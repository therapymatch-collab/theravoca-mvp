"""Update existing therapist records with real data from the provider directory xlsx.

This script matches xlsx rows to existing Mongo therapists by license_number
(falling back to name), then overwrites placeholder/backfilled fields with
the real data from the spreadsheet.  It also populates the T-fields
(t4_hard_truth, t5_lived_experience, t6_session_expectations,
t6_early_sessions_description) for the first time.

Run modes:
  --dry-run          Print what would change for the first N rows (default 3).
  --dry-run --limit 5   Dry-run on 5 rows.
  --apply            Write all changes to MongoDB.

The script NEVER deletes therapists or wipes collections.  It only $set/$unset
on matched documents.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import openpyxl
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=True)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


# ── Column indices (Dropbox copy -- no Timestamp column) ────────────────
# If your xlsx has a Timestamp in col 0, bump every index by +1.
COL_FIRST_NAME       = 0   # first name with credentials
COL_FULL_NAME        = 1   # full name without credentials
COL_PROVIDER_TYPE    = 2   # credential type
COL_GENDER           = 3
COL_YEARS            = 4
COL_PHONE            = 5
COL_EMAIL            = 6
COL_WEBSITE          = 7
COL_LICENSE          = 8
COL_INSURANCE        = 9
COL_AVAILABILITY     = 10
COL_FREE_CONSULT     = 11
COL_CASH_RATE        = 12
COL_SLIDING_SCALE    = 13
COL_SESSION_TYPE     = 14
COL_OFFICE_ADDRESS   = 15
COL_POPULATIONS      = 16
COL_CLIENT_TYPES     = 17
COL_SPECIALTIES      = 18
COL_MODALITIES       = 19
COL_LANGUAGES        = 20
COL_PERSONALITY      = 21  # -> t5_lived_experience (intentional mislabel)
COL_TYPICAL_SESSION  = 22  # -> t6_early_sessions_description + bio
COL_HOMEWORK         = 23  # -> bio
COL_LASTING_CHANGE   = 24  # -> bio
# cols 25+ are consent / referral / admin -- not imported


# ── Mapping tables (reused from import_therapists_xlsx.py) ──────────────

GENDER_MAP = {
    "female": "female",
    "male": "male",
    "non-binary": "nonbinary",
    "nonbinary": "nonbinary",
    "non binary": "nonbinary",
}

YEARS_MAP = {
    "1-3": 2,
    "4-8": 6,
    "9-16": 12,
    "17+": 20,
}

AVAILABILITY_MAP = {
    "Mornings":  ["weekday_morning"],
    "Afternoons": ["weekday_afternoon"],
    "Evenings":  ["weekday_evening"],
    "Weekends":  ["weekend_morning", "weekend_afternoon"],
}

POPULATION_MAP = {
    "Children (0-12)": "child",
    "Children (0–12)": "child",
    "Adolescents (13-17)": "teen",
    "Adolescents (13–17)": "teen",
    "Young Adults (18-25)": "young_adult",
    "Young Adults (18–25)": "young_adult",
    "Adults (26-64)": "adult",
    "Adults (26–64)": "adult",
    "Older Adults (65+)": "older_adult",
}

CLIENT_TYPE_MAP = {
    "Individual therapy": "individual",
    "Couples/Marriage Counseling": "couples",
    "Family therapy": "family",
    "Group Therapy": "group",
    "Parent Coaching": "individual",
    "Testing": "individual",
}

SPECIALTY_MAP = {
    "Anxiety Disorders": "anxiety",
    "Depression & Mood Disorders": "depression",
    "PTSD & Trauma": "trauma_ptsd",
    "Relationship Issues": "relationship_issues",
    "Life Transitions & Adjustment": "life_transitions",
    "Grief & Loss": "life_transitions",
    "ADHD": "adhd",
    "OCD": "ocd",
    "Substance Use & Addiction": "substance_use",
    "Eating Disorders": "eating_concerns",
    "Autism Spectrum Disorders": "autism_neurodivergence",
    "Burnout & Work Stress": "life_transitions",
    "LGBTQIA+ Mental Health": "relationship_issues",
    "Perinatal/Postpartum Mental Health": "parenting_family",
    "Anger Management": "relationship_issues",
    "Personality Disorders": "depression",
    "Bipolar Disorder": "depression",
    "Suicidality & Self-Harm": "depression",
    "Sexual Issues": "relationship_issues",
    "Chronic Pain & Illness": "life_transitions",
    "Gender Identity & Transition": "relationship_issues",
    "Behavioral Issues in Children": "parenting_family",
    "Divorce/Separation Support": "relationship_issues",
}

MODALITY_MAP = {
    "Cognitive behavioral therapy (CBT)": "CBT",
    "Dialectical behavior therapy (DBT)": "DBT",
    "EMDR": "EMDR",
    "Trauma-Informed": "Trauma-Informed",
    "Acceptance and commitment therapy (ACT)": "ACT",
    "Mindfulness-based Therapies": "Mindfulness-Based",
    "Mindfulness-based cognitive therapy": "Mindfulness-Based",
    "Somatic/Mind Body": "Somatic Experiencing",
    "Solution-Oriented": "Solution-Focused",
    "Motivational Interviewing": "Motivational Interviewing",
    "Humanistic": "Person-Centered",
    "Psychodynamic": "Psychodynamic",
    "Gottman": "Gottman",
    "EFT": "EFT",
    "Behavioral": "Behavioral",
    "Internal Family Systems (IFS)": "IFS",
    "Internal Family Systems": "IFS",
    "Internal Family Systems-Parts Work": "IFS",
    "IFS": "IFS",
    "Ecletic/Integrative": "Eclectic",
    "Coaching style": "Coaching",
    "Imago": "Imago",
    "Play Therapy": "Play Therapy",
    "Sex Therapy": "Sex Therapy",
    "Christian Counseling": "Christian Counseling",
    "Art Therapy": "Art Therapy",
    "Accelerated Resolution Therapy": "Accelerated Resolution Therapy",
    "Ketamine-assisted psychotherapy (KAP)": "KAP",
    "Neuropsychology": "Neuropsychology",
}

INSURANCE_MAP = {
    "blue cross of idaho": "Blue Cross of Idaho",
    "regence blueshield of idaho": "Regence BlueShield of Idaho",
    "regence": "Regence BlueShield of Idaho",
    "blue cross and blue shield": "Blue Cross of Idaho",
    "blue cross blue shield": "Blue Cross of Idaho",
    "blue cross": "Blue Cross of Idaho",
    "blue shield": "Blue Cross of Idaho",
    "mountain health co-op": "Mountain Health Co-op",
    "mountain health coop": "Mountain Health Co-op",
    "mountain co op": "Mountain Health Co-op",
    "mountain coop": "Mountain Health Co-op",
    "pacificsource": "PacificSource Health Plans",
    "pacificsource health plans": "PacificSource Health Plans",
    "pacific source": "PacificSource Health Plans",
    "selecthealth": "SelectHealth",
    "select health": "SelectHealth",
    "slhp (st. lukes health plans)": "SelectHealth",
    "slhp": "SelectHealth",
    "st. lukes health plans": "SelectHealth",
    "st lukes": "SelectHealth",
    "aetna": "Aetna",
    "cigna": "Cigna",
    "evernorth": "Cigna",
    "cigna and evernorth": "Cigna",
    "unitedhealthcare": "UnitedHealthcare",
    "united healthcare": "UnitedHealthcare",
    "united behavioral health": "UnitedHealthcare",
    "uhc": "UnitedHealthcare",
    "humana": "Humana",
    "idaho medicaid": "Idaho Medicaid",
    "medicaid": "Idaho Medicaid",
    "medicare": "Medicare",
    "tricare": "Tricare West",
    "tricare west": "Tricare West",
    "optum": "Optum",
    "magellan": "Magellan Health",
    "magellan health": "Magellan Health",
    "carelon": "Optum",
    "carelon behavioral health": "Optum",
    "slh": "SelectHealth",
    "dmba": "DMBA",
    "first choice health": "First Choice Health",
    "first choice": "First Choice Health",
    # Common abbreviations and variants
    "bcbs": "Blue Cross of Idaho",
    "bcbs ppo": "Blue Cross of Idaho",
    "bci": "Blue Cross of Idaho",
    "bcoi": "Blue Cross of Idaho",
    "bc": "Blue Cross of Idaho",
    "bs": "Blue Cross of Idaho",
    "anthem": "Anthem",
    "anthem eap": "Anthem",
    "united": "UnitedHealthcare",
    "united health care": "UnitedHealthcare",
    "optum eap": "Optum",
    "compsych": "Optum",
    "lyra": "Lyra",
    "lyra health": "Lyra",
    "moda": "Moda Health",
    "moda health": "Moda Health",
    "premera": "Premera Blue Cross",
    "premera blue cross": "Premera Blue Cross",
    "first health": "First Health",
    "multiplan": "MultiPlan",
    "va community care": "VA Community Care",
    "va": "VA Community Care",
    "meritain": "Meritain Health",
    "meritain health": "Meritain Health",
}

PROVIDER_TYPE_MAP = {
    "Professional Counselor": "LPC",
    "Social Worker": "LCSW",
    "LMFT": "LMFT",
    "Psychologist": "PsyD",
    "Psychoanalyst": "Other",
    "Art Therapist": "Other",
    "Other": "Other",
}


# ── Parsers ─────────────────────────────────────────────────────────────

def parse_multi(value: str | None, sep: str = ",") -> list[str]:
    """Split a comma-separated cell into trimmed tokens.
    Filters out leaked address fragments from adjacent Google Form cells."""
    if not value:
        return []
    out = []
    for piece in str(value).split(sep):
        piece = piece.strip()
        if not piece:
            continue
        # Reject leaked address fragments
        if piece.startswith("❌"):  # X mark prefix
            continue
        if re.match(r"^[A-Z]{2}\s*\d{5}", piece):
            continue
        if re.match(r"^\d{5}", piece):
            continue
        if re.search(r"Suite \d", piece, re.I) and len(piece) < 20:
            continue
        # Reject bare city names that leaked from address column
        if piece.lower() in IDAHO_CITIES or piece.lower() in {"spokane", "las vegas"}:
            continue
        out.append(piece)
    return out


def normalize_phone(raw: str | None) -> str:
    """Normalize to (xxx) xxx-xxxx format."""
    if not raw:
        return ""
    digits = re.sub(r"\D", "", str(raw).split(".")[0])
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) == 10:
        return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
    return str(raw).strip()


def parse_cash_rate(raw) -> int | None:
    """Extract integer cash rate from various formats."""
    if raw is None:
        return None
    s = str(raw).strip()
    # Handle float strings like "130.0"
    try:
        return int(float(s))
    except (ValueError, TypeError):
        pass
    # Try extracting digits
    digits = re.sub(r"[^\d]", "", s)
    if digits:
        return int(digits)
    return None


def parse_years(raw: str | None) -> int | None:
    """Parse years-experience range string."""
    if not raw:
        return None
    s = str(raw).strip()
    return YEARS_MAP.get(s)


def parse_gender(raw: str | None) -> str:
    """Lowercase gender."""
    if not raw:
        return ""
    return GENDER_MAP.get(str(raw).strip().lower(), str(raw).strip().lower())


def parse_bool(raw: str | None, depends_true: bool = False) -> bool:
    """Parse Yes/No/Depends to bool."""
    if not raw:
        return False
    s = str(raw).strip().lower()
    if s == "yes":
        return True
    if depends_true and s == "depends":
        return True
    return False


def map_enum_list(values: list[str], mapping: dict, field_name: str,
                  unmapped_log: list) -> list[str]:
    """Map a list of raw values through a mapping dict. Log unknowns."""
    out: list[str] = []
    seen: set[str] = set()
    for v in values:
        slug = mapping.get(v)
        if slug and slug not in seen:
            out.append(slug)
            seen.add(slug)
        elif not slug:
            unmapped_log.append((field_name, v))
    return out


def map_insurance(raw: str | None, unmapped_log: list) -> list[str]:
    """Fuzzy-match insurance names."""
    if not raw:
        return []
    s = str(raw).strip()
    if s.lower() in {"none", "no", "n/a", "no insurance", "private pay only",
                     "cash only", "out of network only"}:
        return []
    out: list[str] = []
    seen: set[str] = set()
    for piece in re.split(r"[,/\n;]", s):
        key = piece.strip().lower()
        if not key:
            continue
        canon = INSURANCE_MAP.get(key)
        if canon and canon not in seen:
            out.append(canon)
            seen.add(canon)
        elif not canon:
            # Try substring matching
            matched = False
            for pattern, target in INSURANCE_MAP.items():
                if pattern in key or key in pattern:
                    if target not in seen:
                        out.append(target)
                        seen.add(target)
                    matched = True
                    break
            if not matched:
                unmapped_log.append(("insurance_accepted", piece.strip()))
    return out


def map_availability(values: list[str], unmapped_log: list) -> list[str]:
    """Map availability strings to slugs."""
    out: list[str] = []
    seen: set[str] = set()
    for v in values:
        slugs = AVAILABILITY_MAP.get(v)
        if slugs:
            for s in slugs:
                if s not in seen:
                    out.append(s)
                    seen.add(s)
        else:
            unmapped_log.append(("availability_windows", v))
    return out


def map_session_type(raw: str | None) -> tuple[str, bool, bool]:
    """Return (modality_offering, telehealth, offers_in_person)."""
    v = (raw or "").strip().lower()
    if "both" in v:
        return ("both", True, True)
    if "remote" in v or "tele" in v or "virtual" in v:
        return ("telehealth", True, False)
    if "in-person" in v or "in person" in v:
        return ("in_person", False, True)
    return ("telehealth", True, False)


IDAHO_CITIES = {
    "boise", "meridian", "nampa", "idaho falls", "pocatello", "caldwell",
    "coeur d'alene", "twin falls", "lewiston", "post falls", "rexburg",
    "moscow", "eagle", "kuna", "ammon", "chubbuck", "hayden",
    "mountain home", "blackfoot", "garden city", "jerome", "burley",
    "rathdrum", "sandpoint", "star", "middleton", "emmett", "payette",
    "weiser", "fruitland", "preston", "rupert", "hailey", "ketchum",
    "salmon", "sun valley", "rigby", "ririe", "iona", "shelley",
    "soda springs", "sandy",
}


def extract_office_cities(raw: str | None) -> list[str]:
    """Extract Idaho city names from an address string."""
    if not raw:
        return []
    s = str(raw).strip()
    if s.lower().startswith("online only") or s.lower() in ("n/a", "none", ""):
        return []
    lower = s.lower()
    cities = []
    # Try "City, ID ZIPCODE" pattern
    for m in re.finditer(r"([A-Za-z][A-Za-z\s'\-\.]+?),?\s+ID\s+\d{5}", s):
        cand = m.group(1).strip().lower()
        parts = cand.replace(",", " ").split()
        for n in (3, 2, 1):
            if len(parts) >= n:
                guess = " ".join(parts[-n:])
                if guess in IDAHO_CITIES:
                    cities.append(guess.title())
                    break
    if not cities:
        for c in IDAHO_CITIES:
            if c in lower:
                cities.append(c.title())
    return list(dict.fromkeys(cities))[:3]


def parse_languages(raw: str | None) -> list[str]:
    """Parse languages spoken beyond English."""
    if not raw:
        return []
    s = str(raw).strip()
    if s.lower() in ("none", "n/a", "english only", "english", "no", ""):
        return []
    langs = []
    for piece in re.split(r"[,;/&]| and ", s):
        p = piece.strip()
        if p and p.lower() not in ("none", "english", "n/a"):
            langs.append(p[:50])
    return langs


# ── T-field inference ───────────────────────────────────────────────────

def infer_t4_hard_truth(modalities: list[str], narrative: str) -> str:
    """Rule-based inference for t4_hard_truth from modalities + narrative."""
    text = narrative.lower()

    # Keyword overrides from narrative (highest priority)
    keyword_map = [
        (["head-on", "directly", "name it", "confront"], "direct"),
        (["incremental", "gradually", "build toward", "over time", "across sessions"], "incremental"),
        (["questions", "curious", "wonder", "inquiry", "ask"], "questions"),
        (["emotion", "feeling", "alive in the room", "felt sense"], "emotional"),
        (["wait", "moment", "ready", "gently", "right time"], "wait"),
    ]
    for keywords, slug in keyword_map:
        if any(kw in text for kw in keywords):
            return slug

    # Fall back to modality-based defaults
    mod_set = {m.lower() for m in modalities}
    if mod_set & {"cbt", "dbt", "solution-focused", "behavioral", "coaching"}:
        return "direct"
    if mod_set & {"person-centered", "psychodynamic", "ifs"}:
        return "wait"
    if mod_set & {"somatic experiencing", "emdr", "trauma-informed"}:
        return "emotional"
    if mod_set & {"motivational interviewing"}:
        return "questions"
    return "incremental"


def infer_t6_keyword_fallback(narrative: str) -> list[str]:
    """Keyword-based fallback for t6_session_expectations."""
    text = narrative.lower()
    scores: dict[str, int] = {
        "tools_fast": 0,
        "guide_direct": 0,
        "listen_heard": 0,
        "explore_patterns": 0,
    }
    kw = {
        "tools_fast": ["tools", "skills", "homework", "techniques", "exercises",
                        "strategies", "practical", "coping"],
        "guide_direct": ["guide", "direct", "challenge", "structure",
                          "psychoeducation", "teach", "plan"],
        "listen_heard": ["listen", "hear", "understand", "space", "client-led",
                          "safe", "warm", "compassion", "empathy"],
        "explore_patterns": ["explore", "patterns", "slow", "underlying",
                              "deeper", "insight", "uncover", "unravel"],
    }
    for slug, words in kw.items():
        for w in words:
            if w in text:
                scores[slug] += 1
    ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    picks = [slug for slug, score in ranked if score > 0][:2]
    return picks if picks else ["depends"]


async def infer_t6_llm(narrative: str, therapist_name: str) -> list[str] | None:
    """Use Claude Haiku to classify t6_session_expectations. Returns None on failure."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return None
    try:
        import httpx
        prompt = f"""You are classifying a therapist's session style based on their narrative descriptions.

Based on the following text from therapist {therapist_name}, pick 1-2 slugs from this list that best describe what their early sessions look like:

- guide_direct: "I tend to guide sessions and offer direction early"
- listen_heard: "I focus on listening and understanding before offering input"
- tools_fast: "I introduce tools/strategies early"
- explore_patterns: "I move at a slower, exploratory pace"
- depends: "It depends on the patient"

Therapist text:
{narrative[:1500]}

Reply with ONLY the slug(s), comma-separated. Example: "guide_direct, tools_fast" or "listen_heard" or "depends"."""

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": "claude-haiku-4-5-20251001",
                    "max_tokens": 50,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
            if resp.status_code != 200:
                return None
            text = resp.json()["content"][0]["text"].strip().lower()
            valid = {"guide_direct", "listen_heard", "tools_fast",
                     "explore_patterns", "depends"}
            slugs = [s.strip() for s in text.split(",") if s.strip() in valid]
            return slugs[:2] if slugs else None
    except Exception:
        return None


