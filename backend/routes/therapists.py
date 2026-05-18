"""Therapist routes: signup, Stripe checkout/portal/charge, view + apply/decline."""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request

from deps import db, logger, require_admin, require_session, _create_session_token, JWT_SECRET, _decode_session_from_authorization
import stripe_service
from email_service import send_therapist_signup_received
from embeddings import embed_texts
from geocoding import geocode_offices
import audit
from helpers import _now_iso, _spawn_bg
from models import (
    ApplicationOut, BulkApplyIn, TherapistApplyIn, TherapistDeclineIn, TherapistSignup,
)
from turnstile_service import verify_token as verify_turnstile

router = APIRouter()

# ─── Signed URL helpers for email links ────────────────────────────────
# Generate/verify HMAC signatures so apply/decline email links can't be
# forged. Links expire after SIGNED_URL_TTL_HOURS (default 72h).
SIGNED_URL_TTL_HOURS = int(os.environ.get("SIGNED_URL_TTL_HOURS", "72"))


def generate_action_signature(
    request_id: str, therapist_id: str, action: str, expires_token: str,
) -> str:
    """Create HMAC-SHA256 signature for an email action link.

    `expires_token` is whatever value will appear in the URL's `exp`
    query param verbatim. Pass the EXACT string the verifier will read
    -- if the URL form differs from the signed form (e.g. URL-encoding
    converts a `+` to a space), the signature won't match.
    """
    msg = f"{request_id}:{therapist_id}:{action}:{expires_token}"
    return hmac.new(
        JWT_SECRET.encode(), msg.encode(), hashlib.sha256,
    ).hexdigest()[:32]


def generate_signed_url(
    base_url: str, request_id: str, therapist_id: str, action: str,
) -> str:
    """Build a full signed URL for email links (apply/decline).

    `exp` is a Unix-epoch integer (seconds), NOT an ISO timestamp.
    Earlier versions used isoformat() and URL-encoded the `+00:00`
    timezone offset as `%2B00%3A00`. Some email clients (notably
    Gmail web) silently un-escape `%2B` back to a literal `+` before
    handing the URL to the browser. The browser then sends `+`, which
    FastAPI's query-string parser converts to a space per the HTML-
    form spec. The signed payload then no longer matches the value
    the verifier sees, every link comes back "Invalid link signature".
    Integer epoch seconds are URL-safe and round-trip cleanly.
    """
    expires_dt = (
        datetime.now(timezone.utc) + timedelta(hours=SIGNED_URL_TTL_HOURS)
    )
    expires_token = str(int(expires_dt.timestamp()))
    sig = generate_action_signature(
        request_id, therapist_id, action, expires_token,
    )
    return (
        f"{base_url}/therapist/{action}/{request_id}/{therapist_id}"
        f"?sig={sig}&exp={expires_token}"
    )


async def _verify_action_signature(
    request_id: str,
    therapist_id: str,
    action: str,
    sig: Optional[str],
    exp: Optional[str],
    authorization: Optional[str] = None,
) -> None:
    """Verify a signed URL's signature and expiry. Raises 403 on failure.

    If the caller provides a valid therapist session token whose email
    matches the therapist_id in the URL, signature verification is
    skipped -- the therapist is already authenticated via their portal
    session and owns this resource.

    Accepts BOTH the new integer-epoch `exp` format and the legacy
    ISO-string format, so any signed URLs sent before the format
    change keep working until they expire (72h TTL).
    """
    # -- Authenticated-session bypass (Bug C fix) --
    # A logged-in therapist accessing their own referral from the
    # dashboard doesn't need a signed URL -- they're already authed.
    if not sig and authorization:
        session = _decode_session_from_authorization(authorization)
        if session and session.get("role") == "therapist":
            # Ownership check: session email must match therapist_id
            therapist = await db.therapists.find_one(
                {"id": therapist_id}, {"_id": 0, "email": 1}
            )
            if therapist and therapist.get("email", "").lower() == session["email"].lower():
                return  # authenticated owner -- skip signature
    # -- Standard signed-URL path --
    if not sig:
        raise HTTPException(
            403,
            "Link signature is missing -- please use the link from your email",
        )
    if not exp:
        raise HTTPException(403, "Link is missing expiration")
    # Resolve exp to a datetime, accepting either int-epoch or ISO.
    exp_dt: Optional[datetime] = None
    if exp.isdigit() or (exp.startswith("-") and exp[1:].isdigit()):
        try:
            exp_dt = datetime.fromtimestamp(int(exp), tz=timezone.utc)
        except (ValueError, OverflowError):
            exp_dt = None
    if exp_dt is None:
        try:
            exp_dt = datetime.fromisoformat(exp)
        except ValueError:
            raise HTTPException(
                403,
                "Invalid link -- please use the link from your email",
            )
    if exp_dt < datetime.now(timezone.utc):
        raise HTTPException(
            403,
            "This link has expired. Please check your email for a newer notification.",
        )
    expected = generate_action_signature(
        request_id, therapist_id, action, exp,
    )
    if not hmac.compare_digest(sig, expected):
        raise HTTPException(403, "Invalid link signature")


# ─── Embedding helper for the deep-match Contextual Resonance axis ──
# Stores T5 embedding on the therapist doc so match-time scoring is a
# pure numpy cosine. Called from signup + portal-edit whenever T5 changes.
# T2 (progress story) was removed — its weight shifted entirely to T5.
async def _embed_therapist_signals(
    therapist_id: str, t5_text: str, _t2_text: str = ""
) -> None:
    try:
        vecs = await embed_texts([t5_text or ""])
        update: dict = {}
        if vecs[0]:
            update["t5_embedding"] = vecs[0]
            update["t5_embedding_text"] = (t5_text or "").strip()[:6000]
        if update:
            await db.therapists.update_one(
                {"id": therapist_id}, {"$set": update}
            )
            logger.info(
                "Embedded therapist %s T5 signal: %s",
                therapist_id, bool(vecs[0]),
            )
    except Exception as e:  # noqa: BLE001
        logger.warning("Embedding therapist %s failed: %s", therapist_id, e)


