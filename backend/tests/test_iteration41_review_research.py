"""Iter-41: LLM review-research agent — guardrails on the aggregation logic.

We don't test the actual LLM call (network + flaky). We test:
1. `_summarize` correctly weight-averages multi-platform review data.
2. Sources with count < MIN_REVIEWS_PER_SOURCE are dropped from the avg.
3. The matching engine's `reviews` axis correctly awards +5 / +2 / 0 based on
   the persisted fields.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=True)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def test_summarize_weights_by_count():
    from review_research_agent import _summarize
    out = _summarize([
        {"platform": "Google", "rating": 4.8, "count": 50},
        {"platform": "Yelp", "rating": 4.0, "count": 10},
    ])
    # weighted avg = (4.8*50 + 4.0*10) / 60 = (240 + 40)/60 = 4.666...
    assert out["count"] == 60
    assert abs(out["avg"] - 4.67) < 0.02


def test_summarize_drops_low_volume_sources():
    from review_research_agent import _summarize, MIN_REVIEWS_PER_SOURCE
    assert MIN_REVIEWS_PER_SOURCE >= 10
    out = _summarize([
        {"platform": "Google", "rating": 5.0, "count": 5},  # too few
        {"platform": "Yelp", "rating": 4.2, "count": 20},
    ])
    assert out["count"] == 20
    assert abs(out["avg"] - 4.2) < 0.01


def test_summarize_empty_returns_zero():
    from review_research_agent import _summarize
    out = _summarize([])
    assert out == {"avg": 0.0, "count": 0}


def test_summarize_invalid_rating_dropped():
    from review_research_agent import _summarize
    out = _summarize([
        {"platform": "Google", "rating": 6.0, "count": 50},  # invalid >5
        {"platform": "Yelp", "rating": 4.5, "count": 25},
    ])
    assert out["count"] == 25
    assert abs(out["avg"] - 4.5) < 0.01


def test_matching_review_axis_awards_points():
    """Confirm the matching engine still rewards review_avg/count combos
    correctly after our changes."""
    from matching import score_therapist
    base_request = {
        "location_state": "ID",
        "client_type": "individual",
        "age_group": "adult",
        "payment_type": "cash",
        "budget": 200,
        "presenting_issues": ["anxiety"],
        "availability_windows": ["weekday_morning"],
        "modality_preference": "hybrid",
        "urgency": "flexible",
        "prior_therapy": "not_sure",
        "experience_preference": "no_pref",
        "gender_preference": "no_pref",
        "style_preference": [],
    }
    base_t = {
        "licensed_states": ["ID"],
        "client_types": ["individual"],
        "age_groups": ["adult"],
        "telehealth": True, "offers_in_person": True,
        "cash_rate": 150, "sliding_scale": False,
        "primary_specialties": ["anxiety"],
        "modalities": ["CBT"],
        "modality_offering": "both",
        "availability_windows": ["weekday_morning"],
        "urgency_capacity": "within_2_3_weeks",
        "years_experience": 8,
        "gender": "female",
        "style_tags": [],
    }

    no_reviews = score_therapist({**base_t, "review_avg": 0, "review_count": 0}, base_request)
    mid_reviews = score_therapist({**base_t, "review_avg": 4.2, "review_count": 25}, base_request)
    hi_reviews = score_therapist({**base_t, "review_avg": 4.7, "review_count": 80}, base_request)

    assert no_reviews["breakdown"].get("reviews") == 0
    assert mid_reviews["breakdown"].get("reviews") == 2
    assert hi_reviews["breakdown"].get("reviews") == 5
    # Sanity: hi > mid > none on total score
    assert hi_reviews["total"] > mid_reviews["total"] >= no_reviews["total"]