# ── License number normalization (for matching) ─────────────────────────

def normalize_license(raw: str | None) -> str:
    """Extract the numeric core of a license number for fuzzy matching.
    'LCPC-9263 (Also licensed in CO: ...)' -> '9263'
    'LMFT 8820' -> '8820'
    '7899' -> '7899'
    """
    if not raw:
        return ""
    s = str(raw).strip()
    # Remove parenthetical suffixes
    s = re.sub(r"\(.*?\)", "", s).strip()
    # Find the primary number (longest digit sequence)
    numbers = re.findall(r"\d+", s)
    if not numbers:
        return ""
    # Return the longest number (the actual license ID)
    return max(numbers, key=len)


def normalize_name(raw: str | None) -> str:
    """Lowercase name, strip credentials after comma."""
    if not raw:
        return ""
    name = str(raw).strip()
    # Strip credentials suffix
    if "," in name:
        name = name.split(",")[0].strip()
    return name.lower()


# ── Row processing ──────────────────────────────────────────────────────

def process_row(row: tuple, col_offset: int, unmapped_log: list
                ) -> dict | None:
    """Parse one xlsx row into a dict of fields to update.
    Returns None if the row is empty/unusable.
    col_offset: 0 for no-Timestamp xlsx, 1 for Timestamp-in-col-0 xlsx.
    """
    def col(idx):
        return row[idx + col_offset] if (idx + col_offset) < len(row) else None

    first_name_raw = col(COL_FIRST_NAME)
    full_name_raw = col(COL_FULL_NAME)
    if not first_name_raw and not full_name_raw:
        return None

    # -- Name (use full_name without credentials as base) --
    name = str(full_name_raw or "").strip()
    if not name:
        # Fall back to first_name, strip credentials
        name = str(first_name_raw or "").strip()
        if "," in name:
            name = name.split(",")[0].strip()

    fields: dict = {}
    fields["_xlsx_name"] = name  # internal, not written to DB
    fields["_xlsx_first_name_with_creds"] = str(first_name_raw or "").strip()

    # Direct-copy fields
    fields["name"] = name
    fields["gender"] = parse_gender(col(COL_GENDER))
    fields["phone"] = normalize_phone(col(COL_PHONE))
    fields["email"] = str(col(COL_EMAIL) or "").strip().lower()
    fields["website"] = str(col(COL_WEBSITE) or "").strip()
    if fields["website"] and not fields["website"].startswith(("http://", "https://")):
        fields["website"] = "https://" + fields["website"]

    # License number -- store raw for matching, cleaned for the DB
    raw_license = str(col(COL_LICENSE) or "").strip()
    fields["license_number"] = raw_license
    fields["_xlsx_license_norm"] = normalize_license(raw_license)

    # Cash rate
    cr = parse_cash_rate(col(COL_CASH_RATE))
    if cr is not None:
        fields["cash_rate"] = cr

    # Booleans
    fields["sliding_scale"] = parse_bool(col(COL_SLIDING_SCALE))
    fields["free_consult"] = parse_bool(col(COL_FREE_CONSULT), depends_true=True)

    # Years experience
    ye = parse_years(col(COL_YEARS))
    if ye is not None:
        fields["years_experience"] = ye

    # Credential type
    ptype = str(col(COL_PROVIDER_TYPE) or "").strip()
    if ptype:
        fields["credential_type"] = PROVIDER_TYPE_MAP.get(ptype, ptype)

    # Enum-mapped fields
    fields["age_groups"] = map_enum_list(
        parse_multi(col(COL_POPULATIONS)),
        POPULATION_MAP, "age_groups", unmapped_log,
    )
    fields["client_types"] = map_enum_list(
        parse_multi(col(COL_CLIENT_TYPES)),
        CLIENT_TYPE_MAP, "client_types", unmapped_log,
    )
    fields["primary_specialties"] = map_enum_list(
        parse_multi(col(COL_SPECIALTIES)),
        SPECIALTY_MAP, "primary_specialties", unmapped_log,
    )
    fields["modalities"] = map_enum_list(
        parse_multi(col(COL_MODALITIES)),
        MODALITY_MAP, "modalities", unmapped_log,
    )
    fields["insurance_accepted"] = map_insurance(
        col(COL_INSURANCE), unmapped_log,
    )
    fields["availability_windows"] = map_availability(
        parse_multi(col(COL_AVAILABILITY)),
        unmapped_log,
    )

    # Session type
    offering, tele, in_person = map_session_type(col(COL_SESSION_TYPE))
    fields["modality_offering"] = offering
    fields["telehealth"] = tele
    fields["offers_in_person"] = in_person

    # Office locations
    fields["office_locations"] = extract_office_cities(col(COL_OFFICE_ADDRESS))
    addr_raw = str(col(COL_OFFICE_ADDRESS) or "").strip()
    if addr_raw and addr_raw.lower() not in ("online only", "n/a", "none", ""):
        fields["office_addresses"] = [addr_raw]
    else:
        fields["office_addresses"] = []

    # Languages
    fields["languages_spoken"] = parse_languages(col(COL_LANGUAGES))

    # Bio -- concatenate 4 narrative columns
    personality = str(col(COL_PERSONALITY) or "").strip()
    typical_session = str(col(COL_TYPICAL_SESSION) or "").strip()
    homework = str(col(COL_HOMEWORK) or "").strip()
    lasting_change = str(col(COL_LASTING_CHANGE) or "").strip()
    bio_parts = []
    for label, val in [("Style", personality), ("A typical session", typical_session),
                       ("Between sessions", homework), ("Going deeper", lasting_change)]:
        if val:
            bio_parts.append(f"{label}: {val}")
    fields["bio"] = "\n\n".join(bio_parts)[:4000]

    # ── T-fields ──────────────────────────────────────────────────────
    # t5_lived_experience -- from personality column (intentional mislabel)
    fields["t5_lived_experience"] = personality[:2000]

    # t6_early_sessions_description -- from typical_session column
    fields["t6_early_sessions_description"] = typical_session[:2000]

    # t4_hard_truth -- rule-based from modalities + narrative
    narrative_for_t4 = f"{homework} {lasting_change}"
    fields["t4_hard_truth"] = infer_t4_hard_truth(
        fields.get("modalities", []), narrative_for_t4,
    )

    # t6_session_expectations -- needs LLM, stored as placeholder for now
    # (filled async in the main loop)
    narrative_for_t6 = f"{typical_session}\n{homework}\n{lasting_change}"
    fields["_t6_narrative"] = narrative_for_t6
    fields["_t6_keyword_fallback"] = infer_t6_keyword_fallback(narrative_for_t6)

    return fields


