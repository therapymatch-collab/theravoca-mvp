"""
Auto-recruit — the closed-loop recruiter that binds together:
  * `simulator.py`       — audits the current pool and surfaces zero-pool
                           hotspots (group × child, couples × older_adult, etc.)
  * `_compute_coverage_gap_analysis` (routes/admin.py) — dimensional deltas
                           vs calibrated targets (child_teen<5, group<11, ...)
  * `gap_recruiter.py`    — turns each gap into verified LLM/Places candidate
                           drafts in `recruit_drafts`
  * Outreach sender       — fires emails/SMS (admin-approved, post-launch)

Flow per cycle:
  1. Run a fresh simulator pass (200 requests) against the current pool.
  2. If `zero_pool_rate_pct <= target` → skip ("healthy"), stamp the cycle
     doc and return. This is the "pause when target reached" policy.
  3. Otherwise, build a `recruit_plan` — a prioritized list of specific
     (dimension, slug, deficit) tuples pulled from BOTH the simulator's
     filter_failure_totals AND `_compute_coverage_gap_analysis` so the
     two views agree on what to recruit.
  4. Call `gap_recruiter.run_gap_recruitment(dry_run=True, max_drafts=N)`.
     All drafts created get stamped with `auto_recruit_cycle_id` + 
     `needs_approval=True`. The admin panel shows them for manual
     sign-off before anything real ever goes out.
  5. Persist the cycle to `auto_recruit_cycles` so the admin can see
     the trend over weeks/months.

Nothing in this module sends real emails. Actual outreach is gated
behind `auto_recruit_config.dry_run=True` (current default) + the
manual admin-approval step (`POST /admin/auto-recruit/approve-batch`).
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)


# ── Defaults (all overridable via `auto_recruit_config` singleton) ──────
DEFAULT_CONFIG: dict[str, Any] = {
    "_id": "singleton",
    "enabled": True,
    "dry_run": True,              # never send real emails/SMS today
    "require_approval": True,     # admin must click approve before send
    "target_zero_pool_pct": 5.0,  # stop recruiting when ≤ this %
    "max_drafts_per_cycle": 10,   # per gap recruiter invocation
    "max_sends_per_day_email": 10,
    "max_sends_per_day_sms": 10,
    "cycle_frequency": "weekly",  # weekly | daily | manual
    "sim_num_requests": 200,      # how many synthetic requests per audit
}


async def get_config(db) -> dict[str, Any]:
    """Fetch the singleton config doc — seed defaults on first read."""
    doc = await db.auto_recruit_config.find_one({"_id": "singleton"}, {"_id": 0})
    if doc:
        # Ensure any missing newer keys get filled in so old configs don't
        # break after a deploy that added a field.
        merged = {**DEFAULT_CONFIG, **doc}
        merged.pop("_id", None)
        return merged
    # Seed on first access.
    await db.auto_recruit_config.insert_one(dict(DEFAULT_CONFIG))
    out = dict(DEFAULT_CONFIG)
    out.pop("_id", None)
    return out


async def update_config(db, patch: dict) -> dict[str, Any]:
    """Merge-patch the singleton config. Accepts only known keys."""
    allowed = set(DEFAULT_CONFIG.keys()) - {"_id"}
    clean = {k: v for k, v in patch.items() if k in allowed}
    if not clean:
        return await get_config(db)
    await db.auto_recruit_config.update_one(
        {"_id": "singleton"},
        {"$set": clean, "$setOnInsert": {"_id": "singleton"}},
        upsert=True,
    )
    return await get_config(db)


# ─── Plan builder ──────────────────────────────────────────────────────────

# Map simulator filter-failure slugs → gap-recruiter dimension names so the
# two systems agree on what "client_type gap" means. Gap recruiter uses
# `specialty`, `modality`, `age_group`, `client_type`, `insurance`, `language`,
# `urgency`, `fee`, `geography`. Simulator emits the raw axis name.
_FILTER_TO_DIM = {
    "client_type": "client_type",
    "age_group": "age_group",
    "primary_concern": "specialty",
    "modality": "modality",
    "language": "language",
    "urgency": "urgency",
    "payment": "insurance",
    "availability": "urgency",   # availability strict maps to capacity
}

# Human-readable labels for the cycle notes / admin UI.
_DIM_LABELS = {
    "client_type": "Client type (couples / family / group)",
    "age_group": "Age group (child / teen / older_adult)",
    "specialty": "Clinical specialty",
    "modality": "Treatment modality",
    "language": "Non-English language",
    "urgency": "Urgent / tight availability",
    "insurance": "Insurance / payment",
    "geography": "In-person city coverage",
    "fee": "Fee tier",
}


def _build_recruit_plan(
    sim_report: dict, coverage_gap: dict,
) -> list[dict[str, Any]]:
    """Merge the simulator's filter-failure data with the coverage-gap
    analysis into a prioritized recruit plan.

    Priority is assigned as:
      - `critical` → simulator said this filter caused >= 20% of exclusions
                     AND coverage-gap analysis flagged any critical gap
                     in the same dimension.
      - `high`     → simulator >= 10% OR coverage-gap critical in that dim.
      - `medium`   → coverage-gap warning only.
    Each row: {dimension, slug, label, priority, sim_hits, gap_severity,
               deficit, target}
    """
    total_fail = sum((sim_report.get("coverage") or {}).get(
        "filter_failure_totals", {}).values()) or 1
    sim_pct_by_dim: dict[str, float] = {}
    for raw_slug, hits in (sim_report.get("coverage") or {}).get(
        "filter_failure_totals", {}
    ).items():
        dim = _FILTER_TO_DIM.get(raw_slug) or raw_slug
        sim_pct_by_dim[dim] = sim_pct_by_dim.get(dim, 0) + (100 * hits / total_fail)

    gaps = coverage_gap.get("gaps", []) or []
    out: list[dict] = []
    seen: set[tuple[str, str]] = set()

    # First, materialize every coverage-gap row as a planned recruit.
    for g in gaps:
        dim = g.get("dimension")
        slug = g.get("key") or g.get("slug") or ""
        sev = g.get("severity") or "warning"
        sim_pct = sim_pct_by_dim.get(dim, 0.0)
        if sev == "critical" and sim_pct >= 20:
            priority = "critical"
        elif sev == "critical" or sim_pct >= 10:
            priority = "high"
        else:
            priority = "medium"
        row = {
            "dimension": dim,
            "label": _DIM_LABELS.get(dim, dim or "unknown"),
            "slug": slug,
            "priority": priority,
            "sim_pct": round(sim_pct, 1),
            "gap_severity": sev,
            "current": g.get("current"),
            "target": g.get("target"),
            "deficit": max(0, (g.get("target") or 0) - (g.get("current") or 0)),
            "source": "coverage_gap",
        }
        out.append(row)
        seen.add((dim, slug))

    # Backfill: any simulator dimension with >10% filter-failure hits that
    # the coverage-gap analysis missed entirely (e.g. a new HARD the
    # analyzer doesn't yet track) — record as a plan row too.
    for dim, pct in sim_pct_by_dim.items():
        if pct >= 10 and not any(r["dimension"] == dim for r in out):
            out.append({
                "dimension": dim,
                "label": _DIM_LABELS.get(dim, dim),
                "slug": "",
                "priority": "high",
                "sim_pct": round(pct, 1),
                "gap_severity": "warning",
                "current": None,
                "target": None,
                "deficit": None,
                "source": "simulator_only",
            })

    # Sort: critical first, then high, then medium; within a tier by sim_pct.
    rank = {"critical": 0, "high": 1, "medium": 2}
    out.sort(key=lambda r: (rank.get(r["priority"], 9), -r["sim_pct"]))
    return out


async def compute_plan_preview(db) -> dict[str, Any]:
    """Dry build: runs the simulator + coverage analyzer and returns
    the would-be plan WITHOUT creating any drafts. Used by the admin
    "Preview" button before committing a cycle."""
    import simulator
    from routes.admin import _compute_coverage_gap_analysis

    sim_report = await simulator.run_simulation(
        db, num_requests=(await get_config(db)).get("sim_num_requests", 200),
        random_seed=None,
    )
    coverage = await _compute_coverage_gap_analysis()
    plan = _build_recruit_plan(sim_report, coverage)
    return {
        "sim_run_id": sim_report.get("id"),
        "zero_pool_rate_pct": (sim_report.get("coverage") or {}).get(
            "zero_pool_rate_pct", 0),
        "pool_size": (sim_report.get("coverage") or {}).get("pool_size", 0),
        "plan": plan,
        "plan_total": len(plan),
        "critical_count": sum(1 for p in plan if p["priority"] == "critical"),
        "high_count": sum(1 for p in plan if p["priority"] == "high"),
    }


# ─── Cycle runner ──────────────────────────────────────────────────────────

async def run_cycle(db, *, manual_trigger: bool = False) -> dict[str, Any]:
    """Execute one full auto-recruit cycle and persist it.

    Flow:
      1. Skip if disabled.
      2. Run fresh simulator.
      3. If zero_pool_rate_pct <= target → log a "paused" cycle and return.
      4. Build plan, call gap_recruiter.run_gap_recruitment(dry_run=...).
      5. Stamp every new draft with {auto_recruit_cycle_id, needs_approval}.
      6. Persist the cycle row.

    `manual_trigger=True` bypasses the frequency check (admin "Run now").
    """
    import simulator
    from routes.admin import _compute_coverage_gap_analysis
    from gap_recruiter import run_gap_recruitment

    cfg = await get_config(db)
    cycle_id = str(uuid.uuid4())
    started_at = datetime.now(timezone.utc)

    if not cfg.get("enabled"):
        doc = {
            "id": cycle_id,
            "started_at": started_at.isoformat(),
            "finished_at": started_at.isoformat(),
            "status": "skipped",
            "reason": "auto_recruit disabled in config",
            "triggered_by": "manual" if manual_trigger else "cron",
        }
        await db.auto_recruit_cycles.insert_one(dict(doc))
        return doc

    # Always run a fresh sim so the plan is grounded in current reality.
    sim_report = await simulator.run_simulation(
        db, num_requests=cfg.get("sim_num_requests", 200),
        random_seed=None,
    )
    zero_rate = (sim_report.get("coverage") or {}).get("zero_pool_rate_pct", 0)
    target = cfg.get("target_zero_pool_pct", 5.0)

    if zero_rate <= target:
        doc = {
            "id": cycle_id,
            "started_at": started_at.isoformat(),
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "sim_run_id": sim_report.get("id"),
            "zero_pool_rate_pct_before": zero_rate,
            "target_zero_pool_pct": target,
            "status": "paused_target_reached",
            "drafts_created": 0,
            "recruit_plan": [],
            "triggered_by": "manual" if manual_trigger else "cron",
        }
        await db.auto_recruit_cycles.insert_one(dict(doc))
        # Maintain last_cycle pointer on config
        await db.auto_recruit_config.update_one(
            {"_id": "singleton"},
            {"$set": {
                "last_cycle_at": doc["finished_at"],
                "last_cycle_id": cycle_id,
            }},
        )
        return doc

    coverage = await _compute_coverage_gap_analysis()
    plan = _build_recruit_plan(sim_report, coverage)

    # Kick the gap recruiter. It already picks the highest-severity gaps
    # from `_compute_coverage_gap_analysis()` internally, so we don't need
    # to hand it our plan — we just cap the number of drafts. If you want
    # per-dimension forcing, extend gap_recruiter.run_gap_recruitment().
    try:
        recruit_result = await run_gap_recruitment(
            dry_run=bool(cfg.get("dry_run", True)),
            max_drafts=int(cfg.get("max_drafts_per_cycle", 10)),
        )
    except Exception as e:
        logger.exception("auto-recruit cycle recruit step failed: %s", e)
        recruit_result = {"ok": False, "error": str(e), "drafts_created": 0}

    # Stamp the brand-new drafts with the cycle id + approval flag so the
    # admin UI can list them and require sign-off. We identify "new" drafts
    # as those created in the last minute with no cycle id set.
    from datetime import timedelta
    cutoff = (started_at - timedelta(seconds=1)).isoformat()
    stamp_result = await db.recruit_drafts.update_many(
        {
            "created_at": {"$gte": cutoff},
            "auto_recruit_cycle_id": {"$exists": False},
        },
        {"$set": {
            "auto_recruit_cycle_id": cycle_id,
            "needs_approval": bool(cfg.get("require_approval", True)),
            "auto_generated": True,
        }},
    )
    drafts_stamped = stamp_result.modified_count

    doc = {
        "id": cycle_id,
        "started_at": started_at.isoformat(),
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "sim_run_id": sim_report.get("id"),
        "zero_pool_rate_pct_before": zero_rate,
        "target_zero_pool_pct": target,
        "pool_size": (sim_report.get("coverage") or {}).get("pool_size", 0),
        "recruit_plan": plan,
        "drafts_created": drafts_stamped,
        "gap_recruit_result": {
            "ok": recruit_result.get("ok", False),
            "candidates_seen": recruit_result.get("candidates_seen", 0),
            "gaps_processed": recruit_result.get("gaps_processed", 0),
            "error": recruit_result.get("error"),
        },
        "status": "ok" if recruit_result.get("ok", False) else "error",
        "triggered_by": "manual" if manual_trigger else "cron",
    }
    await db.auto_recruit_cycles.insert_one(dict(doc))
    await db.auto_recruit_config.update_one(
        {"_id": "singleton"},
        {"$set": {
            "last_cycle_at": doc["finished_at"],
            "last_cycle_id": cycle_id,
        }},
    )
    return doc


# ─── Approval + listing helpers ────────────────────────────────────────────

async def list_cycles(db, *, limit: int = 30) -> list[dict]:
    rows = await db.auto_recruit_cycles.find(
        {},
        {"_id": 0},
    ).sort("started_at", -1).to_list(length=limit)
    return rows


async def count_pending_approval(db) -> int:
    """How many drafts are awaiting admin approval across ALL cycles."""
    return await db.recruit_drafts.count_documents({
        "needs_approval": True,
        "sent": {"$ne": True},
    })


async def approve_batch(
    db, *, cycle_id: str | None = None, draft_ids: list[str] | None = None,
) -> int:
    """Flip `needs_approval=False` on drafts matching the given filter.
    Returns the number of drafts approved.

    Approving a draft doesn't send it — it just clears the gate so the
    admin can fire the existing "Send all" action. With dry_run=True this
    is still a no-op in terms of real outbound email."""
    q: dict[str, Any] = {"needs_approval": True}
    if cycle_id:
        q["auto_recruit_cycle_id"] = cycle_id
    if draft_ids:
        q["id"] = {"$in": draft_ids}
    r = await db.recruit_drafts.update_many(
        q,
        {"$set": {
            "needs_approval": False,
            "approved_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    return r.modified_count or 0
