"""Iter-89 v2 — deep-match scoring unit tests.

Three deterministic scoring functions:
- _score_relationship_style: cosine_sim(P1_vec, blend(T1_rank, T4))
- _score_way_of_working:     overlap(P2_picks, T3_picks) / 2
- _score_contextual_resonance: 0.7·sim(P3,T5) + 0.3·sim(P3,T2)

All three return a value in [0,1]. Embedding-based scoring is
verified with toy 2D vectors so we don't need the OpenAI API in CI.
"""
from __future__ import annotations

import math

import pytest

from matching import (
    _score_relationship_style,
    _score_way_of_working,
    _score_contextual_resonance,
    _deep_match_bonus,
    _DEEP_MATCH_DEFAULT_WEIGHTS,
    _DEEP_MATCH_SCALE,
    _T4_BOOST_MAP,
    _P1_T1_KEYS,
)


# ─── Relationship Style (P1 ↔ T1+T4) ─────────────────────────────────────

def test_relationship_perfect_top_two_alignment():
    """Patient picked the exact 2 things the therapist ranked #1 and #2.
    Cosine sim should be near 1.0."""
    p1 = ["challenges", "direct_honest"]
    # Therapist ranks: challenges=1st, direct_honest=2nd, ...
    t1_rank = ["challenges", "direct_honest", "leads_structured",
               "warm_first", "guides_questions", "follows_lead"]
    score = _score_relationship_style(p1, t1_rank, t4=None)
    # P=[0,0,1,0,1,0]; T_norm=[0.6,0.0,1.0,0.4,0.8,0.2]
    # cos = (1.0+0.8)/sqrt(2)/sqrt(0.6²+1²+0.4²+0.8²+0.2²)
    assert 0.85 < score <= 1.0, score


def test_relationship_total_mismatch():
    """Patient picked the 2 slugs the therapist ranked #5 and #6."""
    p1 = ["follows_lead", "guides_questions"]
    t1_rank = ["challenges", "direct_honest", "leads_structured",
               "warm_first", "follows_lead", "guides_questions"]
    score = _score_relationship_style(p1, t1_rank, t4=None)
    # Patient slugs at positions 5 (rank-5 → 0.2) and 6 (rank-6 → 0.0)
    assert score < 0.4, score


def test_relationship_t4_direct_lifts_challenge_score():
    """When the patient picked 'challenges'/'direct_honest', a T4 of
    'direct' should lift the score because it boosts indices 2 and 4."""
    p1 = ["challenges", "direct_honest"]
    t1_rank = ["leads_structured", "warm_first", "challenges",
               "direct_honest", "follows_lead", "guides_questions"]
    base = _score_relationship_style(p1, t1_rank, t4=None)
    boosted = _score_relationship_style(p1, t1_rank, t4="direct")
    assert boosted > base


def test_relationship_t4_questions_lifts_guides_questions():
    """T4 'questions' boosts index 5 (`guides_questions`) — a patient who
    picked that slug should benefit."""
    p1 = ["guides_questions", "warm_first"]
    t1_rank = ["leads_structured", "challenges", "direct_honest",
               "warm_first", "follows_lead", "guides_questions"]
    base = _score_relationship_style(p1, t1_rank, t4=None)
    boosted = _score_relationship_style(p1, t1_rank, t4="questions")
    assert boosted > base


def test_relationship_empty_inputs_return_zero():
    assert _score_relationship_style([], ["challenges"], "direct") == 0.0
    assert _score_relationship_style(["challenges"], [], "direct") == 0.0


def test_t4_boost_map_indices_match_p1_t1_keys():
    """Every index referenced by the boost map must fall inside the
    canonical 6-slot vector. Catches typos when adding new T4 slugs."""
    for slug, boosts in _T4_BOOST_MAP.items():
        for idx in boosts:
            assert 0 <= idx < len(_P1_T1_KEYS), (slug, idx)


# ─── Way of Working (P2 ↔ T3) ────────────────────────────────────────────

def test_way_of_working_full_overlap():
    p2 = ["deep_emotional", "build_insight"]
    t3 = ["deep_emotional", "build_insight"]
    assert _score_way_of_working(p2, t3) == 1.0


def test_way_of_working_half_overlap():
    p2 = ["practical_tools", "explore_past"]
    t3 = ["practical_tools", "shift_relationships"]
    assert _score_way_of_working(p2, t3) == 0.5