# ── Matching + audit ────────────────────────────────────────────────────

async def match_therapist(db, xlsx_fields: dict,
                          license_index: dict, name_index: dict) -> dict | None:
    """Find the existing therapist doc that matches this xlsx row.
    Try license_number first, fall back to name."""
    xlsx_lic = xlsx_fields.get("_xlsx_license_norm", "")
    if xlsx_lic and xlsx_lic in license_index:
        return license_index[xlsx_lic]

    xlsx_name = normalize_name(xlsx_fields.get("_xlsx_name", ""))
    if xlsx_name and xlsx_name in name_index:
        return name_index[xlsx_name]

    return None


def compute_update(xlsx_fields: dict, existing: dict) -> tuple[dict, list[str], list[str]]:
    """Compute the $set dict and audit changes.
    Returns (set_fields, fields_newly_real, fields_to_unset_from_audit).

    fields_newly_real: fields where existing was empty/placeholder and xlsx has data.
    fields_to_unset_from_audit: fields to remove from _backfill_audit.fields_added.
    """
    SKIP_KEYS = {"_xlsx_name", "_xlsx_first_name_with_creds", "_xlsx_license_norm",
                 "_t6_narrative", "_t6_keyword_fallback"}
    EMPTY_VALUES = (None, "", [], {})

    set_fields: dict = {}
    fields_newly_real: list[str] = []
    fields_to_unset: list[str] = []

    # Get existing backfill audit
    audit = existing.get("_backfill_audit", {})
    audit_fields_added = set(audit.get("fields_added", []))

    for key, val in xlsx_fields.items():
        if key in SKIP_KEYS:
            continue
        if val in EMPTY_VALUES:
            continue  # don't overwrite with empty

        set_fields[key] = val

        # If this field was in backfill audit, it's now real -- remove from audit
        if key in audit_fields_added:
            fields_to_unset.append(key)

        # Track if existing value was empty (newly getting real data)
        existing_val = existing.get(key)
        if existing_val in EMPTY_VALUES:
            fields_newly_real.append(key)

    return set_fields, fields_newly_real, fields_to_unset


