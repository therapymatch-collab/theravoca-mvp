"""Seed v3 — 100 fully-populated Idaho therapists with realistic profiles.
Every field the matching engine + admin UI cares about is filled in.
"""
from __future__ import annotations

import hashlib
import random
import uuid
from datetime import date, timedelta

random.seed(42)

# ─── Roster: 100 unique (first, last) pairs paired w/ a sensible gender ──────
# Hand-curated so that name-implied gender (e.g. Sarah=F, Marcus=M, Jordan=NB)
# stays consistent — important so identity-preference filters work in QA.
ROSTER: list[tuple[str, str, str]] = [
    ("Sarah", "Anderson", "female"),
    ("Marcus", "Bennett", "male"),
    ("Jennifer", "Carter", "female"),
    ("David", "Dawson", "male"),
    ("Emily", "Ellis", "female"),
    ("James", "Foster", "male"),
    ("Jessica", "Garcia", "female"),
    ("Robert", "Hayes", "male"),
    ("Ashley", "Iverson", "female"),
    ("Christopher", "Jenkins", "male"),
    ("Amanda", "Klein", "female"),
    ("Matthew", "Larson", "male"),
    ("Melissa", "Mitchell", "female"),
    ("Andrew", "Nguyen", "male"),
    ("Stephanie", "Owens", "female"),
    ("Jordan", "Parker", "nonbinary"),
    ("Nicole", "Quinn", "female"),
    ("Daniel", "Reyes", "male"),
    ("Rachel", "Sullivan", "female"),
    ("Ryan", "Thomas", "male"),
    ("Lauren", "Underwood", "female"),
    ("Brandon", "Vasquez", "male"),
    ("Megan", "Walsh", "female"),
    ("Justin", "Xiong", "male"),
    ("Heather", "Young", "female"),
    ("Kevin", "Zimmerman", "male"),
    ("Amber", "Brooks", "female"),
    ("Jason", "Coleman", "male"),
    ("Brittany", "Drake", "female"),
    ("Jonathan", "Edwards", "male"),
    ("Samantha", "Fischer", "female"),
    ("Nicholas", "Gibson", "male"),
    ("Tiffany", "Hudson", "female"),
    ("Adam", "Ingram", "male"),
    ("Crystal", "Jordan", "female"),
    ("Eric", "Kelly", "male"),
    ("Hannah", "Lopez", "female"),
    ("Anthony", "Morgan", "male"),
    ("Olivia", "Nelson", "female"),
    ("Tyler", "Ortiz", "male"),
    ("Sophia", "Patel", "female"),
    ("Aaron", "Rivera", "male"),
    ("Madison", "Sanchez", "female"),
    ("Jacob", "Turner", "male"),
    ("Chloe", "Vargas", "female"),
    ("Patrick", "Wilson", "male"),
    ("Grace", "Brown", "female"),
    ("Sean", "Davis", "male"),
    ("Lily", "Miller", "female"),
    ("Brian", "Moore", "male"),
    ("Anna", "Reed", "female"),
    ("Kyle", "Cole", "male"),
    ("Natalie", "Diaz", "female"),
    ("Gabriel", "Watson", "male"),
    ("Victoria", "Powell", "female"),
    ("Ethan", "Webb", "male"),
    ("Maya", "Russell", "female"),
    ("Cameron", "Bailey", "nonbinary"),
    ("Bethany", "Cooper", "female"),
    ("Tyler", "Gray", "male"),
    ("Rebecca", "Howard", "female"),
    ("Liam", "Ward", "male"),
    ("Audrey", "Cox", "female"),
    ("Caleb", "Richardson", "male"),
    ("Catherine", "Bell", "female"),
    ("Avery", "Murphy", "nonbinary"),
    ("Erin", "Price", "female"),
    ("Trevor", "Long", "male"),
    ("Vanessa", "Wood", "female"),
    ("Devin", "Sanders", "male"),
    ("Margaret", "Ross", "female"),
    ("Logan", "Henderson", "male"),
    ("Bridget", "Coleman", "female"),
    ("Ian", "Patterson", "male"),
    ("Rosa", "Russell", "female"),
    ("Owen", "Stewart", "male"),
    ("Gabrielle", "Kim", "female"),
    ("Riley", "Foster", "nonbinary"),
    ("Cassandra", "Bryant", "female"),
    ("Alexander", "Alexander", "male"),
    ("Theresa", "Watson", "female"),
    ("Nathaniel", "Hughes", "male"),
    ("Kayla", "Marshall", "female"),
    ("Isaac", "Black", "male"),
    ("Tracy", "Hill", "female"),
    ("Wesley", "Cox", "male"),
    ("Diana", "Simpson", "female"),
    ("Mason", "Reid", "male"),
    ("Jasmine", "Stevens", "female"),
    ("Quinn", "Bradley", "nonbinary"),
    ("Allison", "Knight", "female"),
    ("Spencer", "Fletcher", "male"),
    ("Marisa", "Gallagher", "female"),
    ("Beau", "Romero", "male"),
    ("Alicia", "Park", "female"),
    ("Tate", "Holmes", "male"),
    ("Camille", "Wagner", "female"),
    ("Dylan", "Christensen", "male"),
    ("Rachael", "Pierce", "female"),
    ("Drew", "Daniels", "nonbinary"),
    ("Bailey", "Becker", "female"),
    ("Forrest", "Brennan", "male"),
    ("Tessa", "Hartmann", "female"),
]
assert len(ROSTER) >= 100, f"Expected at least 100, got {len(ROSTER)}"
ROSTER = ROSTER[:100]