# ─── Self-signup + Stripe onboarding ────────────────────────────────────────

@router.post("/therapists/signup", response_model=dict)
async def therapist_signup(payload: TherapistSignup, request: Request):
    # ─── Bot defenses (run before anything expensive) ──────────────────
    # Master testing-mode bypass: when an admin has flipped the master
    # toggle, skip timing + IP rate-limit gates. Honeypot stays on.
    import testing_mode
    _testing_active = await testing_mode.is_active()

    # 1. Honeypot: a hidden form field bots auto-fill. Real users never
    #    see it, so any non-empty value is a clear bot signal. Mirrors
    #    the patient intake defense.
    if (getattr(payload, "fax_number", "") or "").strip():
        raise HTTPException(400, "Submission rejected.")
    # 2. Timing heuristic: humans take >2s to fill the form, bots fire
    #    instantly. If form_started_at_ms is missing we just skip the
    #    check (older clients).
    started_ms = getattr(payload, "form_started_at_ms", None)
    if not _testing_active and started_ms is not None:
        try:
            now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
            delta_s = (now_ms - int(started_ms)) / 1000.0
            if delta_s < 2.0 or delta_s > 24 * 3600.0:
                raise HTTPException(400, "Submission rejected.")
        except (TypeError, ValueError):
            pass
    fwd = request.headers.get("x-forwarded-for") or ""
    client_ip = (fwd.split(",")[0].strip() if fwd else None) or (
        getattr(request.client, "host", None) or ""
    )
    # 3. Per-IP rate limit: cap therapist signups per IP per hour.
    #    Reuses the intake_ip_log collection so the same admin-tunable
    #    cap protects both flows. Therapist signups are rare so we use
    #    a tighter cap.
    if not _testing_active and client_ip:
        ip_cutoff_iso = (
            datetime.now(timezone.utc) - timedelta(hours=1)
        ).isoformat()
        ip_recent = await db.intake_ip_log.count_documents(
            {"ip": client_ip, "kind": "therapist_signup", "ts": {"$gte": ip_cutoff_iso}},
        )
        # Hardcoded cap of 3 -- legit therapists signing up the same hour
        # from one IP is extremely rare; bots can hit this many times.
        if ip_recent >= 3:
            raise HTTPException(
                429,
                "Too many signup attempts from this network in the last hour. "
                "Please try again later.",
            )
    # 4. Cloudflare Turnstile gate (fail-soft when secret not configured).
    ok, ts_err = await verify_turnstile(
        getattr(payload, "turnstile_token", None), remote_ip=client_ip,
    )
    if not ok:
        raise HTTPException(400, ts_err or "Security check failed.")
    # 5. Therapist Terms of Use consent gate. Frontend should already
    #    block submit, but enforce server-side so direct API callers
    #    can't bypass. Stamp the timestamp here so we control the clock
    #    (frontend value is informational only).
    if not getattr(payload, "agreed_to_therapist_terms", False):
        raise HTTPException(
            400,
            "You must agree to the Therapist Terms of Use to sign up.",
        )
    # 6. Open-text moderation (2026-05-17, Josh) -- gate every
    #    free-text field a therapist can submit against gibberish,
    #    profanity, all-caps shouting, and link spam. We run this
    #    before any DB writes so a rejected submission leaves no
    #    artifacts (no half-created therapist row, no embeddings
    #    queued, no Stripe customer). Each non-empty field is
    #    validated; empty fields pass through (pydantic schema
    #    already enforces the optional/required contract).
    from text_moderation import validate_or_raise as _validate_text
    _mod_route = "/api/therapists/signup"
    _mod_actor = payload.email
    if (payload.bio or "").strip():
        # Bio has no max_length in the schema today (oversight); cap
        # it here at 3000 chars -- generous for a full bio but
        # protects against accidental paste of an entire CV.
        _validate_text(
            payload.bio,
            field_name="Bio",
            max_length=3000,
            min_length=20,  # a 5-character bio is clearly low-effort
            route=_mod_route, actor_email=_mod_actor,
        )
    if (getattr(payload, "t2_progress_story", "") or "").strip():
        _validate_text(
            payload.t2_progress_story,
            field_name="Progress story",
            max_length=2000,
            route=_mod_route, actor_email=_mod_actor,
        )
    if (getattr(payload, "t5_lived_experience", "") or "").strip():
        _validate_text(
            payload.t5_lived_experience,
            field_name="Lived experience",
            max_length=2000,
            route=_mod_route, actor_email=_mod_actor,
        )
    if (getattr(payload, "t6_early_sessions_description", "") or "").strip():
        _validate_text(
            payload.t6_early_sessions_description,
            field_name="Early sessions description",
            max_length=2000,
            route=_mod_route, actor_email=_mod_actor,
        )
    # Normalise email to lowercase BEFORE the dup-check + insert so we
    # can't end up with `Joe@x.com` and `joe@x.com` as two separate
    # therapist rows (later lookups are case-insensitive regex, so the
    # second signup would silently work but auth would be unpredictable
    # about which row resolves). 2026-05-16 audit fix.
    payload.email = (payload.email or "").strip().lower()
    existing = await db.therapists.find_one(
        {"email": {"$regex": f"^{re.escape(payload.email)}$", "$options": "i"}},
        {"_id": 0, "id": 1},
    )
    if existing:
        raise HTTPException(409, "A therapist with this email already exists.")

    # ─── Idaho-only address gate (2026-05-18, Josh) ───────────────────
    # Josh's bug report: "i put my home address in NY but it added ID. i
    # know we're doing 30 mile radius checks, but what about address
    # verifications?"
    #
    # The old flow let any string through office_addresses and silently
    # geocoded office_locations as if they were Idaho cities, so a NY
    # address would be accepted and tagged as Idaho. Now we require an
    # Idaho ZIP (8XXXX where the first two digits are 83 -- 83000-83999
    # is exclusively Idaho per USPS) in EACH office_address. This is a
    # cheap regex gate; the office_locations cities still get geocoded
    # against Idaho but the per-address ZIP check is what prevents
    # cross-state leakage.
    #
    # If the therapist legitimately practices in multiple states, they
    # can list non-Idaho addresses on their profile AFTER admin
    # approves them and the licensed_states list reflects that. For
    # signup-time validation, restrict to Idaho per scope-out policy
    # (HIPAA-SCOPE-OUT-2026-05-13.md).
    import re as _re
    IDAHO_ZIP_RE = _re.compile(r"\b83\d{3}\b")
    bad_addresses = [
        a for a in (payload.office_addresses or [])
        if a and a.strip() and not IDAHO_ZIP_RE.search(a)
    ]
    if bad_addresses:
        # Show the first one in the error so the user knows which to fix.
        first_bad = bad_addresses[0][:120]
        raise HTTPException(
            400,
            "Each office address must include an Idaho ZIP code "
            f"(83000-83999). Got: '{first_bad}'. We're licensed to "
            "match therapists in Idaho only -- if you practice in "
            "another state too, add the Idaho address here and you "
            "can list other office locations on your profile after "
            "approval.",
        )

    tid = str(uuid.uuid4())
    office_geos = await geocode_offices(db, payload.office_locations or [], "ID")
    data = payload.model_dump()
    # Bot-defense fields are interrogated above -- never persist them.
    data.pop("turnstile_token", None)
    data.pop("fax_number", None)
    data.pop("form_started_at_ms", None)
    # Server-stamp the ToS consent timestamp so we control the clock.
    data["agreed_to_therapist_terms_at"] = _now_iso()
    data["telehealth"] = data["modality_offering"] in ("telehealth", "both")
    data["offers_in_person"] = data["modality_offering"] in ("in_person", "both")
    # Issue a stable refer-a-colleague code (8 chars, base32-ish)
    referral_code = data.get("referral_code") or uuid.uuid4().hex[:8].upper()

    # Gap-recruit attribution: if the signup came in via a recruit_code, find
    # the originating recruit_drafts row, mark it `converted=true`, and store
    # the code on the therapist for future analytics.
    recruit_code = (data.pop("recruit_code", None) or "").strip().upper()
    converted_draft_id: str | None = None
    if recruit_code:
        # SECURITY: re.escape the user-controlled code so a value like
        # ".*" can't match arbitrary drafts and forge recruit attribution
        # (2026-05-16 audit fix). Anchored ^ + escaped pattern restricts
        # to legitimate prefix match on the draft id.
        draft = await db.recruit_drafts.find_one(
            {"id": {"$regex": f"^{re.escape(recruit_code.lower())}", "$options": "i"}},
            {"_id": 0, "id": 1},
        )
        if draft:
            converted_draft_id = draft["id"]
            await db.recruit_drafts.update_one(
                {"id": converted_draft_id},
                {"$set": {
                    "converted_therapist_id": tid,
                    "converted_at": _now_iso(),
                }},
            )

    doc = {
        "id": tid,
        **data,
        "referral_code": referral_code,
        "office_geos": office_geos,
        "source": "signup" if not recruit_code else "gap_recruit_signup",
        "recruit_code": recruit_code or None,
        "recruit_draft_id": converted_draft_id,
        "is_active": True,
        "pending_approval": True,
        "subscription_status": "incomplete",
        "stripe_customer_id": None,
        "stripe_subscription_id": None,
        "trial_ends_at": None,
        "current_period_end": None,
        "created_at": _now_iso(),
    }
    await db.therapists.insert_one(doc.copy())
    # Log the IP for the per-IP rate-limit window. Same collection +
    # TTL the patient intake uses, distinguished by `kind`.
    if client_ip:
        try:
            await db.intake_ip_log.insert_one({
                "ip": client_ip,
                "kind": "therapist_signup",
                "therapist_id": tid,
                "ts": _now_iso(),
            })
        except Exception as e:
            logger.warning("intake_ip_log insert failed for therapist signup: %s", e)
    _spawn_bg(
        send_therapist_signup_received(payload.email, payload.name),
        name=f"signup_email_{tid[:8]}",
    )
    # (The separate "founder welcome letter" template was removed
    # 2026-05-16 per Josh -- therapist_approved already covers the
    # same goal once the manual review finishes. The single signup
    # receipt above is now the only signup-time email.)
    # Pre-compute T2/T5 embeddings in the background so Contextual
    # Resonance scoring works on first match without a per-request
    # round-trip. Failures degrade gracefully — see embeddings.py.
    if (payload.t5_lived_experience or "").strip():
        _spawn_bg(
            _embed_therapist_signals(tid, payload.t5_lived_experience or ""),
            name=f"embed_signup_{tid[:8]}",
        )
    logger.info(
        "New therapist signup: tid=%s with %d geocoded offices, recruit_code=%s",
        tid, len(office_geos), recruit_code or "none",
    )
    # Issue a therapist session_token immediately on signup. The
    # subsequent /therapists/{id}/subscribe-checkout +
    # /therapists/{id}/sync-payment-method calls REQUIRE this session
    # (2026-05-16 security fix) -- prior to that fix, an attacker who
    # knew a therapist_id could create a checkout, pay with their
    # own card, and trick /sync-payment-method into issuing them a
    # session for that therapist. Now the session must already be in
    # the request, and the URL therapist_id is verified to match the
    # session's email. The session is for an UNAPPROVED therapist;
    # the portal still gates most actions on approval state.
    signup_session_token = _create_session_token(payload.email, "therapist")
    # Kick off deep web-research enrichment in the background so by the
    # time admin reviews the application, we already have evidence-graded
    # specialty themes + public footprint cached. Best-effort; failures
    # are logged in research_enrichment but never block signup.
    try:
        from research_enrichment import get_or_build_research

        async def _bg_deep_research():
            try:
                t = await db.therapists.find_one({"id": tid}, {"_id": 0})
                if t:
                    await get_or_build_research(t, force=True, deep=True)
            except Exception as e:
                logger.warning("Auto deep-research for new signup failed: %s", e)

        _spawn_bg(_bg_deep_research(), name=f"deep_research_{tid[:8]}")
    except ImportError:
        pass
    return {
        "id": tid,
        "status": "pending_approval",
        # 2026-05-16 security fix: returning the session_token here so
        # the frontend can pass it on the immediate next call to
        # /subscribe-checkout (which now REQUIRES auth). The session is
        # short-lived (THERAPIST_SESSION_TTL_DAYS) and bound to the
        # email the user just typed -- they're trivially proving
        # ownership of "this email I just typed" until they click the
        # signup-receipt link, which is the normal verification path.
        "session_token": signup_session_token,
    }


