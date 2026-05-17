"""Unit tests for the 2026-05-17 email quiet-hours guard.

Josh: "make sure times all emails are sent are always 8-8pm local
Idaho time. however, new referrals can come in anytime they are
triggered."

These tests pin the boundary behavior of `_next_idaho_business_hour()`
and `_compute_scheduled_at()` so future refactors can't silently
shift the window. No Mongo / no live backend needed — pure unit
tests against the helpers in email_service.

If quiet hours are widened (e.g. to 7am-9pm) or the timezone
changes, update the constants in email_service AND the expected
values below in the same commit.
"""
from __future__ import annotations

import sys
import types
from datetime import datetime
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pytest

# Stub out modules that require Mongo so importing email_service
# doesn't pull in the live DB. These tests only need the pure
# helpers; the _send() path that calls _log_send is not exercised.
class _StubColl:
    async def insert_one(self, doc):
        return None


class _StubDB:
    email_sends = _StubColl()


for mod_name in ("deps", "server"):
    fake = types.ModuleType(mod_name)
    fake.db = _StubDB()
    sys.modules.setdefault(mod_name, fake)

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import email_service  # noqa: E402


IDAHO = ZoneInfo("America/Boise")


class _FrozenDatetime(datetime):
    """datetime subclass whose .now() returns a pinned moment.

    Used to drive the helper through specific Idaho local times
    regardless of the wall-clock the test happens to run at.
    """

    _frozen_at: datetime | None = None

    @classmethod
    def now(cls, tz=None):  # noqa: N804
        if cls._frozen_at is None:
            return super().now(tz)
        return cls._frozen_at.astimezone(tz) if tz else cls._frozen_at


def _freeze_idaho(hour: int, minute: int = 0, day: int = 17) -> None:
    _FrozenDatetime._frozen_at = datetime(
        2026, 5, day, hour, minute, 0, tzinfo=IDAHO
    )


# ─── _next_idaho_business_hour() boundaries ──────────────────────


@pytest.mark.parametrize(
    "hour,minute,expect_defer",
    [
        # Inside 8 AM–8 PM window: send NOW
        (8, 0, False),       # inclusive lower bound
        (8, 1, False),
        (12, 0, False),
        (19, 59, False),     # 1 min before close, still NOW
        # Outside window: DEFER
        (7, 59, True),       # 1 min before window opens
        (20, 0, True),       # exclusive upper bound -> defer
        (20, 1, True),
        (23, 59, True),
        (0, 0, True),
        (3, 0, True),
        (6, 30, True),
    ],
)
def test_quiet_hours_boundary(hour: int, minute: int, expect_defer: bool) -> None:
    _freeze_idaho(hour, minute)
    with patch.object(email_service, "datetime", _FrozenDatetime):
        result = email_service._next_idaho_business_hour()
    if expect_defer:
        assert result is not None, (
            f"Idaho {hour:02d}:{minute:02d} should defer but helper returned None"
        )
        # Result must be UTC and equal to a future 8 AM Idaho local
        idaho_local = result.astimezone(IDAHO)
        assert idaho_local.hour == 8 and idaho_local.minute == 0, (
            f"Deferred time should be 8 AM Idaho local; got {idaho_local}"
        )
    else:
        assert result is None, (
            f"Idaho {hour:02d}:{minute:02d} is inside the 8–8 window; "
            f"helper should return None but returned {result}"
        )


def test_late_evening_defers_to_next_day() -> None:
    """11 PM Idaho -> next 8 AM is TOMORROW, not today."""
    _freeze_idaho(23, 0, day=17)  # Sunday 11 PM Idaho
    with patch.object(email_service, "datetime", _FrozenDatetime):
        result = email_service._next_idaho_business_hour()
    assert result is not None
    idaho_local = result.astimezone(IDAHO)
    assert idaho_local.day == 18, f"Expected day 18, got {idaho_local}"
    assert idaho_local.hour == 8


def test_early_morning_defers_to_same_day() -> None:
    """3 AM Idaho -> next 8 AM is later TODAY, not tomorrow."""
    _freeze_idaho(3, 0, day=17)
    with patch.object(email_service, "datetime", _FrozenDatetime):
        result = email_service._next_idaho_business_hour()
    assert result is not None
    idaho_local = result.astimezone(IDAHO)
    assert idaho_local.day == 17, f"Expected day 17, got {idaho_local}"
    assert idaho_local.hour == 8


# ─── _compute_scheduled_at(template_key) categorization ──────────


def test_referrals_always_send_now() -> None:
    """Josh's rule: referrals can come in anytime they are triggered."""
    _freeze_idaho(2, 0)  # 2 AM Idaho -- normally would defer
    with patch.object(email_service, "datetime", _FrozenDatetime):
        assert email_service._compute_scheduled_at("therapist_notification") is None


def test_user_initiated_flows_always_send_now() -> None:
    """Magic codes / verification / intake receipts must arrive when
    the user is actively waiting -- never deferred."""
    _freeze_idaho(23, 30)  # 11:30 PM Idaho
    with patch.object(email_service, "datetime", _FrozenDatetime):
        for tpl in (
            "verification",
            "magic_code",
            "patient_intake_receipt",
            "therapist_signup_received",
            "patient_results",
        ):
            assert email_service._compute_scheduled_at(tpl) is None, (
                f"{tpl} should send immediately even outside quiet hours"
            )


def test_unknown_template_sends_immediately() -> None:
    """Any new template added later without explicit categorization
    sends immediately — fail-open, so we don't silently start
    deferring a template before its categorization is reviewed."""
    _freeze_idaho(2, 0)
    with patch.object(email_service, "datetime", _FrozenDatetime):
        assert email_service._compute_scheduled_at("brand_new_template") is None
        assert email_service._compute_scheduled_at(None) is None


def test_surveys_defer_outside_window() -> None:
    """Survey emails respect quiet hours."""
    _freeze_idaho(2, 0)  # 2 AM Idaho
    with patch.object(email_service, "datetime", _FrozenDatetime):
        for tpl in (
            "patient_survey_v2_48h",
            "patient_survey_v2_3w",
            "patient_survey_v2_9w",
            "patient_survey_v2_15w",
            "therapist_followup_2w",
            "therapist_survey",
            "therapist_stale_profile_nag",
            "claim_profile",
            "therapist_approved",
            "therapist_rejected",
        ):
            sched = email_service._compute_scheduled_at(tpl)
            assert sched is not None, (
                f"{tpl} should defer at 2 AM Idaho"
            )
            assert "T08:00" in sched or sched.endswith("08:00+00:00") or "+00:00" in sched, (
                f"{tpl} schedule should be ISO 8601 string; got {sched}"
            )


def test_surveys_send_immediately_inside_window() -> None:
    """During business hours, even deferrable templates send now."""
    _freeze_idaho(14, 0)  # 2 PM Idaho
    with patch.object(email_service, "datetime", _FrozenDatetime):
        assert email_service._compute_scheduled_at("patient_survey_v2_48h") is None
        assert email_service._compute_scheduled_at("therapist_approved") is None


def test_deferrable_and_always_send_sets_are_disjoint() -> None:
    """A template can't both defer AND always send."""
    overlap = email_service._QUIET_HOURS_DEFERRABLE & email_service._QUIET_HOURS_ALWAYS_SEND
    assert not overlap, (
        f"Templates appear in both defer + always-send sets: {overlap}"
    )