LICENSES = ["LCSW", "LMFT", "LCPC", "LPC", "PsyD", "PhD"]
LICENSE_PREFIXES = {  # ID state board prefix conventions for license numbers
    "LCSW": "LCSW",
    "LMFT": "LMFT",
    "LCPC": "LCPC",
    "LPC":  "LPC",
    "PsyD": "PSY",
    "PhD":  "PSY",
}
CREDENTIAL_TYPE = {
    "LCSW": "lcsw", "LMFT": "lmft", "LCPC": "lpc", "LPC": "lpc",
    "PsyD": "psychologist", "PhD": "psychologist",
}

IDAHO_CITIES = [
    "Boise", "Meridian", "Nampa", "Idaho Falls", "Pocatello", "Caldwell",
    "Coeur d'Alene", "Twin Falls", "Lewiston", "Post Falls", "Rexburg", "Eagle",
    "Kuna", "Moscow", "Ammon",
]

ALL_ISSUES = [
    "anxiety", "depression", "ocd", "adhd", "trauma_ptsd",
    "relationship_issues", "life_transitions", "parenting_family",
    "substance_use", "eating_concerns", "autism_neurodivergence",
    "school_academic_stress",
]
ALL_MODALITIES = [
    "CBT", "DBT", "EMDR", "Mindfulness-Based", "Psychodynamic", "ACT",
    "Solution-Focused", "Gottman", "IFS", "Somatic Experiencing", "Person-Centered",
]
INSURERS = [
    "Blue Cross of Idaho", "Regence BlueShield of Idaho", "Mountain Health Co-op",
    "PacificSource Health Plans", "SelectHealth", "Aetna", "Cigna", "UnitedHealthcare",
    "Humana", "Idaho Medicaid", "Medicare", "Tricare West", "Optum", "Magellan Health",
]
AGE_GROUPS = ["child", "teen", "young_adult", "adult", "older_adult"]
AVAILABILITY = [
    "weekday_morning", "weekday_afternoon", "weekday_evening",
    "weekend_morning", "weekend_afternoon",
]
STYLE_TAGS = [
    "structured", "warm_supportive", "direct_practical", "trauma_informed",
    "insight_oriented", "faith_informed", "culturally_responsive", "lgbtq_affirming",
]
URGENCY_CAPACITIES = ["asap", "within_2_3_weeks", "within_month", "full"]


def _avatar_url(name: str, gender: str) -> str:
    """Stable headshot via DiceBear's deterministic API — always loads, no auth."""
    seed = hashlib.sha1(name.encode()).hexdigest()[:12]
    style = "avataaars" if gender != "nonbinary" else "fun-emoji"
    return f"https://api.dicebear.com/7.x/{style}/png?seed={seed}&size=256&backgroundColor=fdfbf7,e8e5df,f2f4f0"


