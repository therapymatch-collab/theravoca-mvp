"""One-off importer for the TheraVoca Idaho Provider Directory Excel.

Per user direction (iter-42):
- Wipe the entire DB (therapists, requests, applications, declines,
  outreach_invites, magic_codes) before importing.
- Use sequential fake emails: therapymatch+t101@gmail.com, t102, etc.
- Mark all imported therapists as `is_active=True, pending_approval=False,
  subscription_status="trialing"` with a 30-day fake trial — they show up
  immediately in matching.

Run with `--dry-run` to see what will happen without writing anything.
Run with `--apply` to actually write the data.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import os
import re
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import openpyxl
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=True)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# ─── Mapping tables ──────────────────────────────────────────────────────────
PROVIDER_TYPE_MAP = {
    "Professional Counselor": "LPC",
    "Social Worker": "LCSW",
    "LMFT": "LMFT",
    "Psychologist": "PsyD",
    "Psychoanalyst": "Other",
    "Art Therapist": "Other",
    "Other": "Other",
}

GENDER_MAP = {
    "Female": "female",
    "Male": "male",
    "Non-Binary": "nonbinary",
}

YEARS_MAP = {
    "1-3": 2,
    "4-8": 6,
    "9-16": 12,
    "17+": 20,
}

AVAILABILITY_MAP = {
    "Mornings": ["weekday_morning"],
    "Afternoons": ["weekday_afternoon"],
    "Evenings": ["weekday_evening"],
    "Weekends": ["weekend_morning", "weekend_afternoon"],
}

POPULATION_MAP = {
    "Children (0–12)": "child",
    "Adolescents (13–17)": "teen",
    "Young Adults (18–25)": "young_adult",
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

# Specialization labels → our internal slug list (matches IntakeForm + scorer).
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

# Modality strings → our canonical labels.
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

# Map insurance provider strings to our INSURERS_LIST canonical labels.
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
    "pacificsource": "PacificSource Health Plans",
    "pacificsource health plans": "PacificSource Health Plans",
    "selecthealth": "SelectHealth",
    "select health": "SelectHealth",
    "aetna": "Aetna",
    "cigna": "Cigna",
    "evernorth": "Cigna",
    "cigna and evernorth": "Cigna",
    "unitedhealthcare": "UnitedHealthcare",
    "united healthcare": "UnitedHealthcare",
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
}


# ─── Cleaners ────────────────────────────────────────────────────────────────
def normalize_phone(raw: str) -> str:
    """Strip everything except digits and re-format as xxx-xxx-xxxx."""
    if not raw:
        return ""
    digits = re.sub(r"\D", "", str(raw))
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) == 10:
        return f"{digits[:3]}-{digits[3:6]}-{digits[6:]}"
    return str(raw).strip()


def parse_multi(value: str | None, sep: str = ",") -> list[str]:
    """Split a comma-separated cell into clean tokens, dropping bad rows that
    leaked in from address overflow (`❌` prefix, raw zip codes, etc.)."""
    if not value:
        return []
    out = []
    for piece in str(value).split(sep):
        piece = piece.strip()
        if not piece:
            continue
        # Reject rows where the multi-select got polluted with addr fragments.
        if piece.startswith("❌") or re.match(r"^[A-Z]{2}\s*\d{5}", piece):
            continue
        if re.match(r"^\d{5}", piece) or re.search(r"Suite \d", piece, re.I):
            continue
        out.append(piece)
    return out


def map_specialties(values: list[str]) -> list[str]:
    """Map 1+ specialty labels to dedup'd internal slugs, preserving order."""
    out: list[str] = []
    seen: set[str] = set()
    for v in values:
        slug = SPECIALTY_MAP.get(v)
        if slug and slug not in seen:
            out.append(slug)
            seen.add(slug)
    return out


