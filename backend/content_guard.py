"""
content_guard.py — server-side PHI / inappropriate-content scanner.

Mirrors the client-side checks in `frontend/src/lib/contentGuard.js`.
Called during request intake (`routes/requests.py`) to flag submissions
that contain personal health information or off-topic content. Flagged
requests get a `content_flags` array in the DB that the admin console
surfaces.

This does NOT block submission — it only tags for review.
"""

import re
from typing import Any

# ── PHI patterns ─────────────────────────────────────────────────────────────

_PHI_RULES: list[dict[str, Any]] = [
    {
        "id": "phone",
        "label": "phone number",
        "re": re.compile(
            r"(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b"
        ),
    },
    {
        "id": "email",
        "label": "email address",
        "re": re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"),
    },
    {
        "id": "ssn",
        "label": "social security number",
        "re": re.compile(r"\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b"),
    },
    {
        "id": "address",
        "label": "street address",
        "re": re.compile(
            r"\b\d{1,5}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+"
            r"(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Ln|Lane|"
            r"Rd|Road|Ct|Court|Way|Pl|Place|Cir|Circle)\b",
            re.IGNORECASE,
        ),
    },
    {
        "id": "dob",
        "label": "date of birth",
        "re": re.compile(
            r"\b(?:DOB|date\s+of\s+birth|born\s+on|birthday)\s*[:\s]\s*\d",
            re.IGNORECASE,
        ),
    },
    {
        "id": "icd",
        "label": "diagnosis code",
        "re": re.compile(r"\b[A-Z]\d{2}\.\d{1,2}\b"),
    },
    {
        "id": "medication",
        "label": "medication name",
        "re": re.compile(
            r"\b(?:Prozac|Zoloft|Lexapro|Wellbutrin|Effexor|Cymbalta|Paxil|"
            r"Celexa|Buspar|Buspirone|Xanax|Klonopin|Ativan|Valium|Ambien|"
            r"Seroquel|Abilify|Risperdal|Lamictal|Lithium|Adderall|Ritalin|"
            r"Concerta|Vyvanse|Strattera|Trazodone|Remeron|Gabapentin|Lyrica|"
            r"Naltrexone|Suboxone|Methadone)\b",
            re.IGNORECASE,
        ),
    },
]

# ── Inappropriate / off-topic patterns ───────────────────────────────────────

_INAPPROPRIATE_RULES: list[dict[str, Any]] = [
    {
        "id": "offtopic_chores",
        "label": "off-topic request",
        "re": re.compile(
            r"\b(?:mow(?:ing)?\s+(?:my\s+)?lawn|do(?:ing)?\s+(?:my\s+)?dishes|"
            r"clean(?:ing)?\s+(?:my\s+)?house|walk(?:ing)?\s+(?:my\s+)?dog|"
            r"fix(?:ing)?\s+(?:my\s+)?car|cook(?:ing)?\s+(?:my\s+)?(?:food|dinner|meal))\b",
            re.IGNORECASE,
        ),
    },
    {
        "id": "offtopic_dating",
        "label": "off-topic request (dating/romantic)",
        "re": re.compile(
            r"\b(?:looking\s+for\s+a\s+date|find\s+me\s+a\s+"
            r"(?:date|girlfriend|boyfriend|partner|hookup)|"
            r"want\s+to\s+date|tinder|bumble|hinge)\b",
            re.IGNORECASE,
        ),
    },
    {
        "id": "offtopic_illegal",
        "label": "potentially inappropriate request",
        "re": re.compile(
            r"\b(?:buy\s+(?:me\s+)?(?:drugs|weed|pills)|"
            r"sell\s+(?:me\s+)?(?:drugs|weed|pills)|"
            r"get\s+(?:me\s+)?(?:drugs|weed|pills|high)|"
            r"fake\s+(?:prescription|diagnosis|note))\b",
            re.IGNORECASE,
        ),
    },
]

# ── Text fields to scan in a patient request ─────────────────────────────────

_TEXT_FIELDS = [
    ("other_issue", "Anything else"),
    ("session_expectations_notes", "Session expectations notes"),
    ("insurance_name", "Insurance name"),
    ("referral_source", "Referral source"),
]


def scan_text(text: str) -> dict[str, list[dict]]:
    """Scan a single string for PHI and inappropriate content."""
    if not text or not isinstance(text, str):
        return {"phi": [], "inappropriate": []}

    phi = []
    for rule in _PHI_RULES:
        m = rule["re"].search(text)
        if m:
            phi.append({"id": rule["id"], "label": rule["label"], "match": m.group()})

    inappropriate = []
    for rule in _INAPPROPRIATE_RULES:
        m = rule["re"].search(text)
        if m:
            inappropriate.append(
                {"id": rule["id"], "label": rule["label"], "match": m.group()}
            )

    return {"phi": phi, "inappropriate": inappropriate}


def scan_request(data: dict) -> list[dict]:
    """Scan all free-text fields in a patient request.

    Returns a list of findings, each with:
        field, type ("phi" | "inappropriate"), id, label, match
    """
    findings: list[dict] = []

    for key, field_label in _TEXT_FIELDS:
        val = (data.get(key) or "").strip()
        if not val:
            continue
        result = scan_text(val)
        for f in result["phi"]:
            findings.append({"field": field_label, "type": "phi", **f})
        for f in result["inappropriate"]:
            findings.append({"field": field_label, "type": "inappropriate", **f})

    return findings
