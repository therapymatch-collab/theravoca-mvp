"""Helpers for TheraVoca: time, summaries, matching, results delivery."""
from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import HTTPException

from deps import db, logger, DEFAULT_THRESHOLD, MIN_TARGET_MATCHES
from email_service import send_patient_results, send_therapist_notification
from geocoding import haversine_miles
from matching import gap_axes, rank_therapists
from sms_service import send_therapist_referral_sms


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ts_to_iso(ts: Optional[int]) -> Optional[str]:
    """Convert a Stripe Unix timestamp to ISO8601, or None."""
    if ts is None:
        return None
    try:
        return datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat()
    except (TypeError, ValueError):
        return None


def _strip_id(doc: dict[str, Any]) -> dict[str, Any]:
    doc.pop("_id", None)
    return doc


def _parse_iso(s: str) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


def _safe_summary_for_therapist(req: dict[str, Any]) -> dict[str, Any]:
    """Anonymized referral summary for therapists."""
    location_bits = []
    if req.get("location_city"):
        location_bits.append(req["location_city"])
    if req.get("location_zip"):
        location_bits.append(req["location_zip"])
    location_str = ", ".join(location_bits) or "—"
    issues = req.get("presenting_issues") or []
    if isinstance(issues, list):
        issues_display = ", ".join(i.replace("_", " ").title() for i in issues if i)
    else:
        issues_display = str(issues)
    if req.get("other_issue"):
        issues_display = (issues_display + " · " if issues_display else "") + req["other_issue"]
    payment_label = (req.get("payment_type") or "either").title()
    if req.get("payment_type") == "insurance" and req.get("insurance_name"):
        payment_label = f"Insurance — {req['insurance_name']}"
    elif req.get("payment_type") == "cash":
        if req.get("budget"):
            payment_label = f"Cash — up to ${req['budget']}/session"
        if req.get("sliding_scale_ok"):
            payment_label += " (open to sliding scale)"
    elif req.get("payment_type") == "either":
        bits = []
        if req.get("insurance_name"):
            bits.append(f"Insurance: {req['insurance_name']}")
        if req.get("budget"):
            bits.append(f"Cash up to ${req['budget']}")
        if req.get("sliding_scale_ok"):
            bits.append("open to sliding scale")
        if bits:
            payment_label = "Either — " + " · ".join(bits)
    avail = req.get("availability_windows") or []
    avail_display = ", ".join(a.replace("_", " ") for a in avail) or "—"
    style = req.get("style_preference") or []
    style_display = ", ".join(s.replace("_", " ") for s in style if s and s != "no_pref") or "—"
    modality_prefs = req.get("modality_preferences") or []
    modality_prefs_display = ", ".join(modality_prefs) if modality_prefs else "—"

    summary = {
        "Client type": (req.get("client_type") or "").title(),
        "Age group": (req.get("age_group") or "").replace("_", " ").title(),
        "State": req.get("location_state"),
        "Location": location_str,
        "Session format": (req.get("modality_preference") or "").replace("_", " ").title(),
        "Payment": payment_label,
        "Presenting issues": issues_display or "—",
        "Preferred therapy approach": modality_prefs_display,
        "Availability": avail_display,
        "Urgency": (req.get("urgency") or "flexible").replace("_", " ").title(),
        "Prior therapy": (req.get("prior_therapy") or "").replace("_", " ").title(),
        "Style preference": style_display,
    }
    if req.get("prior_therapy") == "yes_not_helped" and req.get("prior_therapy_notes"):
        summary["What didn't work last time"] = req["prior_therapy_notes"]
    return summary