def map_modalities(values: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for v in values:
        canon = MODALITY_MAP.get(v)
        if canon and canon not in seen:
            out.append(canon)
            seen.add(canon)
    return out


def map_populations(values: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for v in values:
        slug = POPULATION_MAP.get(v)
        if slug and slug not in seen:
            out.append(slug)
            seen.add(slug)
    return out


def map_client_types(values: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for v in values:
        slug = CLIENT_TYPE_MAP.get(v)
        if slug and slug not in seen:
            out.append(slug)
            seen.add(slug)
    return out


def map_availability(values: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for v in values:
        for slug in AVAILABILITY_MAP.get(v, []):
            if slug not in seen:
                out.append(slug)
                seen.add(slug)
    return out


def map_insurance(raw: str | None) -> list[str]:
    if not raw:
        return []
    s = str(raw).strip()
    if s.lower() in {"none", "no", "n/a", "no insurance"}:
        return []
    out: list[str] = []
    seen: set[str] = set()
    for piece in re.split(r"[,/\n;]", s):
        key = piece.strip().lower()
        canon = INSURANCE_MAP.get(key)
        if canon and canon not in seen:
            out.append(canon)
            seen.add(canon)
    return out


def map_session_type(value: str | None) -> tuple[str, bool, bool]:
    """Return (modality_offering, telehealth, offers_in_person)."""
    v = (value or "").strip().lower()
    if "both" in v:
        return ("both", True, True)
    if "remote" in v or "tele" in v or "virtual" in v:
        return ("telehealth", True, False)
    if "in-person" in v or "in person" in v:
        return ("in_person", False, True)
    return ("telehealth", True, False)


def map_years(value: str | None) -> int | None:
    v = (value or "").strip()
    return YEARS_MAP.get(v)


def map_provider_type(value: str | None, fallback: str | None = None) -> str:
    return (
        PROVIDER_TYPE_MAP.get((value or "").strip())
        or (fallback or "Other")
    )


def map_gender(value: str | None) -> str:
    return GENDER_MAP.get((value or "").strip(), "")


IDAHO_CITIES = {
    "boise", "meridian", "nampa", "idaho falls", "pocatello", "caldwell",
    "coeur d'alene", "twin falls", "lewiston", "post falls", "rexburg",
    "moscow", "eagle", "kuna", "ammon", "chubbuck", "hayden", "mountain home",
    "blackfoot", "garden city", "jerome", "burley", "rathdrum", "sandpoint",
    "star", "middleton", "emmett", "payette", "weiser", "fruitland",
    "preston", "rupert", "hailey", "ketchum", "salmon", "sun valley",
    "rigby", "ririe", "iona", "shelley", "soda springs",
}


def extract_idaho_city(address: str) -> str | None:
    """Find an Idaho city name inside a free-text address."""
    if not address:
        return None
    lower = address.lower()
    # Prefer "City, ID" pattern.
    m = re.search(r"([A-Za-z][A-Za-z\s'\-\.]+?),?\s+ID\s+\d{5}", address)
    if m:
        cand = m.group(1).strip().lower()
        # Drop street name fragments by keeping only the last token-pair.
        parts = cand.replace(",", " ").split()
        for n in (3, 2, 1):
            if len(parts) >= n:
                guess = " ".join(parts[-n:])
                if guess in IDAHO_CITIES:
                    return guess.title()
    for c in IDAHO_CITIES:
        if c in lower:
            return c.title()
    return None


def parse_addresses(raw: str | None, has_id_office: bool) -> list[str]:
    """If the row is flagged as having an Idaho office, treat raw as a list of
    one or more addresses separated by 'and' or newline. Otherwise return []."""
    if not has_id_office or not raw:
        return []
    s = str(raw).strip()
    # Split on "and" / newlines; keep semicolons together.
    parts = re.split(r"\n+|\s+and\s+", s)
    cleaned = []
    for p in parts:
        p = p.strip().strip(",")
        # Drop pure parentheticals and "Online Only" leftovers.
        if p.lower().startswith("online only"):
            continue
        if len(p) < 8:
            continue
        cleaned.append(p)
    return cleaned[:3]


def build_bio(personality: str, session_desc: str, homework: str, depth: str) -> str:
    """Concatenate cols 22-25 into a single bio."""
    pieces = []
    for label, val in [
        ("Style", personality),
        ("A typical session", session_desc),
        ("Between sessions", homework),
        ("Going deeper", depth),
    ]:
        if val and str(val).strip():
            pieces.append(f"{label}: {str(val).strip()}")
    return "\n\n".join(pieces)[:4000]


# ─── Row → therapist doc ─────────────────────────────────────────────────────
def row_to_therapist(row: tuple, idx: int) -> tuple[dict | None, list[str]]:
    """Return (doc, warnings). doc=None means the row is unusable."""
    warnings: list[str] = []
    name_with_creds = (row[0] or "").strip()
    full_name = (row[1] or "").strip()
    if not name_with_creds and not full_name:
        return None, ["missing name"]

    name = name_with_creds or full_name

    has_id_office = bool(row[30]) and str(row[30]).startswith("✅")

    cred_short = map_provider_type(row[2], (row[29] or "").strip() or None)
    gender = map_gender(row[3])
    years = map_years(row[4])
    if years is None:
        warnings.append(f"unmapped years_licensed='{row[4]}' → defaulting to 5")
        years = 5

    phone = normalize_phone(row[5])
    if "-" not in phone or phone.count("-") < 2:
        warnings.append(f"phone failed normalization: '{row[5]}' kept as-is")

    email = (row[6] or "").strip().lower()
    fake_email = f"therapymatch+t{100 + idx}@gmail.com"
    website = (row[7] or "").strip()
    if website and not website.startswith(("http://", "https://")):
        website = "https://" + website
    license_number = str(row[8] or "").strip()

    insurance = map_insurance(row[9])
    avail = map_availability(parse_multi(row[10]))
    if not avail:
        warnings.append("no availability mapped — defaulting to weekday_afternoon")
        avail = ["weekday_afternoon"]

    free_consult = (row[11] or "").strip().lower() == "yes"
    cash_rate = None
    try:
        cash_rate = int(re.sub(r"\D", "", str(row[12])))
    except (TypeError, ValueError):
        warnings.append(f"unparseable cash_rate '{row[12]}'")
    sliding_scale = (row[13] or "").strip().lower() == "yes"

    modality_offering, telehealth, in_person = map_session_type(row[14])
    addresses = parse_addresses(row[15], has_id_office)
    populations = map_populations(parse_multi(row[16]))
    if not populations:
        warnings.append("no populations mapped — defaulting to adult")
        populations = ["adult"]
    client_types = map_client_types(parse_multi(row[17]))
    if not client_types:
        warnings.append("no client_types mapped — defaulting to individual")
        client_types = ["individual"]
    specialties = map_specialties(parse_multi(row[18]))
    modalities = map_modalities(parse_multi(row[19]))
    if not modalities:
        warnings.append("no modalities mapped — defaulting to Eclectic")
        modalities = ["Eclectic"]
    bio = build_bio(row[21], row[22], row[23], row[24])

    # Random-but-deterministic referral code so re-imports are stable.
    referral_code = hashlib.sha1(
        f"{full_name}-{license_number}-{idx}".encode()
    ).hexdigest()[:8].upper()

    now_iso = datetime.now(timezone.utc).isoformat()
    trial_end = (
        datetime.now(timezone.utc) + timedelta(days=30)
    ).isoformat()

    doc = {
        "id": str(uuid.uuid4()),
        "name": name,
        "email": fake_email,
        "real_email": email,  # kept for reference, not used in matching
        "phone": phone,
        "phone_alert": phone,
        "office_phone": phone,
        "gender": gender,
        "credential_type": cred_short,
        "licensed_states": ["ID"],
        "license_number": license_number,
        "license_expires_at": None,
        "license_picture": "",
        "client_types": client_types,
        "age_groups": populations,
        "primary_specialties": specialties,
        "secondary_specialties": [],
        "general_treats": [],
        "modalities": modalities,
        "modality_offering": modality_offering,
        "telehealth": telehealth,
        "offers_in_person": in_person,
        "office_locations": [
            c for c in (extract_idaho_city(a) for a in addresses) if c
        ][:3],
        "office_addresses": addresses,
        "office_geos": [],
        "website": website,
        "insurance_accepted": insurance,
        "cash_rate": cash_rate,
        "sliding_scale": sliding_scale,
        "free_consult": free_consult,
        "years_experience": years,
        "availability_windows": avail,
        "urgency_capacity": "within_2_3_weeks",
        "style_tags": [],
        "bio": bio,
        "profile_picture": "",
        "notify_email": True,
        "notify_sms": True,
        "referral_code": referral_code,
        "source": "imported_xlsx",
        "is_active": True,
        "pending_approval": False,
        "subscription_status": "trialing",
        "stripe_customer_id": None,
        "stripe_subscription_id": None,
        "trial_ends_at": trial_end,
        "current_period_end": trial_end,
        "created_at": now_iso,
    }
    return doc, warnings


# ─── Driver ──────────────────────────────────────────────────────────────────
async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--xlsx", required=True, help="Path to the Excel file")
    parser.add_argument("--dry-run", action="store_true",
                        help="Analyze + preview without writing to DB")
    parser.add_argument("--apply", action="store_true",
                        help="Wipe DB and import (DESTRUCTIVE)")
    parser.add_argument("--limit", type=int, default=0,
                        help="Process only the first N rows (0 = all)")
    args = parser.parse_args()

    if not args.dry_run and not args.apply:
        print("Must pass either --dry-run or --apply")
        sys.exit(1)

    wb = openpyxl.load_workbook(args.xlsx, data_only=True, read_only=True)
    ws = wb["Form Responses 1"]
    rows = list(ws.iter_rows(values_only=True))
    data = [r for r in rows[1:] if r[0] or r[1] or r[6]]
    if args.limit:
        data = data[: args.limit]

    docs: list[dict] = []
    warnings_per_row: list[tuple[str, list[str]]] = []
    rejected: list[tuple[int, str]] = []
    for idx, row in enumerate(data, 1):
        doc, warns = row_to_therapist(row, idx)
        if doc is None:
            rejected.append((idx, "; ".join(warns)))
            continue
        docs.append(doc)
        if warns:
            warnings_per_row.append((doc["name"], warns))

    # Email collisions inside the file? We use deterministic +tNNN, so no.
    emails = [d["email"] for d in docs]
    assert len(emails) == len(set(emails)), "internal email dedupe broken"

    # Real-email collisions (the user wanted us to flag).
    real_email_dups: dict[str, list[str]] = {}
    for d in docs:
        re_ = (d.get("real_email") or "").strip().lower()
        if re_:
            real_email_dups.setdefault(re_, []).append(d["name"])
    real_email_dups = {k: v for k, v in real_email_dups.items() if len(v) > 1}

    print(f"\n📥 Loaded {len(data)} rows from Excel")
    print(f"✅ {len(docs)} therapists ready to import")
    print(f"❌ {len(rejected)} rows rejected")
    if rejected:
        for i, reason in rejected[:10]:
            print(f"    row {i}: {reason}")

    print(f"\n⚠️  {len(warnings_per_row)} therapists imported with warnings (first 10):")
    for n, ws_ in warnings_per_row[:10]:
        print(f"    {n}: {'; '.join(ws_)}")

    if real_email_dups:
        print("\n🔁 Duplicate real-emails (across multiple rows):")
        for e, names in list(real_email_dups.items())[:10]:
            print(f"    {e}: {names}")

    # Distribution preview
    from collections import Counter
    spec_counts: Counter = Counter()
    cred_counts: Counter = Counter()
    state_offices = 0
    telehealth_n = 0
    for d in docs:
        for s in d["primary_specialties"]:
            spec_counts[s] += 1
        cred_counts[d["credential_type"]] += 1
        if d["office_addresses"]:
            state_offices += 1
        if d["telehealth"]:
            telehealth_n += 1
    print("\n📊 Distribution preview:")
    print(f"    Credentials: {dict(cred_counts.most_common())}")
    print(f"    Top specialties: {dict(spec_counts.most_common(8))}")
    print(f"    Therapists w/ ID office: {state_offices}")
    print(f"    Therapists offering telehealth: {telehealth_n}")

    if args.dry_run:
        print("\n🌵 Dry-run complete — no DB writes. Sample doc (first):")
        sample = docs[0]
        for k in ("id", "name", "email", "credential_type", "licensed_states",
                  "primary_specialties", "modalities", "office_addresses",
                  "office_locations", "cash_rate", "sliding_scale",
                  "telehealth", "offers_in_person", "years_experience",
                  "is_active", "pending_approval", "subscription_status"):
            print(f"    {k}: {sample.get(k)}")
        return

    # APPLY MODE — wipe and write.
    mongo = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = mongo[os.environ["DB_NAME"]]
    cleared = {
        "therapists": (await db.therapists.delete_many({})).deleted_count,
        "requests": (await db.requests.delete_many({})).deleted_count,
        "applications": (await db.applications.delete_many({})).deleted_count,
        "declines": (await db.declines.delete_many({})).deleted_count,
        "outreach_invites": (await db.outreach_invites.delete_many({})).deleted_count,
        "magic_codes": (await db.magic_codes.delete_many({})).deleted_count,
    }
    print(f"\n🧹 Wiped: {cleared}")
    if docs:
        await db.therapists.insert_many([d.copy() for d in docs])
    print(f"✅ Inserted {len(docs)} therapists")

    # Geocode offices for any imported therapist with addresses.
    from helpers import _backfill_therapist_geo
    await _backfill_therapist_geo()
    print("📍 Geocoded office addresses")
    mongo.close()


if __name__ == "__main__":
    asyncio.run(main())