def test_way_of_working_no_overlap():
    p2 = ["deep_emotional", "explore_past"]
    t3 = ["practical_tools", "focus_forward"]
    assert _score_way_of_working(p2, t3) == 0.0


def test_way_of_working_empty_returns_zero():
    assert _score_way_of_working([], ["deep_emotional"]) == 0.0
    assert _score_way_of_working(["deep_emotional"], []) == 0.0


# ─── Contextual Resonance (P3 ↔ T5+T2) ──────────────────────────────────

def test_contextual_perfect_alignment():
    """Identical embeddings → cos = 1.0 → score = 0.7·1 + 0.3·1 = 1.0"""
    v = [1.0, 0.0, 0.0]
    assert _score_contextual_resonance(v, v, v) == 1.0


def test_contextual_orthogonal_embeddings():
    """Perpendicular vectors → cos = 0 → score = 0.0"""
    a = [1.0, 0.0]
    b = [0.0, 1.0]
    assert _score_contextual_resonance(a, b, b) == 0.0


def test_contextual_t5_weighted_higher_than_t2():
    """T5 has 0.7 weight; T2 has 0.3. Same patient vector should score
    higher when T5 is the aligned one than when T2 is."""
    p3 = [1.0, 0.0]
    aligned = [1.0, 0.0]
    orthogonal = [0.0, 1.0]
    t5_aligned = _score_contextual_resonance(p3, aligned, orthogonal)
    t2_aligned = _score_contextual_resonance(p3, orthogonal, aligned)
    assert t5_aligned > t2_aligned
    # Specifically T5 weight 0.7 vs T2 weight 0.3
    assert math.isclose(t5_aligned, 0.7, abs_tol=0.01)
    assert math.isclose(t2_aligned, 0.3, abs_tol=0.01)


def test_contextual_missing_embeddings_returns_zero():
    """No embeddings on either side ⇒ 0 (no signal, no penalty)."""
    assert _score_contextual_resonance(None, [1.0], [1.0]) == 0.0
    assert _score_contextual_resonance([1.0], None, None) == 0.0


# ─── Combined deep_match_bonus payload ───────────────────────────────────

def test_deep_match_bonus_returns_v2_axis_names():
    r = {
        "p1_communication": ["challenges", "direct_honest"],
        "p2_change": ["deep_emotional", "build_insight"],
        "p3_embedding": [1.0, 0.0],
    }
    t = {
        "t1_stuck_ranked": ["challenges", "direct_honest", "leads_structured",
                            "warm_first", "guides_questions", "follows_lead"],
        "t4_hard_truth": "direct",
        "t3_breakthrough": ["deep_emotional", "build_insight"],
        "t5_embedding": [1.0, 0.0],
        "t2_embedding": [1.0, 0.0],
    }
    out = _deep_match_bonus(r, t)
    # v2 axis names
    assert "relationship_style" in out
    assert "way_of_working" in out
    assert "contextual_resonance" in out
    assert out["way_of_working"] == 1.0  # full overlap
    assert out["contextual_resonance"] == 1.0  # identical vectors
    assert out["bonus"] > 0


def test_deep_match_weights_default_sum_to_one():
    s = sum(_DEEP_MATCH_DEFAULT_WEIGHTS.values())
    assert s == pytest.approx(1.0)
    assert _DEEP_MATCH_DEFAULT_WEIGHTS["relationship_style"] == 0.40
    assert _DEEP_MATCH_DEFAULT_WEIGHTS["way_of_working"] == 0.35
    assert _DEEP_MATCH_DEFAULT_WEIGHTS["contextual_resonance"] == 0.25


def test_deep_match_bonus_capped_by_scale():
    """A perfect match across all three axes should hit
    _DEEP_MATCH_SCALE (within rounding)."""
    r = {
        "p1_communication": ["challenges", "direct_honest"],
        "p2_change": ["deep_emotional", "build_insight"],
        "p3_embedding": [1.0, 0.0],
    }
    t = {
        "t1_stuck_ranked": ["challenges", "direct_honest", "leads_structured",
                            "warm_first", "guides_questions", "follows_lead"],
        "t4_hard_truth": None,
        "t3_breakthrough": ["deep_emotional", "build_insight"],
        "t5_embedding": [1.0, 0.0],
        "t2_embedding": [1.0, 0.0],
    }
    out = _deep_match_bonus(r, t)
    assert out["bonus"] <= _DEEP_MATCH_SCALE + 0.01