def _therapist_owns_or_403(session: dict, therapist_id: str, t: dict) -> None:
    """Reject if the bearer session's email doesn't match the URL
    therapist. Used by the Stripe-touching therapist endpoints below
    so an attacker who knows a therapist_id can't create a checkout /
    sync a payment method for somebody else's account.
    """
    sess_email = (session.get("email") or "").lower()
    t_email = (t.get("email") or "").lower()
    if not sess_email or not t_email or sess_email != t_email:
        raise HTTPException(
            403,
            "Session does not own this therapist.",
        )


def _safe_return_url(return_url: str, base: str) -> str:
    """Open-redirect-proof check against the canonical PUBLIC_APP_URL.

    The prior implementation used `return_url.startswith(base)` which
    accepts e.g. `https://theravoca.com.attacker.com/...` when base is
    `https://theravoca.com` -- post-Stripe-success redirect could land
    on an attacker domain for credential phishing. Parse the URL and
    compare scheme+netloc EXACTLY against the base. 2026-05-16 audit.
    """
    if not return_url:
        return ""
    try:
        from urllib.parse import urlparse
        ru = urlparse(return_url)
        bu = urlparse(base or "")
        if (ru.scheme, ru.netloc) != (bu.scheme, bu.netloc):
            return ""
        return return_url
    except Exception:
        return ""