def generate_therapist(idx: int) -> dict:
    first, last, gender = ROSTER[idx - 1]
    license_type = random.choice(LICENSES)
    name = f"{first} {last}, {license_type}"
    email = f"therapymatch+t{idx:03d}@gmail.com"
    phone_alert = f"(208) {random.randint(200, 999)}-{random.randint(1000, 9999)}"
    office_phone = f"(208) {random.randint(200, 999)}-{random.randint(1000, 9999)}"
    license_number = f"{LICENSE_PREFIXES[license_type]}-{random.randint(10000, 99999)}"
    # license expires 2-36 months out, weighted toward "longer" so most are clean
    license_expires = (date.today() + timedelta(days=random.randint(60, 1095))).isoformat()

    avail_issues = random.sample(ALL_ISSUES, k=random.randint(5, 9))
    primary = avail_issues[: random.randint(1, 2)]
    secondary = avail_issues[len(primary): len(primary) + random.randint(1, 3)]
    general = avail_issues[len(primary) + len(secondary):][: random.randint(1, 4)]
    modalities = random.sample(ALL_MODALITIES, random.randint(2, 4))

    offering_roll = random.random()
    if offering_roll < 0.55:
        modality_offering = "both"
    elif offering_roll < 0.85:
        modality_offering = "telehealth"
    else:
        modality_offering = "in_person"
    telehealth = modality_offering in ("telehealth", "both")
    offers_in_person = modality_offering in ("in_person", "both")
    office_locations = (
        random.sample(IDAHO_CITIES, random.randint(1, 2)) if offers_in_person else []
    )
    # Full street addresses per office (used for distance maps + patient view)
    OFFICE_STREETS = [
        "100 N Main St", "250 W Idaho St", "500 E State St", "1200 W Bannock St",
        "850 W Front St", "1450 E Park Center Blvd", "750 S 13th St",
        "350 N Eagle Rd", "1010 N Main St", "200 W State St", "75 N Main St",
    ]
    office_addresses = [
        f"{random.choice(OFFICE_STREETS)}, {city}, ID {random.choice(['83702','83703','83704','83706','83709','83712','83642','83646','83687'])}"
        for city in office_locations
    ]
    # Website URL (most therapists have one in real life)
    website = (
        f"https://{first.lower()}-{last.lower()}-therapy.com" if random.random() < 0.7 else None
    )

    age_groups = random.sample(AGE_GROUPS, random.randint(2, 4))
    client_types = ["individual"]
    if random.random() < 0.4:
        client_types.append("couples")
    if random.random() < 0.3:
        client_types.append("family")
    if random.random() < 0.1:
        client_types.append("group")

    if random.random() < 0.7:
        insurance = random.sample(INSURERS, random.randint(1, 4))
    else:
        insurance = []
    cash_rate = random.choice([100, 120, 130, 140, 150, 160, 175, 185, 200, 225])
    sliding_scale = random.random() < 0.4
    years_experience = random.randint(2, 30)
    free_consult = random.random() < 0.6
    availability_windows = random.sample(AVAILABILITY, random.randint(2, 4))
    urgency_capacity = random.choices(
        URGENCY_CAPACITIES, weights=[0.25, 0.4, 0.25, 0.1], k=1
    )[0]
    style_tags = random.sample(STYLE_TAGS, random.randint(2, 4))

    bio = (
        f"{first} is a {license_type} with {years_experience} years of clinical "
        f"experience supporting clients across Idaho. Trained in "
        f"{', '.join(modalities[:3])}, {first} brings warmth and clinical rigor "
        f"to every session, with a particular focus on "
        f"{primary[0].replace('_', ' ')} and {(secondary or general or primary)[0].replace('_', ' ')}."
    )

    return {
        "id": str(uuid.uuid4()),
        "name": name,
        "email": email,
        "phone": phone_alert,
        "phone_alert": phone_alert,
        "office_phone": office_phone,
        "gender": gender,
        "credential_type": CREDENTIAL_TYPE[license_type],
        "licensed_states": ["ID"],
        "license_number": license_number,
        "license_expires_at": license_expires,
        "license_picture": None,  # admins upload during real onboarding
        "client_types": client_types,
        "age_groups": age_groups,
        "primary_specialties": primary,
        "secondary_specialties": secondary,
        "general_treats": general,
        "modalities": modalities,
        "modality_offering": modality_offering,
        "telehealth": telehealth,
        "offers_in_person": offers_in_person,
        "office_locations": office_locations,
        "office_addresses": office_addresses,
        "website": website,
        "insurance_accepted": insurance,
        "cash_rate": cash_rate,
        "sliding_scale": sliding_scale,
        "years_experience": years_experience,
        "availability_windows": availability_windows,
        "urgency_capacity": urgency_capacity,
        "style_tags": style_tags,
        "free_consult": free_consult,
        "bio": bio,
        "profile_picture": _avatar_url(name, gender),
        "notify_email": True,
        "notify_sms": True,
        "source": "seed_v2",
        "is_active": True,
        "pending_approval": False,
        "subscription_status": "trialing",
        "stripe_customer_id": None,
        "stripe_subscription_id": None,
        "trial_ends_at": (date.today() + timedelta(days=30)).isoformat() + "T00:00:00+00:00",
        "current_period_end": (date.today() + timedelta(days=30)).isoformat() + "T00:00:00+00:00",
        "created_at": "2026-04-27T00:00:00+00:00",
    }


def generate_seed_therapists(count: int = 100) -> list[dict]:
    return [generate_therapist(i) for i in range(1, count + 1)]
