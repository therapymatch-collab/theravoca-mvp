"""Pydantic models for TheraVoca API."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, EmailStr, Field


# ── Constrained literals — caught by Pydantic at signup/edit time ──
# These mirror the matching axis predicates in `matching.py` and the
# patient-side option lists. Adding a new bucket?  Update the literal
# AND the predicate; otherwise the matcher will silently fail to find
# the therapist when patients pick the new bucket.
UrgencyCapacity = Literal["asap", "within_2_3_weeks", "within_month"]
ModalityOffering = Literal["telehealth", "in_person", "both"]
ClientType = Literal["individual", "couples", "family", "group"]
AgeGroup = Literal["child", "teen", "young_adult", "adult", "older_adult"]


class Specialty(BaseModel):
    name: str
    weight: int = 20


class TherapistOut(BaseModel):
    id: str
    name: str
    email: str
    phone: Optional[str] = None
    licensed_states: list[str]
    office_locations: list[str]
    telehealth: bool
    specialties: list[Specialty]
    modalities: list[str]
    ages_served: list[str]
    insurance_accepted: list[str]
    cash_rate: int
    years_experience: int
    free_consult: bool
    bio: Optional[str] = None


class TherapistSignup(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    phone: Optional[str] = ""  # legacy alias for phone_alert
    phone_alert: Optional[str] = ""  # private — SMS alerts
    office_phone: Optional[str] = ""  # public — visible to patients
    gender: Optional[str] = ""
    licensed_states: list[str] = Field(default_factory=lambda: ["ID"])
    license_number: Optional[str] = ""
    license_expires_at: Optional[str] = None  # ISO date
    license_picture: Optional[str] = None  # base64 data URL
    website: Optional[str] = ""  # public — patients can click through
    office_addresses: list[str] = Field(default_factory=list)  # full street addresses
    client_types: list[ClientType] = Field(default_factory=lambda: ["individual"])
    age_groups: list[AgeGroup] = Field(default_factory=list, max_length=3)
    primary_specialties: list[str] = Field(default_factory=list, max_length=2)
    secondary_specialties: list[str] = Field(default_factory=list, max_length=3)
    general_treats: list[str] = Field(default_factory=list, max_length=5)
    modalities: list[str] = Field(default_factory=list, max_length=5)
    modality_offering: ModalityOffering = "both"
    office_locations: list[str] = Field(default_factory=list)
    insurance_accepted: list[str] = Field(default_factory=list)
    # Languages the therapist can conduct sessions in BEYOND English
    # (English is implicit). Patient matching uses this as a soft axis
    # (small bonus when patient's preferred_language is in this list)
    # OR a hard filter when the patient flips `language_strict=True`.
    languages_spoken: list[str] = Field(default_factory=list)
    cash_rate: int = Field(ge=0, le=1000, default=150)
    sliding_scale: bool = False
    years_experience: int = Field(ge=0, le=70, default=1)
    availability_windows: list[str] = Field(default_factory=list)
    urgency_capacity: UrgencyCapacity = "within_month"
    style_tags: list[str] = Field(default_factory=list)
    free_consult: bool = False
    bio: Optional[str] = ""
    profile_picture: Optional[str] = None
    credential_type: Optional[str] = ""
    referral_code: Optional[str] = None  # auto-issued on signup, used for "refer a colleague"
    referred_by_code: Optional[str] = None  # captured from invite link
    recruit_code: Optional[str] = None  # captured from gap-recruit invite link
    notify_email: bool = True
    notify_sms: bool = True
    # ─── Deep-match therapist signal fields (T1–T5 — Iter-89) ────────
    # All five are required at signup so the matching engine has a
    # complete picture of clinical style. Existing therapists who
    # signed up before this iteration are prompted to fill them on
    # next portal login (back-fill banner), and the matching engine
    # falls back to neutral 0 scores until they do.
    #
    # T1 — "When a client is stuck, what do you instinctively do
    # first?" Therapists rank ALL 5 in order from most to least
    # likely. The list of slugs is the same set as P1
    # ({truth, questions, tools, listen, patterns}); position in
    # the list = rank. Empty list ⇒ not yet answered.
    t1_stuck_ranked: list[str] = Field(default_factory=list, max_length=5)
    # T2 — "Describe a client who made real progress with you." Open
    # text. Used for embedding-based Contextual Resonance scoring as a
    # weaker secondary signal next to T5.
    t2_progress_story: Optional[str] = Field(default="", max_length=2000)
    # T3 — "What does a breakthrough moment look like in your work?"
    # Pick 2 of 5; same option set as P2
    # ({self_understanding, daily_life, feelings, relationships,
    #   self_regulation}).
    t3_breakthrough: list[str] = Field(default_factory=list, max_length=2)
    # T4 — "When you need to tell a client something they won't want
    # to hear, how do you get there?" Pick 1 of 5 slugs:
    # {direct, gradual, questions, emotion, almost_there}.
    t4_hard_truth: Optional[str] = ""
    # T5 — "What life experiences or communities do you understand
    # from the inside, not from a textbook?" Open text. Primary signal
    # for Contextual Resonance scoring.
    t5_lived_experience: Optional[str] = Field(default="", max_length=2000)
    # Cloudflare Turnstile token (optional). Backend fail-softs when not
    # configured; verified at the route layer.
    turnstile_token: Optional[str] = Field(default=None, max_length=2200)


class RequestCreate(BaseModel):
    email: EmailStr
    location_state: str
    location_city: Optional[str] = ""
    location_zip: Optional[str] = ""
    client_type: str
    age_group: str
    client_age: Optional[int] = None
    payment_type: str = "either"
    insurance_name: Optional[str] = ""
    # Hard-requirement toggle: when True, only therapists who explicitly
    # accept this insurance pass the filter. Default soft (insurance is
    # ranked but not filtered) so out-of-network providers can still
    # appear when they're a strong fit.
    insurance_strict: bool = False
    budget: Optional[int] = None
    sliding_scale_ok: bool = False
    presenting_issues: list[str] = Field(default_factory=list, max_length=3)
    other_issue: Optional[str] = ""
    availability_windows: list[str] = Field(default_factory=list)
    # Hard-requirement toggle for availability windows.
    availability_strict: bool = False
    modality_preference: str = "hybrid"
    modality_preferences: list[str] = Field(default_factory=list)
    urgency: str = "flexible"
    # Hard-requirement toggle for urgency: when True, only therapists
    # whose `urgency_capacity` can meet the patient's timeframe pass.
    urgency_strict: bool = False
    prior_therapy: str = "not_sure"
    prior_therapy_notes: Optional[str] = ""
    # Preferred therapy language. Defaults to English (no filter / no bonus).
    # When set to a non-English value, the matcher gives a soft bonus to
    # therapists with that language in `languages_spoken`. When the
    # patient also flips `language_strict=True`, it becomes a hard filter.
    preferred_language: str = "English"
    language_strict: bool = False
    # Patients can pick multiple experience preferences (e.g. ["seasoned",
    # "mid_career"]); legacy clients sending a single string still work via
    # the field validator below.
    experience_preference: list[str] | str = Field(default_factory=list)
    gender_preference: str = "no_pref"
    gender_required: bool = False
    style_preference: list[str] = Field(default_factory=list)
    referral_source: Optional[str] = ""
    # Patient-to-patient refer-a-friend: the inviter's `patient_referral_code`,
    # captured from `?ref=` on the intake form. Plain attribution — no incentive.
    referred_by_patient_code: Optional[str] = None
    phone: Optional[str] = ""  # patient phone — only used for SMS receipt
    sms_opt_in: bool = False  # patient explicitly opted into SMS receipt
    # Patient-customizable matching: list of axes the patient cares about
    # most ("specialty", "modality", "schedule", "payment", "identity").
    # Each selected axis triggers a weight multiplier in matching.py so the
    # ranked results lean toward what the patient told us matters.
    priority_factors: list[str] = Field(default_factory=list, max_length=5)
    # If True, hard-filter therapists who score 0 on any priority axis.
    strict_priorities: bool = False
    # ─── Deep match opt-in (P1/P2/P3 — Iter-88) ──────────────────────
    # Patients can optionally answer 3 nuance questions that map onto
    # the therapist T1/T3/T5+T2 questions. When `deep_match_opt_in` is
    # True, P1+P2+P3 are stored on the request doc and the matching
    # engine is allowed to add the "Communication Style" + "Theory of
    # Change" + "Contextual Resonance" axes. False/None means standard
    # matching with the existing axes only.
    deep_match_opt_in: Optional[bool] = None
    # P1 — "When your therapist is really helping, what are they
    # doing?" Pick exactly 2 from the slug set
    # {truth, questions, tools, listen, patterns}.
    p1_communication: list[str] = Field(default_factory=list, max_length=2)
    # P2 — "What would make you feel like therapy is actually working?"
    # Pick exactly 2 from {self_understanding, daily_life, feelings,
    # relationships, self_regulation}.
    p2_change: list[str] = Field(default_factory=list, max_length=2)
    # P3 — "What should your therapist already get about you without
    # you having to explain it?" Open text, optional.
    p3_resonance: Optional[str] = Field(default="", max_length=2000)
    # If True, send the patient an email receipt with a read-only copy
    # of their answers right after submit. They can't self-edit, so the
    # receipt doubles as their paper trail for any post-submit
    # corrections (forward + email support).
    email_receipt: bool = False
    # ─── Bot defenses (rejected at the route layer; never persisted) ───
    # Honeypot input — a hidden field bots auto-fill. Real users leave it
    # blank because they never see it.
    fax_number: Optional[str] = Field(default="", max_length=200)
    # Client timestamp (ms since epoch) when the form was first rendered.
    # If the gap from this to submit is < ~2s, it's almost certainly a bot.
    form_started_at_ms: Optional[int] = None
    # Cloudflare Turnstile token. Optional in the schema so dev/preview
    # environments without Turnstile configured still work; verified
    # at the route layer using `turnstile_service.verify_token()`.
    turnstile_token: Optional[str] = Field(default=None, max_length=2200)


class RequestOut(BaseModel):
    id: str
    email: str
    client_age: int
    location_state: str
    location_city: Optional[str] = ""
    location_zip: Optional[str] = ""
    session_format: str
    payment_type: str
    insurance_name: Optional[str] = ""
    budget: Optional[int] = None
    presenting_issues: str
    preferred_gender: Optional[str] = ""
    preferred_modality: Optional[str] = ""
    other_notes: Optional[str] = ""
    referral_source: Optional[str] = ""
    verified: bool
    status: str
    threshold: float
    notified_count: int = 0
    created_at: str
    results_sent_at: Optional[str] = None


class TherapistApplyIn(BaseModel):
    message: str = Field(default="", max_length=1500)
    # Commitment confirmations — therapists must affirm to opt-in
    confirms_availability: bool = False
    confirms_urgency: bool = False
    confirms_payment: bool = False


class BulkApplyIn(BaseModel):
    """Bulk-confirm interest across many referrals at once."""
    request_ids: list[str] = Field(default_factory=list, max_length=50)
    message: str = Field(default="", max_length=1500)
    confirms_availability: bool = False
    confirms_urgency: bool = False
    confirms_payment: bool = False


class TherapistDeclineIn(BaseModel):
    reason_codes: list[str] = Field(default_factory=list, max_length=6)
    notes: str = Field(default="", max_length=500)


class ApplicationOut(BaseModel):
    id: str
    request_id: str
    therapist_id: str
    therapist_name: str
    match_score: float
    message: str
    created_at: str


class FollowupResponse(BaseModel):
    """Patient follow-up survey response — captures success at 48h/2wk/6wk."""
    contacted_therapist: Optional[bool] = None
    therapist_id: Optional[str] = None
    sessions_completed: Optional[int] = None
    helpful_score: Optional[int] = None  # 1–10 NPS-style
    would_recommend: Optional[bool] = None
    barriers: list[str] = Field(default_factory=list)
    notes: str = Field(default="", max_length=1500)


class MagicCodeRequest(BaseModel):
    email: EmailStr
    role: str  # patient | therapist


class MagicCodeVerify(BaseModel):
    email: EmailStr
    role: str
    code: str