@router.post("/therapists/{therapist_id}/subscribe-checkout")
async def therapist_subscribe_checkout(
    therapist_id: str,
    payload: dict | None = None,
    session: dict = Depends(require_session(("therapist",))),
):
    """Create a Stripe Checkout session for the therapist's payment-method
    setup. Optional body param `return_url` controls where Stripe sends
    the user on success / cancel; defaults to the signup form for new
    signups. The portal passes its own URL so signed-up therapists who
    add a payment method don't get sent back to the signup form.

    SECURITY: requires a therapist session whose email matches the URL
    therapist_id. Before this gate, anyone who knew a therapist_id
    could create a Stripe Checkout for that therapist and (combined
    with the old sync-payment-method behaviour) hijack a session.
    """
    t = await db.therapists.find_one(
        {"id": therapist_id},
        {"_id": 0, "id": 1, "email": 1, "name": 1, "subscription_status": 1},
    )
    if not t:
        raise HTTPException(404)
    _therapist_owns_or_403(session, therapist_id, t)
    base = os.environ.get("PUBLIC_APP_URL", "")
    return_url = _safe_return_url(
        ((payload or {}).get("return_url") or "").strip(),
        base,
    )
    return_base = return_url or f"{base}/therapists/join"
    sep = "&" if "?" in return_base else "?"
    success_url = (
        f"{return_base}{sep}subscribed={therapist_id}"
        f"&session_id={{CHECKOUT_SESSION_ID}}"
    )
    cancel_url = f"{return_base}{sep}canceled={therapist_id}"
    try:
        result = await stripe_service.create_setup_checkout(
            therapist_id=t["id"],
            therapist_email=t["email"],
            therapist_name=t["name"],
            success_url=success_url,
            cancel_url=cancel_url,
        )
    except Exception as e:
        logger.exception("Stripe checkout creation failed: %s", e)
        raise HTTPException(502, f"Stripe error: {e}")
    return result


@router.post("/therapists/{therapist_id}/sync-payment-method")
async def therapist_sync_payment_method(
    therapist_id: str,
    payload: dict,
    session: dict = Depends(require_session(("therapist",))),
):
    """Finalise a Stripe Checkout session: persist the payment-method
    id on the therapist + flip status to trialing.

    SECURITY: requires a therapist session whose email matches the URL
    therapist_id. Before this gate, an attacker who created their own
    Stripe Checkout for someone else's therapist_id could call this
    endpoint and either (a) attach their card to the victim's account
    or (b) trick the legacy version into issuing them a session token
    for the victim. Both are now closed. The session token is NO
    LONGER issued here -- the caller (signup or portal) already has
    one.
    """
    session_id = (payload or {}).get("session_id")
    if not session_id:
        raise HTTPException(400, "session_id required")
    t = await db.therapists.find_one(
        {"id": therapist_id}, {"_id": 0, "id": 1, "email": 1},
    )
    if not t:
        raise HTTPException(404)
    _therapist_owns_or_403(session, therapist_id, t)

    info = stripe_service.retrieve_session(session_id)
    if not info:
        raise HTTPException(502, "Could not retrieve Stripe session")
    if info.get("status") != "complete":
        return {"ok": False, "status": info.get("status")}
    # Verify this Stripe session was created for THIS therapist (belt +
    # suspenders alongside the session-ownership check above).
    if info.get("client_reference_id") != therapist_id:
        raise HTTPException(
            403, "Stripe session does not belong to this therapist"
        )

    trial_end = datetime.now(timezone.utc) + timedelta(days=30)
    await db.therapists.update_one(
        {"id": therapist_id},
        {"$set": {
            "stripe_customer_id": info.get("customer"),
            "stripe_setup_intent_id": info.get("setup_intent_id"),
            "stripe_payment_method_id": info.get("payment_method"),
            "subscription_status": "trialing",
            "trial_ends_at": trial_end.isoformat(),
            "current_period_end": trial_end.isoformat(),
            "updated_at": _now_iso(),
        }},
    )
    return {
        "ok": True,
        "subscription_status": "trialing",
        "trial_ends_at": trial_end.isoformat(),
    }


