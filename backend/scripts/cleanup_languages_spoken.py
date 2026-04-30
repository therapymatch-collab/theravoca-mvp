"""One-shot cleanup for the languages_spoken field on therapists.

The import from the Excel directory mis-mapped some address cells into
the languages array (observed examples: "❌ Online Only",
"316 W Boone", "Suite 656", "Spokane"). This script:

  1. Loads all active therapists.
  2. Filters languages_spoken against a canonical whitelist.
  3. Also drops entries matching address-like heuristics (contains
     digits, street-suffix words, known Idaho city names).
  4. Persists the cleaned list.

Run with:
    cd /app/backend && python -m scripts.cleanup_languages_spoken
"""
from __future__ import annotations

import asyncio
import os
import re

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv("/app/backend/.env")


# Canonical language whitelist — covers the 12 most-commonly supported
# languages on mental-health directories + the ones already populated
# in our Excel import. Anything outside this list is treated as
# garbage UNLESS it's a clean multi-word language name (e.g. "American
# Sign Language").
WHITELIST = {
    "English", "Spanish", "Mandarin", "Cantonese", "Korean", "Japanese",
    "Vietnamese", "Arabic", "French", "Portuguese", "Russian", "German",
    "Hindi", "Urdu", "Tagalog", "Polish", "Italian", "Hebrew",
    "Farsi", "Persian", "ASL", "American Sign Language", "Ukrainian",
    "Romanian", "Punjabi", "Bengali", "Greek", "Hmong", "Somali",
    "Swahili", "Amharic", "Turkish", "Thai", "Dutch", "Norwegian",
    "Swedish", "Filipino",
}

# Street-suffix words that commonly appear in mis-mapped address cells.
_ADDRESS_TOKENS = re.compile(
    r"\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|way|place|pl|"
    r"court|ct|highway|hwy|blvd|suite|ste|apt|unit|floor|online|only)\b",
    re.IGNORECASE,
)
_IDAHO_CITIES = {
    "boise", "meridian", "nampa", "idaho falls", "pocatello",
    "coeur d'alene", "twin falls", "caldwell", "rexburg", "moscow",
    "lewiston", "post falls", "eagle", "sandpoint", "hailey",
    "ketchum", "spokane",  # Spokane (WA border) appeared in the data
}


def _clean_entry(raw: str) -> str | None:
    """Return a trimmed language-ish string, or None if it's obvious garbage.

    Conservative rule: we only reject clearly bad entries (addresses,
    numbers, ❌-prefixed strings, Idaho city names). Legitimate but
    uncommon language names (Marathi, Hungarian, etc.) should pass
    through so we don't accidentally prune valid data."""
    s = (raw or "").strip()
    if not s:
        return None
    # Obvious garbage markers from the Excel import.
    if s.startswith("❌"):
        return None
    # Strip leading/trailing bullets + stray chars.
    s = s.lstrip("❌•-* ").rstrip("•-* ").strip('"').strip("'").strip()
    if not s:
        return None
    # Drop entries with digits — no real language name has numbers.
    if re.search(r"\d", s):
        return None
    # Drop entries matching address tokens.
    if _ADDRESS_TOKENS.search(s):
        return None
    # Drop known Idaho/Washington-border city names.
    if s.lower() in _IDAHO_CITIES:
        return None
    # Drop US state-name one-offs that appeared in the import.
    _STATES = {
        "tennessee", "washington", "oregon", "idaho", "montana",
        "utah", "wyoming", "nevada", "california", "wa", "id", "or",
    }
    if s.lower() in _STATES:
        return None
    # Drop obvious non-answers.
    if s.lower() in {"none", "none.", "n/a", "na", "-", "—"}:
        return None
    # Normalize case — canonicalize to Title Case when it matches the
    # whitelist (e.g. "spanish" → "Spanish"), otherwise leave as-is
    # since we can't guess foreign-language capitalization.
    for w in WHITELIST:
        if s.lower() == w.lower():
            return w
    # Accept anything else that's alpha + short.
    if len(s) <= 30 and re.match(r"^[A-Za-z][A-Za-z \-']*$", s):
        return s
    return None


def clean_languages(raw: list) -> list[str]:
    """Apply `_clean_entry` across a list and dedupe while preserving order."""
    if not raw:
        return []
    out: list[str] = []
    seen: set[str] = set()
    for r in raw:
        c = _clean_entry(r)
        if c and c not in seen:
            out.append(c)
            seen.add(c)
    return out


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    total = 0
    changed = 0
    removed_samples: list[tuple[str, list, list]] = []
    async for t in db.therapists.find(
        {}, {"_id": 0, "id": 1, "name": 1, "languages_spoken": 1},
    ):
        total += 1
        raw = t.get("languages_spoken") or []
        clean = clean_languages(raw)
        if clean != raw:
            await db.therapists.update_one(
                {"id": t["id"]},
                {"$set": {"languages_spoken": clean}},
            )
            changed += 1
            if len(removed_samples) < 10:
                # Show what got dropped — useful when the script is run
                # with `tee` so the operator can spot-check the diff.
                removed = [x for x in raw if x not in clean]
                removed_samples.append((t.get("name", ""), raw, clean, removed))
    print(f"Scanned {total} therapists · cleaned {changed}")
    print("\nSample diffs:")
    for name, raw, clean, removed in removed_samples:
        print(f"  {name}")
        print(f"    before:  {raw}")
        print(f"    after:   {clean}")
        print(f"    dropped: {removed}")


if __name__ == "__main__":
    asyncio.run(main())