async def _trigger_matching(request_id: str, threshold: Optional[float] = None) -> dict[str, Any]:
    req = await db.requests.find_one({"id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Request not found")
    if threshold is None:
        threshold = req.get("threshold", DEFAULT_THRESHOLD)
    therapists_cursor = db.therapists.find(
        {
            "is_active": {"$ne": False},
            "pending_approval": {"$ne": True},
            "subscription_status": {"$nin": ["past_due", "canceled", "unpaid", "incomplete"]},
        }, {"_id": 0},
    )
    therapists = await therapists_cursor.to_list(2000)
    matches = rank_therapists(
        therapists, req, threshold=threshold, top_n=MIN_TARGET_MATCHES, min_results=3,
    )

    already = set(req.get("notified_therapist_ids") or [])
    new_matches = [m for m in matches if m["id"] not in already]

    notified_ids = list(already) + [m["id"] for m in new_matches]
    notified_scores = req.get("notified_scores") or {}
    notified_scores.update({m["id"]: m["match_score"] for m in new_matches})
    notified_breakdowns: dict[str, dict] = req.get("notified_breakdowns") or {}
    notified_breakdowns.update({m["id"]: m.get("match_breakdown") or {} for m in new_matches})
    notified_distances: dict[str, float] = req.get("notified_distances") or {}
    patient_geo = req.get("patient_geo")
    if patient_geo:
        for m in new_matches:
            offices = m.get("office_geos") or []
            if offices:
                dists = [
                    haversine_miles(patient_geo["lat"], patient_geo["lng"], o["lat"], o["lng"])
                    for o in offices if "lat" in o and "lng" in o
                ]
                if dists:
                    notified_distances[m["id"]] = round(min(dists), 1)

    summary = _safe_summary_for_therapist(req)
    public_url = os.environ.get("PUBLIC_APP_URL", "")
    for m in new_matches:
        notify_email = m.get("notify_email", True)
        notify_sms = m.get("notify_sms", True)
        gaps = gap_axes(m, req, m.get("match_breakdown") or {}, top_n=3)
        if notify_email:
            await send_therapist_notification(
                to=m["email"],
                therapist_name=m["name"].split(",")[0],
                request_id=req["id"],
                therapist_id=m["id"],
                match_score=m["match_score"],
                summary=summary,
                gaps=gaps,
            )
        phone = m.get("phone_alert") or m.get("phone") or ""
        if phone and notify_sms:
            apply_url = f"{public_url}/therapist/apply/{req['id']}/{m['id']}"
            try:
                await send_therapist_referral_sms(
                    to=phone,
                    therapist_first_name=m["name"].split(",")[0],
                    match_score=m["match_score"],
                    apply_url=apply_url,
                )
            except Exception as e:
                logger.warning("SMS send failed for therapist %s: %s", m["id"], e)

    notified_total = len(notified_ids)
    outreach_needed_count = max(0, MIN_TARGET_MATCHES - notified_total)
    await db.requests.update_one(
        {"id": request_id},
        {"$set": {
            "notified_therapist_ids": notified_ids,
            "notified_scores": notified_scores,
            "notified_breakdowns": notified_breakdowns,
            "notified_distances": notified_distances,
            "matched_at": _now_iso(),
            "status": "matched",
            "outreach_needed_count": outreach_needed_count,
        }},
    )
    logger.info(
        "Matched request %s -> notified %d new (total %d, outreach gap %d) at threshold>=%s",
        request_id, len(new_matches), notified_total, outreach_needed_count, threshold,
    )
    # Auto-fire LLM outreach in background if we have a gap to fill
    if outreach_needed_count > 0 and os.environ.get("OUTREACH_AUTO_RUN", "true").lower() == "true":
        try:
            from outreach_agent import run_outreach_for_request
            asyncio.create_task(run_outreach_for_request(request_id))
        except Exception as e:
            logger.warning("Could not schedule outreach for %s: %s", request_id, e)
    return {
        "notified_new": len(new_matches),
        "notified_total": notified_total,
        "outreach_needed_count": outreach_needed_count,
        "matches": [
            {"id": m["id"], "name": m["name"], "match_score": m["match_score"]}
            for m in new_matches
        ],
    }


async def _deliver_results(request_id: str) -> dict[str, Any]:
    req = await db.requests.find_one({"id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Request not found")
    apps = await db.applications.find({"request_id": request_id}, {"_id": 0}).to_list(50)
    matched_at = req.get("matched_at") or req.get("created_at")
    matched_dt = _parse_iso(matched_at) if matched_at else None
    for a in apps:
        ms = float(a.get("match_score") or 0)
        speed_bonus = 0.0
        if matched_dt:
            applied_dt = _parse_iso(a.get("created_at") or "")
            if applied_dt:
                hours = max(0.0, (applied_dt - matched_dt).total_seconds() / 3600.0)
                speed_bonus = max(0.0, min(30.0, 30.0 * (24.0 - hours) / 24.0))
        msg_len = len(a.get("message") or "")
        quality_bonus = min(10.0, msg_len / 300.0 * 10.0)
        a["patient_rank_score"] = round(min(100.0, ms * 0.6 + speed_bonus + quality_bonus), 1)

    apps.sort(key=lambda a: (a.get("patient_rank_score", 0), a.get("created_at", "")), reverse=True)

    enriched = []
    breakdowns = req.get("notified_breakdowns") or {}
    for a in apps:
        t = await db.therapists.find_one({"id": a["therapist_id"]}, {"_id": 0})
        if t:
            t_view = {
                **t,
                "specialties_display": (t.get("primary_specialties") or [])
                + (t.get("secondary_specialties") or []),
            }
            enriched.append({
                **a,
                "therapist": t_view,
                "match_breakdown": breakdowns.get(a["therapist_id"]) or {},
            })

    await send_patient_results(req["email"], request_id, enriched)
    # Mark sent + auto-release the 24h hold so the patient sees results now.
    now_iso = _now_iso()
    await db.requests.update_one(
        {"id": request_id},
        {"$set": {
            "results_sent_at": now_iso,
            "results_released_at": now_iso,
            "status": "completed",
        }},
    )
    return {"sent_to": req["email"], "count": len(enriched)}


async def _backfill_therapist_geo() -> None:
    """One-shot backfill: geocode any therapist missing office_geos."""
    from geocoding import geocode_offices
    cursor = db.therapists.find(
        {"office_geos": {"$exists": False}},
        {"_id": 0, "id": 1, "office_locations": 1},
    )
    count = 0
    async for doc in cursor:
        geos = await geocode_offices(db, doc.get("office_locations") or [], "ID")
        await db.therapists.update_one({"id": doc["id"]}, {"$set": {"office_geos": geos}})
        count += 1
    if count:
        logger.info("Backfilled office_geos for %d therapists", count)