@router.post("/therapists/{therapist_id}/portal-session")
async def therapist_portal_session(
    therapist_id: str,
    session: dict = Depends(require_session(("therapist",))),
):
    """Stripe Customer Portal -- therapist self-serve subscription management."""
    import re
    t = await db.therapists.find_one(
        {"id": therapist_id},
        {"_id": 0, "id": 1, "email": 1, "stripe_customer_id": 1},
    )
    if not t:
        raise HTTPException(404)
    if t["email"].lower() != session["email"].lower():
        raise HTTPException(403, "Not your account")
    if not t.get("stripe_customer_id"):
        raise HTTPException(400, "No Stripe customer on file. Add a payment method first.")
    base = os.environ.get("PUBLIC_APP_URL", "")
    return_url = f"{base}/portal/therapist"
    res = stripe_service.create_billing_portal_session(t["stripe_customer_id"], return_url)
    if not res:
        raise HTTPException(502, "Could not create Stripe Customer Portal session")
    return res


@router.get("/therapists/{therapist_id}/subscription")
async def therapist_subscription_status(
    therapist_id: str,
    session: dict = Depends(require_session(("therapist",))),
):
    import re
    t = await db.therapists.find_one(
        {"id": therapist_id},
        {"_id": 0, "id": 1, "email": 1, "subscription_status": 1,
         "trial_ends_at": 1, "current_period_end": 1},
    )
    if not t:
        raise HTTPException(404)
    if t["email"].lower() != session["email"].lower():
        raise HTTPException(403, "Not your account")
    t.pop("email", None)
    return t


@router.post("/admin/therapists/{therapist_id}/charge-now")
async def admin_charge_therapist_now(
    therapist_id: str, _: bool = Depends(require_admin),
):
    t = await db.therapists.find_one(
        {"id": therapist_id},
        {"_id": 0, "id": 1, "stripe_customer_id": 1, "stripe_payment_method_id": 1, "subscription_status": 1},
    )
    if not t or not t.get("stripe_customer_id"):
        raise HTTPException(400, "Therapist has no Stripe customer on file")
    res = stripe_service.charge_monthly_fee(
        customer_id=t["stripe_customer_id"],
        payment_method_id=t.get("stripe_payment_method_id"),
    )
    if res.get("error"):
        await db.therapists.update_one(
            {"id": therapist_id},
            {"$set": {"subscription_status": "past_due", "updated_at": _now_iso()}},
        )
        return {"ok": False, **res}
    next_period = datetime.now(timezone.utc) + timedelta(days=30)
    await db.therapists.update_one(
        {"id": therapist_id},
        {"$set": {
            "subscription_status": "active",
            "current_period_end": next_period.isoformat(),
            "trial_ends_at": None,
            "updated_at": _now_iso(),
        }},
    )
    return {"ok": True, **res, "current_period_end": next_period.isoformat()}


# ─── Therapist-facing referral apply/decline/view ────────────────────────────

from helpers import _safe_summary_for_therapist  # noqa: E402


@router.post("/portal/therapist/bulk-apply")
async def therapist_bulk_apply(
    payload: BulkApplyIn,
    session: dict = Depends(require_session(("therapist",))),
):
    """Confirm interest on N referrals at once. Each referral gets the same
    message + commitment flags. Skips referrals the therapist wasn't notified for."""
    import re
    therapist = await db.therapists.find_one(
        {"email": {"$regex": f"^{re.escape(session['email'])}$", "$options": "i"}},
        {"_id": 0, "id": 1, "name": 1},
    )
    if not therapist:
        raise HTTPException(404, "Therapist profile not found")
    tid = therapist["id"]
    # 2026-05-17 (Josh's p3_resonance audit miss) -- validate the
    # bulk-apply message body against gibberish / profanity / link
    # spam BEFORE looping. Same wordlist as patient + therapist
    # signup; one rejection short-circuits the whole batch.
    if (payload.message or "").strip():
        from text_moderation import validate_or_raise as _validate_text
        _validate_text(
            payload.message,
            field_name="Bulk-apply message",
            max_length=1500,
            route="/api/portal/therapist/bulk-apply",
            actor_email=session.get("email"),
        )
    out: list[dict] = []
    for rid in payload.request_ids[:50]:
        req = await db.requests.find_one({"id": rid}, {"_id": 0, "id": 1, "notified_scores": 1})
        if not req:
            out.append({"request_id": rid, "ok": False, "error": "not_found"})
            continue
        score = (req.get("notified_scores") or {}).get(tid)
        if score is None:
            out.append({"request_id": rid, "ok": False, "error": "not_notified"})
            continue
        existing = await db.applications.find_one(
            {"request_id": rid, "therapist_id": tid}, {"_id": 0, "id": 1}
        )
        all_confirmed = all([
            payload.confirms_availability, payload.confirms_urgency, payload.confirms_payment,
        ])
        doc = {
            "message": payload.message,
            "confirms_availability": payload.confirms_availability,
            "confirms_urgency": payload.confirms_urgency,
            "confirms_payment": payload.confirms_payment,
            "all_confirmed": all_confirmed,
            "updated_at": _now_iso(),
        }
        if existing:
            await db.applications.update_one({"id": existing["id"]}, {"$set": doc})
            out.append({"request_id": rid, "ok": True, "updated": True})
        else:
            doc.update({
                "id": str(uuid.uuid4()),
                "request_id": rid,
                "therapist_id": tid,
                "therapist_name": therapist["name"],
                "match_score": score,
                "created_at": _now_iso(),
            })
            await db.applications.insert_one(doc.copy())
            out.append({"request_id": rid, "ok": True, "created": True})
    return {"results": out, "succeeded": sum(1 for x in out if x["ok"])}


