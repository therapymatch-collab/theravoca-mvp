"""Seed ~100 fake Idaho therapists for TheraVoca demo."""
from __future__ import annotations

import random
import uuid
from typing import Any

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

ALL_SPECIALTIES = list({
    "anxiety", "depression", "trauma", "couples", "family", "grief", "addiction",
    "lgbtq", "eating", "ocd", "adhd", "stress", "self-esteem", "career", "identity",
})
ALL_MODALITIES = [
    "CBT", "DBT", "EMDR", "Mindfulness-Based", "Psychodynamic", "ACT",
    "Solution-Focused", "Gottman", "IFS", "Somatic Experiencing", "Person-Centered",
]
INSURERS = [
    "Blue Cross Blue Shield", "Aetna", "Cigna", "United Healthcare", "Regence",
    "Mountain Health Co-op", "PacificSource", "Medicaid",
]
AGE_BANDS = ["children-5-12", "teen-13-17", "adult-18-64", "older-65+"]


def generate_therapist(idx: int) -> dict[str, Any]:
    first = random.choice(FIRST_NAMES)
    last = random.choice(LAST_NAMES)
    license_type = random.choice(LICENSES)
    name = f"{first} {last}, {license_type}"
    email = f"therapymatch+t{idx:03d}@gmail.com"
    phone_area = random.choice(["208"])
    phone = f"({phone_area}) {random.randint(200,999)}-{random.randint(1000,9999)}"

    # Specialties: pick 3-5 with weights summing to ~100
    spec_count = random.randint(3, 5)
    chosen_specs = random.sample(ALL_SPECIALTIES, spec_count)
    weights_raw = [random.randint(15, 35) for _ in chosen_specs]
    weights_sum = sum(weights_raw)
    specialties = [
        {"name": s, "weight": round(w / weights_sum * 100)}
        for s, w in zip(chosen_specs, weights_raw)
    ]

    # Modalities
    modalities = random.sample(ALL_MODALITIES, random.randint(2, 3))

    # Office locations
    office_count = random.randint(1, 2)
    office_locations = random.sample(IDAHO_CITIES, office_count)

    # Ages served
    ages_served = random.sample(AGE_BANDS, random.randint(2, 4))

    # Insurance
    insurance = random.sample(INSURERS, random.randint(0, 4))

    cash_rate = random.choice([100, 120, 130, 140, 150, 160, 175, 185, 200, 225])
    years_experience = random.randint(2, 30)
    free_consult = random.random() < 0.6
    telehealth = random.random() < 0.85

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
        "licensed_states": ["ID"],
        "office_locations": office_locations,
        "telehealth": telehealth,
        "specialties": specialties,
        "modalities": modalities,
        "ages_served": ages_served,
        "insurance_accepted": insurance,
        "cash_rate": cash_rate,
        "years_experience": years_experience,
        "free_consult": free_consult,
        "bio": bio,
        "source": "seed",
        "is_active": True,
        "pending_approval": False,
        "created_at": "2026-02-01T00:00:00+00:00",
    }


def generate_seed_therapists(count: int = 100) -> list[dict[str, Any]]:
    return [generate_therapist(i) for i in range(1, count + 1)]
