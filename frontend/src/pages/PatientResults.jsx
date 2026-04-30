import { useEffect, useState } from "react";
import { Link, useParams, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, Phone, Mail, Star, Sparkles, CalendarPlus, Send, Inbox, CheckCircle2, Clock, ArrowRight, ArrowLeft, Share2, FileText, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";
import { Header, Footer } from "@/components/SiteShell";
import useSiteCopy from "@/lib/useSiteCopy";
import credentialLabel from "@/lib/credentialLabel";
import EmailButton from "@/components/EmailButton";
import { api, getSession } from "@/lib/api";
import { RESULTS_POLL_INTERVAL_MS } from "@/lib/constants";
import {
  P1_OPTIONS,
  P2_OPTIONS,
} from "@/components/intake/deepMatchOptions";

// Friendly labels for each scoring axis. Each entry maps axis -> { max, label }.
// We surface the top 3 axes (where score > 50% of max) on the patient result card.
// ── Keep this set in sync with `matching._score_one`'s emitted breakdown
// keys. Missing entries are silently skipped by `topReasons`, so adding a
// new axis to the engine without updating this table = invisible signal.
const AXIS_META = {
  issues: { max: 35, label: "Specializes in your concerns" },
  availability: { max: 20, label: "Matches your schedule" },
  modality: { max: 15, label: "Offers your preferred format" },
  urgency: { max: 10, label: "Can take you on quickly" },
  prior_therapy: { max: 10, label: "Right fit for your therapy history" },
  experience: { max: 5, label: "Matches your experience preference" },
  reviews: { max: 5, label: "Highly rated online" },
  gender: { max: 3, label: "Matches your gender preference" },
  style: { max: 2, label: "Aligns with your style preference" },
  payment_fit: { max: 3, label: "Open to your budget on a sliding scale" },
  payment_alignment: { max: 10, label: "Accepts your payment method" },
  modality_pref: { max: 4, label: "Practices your preferred therapy approach" },
  // Recently-added axes (kept in sync with `matching._score_one`).
  language: { max: 4, label: "Speaks your preferred language" },
  differentiator: { max: 5, label: "Offers something you specifically asked for" },
  research_bonus: { max: 25, label: "Strong evidence in their public practice" },
  deep_match: { max: 15, label: "Resonates with how you described yourself" },
  other_issue_bonus: { max: 6, label: "Resonates with your written context" },
};

// Slug -> friendly label. Mirrors IntakeForm/TherapistSignup ISSUES list.
const ISSUE_LABELS = {
  anxiety: "anxiety",
  depression: "depression",
  ocd: "OCD",
  adhd: "ADHD",
  trauma_ptsd: "trauma / PTSD",
  relationship_issues: "relationship issues",
  life_transitions: "life transitions",
  parenting_family: "parenting / family conflict",
  substance_use: "substance use",
  eating_concerns: "eating concerns",
  autism_neurodivergence: "autism / neurodivergence",
  school_academic_stress: "school / academic stress",
};

function topReasons(breakdown) {
  if (!breakdown) return [];
  const entries = Object.entries(breakdown)
    .map(([k, v]) => {
      const meta = AXIS_META[k];
      if (!meta || !v || v <= 0) return null;
      const pct = meta.max > 0 ? v / meta.max : 0;
      return { key: k, score: v, max: meta.max, pct, label: meta.label };
    })
    .filter(Boolean)
    // Always surface the top 3 axes by raw score (no % threshold);
    // higher-weighted axes (issues=35) outrank lighter ones on ties.
    .sort((a, b) => b.score - a.score || b.pct - a.pct);
  return entries.slice(0, 3);
}

// Concrete "Why I matched" chip text generators. Each one takes the
// therapist + request and returns a short, specific string the patient
// can read at a glance — e.g. "Treats anxiety", "Telehealth fit",
// "$150/session", instead of the generic axis label "Specializes in
// your concerns". Falls back to the axis label if we can't produce
// a concrete reason.
const WHY_GENERATORS = {
  issues: (t, r) => {
    const want = (r?.presenting_issues || [])[0];
    if (!want) return null;
    const primary = (t.primary_specialties || []).map((s) => s.toLowerCase());
    const secondary = (t.secondary_specialties || []).map((s) => s.toLowerCase());
    const friendly = ISSUE_LABELS[want] || want.replace(/_/g, " ");
    if (primary.includes(want)) return `${cap(friendly)} specialist`;
    if (secondary.includes(want)) return `Treats ${friendly}`;
    return `Treats ${friendly}`;
  },
  modality: (t, r) => {
    const pref = (r?.modality_preference || "").toLowerCase();
    const off = (t.modality_offering || "").toLowerCase();
    if (pref === "telehealth_only" || pref === "prefer_telehealth") return "Telehealth fit";
    if (pref === "in_person_only" || pref === "prefer_inperson") return "In-person fit";
    if (off === "both") return "Telehealth & in-person";
    if (off === "telehealth") return "Telehealth";
    if (off === "in_person") return "In-person";
    return null;
  },
  availability: (t, r) => {
    const want = new Set(r?.availability_windows || []);
    if (want.has("flexible")) return "Flexible schedule";
    const offer = (t.availability_windows || []).filter((w) => want.has(w));
    if (offer.length === 0) return null;
    const w = offer[0];
    const map = {
      weekday_morning: "Weekday mornings",
      weekday_afternoon: "Weekday afternoons",
      weekday_evening: "Weekday evenings",
      weekend_morning: "Weekend mornings",
      weekend_afternoon: "Weekend afternoons",
    };
    return map[w] || w.replace(/_/g, " ");
  },
  urgency: (t, r) => {
    const u = (r?.urgency || "").toLowerCase();
    if (u === "asap") return "Available ASAP";
    if (u === "within_2_3_weeks") return "Open in 2-3 weeks";
    return "Open scheduling";
  },
  payment_fit: (t) => (t.sliding_scale ? "Sliding-scale OK" : null),
  modality_pref: (t, r) => {
    const want = (r?.modality_preferences || []).map((m) => m.toLowerCase());
    const offer = (t.modalities || []).map((m) => m.toLowerCase());
    const overlap = want.find((m) => offer.includes(m));
    if (!overlap) return null;
    return `Trained in ${overlap.toUpperCase()}`;
  },
  experience: (t) => {
    const yrs = parseInt(t.years_experience, 10);
    if (!yrs || isNaN(yrs)) return null;
    return `${yrs}+ yrs experience`;
  },
  reviews: (t) => {
    const avg = parseFloat(t.review_avg);
    const cnt = parseInt(t.review_count, 10);
    if (!avg || avg < 4.0 || !cnt || cnt < 3) return null;
    return `${avg.toFixed(1)}★ verified`;
  },
  gender: (t, r) => {
    const want = (r?.gender_preference || "").toLowerCase();
    if (!want || want === "no_pref") return null;
    return `${cap(want)} therapist`;
  },
  style: (t, r) => {
    const want = (r?.style_preference || []).map((s) => s.toLowerCase());
    const offer = (t.style_tags || []).map((s) => s.toLowerCase());
    const overlap = want.find((s) => offer.includes(s));
    if (!overlap) return null;
    return cap(overlap.replace(/_/g, " "));
  },
  prior_therapy: () => null,
};

function cap(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Returns up to 3 concrete chip strings explaining why this therapist
// scored high. Falls back to axis labels for axes without a generator.
function whyMatchedChips(breakdown, therapist, request) {
  const reasons = topReasons(breakdown);
  const seen = new Set();
  const out = [];
  for (const r of reasons) {
    const gen = WHY_GENERATORS[r.key];
    let text = null;
    try {
      text = gen ? gen(therapist || {}, request || {}) : null;
    } catch (_) {
      text = null;
    }
    if (!text) text = r.label;
    if (seen.has(text)) continue;
    seen.add(text);
    out.push({ key: r.key, text });
  }
  return out;
}

function buildConsultParts(therapist, request) {
  const firstName = (therapist?.name || "").split(",")[0].split(" ")[0] || "there";
  const issues = (request?.presenting_issues || [])
    .slice(0, 2)
    .map((s) => ISSUE_LABELS[s] || s.replace(/_/g, " "))
    .join(" and ");
  const issuesLine = issues
    ? `What I'd like to focus on: ${issues}.`
    : "I'd love to share more about what I'd like to work on.";
  const subject = "Free 15-min consult — TheraVoca match";
  const body = [
    `Hi ${firstName},`,
    "",
    "Thank you for reaching out through TheraVoca — I'd love to set up a free 15-minute consult to see if we're a good fit.",
    "",
    issuesLine,
    "",
    "Could you share 3 time slots that work for you this week or next?",
    "",
    "Looking forward to it,",
  ].join("\n");
  return { to: therapist?.email || "", subject, body };
}

// Build URLs for each supported send-from-here channel. We expose all
// of them via the EmailButton dropdown so a desktop user without a
// configured `mailto:` handler can still send the message.
function buildEmailUrls({ to, subject, body }) {
  // `mailto:` requires RFC-3986 percent-encoding (%20 for spaces), NOT
  // form-encoded `+` — iOS Mail rendered "Free+15-min+consult" literally.
  const enc = (s) => encodeURIComponent(s);
  return {
    mailto: `mailto:${to}?subject=${enc(subject)}&body=${enc(body)}`,
    gmail: `https://mail.google.com/mail/?view=cm&fs=1&to=${enc(to)}&su=${enc(subject)}&body=${enc(body)}`,
    outlook: `https://outlook.office.com/mail/deeplink/compose?to=${enc(to)}&subject=${enc(subject)}&body=${enc(body)}`,
    yahoo: `https://compose.mail.yahoo.com/?to=${enc(to)}&subject=${enc(subject)}&body=${enc(body)}`,
  };
}

// Heuristic: are we on a mobile device? Used to default the primary
// click action to `mailto:` (which always works on phones) vs. the
// dropdown menu (better default for desktop, where mailto: silently
// fails when no default mail client is set).
function isMobileDevice() {
  if (typeof navigator === "undefined") return false;
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
}

// Computes "where you may not align" gaps from a per-therapist match breakdown.
// Returns at most 4 short, patient-friendly bullets describing what wasn't
// fully covered. We only surface gaps where the score on a meaningful axis
// is < 50% of max — small (≥50%) gaps would just create noise.
function matchGaps(breakdown, request, therapist) {
  if (!breakdown || !request) return [];
  const out = [];
  const issuesAsked = request.presenting_issues || [];
  const therapistIssues = new Set([
    ...(therapist?.primary_specialties || []),
    ...(therapist?.secondary_specialties || []),
    ...(therapist?.general_treats || []),
  ]);

  // Issue coverage — explicit bullet listing any concern the therapist
  // doesn't mark as a specialty. This is the highest-signal gap.
  const uncovered = issuesAsked.filter((iss) => !therapistIssues.has(iss));
  if (uncovered.length > 0 && issuesAsked.length > 0) {
    const labels = uncovered
      .slice(0, 3)
      .map((s) => ISSUE_LABELS[s] || s.replace(/_/g, " "))
      .join(", ");
    out.push({
      key: "issues",
      label: `Doesn't list ${labels} as a specialty`,
    });
  }

  // Generic axis-based gaps (score < 50% of max on a meaningful axis).
  // NOTE: payment_fit is the SLIDING-SCALE bonus — its label is *not*
  // a payment-budget gap. Real payment gaps (insurance mismatch / cash
  // rate above budget) are computed explicitly below from request +
  // therapist fields rather than from the breakdown axis, because the
  // axis can't tell us whether the patient actually gave a budget.
  const axisGapLabels = {
    availability: "Schedule may be limited compared to what you need",
    modality: "Doesn't fully cover your preferred session format",
    urgency: "May not be able to start as quickly as you'd like",
    modality_pref: "Doesn't primarily practice your preferred therapy approach",
    gender: "Different gender than you preferred",
    style: "Different working style than you preferred",
  };
  Object.entries(breakdown).forEach(([k, v]) => {
    const meta = AXIS_META[k];
    if (!meta || !axisGapLabels[k]) return;
    const pct = meta.max > 0 ? v / meta.max : 1;
    if (pct < 0.5) out.push({ key: k, label: axisGapLabels[k] });
  });

  // Insurance gap — patient gave a specific carrier and the therapist
  // doesn't accept it. Reads `insurance_name` (current schema) with a
  // fallback to `insurance_plans` (legacy array) so old records still
  // surface the gap. Only fires when payment_type=insurance.
  const payType = (request.payment_type || "").toLowerCase();
  const insAsked = []
    .concat(request.insurance_name ? [request.insurance_name] : [])
    .concat(Array.isArray(request.insurance_plans) ? request.insurance_plans : [])
    .map((s) => String(s || "").trim())
    .filter(Boolean);
  const insAccepted = (therapist?.insurance_accepted || []).map((s) =>
    String(s).toLowerCase(),
  );
  if (payType === "insurance" && insAsked.length > 0) {
    const matchAny = insAsked.some((p) =>
      insAccepted.includes(String(p).toLowerCase()),
    );
    if (!matchAny) {
      if (insAccepted.length > 0) {
        out.push({
          key: "insurance",
          label: `Doesn't accept your insurance: ${insAsked
            .slice(0, 2)
            .join(", ")}`,
        });
      } else {
        out.push({
          key: "insurance",
          label: "Cash-only practice — no in-network insurance",
        });
      }
    }
  }

  // Cash-rate gap — only fires when the patient ACTUALLY gave a cash
  // budget AND the therapist's published rate exceeds 1.2× that budget.
  // Without an explicit budget there's no comfort threshold to compare
  // to, so we say nothing rather than make up a phantom gap.
  const cashBudget = Number(request.budget) || 0;
  const cashRate = Number(therapist?.cash_rate) || 0;
  if (cashBudget > 0 && cashRate > 0 && cashRate > cashBudget * 1.2) {
    out.push({
      key: "cash_rate",
      label: `Cash rate ($${cashRate}) is above your $${cashBudget} budget`,
    });
  }

  // De-dupe by key, cap at 4 items.
  const seen = new Set();
  return out
    .filter((g) => {
      if (seen.has(g.key)) return false;
      seen.add(g.key);
      return true;
    })
    .slice(0, 4);
}

// Compact summary panel of the patient's original referral so they can
// scan their inputs side-by-side with the matches below.
function YourReferralPanel({ request }) {
  const [open, setOpen] = useState(false);
  const issues = (request.presenting_issues || [])
    .map((s) => ISSUE_LABELS[s] || s.replace(/_/g, " "))
    .join(", ");
  // Insurance is rendered from `insurance_name` (the human-readable plan
  // the patient typed in). Older records sometimes carry an
  // `insurance_plans` array. We surface insurance whenever EITHER field
  // has data — the patient may have set `payment_type='either'` while
  // still picking an insurance plan as preferred, in which case a
  // strict `payment_type==='insurance'` check would silently hide it.
  const insurances = (() => {
    if (Array.isArray(request.insurance_plans) && request.insurance_plans.length) {
      return request.insurance_plans.join(", ");
    }
    if (request.insurance_name) return request.insurance_name;
    return "";
  })();
  // Modality / session-format display. The DB stores it under
  // `modality_preference` (telehealth_only / in_person_only / hybrid);
  // older records may use `session_format`.
  const sessionFormat = request.modality_preference || request.session_format;
  // Cash budget. Newer field name is `budget`; older records used
  // `budget_per_session`.
  const cashBudget = request.budget || request.budget_per_session;
  // ZIP — DB stores `location_zip`; older records may use `zip_code`.
  const zip = request.location_zip || request.zip_code;
  // Therapy history boolean. New field is `prior_therapy` ("yes"/"no"/
  // "not_sure"); older was a `previous_therapy` boolean.
  const therapyHistory = (() => {
    const pt = request.prior_therapy;
    if (typeof pt === "string") {
      if (pt === "yes") return "Has prior therapy";
      if (pt === "no") return "First-time";
      if (pt === "not_sure") return "Not sure";
    }
    if (request.previous_therapy === true) return "Has prior therapy";
    if (request.previous_therapy === false) return "First-time";
    return "—";
  })();
  // Age — DB stores `client_age` (number) but older flows captured an
  // `age_group` ("teen" / "adult" / "older_adult") instead. Render the
  // most specific signal we have.
  const ageDisplay = request.client_age
    || (request.age_group
      ? request.age_group.replace(/_/g, " ")
      : null);
  const summary = [
    ageDisplay && `Age ${ageDisplay}`,
    request.location_state,
    sessionFormat,
    issues && `concerns: ${issues}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <section
      className="mt-7 bg-white border border-[#E8E5DF] rounded-2xl p-5 sm:p-6"
      data-testid="your-referral-panel"
    >
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="w-full text-left flex items-start justify-between gap-4 group"
        data-testid="referral-toggle"
      >
        <div className="flex items-start gap-3 min-w-0">
          <FileText size={18} className="text-[#2D4A3E] mt-0.5 shrink-0" />
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-[#C87965] font-semibold">
              Your referral
            </div>
            <div className="font-serif-display text-lg text-[#2D4A3E] leading-tight mt-0.5">
              What you asked for
            </div>
            {!open && (
              <div className="text-xs text-[#6D6A65] mt-1.5 line-clamp-1">
                {summary}
              </div>
            )}
          </div>
        </div>
        <span className="text-xs text-[#6D6A65] hover:text-[#2D4A3E] inline-flex items-center gap-1 shrink-0">
          {open ? (
            <>
              Collapse <ChevronUp size={14} />
            </>
          ) : (
            <>
              Expand <ChevronDown size={14} />
            </>
          )}
        </span>
      </button>

      {open && (
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          {/* Hard-filter legend — matches the chip-styling used on
              individual rows below so the patient immediately
              understands what HARD means. */}
          <div
            className="sm:col-span-2 flex items-center gap-2 text-xs text-[#2B2A29] bg-[#FBE9E5] border border-[#F4C7BE] rounded-lg px-3 py-2 mb-1"
            data-testid="patient-request-hard-legend"
          >
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold text-[#C8412B] bg-white border border-[#F4C7BE] rounded-full px-2 py-0.5">
              HARD
            </span>
            <span className="leading-snug">
              Fields marked HARD are filters — therapists must match them
              exactly to appear in your matches.
            </span>
          </div>
          {(() => {
            // Compute which of the patient-toggleable hard filters are
            // active on THIS request. The 4 always-hard fields (state,
            // age group, concerns, format-when-in-person-only) are set
            // below with `hard` prop.
            const isInPersonHard = request.modality_preference === "in_person_only";
            const isGenderHard =
              !!request.gender_required &&
              request.gender_preference &&
              request.gender_preference !== "no_pref";
            const isLanguageHard =
              !!request.language_strict &&
              request.preferred_language &&
              request.preferred_language !== "English";
            return (
              <>
                <RefDetail label="Age" value={ageDisplay} hard />
                <RefDetail label="State" value={request.location_state} hard />
                <RefDetail label="ZIP" value={zip} />
                <RefDetail
                  label="Format"
                  value={sessionFormat}
                  hard={isInPersonHard}
                />
                <RefDetail
                  label="Insurance"
                  value={insurances || "—"}
                  hard={!!request.insurance_strict}
                />
                <RefDetail
                  label="Cash-budget / session"
                  value={cashBudget ? `$${cashBudget}` : "—"}
                />
                <RefDetail label="Therapy history" value={therapyHistory} />
                <RefDetail
                  label="Urgency"
                  value={request.urgency}
                  hard={!!request.urgency_strict}
                />
                <RefDetail
                  label="Preferred gender"
                  value={request.gender_preference || "Any"}
                  hard={isGenderHard}
                />
                <RefDetail
                  label="Preferred language"
                  value={request.preferred_language || "English"}
                  hard={isLanguageHard}
                />
                <RefDetail
                  label="Availability"
                  value={
                    (request.availability_windows || [])
                      .map((w) => w.replace(/_/g, " "))
                      .join(", ") || "—"
                  }
                  hard={!!request.availability_strict}
                  span={2}
                />
                <RefDetail label="Concerns" value={issues || "—"} hard span={2} />
              </>
            );
          })()}
          {(request.preferred_modalities || request.modality_preferences || []).length > 0 && (
            <RefDetail
              label="Preferred therapy approaches"
              value={(request.preferred_modalities || request.modality_preferences || []).join(", ")}
              span={2}
            />
          )}
          {request.notes && (
            <RefDetail label="Notes you shared" value={request.notes} span={2} />
          )}
          {/* Deep-match answers (P1/P2/P3) — only shown when the
              patient opted into the deeper intake. Visually separated
              (full-width spanning row with a dusty-rose background) so
              the patient can see the extra signals their match is
              scored on. Slugs are mapped back to human-readable
              labels via the same option arrays used by the form. */}
          {request.deep_match_opt_in && (
            <div
              className="sm:col-span-2 mt-2 rounded-2xl bg-[#FBF5F2] border border-[#EBD5CB] p-4 sm:p-5"
              data-testid="patient-request-deep-section"
            >
              <p className="text-[10px] uppercase tracking-[0.2em] text-[#A8553F] font-semibold">
                ✦ Deep-match · 3 extra answers
              </p>
              <p className="text-xs text-[#2B2A29]/80 mt-1 mb-4 leading-relaxed">
                These boost your matching on Relationship Style, Way of
                Working, and Contextual Resonance.
              </p>
              <div className="space-y-3.5">
                <div data-testid="patient-request-row-p1">
                  <div className="text-[10px] uppercase tracking-wider text-[#8B3220]">
                    Relationship style (P1)
                  </div>
                  <div className="text-[#2B2A29] mt-1 leading-snug">
                    {(request.p1_communication || []).length
                      ? (request.p1_communication || [])
                          .map(
                            (v) =>
                              P1_OPTIONS.find((o) => o.v === v)?.l || v,
                          )
                          .join(" · ")
                      : "—"}
                  </div>
                </div>
                <div data-testid="patient-request-row-p2">
                  <div className="text-[10px] uppercase tracking-wider text-[#8B3220]">
                    Way of working (P2)
                  </div>
                  <div className="text-[#2B2A29] mt-1 leading-snug">
                    {(request.p2_change || []).length
                      ? (request.p2_change || [])
                          .map(
                            (v) =>
                              P2_OPTIONS.find((o) => o.v === v)?.l || v,
                          )
                          .join(" · ")
                      : "—"}
                  </div>
                </div>
                <div data-testid="patient-request-row-p3">
                  <div className="text-[10px] uppercase tracking-wider text-[#8B3220]">
                    What they should already get (P3)
                  </div>
                  <div className="text-[#2B2A29] mt-1 leading-relaxed whitespace-pre-wrap">
                    {(request.p3_resonance || "").trim() || (
                      <span className="text-[#6D6A65] italic">
                        Skipped — that's okay.
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function RefDetail({ label, value, span = 1, hard = false }) {
  const wrap = [
    span === 2 ? "sm:col-span-2" : "",
    hard ? "rounded-lg bg-[#FBE9E5] border border-[#F4C7BE] px-3 py-2 -mx-1" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      className={wrap}
      data-testid={`patient-request-row-${label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")}`}
    >
      <div className="text-[10px] uppercase tracking-wider text-[#6D6A65] flex items-center gap-1.5">
        {label}
        {hard && (
          <span
            className="inline-flex text-[9px] font-semibold tracking-wider text-[#C8412B] bg-white border border-[#F4C7BE] rounded-full px-1.5 py-[1px]"
            title="This is a hard filter — therapists must match exactly"
          >
            HARD
          </span>
        )}
      </div>
      <div className="text-[#2B2A29] font-medium leading-snug break-words mt-1">
        {value || "—"}
      </div>
    </div>
  );
}



export default function PatientResults() {
  const { requestId } = useParams();
  const [data, setData] = useState(null);
  // `loadError` captures non-401 failures (mainly 404 for expired/invalid
  // result links, plus 5xx). Without this, a missing request id used to
  // leave the page stuck on the spinner forever — the user saw a blank
  // page with just the Feedback widget. Now we render a friendly
  // "this link is no longer valid" panel instead.
  const [loadError, setLoadError] = useState(null);
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const viewToken = sp.get("t") || "";
  const session = getSession();
  // Site-copy resolver. Used to render `results.heading` /
  // `results.subhead` overrides from the admin editor.
  const copy = useSiteCopy();
  // Cached at mount — `isMobileDevice()` only reads navigator.userAgent
  // so result is stable for this render cycle.
  const mobileDevice = isMobileDevice();

  useEffect(() => {
    let active = true;
    const headers = session?.token
      ? { Authorization: `Bearer ${session.token}` }
      : undefined;
    const url = viewToken
      ? `/requests/${requestId}/results?t=${encodeURIComponent(viewToken)}`
      : `/requests/${requestId}/results`;
    const load = () =>
      api.get(url, { headers }).then((res) => {
        if (active) {
          setData(res.data);
          setLoadError(null);
        }
      }).catch((err) => {
        if (!active) return;
        if (err?.response?.status === 401) {
          // Magic-code login required (no token + no/expired session).
          // Patient signs in with the email that owns this request, then
          // returns here.
          navigate(
            `/sign-in?role=patient&next=${encodeURIComponent(
              `/results/${requestId}`,
            )}`,
            { replace: true },
          );
          return;
        }
        // Persist the error so we can render a useful message rather
        // than spinning forever. Capture status + a friendly fallback.
        const status = err?.response?.status || 0;
        setLoadError({
          status,
          message:
            err?.response?.data?.detail ||
            (status === 404
              ? "This results link is no longer valid."
              : "We couldn't load your matches. Please refresh."),
        });
      });
    load();
    const intervalId = setInterval(load, RESULTS_POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [requestId, viewToken, session?.token, navigate]);

  if (loadError && !data) {
    return (
      <div
        className="min-h-screen bg-[#FDFBF7] flex items-center justify-center px-6"
        data-testid="results-load-error"
      >
        <div className="max-w-md text-center space-y-4">
          <h1 className="font-serif-display text-3xl text-[#2D4A3E]">
            {loadError.status === 404
              ? "This link expired"
              : "We hit a snag"}
          </h1>
          <p className="text-sm text-[#6D6A65] leading-relaxed">
            {loadError.status === 404 ? (
              <>
                If you submitted a request, your most recent results email
                will have an updated link.
              </>
            ) : (
              loadError.message
            )}
          </p>
          <div className="flex flex-wrap gap-3 justify-center pt-2">
            <a
              href="/"
              className="px-4 py-2 rounded-full bg-[#2D4A3E] text-white text-sm font-medium hover:bg-[#1F3A30] transition"
              data-testid="results-error-home-btn"
            >
              Back to home
            </a>
            <a
              href="/sign-in?role=patient"
              className="px-4 py-2 rounded-full border border-[#2D4A3E] text-[#2D4A3E] text-sm font-medium hover:bg-[#F0EBE0] transition"
              data-testid="results-error-signin-btn"
            >
              Sign in
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div
        className="min-h-screen bg-[#FDFBF7] flex flex-col items-center justify-center gap-3"
        data-testid="results-loading"
      >
        <Loader2 className="animate-spin text-[#2D4A3E]" />
        <p className="text-sm text-[#6D6A65]">Loading your matches…</p>
      </div>
    );
  }

  const { request, applications, hold_active, hold_ends_at, applications_pending_count } = data;
  const holdEndsLabel = hold_ends_at
    ? new Date(hold_ends_at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })
    : "soon";

  // Stage logic for the inline status timeline (no numeric details exposed,
  // per UX direction — just qualitative milestones the patient cares about).
  const matchedAt = request?.matched_at || request?.created_at;
  const releasedAt = request?.results_released_at;
  const stage = !matchedAt
    ? "submitted"
    : hold_active
      ? "matching"
      : applications.length === 0
        ? "waiting"
        : "ready";
  const STAGES = [
    {
      key: "submitted",
      icon: Send,
      title: "Referral submitted",
      sub: "We received your request and started looking for matches.",
    },
    {
      key: "matching",
      icon: Inbox,
      title: "Matching with therapists",
      sub: hold_active
        ? `We'll release your matched therapists within 24 hours — full results unlock ${holdEndsLabel}.`
        : "We'll release your matched therapists within 24 hours.",
    },
    {
      key: "ready",
      icon: CheckCircle2,
      title: "Matches ready",
      sub: releasedAt
        ? "Your matches are live below — reach out whenever you're ready."
        : "Your matched therapists will appear below once the 24-hour window closes.",
    },
  ];
  const stageIdx = { submitted: 0, matching: 1, waiting: 1, ready: 2 }[stage] ?? 0;

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <Header />
      <main className="flex-1 px-5 py-12 md:py-16" data-testid="patient-results-page">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-[#C87965]">
                {copy("results.heading", "Your matches")}
              </p>
              <h1 className="font-serif-display text-4xl sm:text-5xl text-[#2D4A3E] mt-2 leading-tight">
                Therapists who want to work with you
              </h1>
            </div>
            {session?.role === "patient" && (
              <Link
                to="/portal/patient"
                className="tv-btn-secondary !py-2 !px-4 text-sm inline-flex items-center gap-1.5"
                data-testid="back-to-dashboard"
              >
                <ArrowLeft size={14} /> Back to dashboard
              </Link>
            )}
          </div>
          <p className="text-[#6D6A65] mt-3 max-w-3xl leading-relaxed">
            {copy(
              "results.subhead",
              "These therapists read your anonymous referral and submitted interest. Reach out to whoever feels right — many offer a free consult.",
            )}
          </p>

          {/* Show patient their original request so they can compare */}
          {request && (
            <YourReferralPanel request={request} />
          )}

          {hold_active && (
            <StatusTimeline
              stages={STAGES}
              activeIdx={stageIdx}
              holdEndsLabel={holdEndsLabel}
            />
          )}

          {applications.length === 0 ? (
            <div className="mt-10 bg-white border border-[#E8E5DF] rounded-2xl p-10 text-center">
              <Loader2 className="animate-spin mx-auto text-[#2D4A3E]" />
              <p className="text-[#6D6A65] mt-4 max-w-md mx-auto leading-relaxed">
                {hold_active
                  ? "We'll show your matches once the 24-hour window closes."
                  : "Therapists are reviewing your referral. Responses typically arrive within 24 hours. We'll email you as soon as your matches are ready."}
              </p>
            </div>
          ) : (
            <div className="mt-8 space-y-3">
              {applications.map((app, i) => {
                const t = app.therapist;
                const formats = [];
                if (t.telehealth) formats.push("Virtual");
                if (t.offers_in_person) formats.push("In-person");
                const formatStr = formats.join(" + ") || "Virtual";
                return (
                  <article
                    key={app.id}
                    className="bg-white border border-[#E8E5DF] rounded-2xl p-4 md:p-5 hover:border-[#2D4A3E] transition"
                    data-testid={`result-card-${i}`}
                  >
                    <div className="flex gap-4">
                      <div
                        className="w-14 h-14 rounded-full bg-[#FDFBF7] border border-[#E8E5DF] overflow-hidden flex items-center justify-center shrink-0"
                        data-testid={`avatar-${i}`}
                      >
                        {t.profile_picture ? (
                          <img
                            src={t.profile_picture}
                            alt={t.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="font-serif-display text-base text-[#2D4A3E]">
                            {(t.name || "")
                              .split(",")[0]
                              .split(" ")
                              .filter(Boolean)
                              .map((p) => p[0])
                              .slice(0, 2)
                              .join("")
                              .toUpperCase() || "T"}
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-3 flex-wrap">
                          <h3 className="font-serif-display text-xl text-[#2D4A3E] leading-tight truncate">
                            {t.name}
                          </h3>
                          <div className="inline-flex items-center gap-1 bg-[#2D4A3E] text-white text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0">
                            <Star size={10} fill="currentColor" />
                            {Math.round(app.match_score)}%
                          </div>
                        </div>
                        <div className="text-xs text-[#6D6A65] mt-0.5 break-words">
                          {t.credential_type && (
                            <span className="text-[#2B2A29] font-medium">
                              {credentialLabel(t.credential_type)}
                            </span>
                          )}
                          {t.credential_type && (t.years_experience || (t.modalities || []).length > 0) && " · "}
                          {t.years_experience
                            ? `${t.years_experience} year${t.years_experience === 1 ? "" : "s"} experience`
                            : !t.credential_type && "Experience: —"}{" "}
                          {(t.years_experience || t.credential_type) && (t.modalities || []).length > 0 && "• "}
                          {(t.modalities || []).slice(0, 3).join(" · ")}
                          {t.review_count >= 10 && t.review_avg >= 4.0 && (
                            <span
                              className="ml-2 inline-flex items-center gap-1 text-[10px] text-[#C87965] bg-[#FDFBF7] border border-[#E8E5DF] rounded-full px-1.5 py-0.5 align-middle"
                              data-testid={`review-badge-${i}`}
                              title={`Aggregated from ${(t.review_sources || []).map((s) => s.platform).join(", ") || "online sources"}`}
                            >
                              <Star size={9} fill="currentColor" />
                              {t.review_avg.toFixed(1)} · {t.review_count} reviews
                            </span>
                          )}
                        </div>
                        {app.research_rationale ? (
                          <div
                            className="mt-3 text-xs text-[#2B2A29] bg-[#FBE9E5] border border-[#F4C7BE] rounded-md px-3 py-2 leading-relaxed"
                            data-testid={`therapist-research-rationale-${i}`}
                          >
                            <span className="text-[10px] uppercase tracking-wider text-[#C87965] font-semibold mr-1.5">
                              Why we recommend
                            </span>
                            {app.research_rationale}
                          </div>
                        ) : null}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 mt-3 text-xs">
                          <Detail label="Format" value={formatStr} />
                          <Detail
                            label="Cash rate"
                            value={t.cash_rate ? `$${t.cash_rate} / session` : "—"}
                          />
                          <Detail
                            label="Sliding scale"
                            value={t.sliding_scale ? "Yes" : "No"}
                            highlight={t.sliding_scale}
                          />
                          <Detail
                            label="Free consult"
                            value={t.free_consult ? "Yes" : "—"}
                            highlight={t.free_consult}
                          />
                          {typeof app.distance_miles === "number" && (
                            <Detail
                              label="Travel distance"
                              value={`${Math.round(app.distance_miles)} mi`}
                              highlight={app.distance_miles <= 10}
                            />
                          )}
                          {t.office_addresses && t.office_addresses.length > 0 ? (
                            <div className="col-span-2 text-xs">
                              <div className="text-[10px] uppercase tracking-wider text-[#6D6A65]">
                                Office
                              </div>
                              <a
                                href={`https://maps.google.com/?q=${encodeURIComponent(t.office_addresses[0])}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium text-[#2D4A3E] underline decoration-dotted underline-offset-2 hover:text-[#C87965] break-words"
                                data-testid={`therapist-office-map-${i}`}
                              >
                                {t.office_addresses[0]}
                              </a>
                            </div>
                          ) : t.office_locations && t.office_locations.length > 0 ? (
                            <Detail
                              label="Offices"
                              value={t.office_locations.slice(0, 2).join(", ")}
                              span={2}
                            />
                          ) : null}
                          {t.website && (
                            <div className="col-span-2 text-xs">
                              <span className="text-[10px] uppercase tracking-wider text-[#6D6A65]">
                                Website
                              </span>
                              <div>
                                <a
                                  href={t.website}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[#2D4A3E] underline break-all hover:text-[#C87965]"
                                  data-testid={`therapist-website-${i}`}
                                >
                                  {t.website.replace(/^https?:\/\//, "")}
                                </a>
                              </div>
                            </div>
                          )}
                          {(() => {
                            const plans = t.insurance_accepted || [];
                            if (plans.length === 0) {
                              return (
                                <Detail
                                  label="Insurance"
                                  value={`Cash only — $${t.cash_rate || "?"}/session`}
                                  span={2}
                                />
                              );
                            }
                            // Show first 4 plans inline + count for any remainder.
                            const head = plans.slice(0, 4).join(", ");
                            const tailN = Math.max(0, plans.length - 4);
                            return (
                              <Detail
                                label="Insurance"
                                value={tailN > 0 ? `${head} +${tailN} more` : head}
                                span={2}
                              />
                            );
                          })()}
                          {(t.languages_spoken || []).length > 0 && (
                            <Detail
                              label="Languages"
                              value={["English", ...t.languages_spoken].join(", ")}
                              span={2}
                            />
                          )}
                        </div>

                        {topReasons(app.match_breakdown).length > 0 && (
                          <ul
                            className="flex flex-wrap gap-1.5 mt-3"
                            data-testid={`why-match-${i}`}
                          >
                            <li className="text-[10px] uppercase tracking-wider text-[#C87965] font-semibold pr-1 self-center">
                              Why we matched
                            </li>
                            {whyMatchedChips(app.match_breakdown, t, request).map((r) => (
                              <li
                                key={r.key}
                                className="text-[11px] bg-[#F2F7F1] border border-[#D2E2D0] text-[#3F6F4A] px-2 py-0.5 rounded-full font-medium"
                                data-testid={`why-match-${i}-${r.key}`}
                              >
                                {r.text}
                              </li>
                            ))}
                          </ul>
                        )}

                        {/* Match gaps — what's missing from a 100% fit. Helps the
                            patient understand why this isn't a perfect match. */}
                        {(() => {
                          const gaps = matchGaps(app.match_breakdown, request, t);
                          if (gaps.length === 0) return null;
                          return (
                            <div
                              className="mt-3 bg-[#FDF7EC] border border-[#E8DCC1] rounded-lg p-3"
                              data-testid={`gaps-${i}`}
                            >
                              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-[#C87965] font-semibold">
                                <AlertCircle size={11} />
                                Where you may not align ({Math.round(100 - app.match_score)}% gap)
                              </div>
                              <ul className="mt-1.5 space-y-0.5">
                                {gaps.map((g) => (
                                  <li
                                    key={g.key}
                                    className="text-xs text-[#6D6A65] leading-relaxed flex items-start gap-1.5"
                                    data-testid={`gap-${i}-${g.key}`}
                                  >
                                    <span className="text-[#C87965] mt-0.5">•</span>
                                    <span>{g.label}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          );
                        })()}

                        {app.message && app.message.trim().length > 0 && (
                          <p className="mt-3 text-sm text-[#2B2A29] leading-snug border-l-2 border-[#C87965] pl-3 italic line-clamp-3">
                            "{app.message}"
                          </p>
                        )}

                        <div className="flex flex-wrap gap-2 mt-3">
                          <EmailButton
                            urls={(() => {
                              const parts = buildConsultParts(t, request);
                              return buildEmailUrls(parts);
                            })()}
                            to={t.email || ""}
                            isMobile={mobileDevice}
                            className="inline-flex items-center gap-1.5 bg-[#2D4A3E] text-white rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-[#3A5E50] transition cursor-pointer"
                            testId={`consult-btn-${i}`}
                          >
                            <CalendarPlus size={13} /> Book free consult
                          </EmailButton>
                          <EmailButton
                            urls={buildEmailUrls({
                              to: t.email || "",
                              subject: "Hello from TheraVoca",
                              body: "",
                            })}
                            to={t.email || ""}
                            isMobile={mobileDevice}
                            className="inline-flex items-center gap-1.5 bg-[#FDFBF7] border border-[#E8E5DF] rounded-lg px-3 py-1.5 text-xs hover:border-[#2D4A3E] transition cursor-pointer text-[#2B2A29]"
                            testId={`contact-email-${i}`}
                          >
                            <Mail size={13} className="text-[#2D4A3E]" />
                            Email
                          </EmailButton>
                          {t.phone && (
                            <a
                              href={`tel:${t.phone}`}
                              className="inline-flex items-center gap-1.5 bg-[#FDFBF7] border border-[#E8E5DF] rounded-lg px-3 py-1.5 text-xs hover:border-[#2D4A3E] transition"
                              data-testid={`contact-phone-${i}`}
                            >
                              <Phone size={13} className="text-[#2D4A3E]" />
                              {t.phone}
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {/* Refer-a-friend — quietly suggest the patient share TheraVoca with
              someone they know who's looking. Plain attribution, no incentive. */}
          {request?.patient_referral_code && (
            <ReferFriendTile code={request.patient_referral_code} />
          )}

          {/* "Try again" — give patients a way to re-run intake if matches don't feel right.
              We send them back to /#start — the homepage's intake form is the canonical entry. */}
          {!hold_active && applications.length > 0 && (
            <div
              className="mt-10 bg-white border border-[#E8E5DF] rounded-2xl p-6 text-center"
              data-testid="results-try-again-section"
            >
              <h3 className="font-serif-display text-xl text-[#2D4A3E]">
                Not feeling these matches?
              </h3>
              <p className="text-sm text-[#6D6A65] mt-1.5 max-w-md mx-auto leading-relaxed">
                Sometimes a few tweaks to your answers surfaces a totally different
                set of therapists. Run the intake again — it takes 2 minutes.
              </p>
              <Link
                to="/#start"
                className="tv-btn-primary mt-5 inline-flex"
                data-testid="results-try-again-btn"
                onClick={() => {
                  setTimeout(() => {
                    document
                      .getElementById("start")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }, 250);
                }}
              >
                Try again with different answers <ArrowRight size={16} />
              </Link>
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}

function ReferFriendTile({ code }) {
  const link = `${window.location.origin}/?ref=${code}`;
  const copy = () => {
    navigator.clipboard
      .writeText(link)
      .then(() => toast.success("Invite link copied!"))
      .catch(() => toast.error("Couldn't copy link"));
  };
  return (
    <section
      className="mt-8 bg-white border border-[#E8E5DF] rounded-2xl p-5 sm:p-6 flex items-start justify-between gap-4 flex-wrap"
      data-testid="refer-friend-tile"
    >
      <div className="flex items-start gap-3 flex-1 min-w-[220px]">
        <Share2 size={18} className="text-[#C87965] mt-1 shrink-0" />
        <div>
          <div className="text-sm font-semibold text-[#2B2A29]">
            Know someone else looking for a therapist?
          </div>
          <p className="text-xs text-[#6D6A65] mt-1 leading-relaxed">
            Share TheraVoca with a friend or family member. They'll get the same
            anonymous matching service — no signup, no spam.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={copy}
        className="inline-flex items-center gap-1.5 bg-[#FDFBF7] border border-[#E8E5DF] rounded-lg px-3 py-2 text-xs font-medium text-[#2D4A3E] hover:border-[#2D4A3E] transition shrink-0"
        data-testid="refer-friend-copy-btn"
      >
        Copy invite link
      </button>
    </section>
  );
}

function Detail({ label, value, span = 1, highlight = false }) {
  return (
    <div className={span === 2 ? "col-span-2" : ""}>
      <div className="text-[10px] uppercase tracking-wider text-[#6D6A65]">{label}</div>
      <div
        className={`font-medium ${
          highlight ? "text-[#C87965]" : "text-[#2B2A29]"
        } truncate`}
      >
        {value || "—"}
      </div>
    </div>
  );
}

function StatusTimeline({ stages, activeIdx, holdEndsLabel }) {
  return (
    <section
      className="mt-7 bg-white border border-[#E8E5DF] rounded-2xl p-5 sm:p-6"
      data-testid="results-status-timeline"
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-5">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-[#C87965]">
            What happens next
          </p>
          <h2 className="font-serif-display text-xl text-[#2D4A3E] mt-1 leading-tight">
            We're matching you with therapists right now
          </h2>
        </div>
        <div className="inline-flex items-center gap-1.5 text-xs text-[#2D4A3E] bg-[#F2F4F0] border border-[#D9DDD2] rounded-full px-2.5 py-1">
          <Clock size={12} strokeWidth={2} />
          Unlocks {holdEndsLabel}
        </div>
      </div>

      <ol className="relative pl-6 sm:pl-8">
        {stages.map((s, i) => {
          const Icon = s.icon || Sparkles;
          const isActive = i === activeIdx;
          const isDone = i < activeIdx;
          const isPending = i > activeIdx;
          const dotColor = isPending
            ? "bg-[#E8E5DF] text-[#A8A39A]"
            : isActive
              ? "bg-[#C87965] text-white"
              : "bg-[#2D4A3E] text-white";
          const lineColor =
            i < stages.length - 1
              ? isPending
                ? "bg-[#E8E5DF]"
                : "bg-[#2D4A3E]"
              : "bg-transparent";
          return (
            <li
              key={s.key}
              className="relative pb-6 last:pb-0"
              data-testid={`status-stage-${s.key}`}
            >
              <span
                className={`absolute -left-[3px] sm:-left-[1px] top-0 inline-flex items-center justify-center w-7 h-7 rounded-full border-2 border-white ${dotColor} shadow-sm ${
                  isActive ? "ring-2 ring-[#C87965]/30" : ""
                }`}
              >
                <Icon size={13} strokeWidth={2.2} />
              </span>
              <span
                aria-hidden="true"
                className={`absolute left-[10px] sm:left-[12px] top-7 bottom-0 w-0.5 ${lineColor}`}
              />
              <div className="ml-7 sm:ml-9">
                <div
                  className={`text-sm font-semibold ${
                    isPending ? "text-[#A8A39A]" : "text-[#2B2A29]"
                  }`}
                >
                  {s.title}
                  {isActive && (
                    <span className="ml-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-[#C87965]">
                      <span className="relative flex w-1.5 h-1.5">
                        <span className="absolute inline-flex w-full h-full rounded-full bg-[#C87965] opacity-60 animate-ping" />
                        <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-[#C87965]" />
                      </span>
                      In progress
                    </span>
                  )}
                  {isDone && (
                    <span className="ml-2 text-[10px] uppercase tracking-wider text-[#2D4A3E]">
                      Done
                    </span>
                  )}
                </div>
                <p
                  className={`text-xs mt-1 leading-relaxed ${
                    isPending ? "text-[#A8A39A]" : "text-[#6D6A65]"
                  }`}
                >
                  {s.sub}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