@router.get("/therapist/apply/{request_id}/{therapist_id}", response_model=dict)
async def therapist_view(
    request_id: str,
    therapist_id: str,
    request: Request,
    sig: Optional[str] = Query(None),
    exp: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    await _verify_action_signature(request_id, therapist_id, "apply", sig, exp, authorization)
    audit.emit(
        actor_type="therapist", actor_id=therapist_id, action="view_referral",
        resource="request", resource_id=request_id,
        ip=request.headers.get("x-forwarded-for", ""),
        user_agent=request.headers.get("user-agent", ""),
    )
    req = await db.requests.find_one(
        {"id": request_id}, {"_id": 0, "email": 0, "verification_token": 0}
    )
    therapist = await db.therapists.find_one({"id": therapist_id}, {"_id": 0})
    if not req or not therapist:
        raise HTTPException(404)
    score = (req.get("notified_scores") or {}).get(therapist_id)
    if score is None:
        raise HTTPException(403, "This therapist was not notified for this request")
    existing = await db.applications.find_one(
        {"request_id": request_id, "therapist_id": therapist_id}, {"_id": 0}
    )
    summary = _safe_summary_for_therapist({**req, "email": ""})
    breakdown = (req.get("notified_breakdowns") or {}).get(therapist_id) or {}
    from matching import gap_axes
    gaps = gap_axes(therapist, req, breakdown, top_n=3) if breakdown else []
    # Compute referral state (same logic as portal endpoint)
    decline = await db.declines.find_one(
        {"request_id": request_id, "therapist_id": therapist_id},
        {"_id": 0, "id": 1},
    )
    r_status = (req.get("status") or "").lower()
    matched_at_str = req.get("matched_at") or req.get("created_at") or ""
    if decline:
        ref_state = "past"
    elif existing:
        ref_state = "applied"
    elif r_status in ("delivered", "results_sent", "closed", "archived"):
        ref_state = "past"
    else:
        try:
            matched_dt = datetime.fromisoformat(matched_at_str)
            if matched_dt.tzinfo is None:
                matched_dt = matched_dt.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) - matched_dt > timedelta(hours=24):
                ref_state = "past"
            else:
                ref_state = "active"
        except (ValueError, TypeError):
            ref_state = "active"
    return {
        "request_id": request_id,
        "therapist": {"id": therapist["id"], "name": therapist["name"]},
        "match_score": score,
        "match_breakdown": breakdown,
        "deep_match_opt_in": bool(req.get("deep_match_opt_in")),
        "gaps": gaps,
        "state": ref_state,
        "matched_at": matched_at_str,
        "summary": summary,
        "presenting_issues": req.get("presenting_issues", ""),
        "already_applied": bool(existing),
        "existing_message": existing.get("message") if existing else None,
        "existing_confirmations": {
            "availability": bool((existing or {}).get("confirms_availability")),
            "urgency": bool((existing or {}).get("confirms_urgency")),
            "payment": bool((existing or {}).get("confirms_payment")),
        } if existing else None,
    }


