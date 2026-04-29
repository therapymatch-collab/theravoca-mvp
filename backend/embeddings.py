"""Lightweight OpenAI embeddings client for TheraVoca's Contextual
Resonance scoring axis (P3 ↔ T5+T2).

Why a dedicated module instead of using `emergentintegrations`?
The Emergent LLM key proxy doesn't expose embedding endpoints — it's
chat/image/audio only. Embeddings cost ~$0.02 per million tokens at
text-embedding-3-small scale, which means the entire production load
fits comfortably under a few cents/month at MVP scale, so we just call
OpenAI directly.

Design choices:
- We pre-compute therapist embeddings on save (one HTTP call per
  T2/T5 update) and store the 1536-float vector on the therapist doc
  alongside its source text.
- At match time we embed the patient's P3 answer (one HTTP call per
  request) and then everything else is pure numpy cosine.
- Texts are truncated to 6 KB before embedding because the matching
  engine doesn't need precision past 1500 tokens.
- Failures degrade gracefully — a missing embedding ⇒ Contextual
  Resonance axis returns 0.0 (no penalty, no boost) rather than
  blocking the match.
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Iterable

import httpx
import numpy as np

log = logging.getLogger("theravoca.embeddings")

EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIMS = 1536
_MAX_INPUT_CHARS = 6_000  # ~1500 tokens; plenty for short identity text


def _api_key() -> str | None:
    """Resolve the OpenAI API key from env. Returns None when missing
    so callers can short-circuit without raising — this is critical for
    the matching engine, which must never crash when a key is rotated
    out."""
    return os.environ.get("OPENAI_API_KEY") or None


def _normalize(text: str) -> str:
    """Trim, collapse whitespace, truncate to MAX_INPUT_CHARS."""
    if not text:
        return ""
    cleaned = " ".join(text.split())
    return cleaned[:_MAX_INPUT_CHARS]


async def embed_text(text: str, *, timeout: float = 15.0) -> list[float] | None:
    """Embed a single text. Returns the 1536-dim float vector or None
    on failure (missing key, API error, empty text)."""
    norm = _normalize(text)
    if not norm:
        return None
    key = _api_key()
    if not key:
        log.warning("embed_text: OPENAI_API_KEY missing — returning None")
        return None
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(
                "https://api.openai.com/v1/embeddings",
                headers={"Authorization": f"Bearer {key}"},
                json={"model": EMBEDDING_MODEL, "input": norm},
            )
            r.raise_for_status()
            data = r.json()
            return list(data["data"][0]["embedding"])
    except (httpx.HTTPError, KeyError, ValueError) as e:
        log.warning("embed_text: failed — %s", e)
        return None


async def embed_texts(
    texts: Iterable[str], *, timeout: float = 30.0
) -> list[list[float] | None]:
    """Embed a batch of texts in a single API call. Order is preserved.
    Empty inputs in the list become None."""
    items = list(texts)
    norms = [_normalize(t) for t in items]
    nonempty = [(i, n) for i, n in enumerate(norms) if n]
    if not nonempty:
        return [None] * len(items)
    key = _api_key()
    if not key:
        log.warning("embed_texts: OPENAI_API_KEY missing — returning Nones")
        return [None] * len(items)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(
                "https://api.openai.com/v1/embeddings",
                headers={"Authorization": f"Bearer {key}"},
                json={
                    "model": EMBEDDING_MODEL,
                    "input": [n for _, n in nonempty],
                },
            )
            r.raise_for_status()
            data = r.json()["data"]
        out: list[list[float] | None] = [None] * len(items)
        for slot, vec in zip(nonempty, data):
            out[slot[0]] = list(vec["embedding"])
        return out
    except (httpx.HTTPError, KeyError, ValueError) as e:
        log.warning("embed_texts: batch failed — %s", e)
        return [None] * len(items)


def cosine_similarity(a: list[float] | None, b: list[float] | None) -> float:
    """Cosine similarity in [-1, 1]. Returns 0.0 when either side is
    missing — the matching engine treats this as 'no signal' rather
    than penalising. text-embedding-3 vectors are already unit-norm,
    but we re-normalise defensively in case of any future drift."""
    if not a or not b:
        return 0.0
    va = np.asarray(a, dtype=np.float32)
    vb = np.asarray(b, dtype=np.float32)
    na = float(np.linalg.norm(va))
    nb = float(np.linalg.norm(vb))
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(va, vb) / (na * nb))


# Convenience for synchronous call sites (e.g., admin scripts) that
# need a one-shot embed without an event loop. Used sparingly.
def embed_text_sync(text: str) -> list[float] | None:
    return asyncio.get_event_loop().run_until_complete(embed_text(text))
