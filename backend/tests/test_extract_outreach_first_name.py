"""Unit tests for helpers.extract_outreach_first_name.

The helper exists because cold-outreach scrapers (Psychology Today, Google
Maps Places) sometimes return a business name instead of a person's name.
Falling back to "Hi there," is much better than "Hi Acme,".

These tests pin the behavior so a future regression doesn't quietly
revive the bad greetings.
"""
from helpers import extract_outreach_first_name


# ─── Happy path: real person names ─────────────────────────────────────────

def test_simple_person_name():
    assert extract_outreach_first_name("Sarah Smith") == "Sarah"


def test_person_with_credentials_after_comma():
    assert extract_outreach_first_name("Sarah Smith, LCSW") == "Sarah"


def test_person_with_multiple_credentials():
    assert extract_outreach_first_name("Sarah Smith, LCSW, MFT") == "Sarah"


def test_person_with_credentials_no_comma():
    assert extract_outreach_first_name("Sarah Smith LCSW") == "Sarah"


def test_person_with_doctor_honorific():
    assert extract_outreach_first_name("Dr. Sarah Smith") == "Sarah"


def test_person_with_honorific_and_credentials():
    assert extract_outreach_first_name("Dr. Sarah Smith, PhD") == "Sarah"


def test_person_with_middle_initial():
    assert extract_outreach_first_name("Sarah J. Smith") == "Sarah"


def test_lowercase_name_titlecased():
    assert extract_outreach_first_name("sarah smith") == "Sarah"


def test_uppercase_name_titlecased():
    assert extract_outreach_first_name("SARAH SMITH") == "Sarah"


def test_single_first_name_only():
    # Single-token names are uncommon but legitimate. Allow.
    assert extract_outreach_first_name("Sarah") == "Sarah"


def test_mister_honorific_stripped():
    assert extract_outreach_first_name("Mr. John Doe") == "John"


def test_mrs_honorific_stripped():
    assert extract_outreach_first_name("Mrs. Jane Doe") == "Jane"


# ─── Company-name detection ───────────────────────────────────────────────

def test_llc_suffix_returns_none():
    assert extract_outreach_first_name("Acme Therapy LLC") is None


def test_inc_suffix_returns_none():
    assert extract_outreach_first_name("Wellness Center Inc.") is None


def test_pllc_suffix_returns_none():
    assert extract_outreach_first_name("Smith Counseling PLLC") is None


def test_pc_suffix_returns_none():
    assert extract_outreach_first_name("Boise Behavioral, P.C.") is None


def test_pa_suffix_returns_none():
    assert extract_outreach_first_name("Idaho Mental Health, P.A.") is None


def test_therapy_token_returns_none():
    assert extract_outreach_first_name("Acme Therapy") is None


def test_counseling_token_returns_none():
    assert extract_outreach_first_name("Boise Counseling") is None


def test_center_token_returns_none():
    assert extract_outreach_first_name("Boise Counseling Center") is None


def test_centre_british_spelling_returns_none():
    assert extract_outreach_first_name("Boise Centre for Mental Health") is None


def test_group_token_returns_none():
    assert extract_outreach_first_name("Manhattan Psychology Group") is None


def test_associates_token_returns_none():
    assert extract_outreach_first_name("Mental Health Associates of Idaho") is None


def test_practice_token_returns_none():
    assert extract_outreach_first_name("Smith Therapy Practice") is None


def test_wellness_token_returns_none():
    assert extract_outreach_first_name("Live Up Wellness Hub") is None


def test_psychiatric_token_returns_none():
    assert extract_outreach_first_name("Boise Psychiatric Services") is None


def test_clinic_token_returns_none():
    assert extract_outreach_first_name("Sage Hen Clinic") is None


def test_lone_company_word_returns_none():
    # Just "therapy" alone clearly isn't a person.
    assert extract_outreach_first_name("Therapy") is None


# ─── Edge cases ───────────────────────────────────────────────────────────

def test_empty_string_returns_none():
    assert extract_outreach_first_name("") is None


def test_none_returns_none():
    assert extract_outreach_first_name(None) is None


def test_whitespace_only_returns_none():
    assert extract_outreach_first_name("   ") is None


def test_only_credentials_returns_none():
    assert extract_outreach_first_name("LCSW, PhD") is None


def test_only_honorific_returns_none():
    assert extract_outreach_first_name("Dr.") is None


def test_credentials_only_after_strip():
    # "Dr. LCSW" -- after stripping honorific + credentials nothing left.
    assert extract_outreach_first_name("Dr. LCSW") is None


def test_single_letter_first_name_rejected():
    # "J. Smith" -> after credentials/honorific strip, first token is
    # the initial. Reject as too ambiguous.
    assert extract_outreach_first_name("J. Smith") is None


# ─── Conservative cases (intentional False detections) ─────────────────────

def test_smith_therapy_returns_none_intentionally():
    # Could be a person ("Smith" first name + "Therapy" surname,
    # extremely unlikely) or a business ("Smith Therapy" practice,
    # very common). We pick safer fallback.
    assert extract_outreach_first_name("Smith Therapy") is None


def test_health_in_name_returns_none():
    # Same -- "Sarah Health" is unlikely a person; "Health" almost
    # always business. Conservative.
    assert extract_outreach_first_name("Sarah Health") is None