# ── Main ────────────────────────────────────────────────────────────────

async def main():
    parser = argparse.ArgumentParser(description="Update therapists from provider xlsx")
    parser.add_argument("--xlsx", required=True, help="Path to the provider directory xlsx")
    parser.add_argument("--dry-run", action="store_true",
                        help="Preview changes without writing to DB")
    parser.add_argument("--apply", action="store_true",
                        help="Write changes to MongoDB")
    parser.add_argument("--limit", type=int, default=3,
                        help="Number of rows to process in dry-run (default 3)")
    parser.add_argument("--col-offset", type=int, default=0,
                        help="Column offset (1 if xlsx has Timestamp in col 0)")
    parser.add_argument("--skip-llm", action="store_true",
                        help="Skip LLM classifier, use keyword fallback only")
    args = parser.parse_args()

    if not args.dry_run and not args.apply:
        print("Must pass either --dry-run or --apply")
        sys.exit(1)

    # Load xlsx
    wb = openpyxl.load_workbook(args.xlsx, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))

    # Detect timestamp column
    first_header = str(rows[0][0] or "").lower()
    col_offset = args.col_offset
    if "timestamp" in first_header:
        col_offset = 1
        print("Detected Timestamp in col 0 -- applying col_offset=1")

    data = rows[1:]  # skip header
    # Filter to rows with a name
    data = [r for r in data if (r[0 + col_offset] or r[1 + col_offset])]
    print(f"Loaded {len(data)} rows with data from xlsx")

    if args.dry_run:
        data = data[:args.limit]
        print(f"DRY RUN -- processing first {len(data)} rows only\n")

    # Connect to Mongo (skip in parse-only dry-run when no env vars)
    mongo = None
    db = None
    all_therapists: list[dict] = []
    has_db = bool(os.environ.get("MONGO_URL"))
    if has_db:
        mongo = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = mongo[os.environ["DB_NAME"]]
        all_therapists = await db.therapists.find({}).to_list(length=None)
        print(f"Found {len(all_therapists)} existing therapists in DB\n")
    else:
        print("No MONGO_URL -- parse-only mode (no DB matching)\n")

    # Build matching indices from existing therapists
    license_index: dict[str, dict] = {}
    name_index: dict[str, dict] = {}
    for t in all_therapists:
        lic = normalize_license(t.get("license_number"))
        if lic:
            license_index[lic] = t
        nm = normalize_name(t.get("name"))
        if nm:
            name_index[nm] = t

    # Process rows
    unmapped_log: list[tuple[str, str]] = []
    matched = 0
    unmatched = 0
    updated_count = 0
    fields_per_therapist: list[int] = []
    t6_distribution: Counter = Counter()
    match_method_counts = Counter()
    unmatched_names: list[str] = []
    sanity_samples: list[tuple[str, dict]] = []

    for idx, row in enumerate(data, 1):
        parsed = process_row(row, col_offset, unmapped_log)
        if parsed is None:
            continue

        name = parsed["_xlsx_name"]

        # Match against DB (or skip if no DB)
        if has_db:
            existing = await match_therapist(db, parsed, license_index, name_index)
        else:
            existing = None

        # LLM / keyword classification for t6_session_expectations
        t6_narrative = parsed.pop("_t6_narrative", "")
        t6_fallback = parsed.pop("_t6_keyword_fallback", ["depends"])
        if not args.skip_llm and t6_narrative.strip():
            t6_slugs = await infer_t6_llm(t6_narrative, name)
            if t6_slugs is None:
                t6_slugs = t6_fallback
                if args.dry_run:
                    print(f"       t6 LLM failed, using keyword fallback")
            else:
                if args.dry_run:
                    print(f"       t6 LLM result: {t6_slugs}")
        else:
            t6_slugs = t6_fallback
        parsed["t6_session_expectations"] = t6_slugs
        for s in t6_slugs:
            t6_distribution[s] += 1

        # Collect for sanity-check report
        sanity_samples.append((name, dict(parsed)))

        if existing is None and not has_db:
            # Parse-only mode: show what we parsed
            matched += 1  # count as "would match" for reporting
            if args.dry_run:
                print(f"  [{idx}] {name}")
                print(f"       license_norm: '{parsed.get('_xlsx_license_norm', '')}'")
                print(f"       t6_session_expectations: {t6_slugs} (keyword fallback: {t6_fallback})")
                print(f"       t4_hard_truth: {parsed.get('t4_hard_truth')}")
                print(f"       t5_lived_experience: {str(parsed.get('t5_lived_experience', ''))[:80]}...")
                print(f"       t6_early_sessions_description: {str(parsed.get('t6_early_sessions_description', ''))[:80]}...")
                print(f"       --- parsed fields ---")
                SKIP = {"_xlsx_name", "_xlsx_first_name_with_creds", "_xlsx_license_norm",
                        "bio", "t5_lived_experience", "t6_early_sessions_description"}
                for k, v in sorted(parsed.items()):
                    if k in SKIP:
                        continue
                    print(f"         {k}: {str(v)[:80]}")
                print()
            continue
        elif existing is None and has_db:
            unmatched += 1
            unmatched_names.append(name)
            if args.dry_run:
                print(f"  [{idx}] {name}: NO MATCH FOUND")
                print(f"       license_norm='{parsed['_xlsx_license_norm']}'")
                print()
            continue

        matched += 1
        match_key = "license" if normalize_license(
            existing.get("license_number")) == parsed.get("_xlsx_license_norm") and parsed.get("_xlsx_license_norm") else "name"
        match_method_counts[match_key] += 1

        # Compute update
        set_fields, newly_real, audit_unset = compute_update(parsed, existing)
        fields_per_therapist.append(len(set_fields))

        if args.dry_run:
            print(f"  [{idx}] {name} (matched by {match_key})")
            print(f"       existing_id: {existing.get('id', '???')}")
            print(f"       fields to update: {len(set_fields)}")
            for k, v in sorted(set_fields.items()):
                old = existing.get(k)
                old_str = str(old)[:60] if old else "(empty)"
                new_str = str(v)[:60]
                changed = " <-- CHANGED" if old != v else ""
                print(f"         {k}: {old_str} -> {new_str}{changed}")
            if audit_unset:
                print(f"       audit fields to unset: {audit_unset}")
            print()
        elif args.apply:
            # Build the MongoDB update
            update: dict = {"$set": set_fields}
            update["$set"]["updated_at"] = datetime.now(timezone.utc).isoformat()

            # Update _backfill_audit
            real_email = parsed.get("email", "")
            if real_email:
                update["$set"]["_backfill_audit.original_email"] = real_email

            # Remove fields from _backfill_audit.fields_added
            if audit_unset:
                existing_audit = existing.get("_backfill_audit", {})
                existing_fields_added = existing_audit.get("fields_added", [])
                new_fields_added = [f for f in existing_fields_added
                                    if f not in set(audit_unset)]
                update["$set"]["_backfill_audit.fields_added"] = new_fields_added

            await db.therapists.update_one(
                {"_id": existing["_id"]},
                update,
            )
            updated_count += 1

    # ── Report ──────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("IMPORT REPORT")
    print("=" * 60)
    print(f"  Total xlsx rows processed: {len(data)}")
    print(f"  Matched:   {matched} ({match_method_counts})")
    print(f"  Unmatched: {unmatched}")
    if unmatched_names:
        print(f"  Unmatched names:")
        for n in unmatched_names[:20]:
            print(f"    - {n}")
        if len(unmatched_names) > 20:
            print(f"    ... and {len(unmatched_names) - 20} more")

    if fields_per_therapist:
        avg = sum(fields_per_therapist) / len(fields_per_therapist)
        print(f"\n  Fields updated per therapist: avg={avg:.1f}, "
              f"min={min(fields_per_therapist)}, max={max(fields_per_therapist)}")

    if unmapped_log:
        print(f"\n  Unmapped enum values ({len(unmapped_log)} total):")
        by_field: dict[str, list[str]] = {}
        for field, val in unmapped_log:
            by_field.setdefault(field, []).append(val)
        for field, vals in sorted(by_field.items()):
            unique = sorted(set(vals))
            print(f"    {field}:")
            for v in unique[:15]:
                print(f"      - \"{v}\" (x{vals.count(v)})")
            if len(unique) > 15:
                print(f"      ... and {len(unique) - 15} more")

    print(f"\n  t6_session_expectations distribution:")
    for slug, count in t6_distribution.most_common():
        print(f"    {slug}: {count}")

    # Sanity check: 5 random therapists from the run
    if sanity_samples:
        import random as _rand
        _rand.seed(42)
        picks = _rand.sample(sanity_samples, min(5, len(sanity_samples)))
        print(f"\n  Sanity check ({len(picks)} random therapists):")
        for name, fields in picks:
            print(f"    {name}:")
            print(f"      t4_hard_truth:                {fields.get('t4_hard_truth', '???')}")
            print(f"      t6_session_expectations:      {fields.get('t6_session_expectations', [])}")
            t6d = str(fields.get('t6_early_sessions_description', ''))
            print(f"      t6_early_sessions_description: {t6d[:120]}...")
            t5l = str(fields.get('t5_lived_experience', ''))
            print(f"      t5_lived_experience:          {t5l[:120]}...")

    if args.apply:
        print(f"\n  Successfully updated {updated_count} therapist records.")

    if mongo:
        mongo.close()


if __name__ == "__main__":
    import sys as _sys
    _sys.stdout.reconfigure(line_buffering=True)
    asyncio.run(main())