@router.post("/therapist/apply/{request_id}/{therapist_id}", response_model=ApplicationOut)
async def therapist_apply(
    request_id: str,
    therapist_id: str,
    payload: TherapistApplyIn,
    request: Request,
    sig: Optional[str] = Query(None),
    exp: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    await _verify_action_signature(request_id, therapist_id, "apply", sig, exp, authorization)
    audit.emit(
        actor_type="therapist", actor_id=therapist_id, action="apply",
        resource="request", resource_id=request_id,
        ip=request.headers.get("x-forwarded-for", ""),
        user_agent=request.headers.get("user-agent", ""),
    )
    req = await db.requests.find_one({"id": request_id}, {"_id": 0})
    therapist = await db.therapists.find_one({"id": therapist_id}, {"_id": 0})
    if not req or not therapist:
        raise HTTPException(404)
    score = (req.get("notified_scores") or {}).get(therapist_id)
    if score is None:
        raise HTTPException(403, "Not notified for this request")

    # 2026-05-17 (Josh's audit miss) -- validate the apply message
    # body. This text gets seen by the patient + indexed for
    # apply-fit scoring + persisted to db.applications, so it must
    # not contain gibberish / profanity / link spam.
    if (payload.message or "").strip():
        from text_moderation import validate_or_raise as _validate_text
        _validate_text(
            payload.message,
            field_name="Apply message",
            max_length=1500,
            route=f"/api/therapist/apply/{request_id}/{therapist_id}",
            actor_email=therapist.get("email"),
        )

    existing = await db.applications.find_one(
        {"request_id": request_id, "therapist_id": therapist_id}, {"_id": 0}
    )
    now = _now_iso()
    # Auto-login token so the therapist lands in their portal after
    # applying instead of having to re-authenticate via magic-code.
    # Mirrors the patient pattern at routes/patients.py:508. Skipped
    # silently when the therapist record has no email (impossible in
    # practice but defensively guarded).
    therapist_email = (therapist.get("email") or "").strip()
    auto_token: Optional[str] = (
        _create_session_token(therapist_email, "therapist")
        if therapist_email else None
    )
    portal_url: Optional[str] = "/portal/therapist" if auto_token else None

    if existing:
        await db.applications.update_one(
            {"id": existing["id"]},
            {"$set": {
                "message": payload.message,
                "confirms_availability": payload.confirms_availability,
                "confirms_urgency": payload.confirms_urgency,
                "confirms_payment": payload.confirms_payment,
                "all_confirmed": all([
                    payload.confirms_availability,
                    payload.confirms_urgency,
                    payload.confirms_payment,
                ]),
                "updated_at": now,
            }},
        )
        return ApplicationOut(
            id=existing["id"],
            request_id=request_id,
            therapist_id=therapist_id,
            therapist_name=therapist["name"],
            match_score=score,
            message=payload.message,
            created_at=existing["created_at"],
            session_token=auto_token,
            portal_url=portal_url,
        )

    app_doc = {
        "id": str(uuid.uuid4()),
        "request_id": request_id,
        "therapist_id": therapist_id,
        "therapist_name": therapist["name"],
        "match_score": score,
        "message": payload.message,
        "confirms_availability": payload.confirms_availability,
        "confirms_urgency": payload.confirms_urgency,
        "confirms_payment": payload.confirms_payment,
        "all_confirmed": all([
            payload.confirms_availability,
            payload.confirms_urgency,
            payload.confirms_payment,
        ]),
        "created_at": now,
    }
    # Score apply-text fit when research enrichment is enabled. Best-effort
    # — failures don't block the apply. Adds 0-5 points + 1-sentence rationale.
    try:
        from research_enrichment import is_enabled as _re_enabled, score_apply_fit
        if await _re_enabled():
            fit = await score_apply_fit(payload.message or "", req, therapist)
            app_doc["apply_fit"] = fit.get("apply_fit") or 0
            app_doc["apply_fit_rationale"] = fit.get("rationale") or ""
    except Exception:
        pass
    await db.applications.insert_one(app_doc.copy())
    # Strip fields that aren't on ApplicationOut before unpacking.
    out_kwargs = {k: v for k, v in app_doc.items() if k in {
        "id", "request_id", "therapist_id", "therapist_name",
        "match_score", "message", "created_at",
    }}
    return ApplicationOut(
        **out_kwargs,
        session_token=auto_token,
        portal_url=portal_url,
    )


@router.post("/therapist/decline/{request_id}/{therapist_id}", response_model=dict)
async def therapist_decline_action(
    request_id: str,
    therapist_id: str,
    payload: TherapistDeclineIn,
    request: Request,
    sig: Optional[str] = Query(None),
    exp: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    await _verify_action_signature(request_id, therapist_id, "decline", sig, exp, authorization)
    audit.emit(
        actor_type="therapist", actor_id=therapist_id, action="decline",
        resource="request", resource_id=request_id,
        ip=request.headers.get("x-forwarded-for", ""),
        user_agent=request.headers.get("user-agent", ""),
    )
    # 2026-05-17 (Josh's audit miss) -- validate the decline notes
    # field. Admin reads these in the Outcomes tab to improve
    # matching; they shouldn't contain abusive language.
    if (payload.notes or "").strip():
        from text_moderation import validate_or_raise as _validate_text
        _validate_text(
            payload.notes,
            field_name="Decline notes",
            max_length=500,
            route=f"/api/therapist/decline/{request_id}/{therapist_id}",
        )
    req = await db.requests.find_one(
        {"id": request_id},
        {"_id": 0, "id": 1, "notified_scores": 1, "notified_breakdowns": 1,
         "client_age": 1, "location_state": 1, "session_expectations": 1,
         "insurance_type": 1, "presenting_issues": 1, "deep_match_opt_in": 1,
         "notified_therapist_ids": 1, "urgency": 1,
         "modality_preference": 1, "modality_preferences": 1},
    )
    therapist = await db.therapists.find_one(
        {"id": therapist_id}, {"_id": 0, "id": 1, "email": 1}
    )
    if not req or not therapist:
        raise HTTPException(404)
    score = (req.get("notified_scores") or {}).get(therapist_id) if req else None
    breakdown = (req.get("notified_breakdowns") or {}).get(therapist_id) or {}
    # WS5: count active referrals for this therapist at moment of decline
    active_referral_count = await db.requests.count_documents(
        {"notified_therapist_ids": therapist_id},
    )
    now = _now_iso()
    doc = {
        "id": str(uuid.uuid4()),
        "request_id": request_id,
        "therapist_id": therapist_id,
        "therapist_email": therapist.get("email", ""),
        "match_score": score,
        "match_breakdown": breakdown,
        "patient_input_summary": {
            "client_age": req.get("client_age"),
            "location_state": req.get("location_state"),
            "session_expectations": req.get("session_expectations"),
            "insurance_type": req.get("insurance_type"),
            "presenting_issues": req.get("presenting_issues"),
            "deep_match_opt_in": bool(req.get("deep_match_opt_in")),
            "urgency": req.get("urgency"),
            "modality_preference": req.get("modality_preference"),
            "modality_preferences": req.get("modality_preferences"),
        },
        "therapist_load_at_decline": active_referral_count,
        "reason_codes": payload.reason_codes,
        "notes": payload.notes,
        "created_at": now,
        "declined_at": now,
    }
    await db.declines.update_one(
        {"request_id": request_id, "therapist_id": therapist_id},
        {"$set": doc},
        upsert=True,
    )
    return {"id": doc["id"], "status": "declined"}


@router.get("/therapist/{therapist_id}/referrals")
async def therapist_referrals(
    therapist_id: str,
    request: Request,
    session: dict = Depends(require_session(("therapist",))),
):
    """Authenticated referral list — therapist must be logged in and can
    only view their own referrals."""
    audit.emit(
        actor_type="therapist", actor_id=therapist_id, action="list_referrals",
        resource="request", detail="limit=100",
        ip=request.headers.get("x-forwarded-for", ""),
        user_agent=request.headers.get("user-agent", ""),
    )
    t = await db.therapists.find_one(
        {"id": therapist_id}, {"_id": 0, "id": 1, "name": 1, "email": 1}
    )
    if not t:
        raise HTTPException(404)
    # Verify the logged-in therapist owns this ID
    if t["email"].lower() != session["email"].lower():
        raise HTTPException(403, "You can only view your own referrals")

    cur = db.requests.find(
        {"notified_therapist_ids": therapist_id},
        {"_id": 0, "verification_token": 0},
    ).sort("matched_at", -1).limit(100)
    requests_list = await cur.to_list(100)

    apps = {a["request_id"]: a async for a in db.applications.find(
        {"therapist_id": therapist_id}, {"_id": 0}
    )}
    declines = {d["request_id"]: d async for d in db.declines.find(
        {"therapist_id": therapist_id}, {"_id": 0}
    )}

    out = []
    for r in requests_list:
        rid = r["id"]
        score = (r.get("notified_scores") or {}).get(therapist_id) or 0
        breakdown = (r.get("notified_breakdowns") or {}).get(therapist_id) or {}
        if rid in apps:
            ref_status = "interested"
        elif rid in declines:
            ref_status = "declined"
        else:
            ref_status = "pending"
        # WS3: server-side tab state so the client just groups by it.
        # "active"  = pending referral on a live request
        # "applied" = therapist expressed interest
        # "past"    = declined OR request moved past active lifecycle OR 24h idle
        r_status = (r.get("status") or "").lower()
        if ref_status == "declined":
            state = "past"
        elif ref_status == "interested":
            state = "applied"
        elif r_status in ("delivered", "results_sent", "closed", "archived"):
            state = "past"
        else:
            matched_ts = r.get("matched_at") or r.get("created_at") or ""
            try:
                matched_dt = datetime.fromisoformat(matched_ts)
                if matched_dt.tzinfo is None:
                    matched_dt = matched_dt.replace(tzinfo=timezone.utc)
                if datetime.now(timezone.utc) - matched_dt > timedelta(hours=24):
                    state = "past"
                else:
                    state = "active"
            except (ValueError, TypeError):
                state = "active"
        out.append({
            "request_id": rid,
            "matched_at": r.get("matched_at"),
            "patient_email_anon": (r.get("email", "")[:3] + "***") if r.get("email") else "",
            "match_score": score,
            "match_breakdown": breakdown,
            "status": ref_status,
            "referral_status": ref_status,
            "state": state,
            "request_status": r_status,
            "deep_match_opt_in": bool(r.get("deep_match_opt_in")),
            "summary": _safe_summary_for_therapist({**r, "email": ""}),
        })
    return {"therapist": t, "referrals": out}



# ─── Self-serve license document upload ─────────────────────────────────────
# Therapist uploads a PDF / JPG / PNG of their license. We base64-store it
# inline on the therapist doc (capped at 5 MB) and flag the row as
# `pending_reapproval` so an admin reviews + re-publishes after upload.
MAX_LICENSE_BYTES = 5 * 1024 * 1024  # 5 MB
LICENSE_ALLOWED_TYPES = {
    "application/pdf", "image/jpeg", "image/jpg", "image/png", "image/webp",
}


@router.post("/therapists/me/license-document")
async def therapist_upload_license(
    payload: dict,
    session: dict = Depends(require_session(("therapist",))),
):
    """Therapist uploads a base64-encoded license document. Body:
        {filename, content_type, data_base64}
    """
    email = session.get("email")
    therapist = await db.therapists.find_one({"email": email}, {"_id": 0})
    if not therapist:
        raise HTTPException(404, "Therapist profile not found")

    filename = (payload or {}).get("filename") or ""
    content_type = (payload or {}).get("content_type") or ""
    data_b64 = (payload or {}).get("data_base64") or ""
    if not filename or not data_b64:
        raise HTTPException(400, "filename and data_base64 are required")
    if content_type not in LICENSE_ALLOWED_TYPES:
        raise HTTPException(
            400,
            "Unsupported file type. Allowed: PDF, JPG, PNG, WEBP.",
        )
    try:
        if "," in data_b64:
            data_b64 = data_b64.split(",", 1)[1]
        raw = base64.b64decode(data_b64, validate=True)
    except Exception:
        raise HTTPException(400, "Invalid base64 payload")
    if len(raw) > MAX_LICENSE_BYTES:
        raise HTTPException(
            400,
            f"File too large ({len(raw) // 1024} KB). Max 5 MB.",
        )

    now = _now_iso()
    await db.therapists.update_one(
        {"id": therapist["id"]},
        {"$set": {
            "license_document": {
                "filename": filename[:200],
                "content_type": content_type,
                "size_bytes": len(raw),
                "data_base64": data_b64,
                "uploaded_at": now,
            },
            "pending_reapproval": True,
            "updated_at": now,
        }},
    )
    return {
        "ok": True,
        "filename": filename,
        "size_bytes": len(raw),
        "uploaded_at": now,
        "pending_reapproval": True,
    }


@router.get("/therapists/me/license-document")
async def therapist_get_my_license_doc(
    session: dict = Depends(require_session(("therapist",))),
):
    email = session.get("email")
    t = await db.therapists.find_one(
        {"email": email},
        {"_id": 0, "license_document": 1, "license_picture": 1, "_backfill_audit": 1},
    )
    if not t:
        raise HTTPException(404, "Therapist not found")
    doc = t.get("license_document") or {}
    if doc and doc.get("data_base64"):
        # Backfill writes a license_document with is_backfill_placeholder=True
        # so the widget can flag it as synthetic instead of treating it like
        # a real upload. Real therapist uploads never set that flag.
        is_backfill_doc = bool(doc.get("is_backfill_placeholder"))
        return {
            "present": True,
            "filename": doc.get("filename"),
            "content_type": doc.get("content_type"),
            "size_bytes": doc.get("size_bytes"),
            "uploaded_at": doc.get("uploaded_at"),
            "source": "backfill_placeholder" if is_backfill_doc else "uploaded",
        }
    # Legacy fallback: backfilled (and pre-2026 signup) therapists
    # store the license image on `license_picture` as a `data:` URL,
    # not in the newer `license_document` blob. Treat that as a
    # present-but-legacy record so the widget shows "on file" instead
    # of the alarming "No license document on file yet" -- matches
    # what _has_license_document in profile_completeness already
    # accepts as proof for the publishable check.
    lp = t.get("license_picture") or ""
    if isinstance(lp, str) and lp.startswith("data:"):
        # Best-effort metadata extraction from the data URL header.
        ctype = "image/png"
        try:
            ctype = lp.split(";", 1)[0].split(":", 1)[1]
        except Exception:
            pass
        # Approximate size from base64 length (4 chars -> 3 bytes).
        b64_len = len(lp.split(",", 1)[-1]) if "," in lp else 0
        size_bytes = int(b64_len * 3 / 4)
        is_backfill = bool(
            (t.get("_backfill_audit") or {}).get("fields_added")
            and "license_picture" in (t["_backfill_audit"]["fields_added"])
        )
        return {
            "present": True,
            "filename": "License (legacy upload)" if not is_backfill else "License (backfill placeholder)",
            "content_type": ctype,
            "size_bytes": size_bytes,
            "uploaded_at": None,
            "source": "backfill_placeholder" if is_backfill else "legacy_field",
        }
    return {"present": False}
