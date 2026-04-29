"""Pydantic models for TheraVoca API."""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, EmailStr, Field


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
    client_types: list[str] = Field(default_factory=lambda: ["individual"])
    age_groups: list[str] = Field(default_factory=list, max_length=3)
    primary_specialties: list[str] = Field(default_factory=list, max_length=2)
    secondary_specialties: list[str] = Field(default_factory=list, max_length=3)
    general_treats: list[str] = Field(default_factory=list, max_length=5)
    modalities: list[str] = Field(default_factory=list, max_length=6)
    modality_offering: str = "both"
    office_locations: list[str] = Field(default_factory=list)
    insurance_accepted: list[str] = Field(default_factory=list)
    cash_rate: int = Field(ge=0, le=1000, default=150)
    sliding_scale: bool = False
    years_experience: int = Field(ge=0, le=70, default=1)
    availability_windows: list[str] = Field(default_factory=list)
    urgency_capacity: str = "within_month"
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
    budget: Optional[int] = None
    sliding_scale_ok: bool = False
    presenting_issues: list[str] = Field(default_factory=list, max_length=3)
    other_issue: Optional[str] = ""
    availability_windows: list[str] = Field(default_factory=list)
    modality_preference: str = "hybrid"
    modality_preferences: list[str] = Field(default_factory=list)
    urgency: str = "flexible"
    prior_therapy: str = "not_sure"
    prior_therapy_notes: Optional[str] = ""
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
