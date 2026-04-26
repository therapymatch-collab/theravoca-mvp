"""Seed Idaho therapists with the new MVP schema (v2)."""
from __future__ import annotations

import random
import uuid

random.seed(42)

FIRST_NAMES = [
    "Sarah", "Michael", "Jennifer", "David", "Emily", "James", "Jessica", "Robert",
    "Ashley", "Christopher", "Amanda", "Matthew", "Melissa", "Andrew", "Stephanie",
    "Joshua", "Nicole", "Daniel", "Rachel", "Ryan", "Lauren", "Brandon", "Megan",
    "Justin", "Heather", "Kevin", "Amber", "Jason", "Brittany", "Jonathan",
    "Samantha", "Nicholas", "Tiffany", "Adam", "Crystal", "Eric", "Hannah",
    "Anthony", "Olivia", "Tyler", "Sophia", "Aaron", "Madison", "Jacob", "Chloe",
    "Patrick", "Grace", "Sean", "Lily", "Brian", "Anna",
]
LAST_NAMES = [
    "Anderson", "Bennett", "Carter", "Dawson", "Ellis", "Foster", "Garcia",
    "Hayes", "Iverson", "Jenkins", "Klein", "Larson", "Mitchell", "Nguyen",
    "Owens", "Parker", "Quinn", "Reyes", "Sullivan", "Thomas", "Underwood",
    "Vasquez", "Walsh", "Xiong", "Young", "Zimmerman", "Brooks", "Coleman",
    "Drake", "Edwards", "Fischer", "Gibson", "Hudson", "Ingram", "Jordan",
    "Kelly", "Lopez", "Morgan", "Nelson", "Ortiz", "Patel", "Rivera",
    "Sanchez", "Turner", "Vargas", "Wilson", "Brown", "Davis", "Miller", "Moore",
]
LICENSES = ["LCSW", "LMFT", "LPC", "PsyD", "PhD", "LCMHC", "LCPC"]

IDAHO_CITIES = [
    "Boise", "Meridian", "Nampa", "Idaho Falls", "Pocatello", "Caldwell",
    "Coeur d'Alene", "Twin Falls", "Lewiston", "Post Falls", "Rexburg", "Eagle",
    "Kuna", "Moscow", "Ammon",
]

# Issues match the patient-facing intake list exactly
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
    "Blue Cross Blue Shield", "Aetna", "Cigna", "United Healthcare", "Regence",
    "Mountain Health Co-op", "PacificSource", "Medicaid",
]
CLIENT_TYPES = ["individual", "couples", "family", "group"]
AGE_GROUPS = ["child", "teen", "young_adult", "adult", "older_adult"]
GENDERS = ["female", "male", "nonbinary"]
AVAILABILITY = [
    "weekday_morning", "weekday_afternoon", "weekday_evening",
    "weekend_morning", "weekend_afternoon",
]
STYLE_TAGS = [
    "structured", "warm_supportive", "direct_practical", "trauma_informed",
    "insight_oriented", "faith_informed", "culturally_responsive", "lgbtq_affirming",
]
MODALITY_OFFERINGS = ["telehealth", "in_person", "both"]
URGENCY_CAPACITIES = ["asap", "within_2_3_weeks", "within_month", "full"]


def _name_to_gender(first: str) -> str:
    """Lightweight heuristic for the seed only."""
    male = {"Michael", "David", "James", "Robert", "Christopher", "Matthew", "Andrew",
            "Joshua", "Daniel", "Ryan", "Brandon", "Justin", "Kevin", "Jason", "Jonathan",
            "Nicholas", "Adam", "Eric", "Anthony", "Tyler", "Aaron", "Jacob", "Patrick",
            "Sean", "Brian"}
    female = {"Sarah", "Jennifer", "Emily", "Jessica", "Ashley", "Amanda", "Melissa",
              "Stephanie", "Nicole", "Rachel", "Lauren", "Megan", "Heather", "Amber",
              "Brittany", "Samantha", "Tiffany", "Crystal", "Hannah", "Olivia", "Sophia",
              "Madison", "Chloe", "Grace", "Lily", "Anna"}
    if first in male:
        return "male"
    if first in female:
        return "female"
    return random.choice(["female", "male", "nonbinary"])


def generate_therapist(idx: int) -> dict:
    first = random.choice(FIRST_NAMES)
    last = random.choice(LAST_NAMES)
    license_type = random.choice(LICENSES)
    name = f"{first} {last}, {license_type}"
    email = f"therapymatch+t{idx:03d}@gmail.com"
    phone = f"(208) {random.randint(200, 999)}-{random.randint(1000, 9999)}"
    gender = _name_to_gender(first)

    # Specialties — split into primary (1-2), secondary (1-3), general (1-4)
    avail_issues = random.sample(ALL_ISSUES, k=random.randint(5, 9))
    primary = avail_issues[: random.randint(1, 2)]
    secondary = avail_issues[len(primary): len(primary) + random.randint(1, 3)]
    general = avail_issues[len(primary) + len(secondary):][: random.randint(1, 4)]

    modalities = random.sample(ALL_MODALITIES, random.randint(2, 3))

    # Modality offering
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

    age_groups = random.sample(AGE_GROUPS, random.randint(2, 4))

    # Client types — most therapists do individual, some add couples/family
    client_types = ["individual"]
    if random.random() < 0.4:
        client_types.append("couples")
    if random.random() < 0.3:
        client_types.append("family")
    if random.random() < 0.1:
        client_types.append("group")

    # Insurance
    if random.random() < 0.7:
        insurance = random.sample(INSURERS, random.randint(1, 4))
    else:
        insurance = []

    cash_rate = random.choice([100, 120, 130, 140, 150, 160, 175, 185, 200, 225])
    years_experience = random.randint(2, 30)
    free_consult = random.random() < 0.6

    availability_windows = random.sample(AVAILABILITY, random.randint(2, 4))
    urgency_capacity = random.choices(
        URGENCY_CAPACITIES, weights=[0.25, 0.4, 0.25, 0.1], k=1
    )[0]

    style_tags = random.sample(STYLE_TAGS, random.randint(2, 4))

    bio = (
        f"{first} is a {license_type} with {years_experience} years of experience supporting "
        f"individuals across Idaho. Trained in {', '.join(modalities)}, "
        f"{first} brings warmth and clinical rigor to every session."
    )

    return {
        "id": str(uuid.uuid4()),
        "name": name,
        "email": email,
        "phone": phone,
        "gender": gender,
        "licensed_states": ["ID"],
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
        "insurance_accepted": insurance,
        "cash_rate": cash_rate,
        "years_experience": years_experience,
        "availability_windows": availability_windows,
        "urgency_capacity": urgency_capacity,
        "style_tags": style_tags,
        "free_consult": free_consult,
        "bio": bio,
        "source": "seed_v2",
        "is_active": True,
        "pending_approval": False,
        "created_at": "2026-04-01T00:00:00+00:00",
    }


def generate_seed_therapists(count: int = 100) -> list[dict]:
    return [generate_therapist(i) for i in range(1, count + 1)]
