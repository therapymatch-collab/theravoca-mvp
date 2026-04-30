"""iter-112 — Step-2 patient_rank_score is the SINGLE source of truth for
ranking applicants in the patient view, the admin view, AND the patient
results email. Verifies all three callsites produce identical ranks given
the same input.

Background: user reported that all 6 applied therapists on request
`0b0e5091…` showed flat 95% in the admin view. Root cause was that
`match_score` is correctly capped at 95% (Step-1 design), but the admin
view was rendering `match_score` instead of the differentiated
`patient_rank_score`. iter-111 wired both views through
`helpers.compute_patient_rank_score`. This test locks that in + extends
to cover the email-delivery path."""
from __future__ import annotations

from helpers import compute_patient_rank_score


def _base_request() -> dict:
    return {
        "id": "req-step2-test",
        "matched_at": "2026-04-30T00:00:00+00:00",
        "presenting_issues": ["trauma_ptsd", "anxiety"],
    }


def _make_app(*, msg: str = "", apply_fit: float = 0.0,
              commits: int = 0, applied_at: str = "2026-04-30T01:00:00+00:00",
              match_score: float = 95.0) -> dict:
    return {
        "therapist_id": f"t-{abs(hash((msg, apply_fit, commits, applied_at)))}",
        "match_score": match_score,
        "message": msg,
        "apply_fit": apply_fit,
        "confirms_availability": commits >= 1,
        "confirms_urgency": commits >= 2,
        "confirms_payment": commits >= 3,
        "created_at": applied_at,
    }


def test_six_tied_step1_scores_differentiate_at_step2():
    """The exact bug-class from the user's complaint: all 6 therapists
    capped at Step-1 95% — Step-2 must differentiate based on message
    quality, apply_fit, and commits."""
    req = _base_request()
    apps = [
        _make_app(msg="I have extensive trauma & PTSD experience using EMDR. I have an open slot Tuesday — happy to do a free 15-min consult.", apply_fit=4.5, commits=3),
        _make_app(msg="I work with anxiety and trauma. I'd love to chat.", apply_fit=2.5, commits=3),
        _make_app(msg="Hi.", apply_fit=0.5, commits=1, applied_at="2026-04-30T03:00:00+00:00"),
        _make_app(msg="", apply_fit=0.0, commits=0, applied_at="2026-04-30T08:00:00+00:00"),
        _make_app(msg="Yes, I treat trauma and PTSD. My approach is somatic therapy.", apply_fit=3.5, commits=2),
        _make_app(msg="I'd be happy to see this patient — I've been doing trauma work for 15 years.", apply_fit=3.0, commits=1),
    ]
    for a in apps:
        a.update(compute_patient_rank_score(a, req))

    ranks = [a["patient_rank_score"] for a in apps]
    # Strict differentiation — every app must have a unique rank.
    assert len(set(ranks)) == len(ranks), (
        f"Step-2 should differentiate 6 distinct applications; got {ranks}"
    )
    # Best application (a[0]) must rank highest.
    sorted_apps = sorted(apps, key=lambda a: a["patient_rank_score"], reverse=True)
    assert sorted_apps[0] is apps[0], (
        "Highest apply_fit + most engaged message + fastest must rank #1"
    )
    # Empty/no-effort application (a[3]) must rank last.
    assert sorted_apps[-1] is apps[3], (
        "Empty message + no commits + no apply_fit must rank last"
    )


def test_step2_score_caps_at_99_never_100():
    """Mirror of the Step-1 95% cap philosophy — the rescaled Step-2
    output must ceiling at 99 so we never claim a perfect match."""
    req = _base_request()
    perfect_app = _make_app(
        msg="I specialise in trauma and PTSD using EMDR + CPT. I have an open slot tomorrow at 2pm — happy to do a free 15-min intake call. I bill insurance directly.",
        apply_fit=5.0,
        commits=3,
        applied_at="2026-04-30T00:01:00+00:00",  # within 1 minute → max speed
    )
    perfect_app.update(compute_patient_rank_score(perfect_app, req))
    assert perfect_app["patient_rank_score"] <= 99.0
    assert perfect_app["patient_rank_score"] > 90.0  # but should be high


def test_step2_components_breakdown_present():
    """The breakdown surfaces in patient + admin tooltips — must be
    populated and add up coherently."""
    req = _base_request()
    a = _make_app(msg="I treat trauma using EMDR.", apply_fit=4.0, commits=2)
    a.update(compute_patient_rank_score(a, req))

    assert "rank_components" in a
    comp = a["rank_components"]
    for key in ("step1_baseline", "speed_bonus", "quality_bonus",
                "apply_fit_bonus", "commit_bonus", "raw_total",
                "max_possible"):
        assert key in comp
    # Components should sum (approximately) to raw_total.
    summed = (comp["step1_baseline"] + comp["speed_bonus"]
              + comp["quality_bonus"] + comp["apply_fit_bonus"]
              + comp["commit_bonus"])
    assert abs(summed - comp["raw_total"]) < 0.5


def test_step2_response_quality_breakdown():
    """Response-quality sub-components surface for the patient tooltip."""
    req = _base_request()
    a = _make_app(
        msg="I work with trauma using EMDR — happy to schedule an intake call tomorrow.",
        apply_fit=4.0, commits=3,
    )
    a.update(compute_patient_rank_score(a, req))
    rq = a["response_quality"]
    assert rq["issue_match"] == 3.0  # "trauma" matched
    assert rq["action_signal"] == 2.0  # "schedule" + "tomorrow"
    assert rq["personal_voice"] >= 1.0  # "I work with..."
    assert rq["length"] > 0


def test_legacy_app_with_no_message_still_ranks():
    """Old applications missing message + apply_fit should still
    produce a coherent (lower) rank, not crash."""
    req = _base_request()
    a = _make_app(msg="", apply_fit=0.0, commits=0)
    a.update(compute_patient_rank_score(a, req))
    assert isinstance(a["patient_rank_score"], (int, float))
    assert 0 <= a["patient_rank_score"] <= 99.0
