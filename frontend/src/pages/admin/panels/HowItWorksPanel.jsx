/**
 * Internal documentation panel — the operator's "how the whole
 * machine fits together" page. Lives under Admin → "How it works"
 * tab. Read-only, no API calls.
 *
 * Updated to walk a new operator through the *full* business loop:
 * lead generation → conversion → matching → therapist invitations →
 * patient hand-off → automated follow-ups → algorithm self-improvement
 * → marketing self-improvement → pricing.
 *
 * Now also includes a deep-dive on the SCORING ALGORITHM (hard filters,
 * soft axes + weights, deep-match overlay, research enrichment, apply-
 * fit grading, 95% cap) and a download link for the latest text-impact
 * experiment Excel report.
 *
 * Open questions are surfaced inline so the team has a concrete
 * checklist of what's automated vs. what still needs design / build.
 */
import { useEffect, useState } from "react";
import {
  Megaphone,
  Filter,
  Brain,
  Sparkles,
  UserPlus,
  Globe,
  ListChecks,
  Send,
  Repeat,
  TrendingUp,
  Bot,
  DollarSign,
  Download,
  FileSpreadsheet,
} from "lucide-react";
import useAdminClient from "@/lib/useAdminClient";

const STEPS = [
  {
    icon: Megaphone,
    title: "1. Generate leads",
    body:
      "Run paid ads (Meta, Google, TikTok) plus organic strategies (SEO, partnerships, founder-led content) to drive traffic to the website. Each ad ideally lands on a campaign-specific landing page that mirrors the ad's promise.",
    open: [
      "How can ad campaigns be automated end-to-end (creative refresh, audience expansion, budget pacing)?",
      "Build a system that auto-generates landing pages from each paid ad — same headline + CTA so message-match scores stay high.",
    ],
  },
  {
    icon: Filter,
    title: "2. Convert visitors → submitted requests",
    body:
      "Optimize the website + on-site behavior so as many qualified visitors as possible submit a referral request.",
    open: [
      "For therapists: a website widget that estimates the number of leads/month TheraVoca would send to a clinician (input: their URL → output: estimated patient flow + patient-type breakdown).",
      "For patients: matching education throughout the funnel + an intuitive intake flow that doesn't feel like a clinical form. (✦ Done — current intake is 8 steps standard / 11 with deep-match opt-in.)",
    ],
  },
  {
    icon: Brain,
    title: "3. Analyze the request",
    body:
      "When a request lands, the system breaks it into explicit matching variables (state, modality, payment, urgency, schedule, gender, language) and implicit ones (deep-match P1/P2/P3 — relationship style, way of working, contextual resonance via embeddings).",
  },
  {
    icon: Sparkles,
    title: "4. Score against registered therapists (Step-1 score)",
    body:
      "The matching engine compares each request's variables to every active therapist's profile. Hard filters knock out ineligible therapists; soft axes produce a 0-100 fit score. Deep research (LLM web pull across public sources) and LLM enrichment add evidence_depth + approach_alignment so the Step-1 score isn't purely self-reported.",
  },
  {
    icon: UserPlus,
    title: "5. Invite high-fit therapists to apply",
    body:
      "Therapists with a Step-1 match score of 70%+ are automatically invited (email + SMS) to apply for THIS specific referral. They have 24 hours to respond.",
  },
  {
    icon: Globe,
    title: "6. Network gap-fill — recruit non-registered therapists",
    body:
      "If the system can't identify at least 30 strong matches from the registered network, it searches the open web for non-registered therapists who appear to fit this exact request and invites them to apply. Every gap-fill effort permanently expands the network for future referrals — the funnel pays for itself.",
  },
  {
    icon: ListChecks,
    title: "7. Therapist application → Step-2 ranking score",
    body:
      "Interested therapists confirm 'Yes', write a short personalized blurb to the patient, and toggle 3 availability confirmations (taking new clients · accepts payment type · can start within urgency window). These responses produce a Step-2 ranking score on top of the Step-1 baseline. Quality of blurb (length, mentions of patient's concerns, concrete next-step language) factors in.",
  },
  {
    icon: Send,
    title: "8. Send the patient a ranked shortlist",
    body:
      "After the 24-hour application window closes, the system shares the final ranked shortlist with the patient — a curated list of therapists who've actually opted in to this specific referral.",
  },
  {
    icon: Repeat,
    title: "9. Automated follow-ups (48h · 3wk · 9wk · 15wk)",
    body:
      "The system auto-sends structured surveys to patients at 4 milestones: 48-Hour Check-in (process feedback), 3-Week Selection (who they picked, confidence), 9-Week Retention + TAI (therapeutic alliance, still seeing therapist?), and 15-Week Outcome (progress, referral willingness). Each milestone has different questions tailored to where the patient is in their therapy journey. Therapists get a separate weekly pulse check (never about specific patients).",
  },
  {
    icon: TrendingUp,
    title: "10. Feed success back into the matching algorithm",
    body:
      "Survey responses feed directly into therapist reliability scores (25% of total match weight) and Therapeutic Alliance Index (TAI). The 9-week TAI score (bond + goals subscales) and 15-week outcome data adjust future match rankings. Over time the engine self-tunes for actual therapeutic outcomes, not just self-reported preferences.",
  },
  {
    icon: Bot,
    title: "11. Feed success back into the marketing engine",
    body:
      "Successful matches also produce content for the next wave of paid ads — testimonial-style creative targeting look-alike patients (same age, same concerns, same payment situation). The system breathes on its own: matches make ads, ads make leads, leads make matches.",
  },
  {
    icon: DollarSign,
    title: "12. Pricing model",
    body:
      "Therapists pay $0 their first month, then $45/month thereafter to keep receiving referrals. Patients pay $0 per request — for now. (We'll re-evaluate if junk requests or therapists chasing ghost requests get out of hand.)",
  },
];

export default function HowItWorksPanel() {
  const client = useAdminClient();
  const [exp, setExp] = useState(null);
  // Track download in flight so the button can show "Downloading…" and
  // disable on rapid double-clicks. Errors surface via sonner.
  const [dlPending, setDlPending] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await client.get("/admin/experiments/text-impact/latest");
        setExp(r.data || null);
      } catch (_) {
        setExp({ available: false });
      }
    })();
  }, [client]);

  // Browser anchor tags can't pipe the admin auth headers (X-Admin-Password
  // / Authorization) on a plain `<a href>` click — so the previous version
  // hit `/api/admin/experiments/text-impact/download` unauthenticated and
  // bounced with `{"detail": "Invalid admin credentials"}`. Fetch the file
  // through the authed admin client as a blob, then trigger a same-origin
  // anchor click against an Object URL. Same UX, real auth.
  const downloadExperiment = async () => {
    if (dlPending) return;
    setDlPending(true);
    try {
      const r = await client.get(
        "/admin/experiments/text-impact/download",
        { responseType: "blob" },
      );
      const blob = new Blob([r.data], {
        type:
          r.headers?.["content-type"] ||
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = exp?.filename || "theravoca_experiment.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Defer revoke so Firefox/Safari finish piping the download.
      setTimeout(() => window.URL.revokeObjectURL(url), 1500);
    } catch (e) {
      const msg = e?.response?.data?.detail || "Download failed.";
      const { toast } = await import("sonner");
      toast.error(msg);
    } finally {
      setDlPending(false);
    }
  };

  return (
    <div className="mt-6 space-y-4" data-testid="how-it-works-panel">
      <div className="bg-white border border-[#E8E5DF] rounded-2xl p-6">
        <h3 className="font-serif-display text-2xl text-[#2D4A3E]">
          How TheraVoca works — end to end
        </h3>
        <p className="text-sm text-[#6D6A65] mt-2 max-w-3xl leading-relaxed">
          The full business loop: how leads come in, how requests get
          converted, how the matching engine ranks therapists, how
          gap-filling expands our network, how we hand patients a
          curated shortlist, and how follow-up data trains both the
          algorithm <em>and</em> the next round of ads. Read this
          before your first on-call shift.
        </p>
      </div>
      <ol className="space-y-3">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          return (
            <li
              key={s.title}
              className="bg-white border border-[#E8E5DF] rounded-2xl p-5 flex gap-4"
              data-testid={`how-step-${i}`}
            >
              <div className="w-10 h-10 rounded-full bg-[#FBF3E8] text-[#C87965] flex items-center justify-center shrink-0">
                <Icon size={18} strokeWidth={1.8} />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-medium text-[#2B2A29]">{s.title}</h4>
                <p className="text-sm text-[#6D6A65] leading-relaxed mt-1 break-words">
                  {s.body}
                </p>
                {s.open && s.open.length > 0 && (
                  <ul
                    className="mt-3 space-y-1.5 text-xs text-[#2B2A29] bg-[#FBF5F2] border border-[#EBD5CB] rounded-lg p-3"
                    data-testid={`how-step-${i}-open`}
                  >
                    {s.open.map((q, qi) => (
                      <li key={qi} className="flex gap-2 leading-snug">
                        <span className="text-[#A8553F] shrink-0">●</span>
                        <span>{q}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="bg-[#FDFBF7] border border-[#E8E5DF] rounded-2xl p-5">
        <h4 className="font-medium text-[#2B2A29] mb-2">
          Why we pull data from outside the therapist's website
        </h4>
        <p className="text-sm text-[#6D6A65] leading-relaxed">
          A solo therapist's website often lists every specialty
          they've ever trained in. Without independent corroboration,
          every match looks equally strong. By pulling public
          professional pages, long-form interviews, writing samples,
          and local press, we can verify which specialties actually
          appear in their <em>practice</em> — not just their checkbox
          list — and re-rank Step-1 scores accordingly. This is the
          difference between &quot;matches their stated profile&quot; and
          &quot;matches the shape of their actual practice.&quot;
        </p>
      </div>

      {/* ── Scoring algorithm deep-dive ───────────────────────────── */}
      <div
        className="bg-white border border-[#E8E5DF] rounded-2xl p-6 space-y-5"
        data-testid="scoring-algo-explainer"
      >
        <div>
          <h3 className="font-serif-display text-2xl text-[#2D4A3E]">
            Scoring algorithm — line by line
          </h3>
          <p className="text-sm text-[#6D6A65] mt-2 max-w-3xl leading-relaxed">
            Every patient request is scored against every active
            therapist. The pipeline runs three passes, each capped so a
            single axis can&apos;t dominate. The final score is always
            capped at <strong>95%</strong> — we never claim a perfect
            match on first pass.
          </p>
        </div>

        {/* Pass 1 — Hard filters */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-full bg-[#7B2D2D] text-white">
              Pass 1 — Hard filters
            </span>
            <span className="text-xs text-[#6D6A65]">
              fail any one → therapist excluded outright (score = -1)
            </span>
          </div>
          <ul className="text-sm text-[#2B2A29] leading-relaxed space-y-1.5 ml-1">
            <li>
              <strong>Always-on:</strong> location_state · client_type
              · age_group · presenting_issues[0] (primary concern only)
            </li>
            <li>
              <strong>Always-on:</strong> the therapist must list the
              patient&apos;s <em>primary</em> issue in
              <code className="mx-1 px-1.5 py-0.5 rounded bg-[#F2EFE9] text-[#7B2D2D]">
                primary_specialties
              </code>
              <em>or</em>
              <code className="mx-1 px-1.5 py-0.5 rounded bg-[#F2EFE9] text-[#7B2D2D]">
                secondary_specialties
              </code>
              <em>or</em>
              <code className="mx-1 px-1.5 py-0.5 rounded bg-[#F2EFE9] text-[#7B2D2D]">
                general_treats
              </code>
              . All three count equally for the filter — primary
              vs secondary only matters for soft scoring.
            </li>
            <li>
              <strong>Patient-toggleable:</strong> insurance_strict
              · gender_required · availability_strict · urgency_strict
              · language_strict — each is soft-scored by default,
              hard-filtered when the patient flips the strict toggle.
            </li>
          </ul>
          <p className="text-xs text-[#6D6A65] mt-2 italic leading-relaxed">
            A patient who picks <strong>three</strong> presenting
            issues only hard-filters on the first one. Issues #2 and
            #3 add soft scoring bonuses (see Pass 2 below) but never
            disqualify a therapist. This is why the intake form labels
            the picks <strong>1st / 2nd / 3rd priority</strong> — only
            the 1st is filter-critical.
          </p>
        </div>

        {/* Pass 2 — Soft-axis scoring */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-full bg-[#2D4A3E] text-white">
              Pass 2 — Soft scoring (0-100)
            </span>
            <span className="text-xs text-[#6D6A65]">
              every surviving therapist scored on these axes
            </span>
          </div>
          <table className="w-full text-sm border border-[#E8E5DF] rounded-lg overflow-hidden">
            <thead className="bg-[#F8F4EB] text-[#6D6A65]">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Axis</th>
                <th className="text-right px-3 py-2 font-medium">Max points</th>
                <th className="text-left px-3 py-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8E5DF]">
              {[
                ["Issues (presenting concern coverage)", 30, "Primary issue in therapist's primary_specialties = full points; secondary = ~70%; general_treats = ~40%. Issues #2 + #3 add diminishing-returns bonuses."],
                ["Availability windows", 12, "Overlap between patient's preferred time-of-day and therapist's open slots."],
                ["Modality / format", 10, "Telehealth · in-person · hybrid alignment."],
                ["Urgency", 8, "Therapist's urgency_capacity vs patient's `urgency` field."],
                ["Prior therapy", 6, "Soft signal — prior_therapy=yes_not_helped slightly favours therapists with deeper experience."],
                ["Years of experience", 6, "Patient's `experience_preference` ranges (early/mid/seasoned) vs therapist's years_experience."],
                ["Gender preference", 6, "Soft unless gender_required is true."],
                ["Style preference", 6, "warm / structured / direct / exploratory."],
                ["Payment fit + alignment", 12, "Sliding-scale availability + insurance match (or cash budget)."],
                ["Modality preferences (CBT/EMDR/IFS/etc.)", 4, "List intersection — patient picks N, therapist offers M, scored on overlap."],
                ["Languages", 4, "Patient's preferred_language in therapist's languages_spoken."],
              ].map(([axis, pts, note]) => (
                <tr key={axis}>
                  <td className="px-3 py-2 text-[#2B2A29]">{axis}</td>
                  <td className="px-3 py-2 text-right font-mono text-[#2D4A3E]">
                    {pts}
                  </td>
                  <td className="px-3 py-2 text-[#6D6A65] text-xs leading-snug">
                    {note}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pass 3 — Deep-match overlay (V2) */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-full bg-[#C87965] text-white">
              Pass 3 — Deep-match overlay (V2)
            </span>
            <span className="text-xs text-[#6D6A65]">
              opt-in only, when patient checks &quot;deep match&quot;
            </span>
          </div>
          <p className="text-sm text-[#2B2A29] leading-relaxed">
            Three open-text axes are embedded with{" "}
            <code className="text-xs px-1 py-0.5 rounded bg-[#F2EFE9]">
              text-embedding-3-small
            </code>{" "}
            and scored via cosine similarity:
          </p>
          <ul className="text-sm text-[#2B2A29] leading-relaxed mt-2 space-y-1.5 ml-1">
            <li>
              <strong>Relationship style</strong> — patient P1 vs
              therapist (T1, T4) blend.
            </li>
            <li>
              <strong>Way of working</strong> — patient P2 vs
              therapist T3.
            </li>
            <li>
              <strong>Contextual resonance</strong> — patient P3 vs
              therapist T5 (lived-experience open text). This is the
              axis the new free-text patient note also feeds into.
            </li>
          </ul>
          <p className="text-xs text-[#6D6A65] mt-2 italic">
            Default weights: relationship 0.40 · working 0.35 ·
            contextual 0.25 — admin-tunable in the Settings panel.
          </p>
        </div>

        {/* Research enrichment bonus */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-full bg-[#A8553F] text-white">
              Research enrichment bonus (background)
            </span>
            <span className="text-xs text-[#6D6A65]">
              cached 30 days · runs async after match
            </span>
          </div>
          <p className="text-sm text-[#2B2A29] leading-relaxed">
            For each notified therapist we pull 4-6 public web pages
            (their site, Psychology Today, long-form interviews, local
            press) and ask Claude Sonnet 4.5 to extract themes. Two
            scores fold into the rank:
          </p>
          <ul className="text-sm text-[#2B2A29] leading-relaxed mt-2 space-y-1.5 ml-1">
            <li>
              <strong>evidence_depth</strong> (0-15) — how often
              the patient&apos;s primary issue actually appears in the
              therapist&apos;s public writing, vs being a checkbox.
            </li>
            <li>
              <strong>approach_alignment</strong> (0-10) — match
              between the patient&apos;s style preference and the
              therapist&apos;s self-described approach as it appears
              in long-form context.
            </li>
          </ul>
          <p className="text-xs text-[#6D6A65] mt-2 italic">
            Cold-cache therapists score without this bonus on
            first-touch; the warmup endpoint backfills overnight.
          </p>
        </div>

        {/* Apply-fit grade */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-full bg-[#5C6B4A] text-white">
              Apply-fit grade (post-application)
            </span>
            <span className="text-xs text-[#6D6A65]">
              0-5, LLM-graded against patient brief
            </span>
          </div>
          <p className="text-sm text-[#2B2A29] leading-relaxed">
            When the therapist clicks Apply and writes their reply,
            <code className="mx-1 px-1.5 py-0.5 rounded bg-[#F2EFE9] text-[#5C6B4A]">
              score_apply_fit
            </code>
            grades the message 0-5 against the patient&apos;s
            presenting_issues, style_preference, prior_therapy_notes,
            and now the <strong>free-text &quot;Anything else?&quot;</strong>
            field too. Stored on the application doc and surfaced to
            the patient on the results page.
          </p>
          <ul className="text-xs text-[#6D6A65] leading-relaxed mt-2 space-y-1 ml-1 italic">
            <li>5: addresses primary concern + style + prior + free text.</li>
            <li>3-4: addresses primary concern + ONE other axis.</li>
            <li>1-2: generic intro, mentions concerns only in passing.</li>
            <li>0: doesn&apos;t engage the brief at all.</li>
          </ul>
          <p className="text-xs text-[#6D6A65] mt-2 leading-relaxed">
            Empirical lift (50-request, 250-application study, run id{" "}
            <code className="text-[10px]">exp_20260430_111623</code>):
            empty/oneliner → 0.0 · generic long → 0.87 · issue-specific
            → 3.2 · full-engagement → 4.84. Length alone buys you
            ~+0.9 — relevance is what the grader rewards.
          </p>
        </div>

        {/* Final cap */}
        <div className="flex items-start gap-3 bg-[#F8F4EB] rounded-lg p-3">
          <span className="text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-full bg-[#2B2A29] text-white whitespace-nowrap">
            Cap @ 95%
          </span>
          <p className="text-xs text-[#6D6A65] leading-relaxed">
            After all passes, the final match_score is rounded to a
            whole integer and capped at 95%. We deliberately never
            show 100% — every therapist relationship has more
            information to discover than the engine could ever
            encode, and we set patient expectations honestly.
          </p>
        </div>
      </div>

      {/* ── Experiment download ──────────────────────────────────── */}
      <div
        className="bg-white border border-[#E8E5DF] rounded-2xl p-5 flex items-start gap-4"
        data-testid="experiment-download-card"
      >
        <div className="w-10 h-10 rounded-lg bg-[#E9F0E6] text-[#2D4A3E] flex items-center justify-center shrink-0">
          <FileSpreadsheet size={20} strokeWidth={1.8} />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-[#2B2A29]">
            Text-impact experiment — Excel report
          </h4>
          <p className="text-sm text-[#6D6A65] leading-relaxed mt-1">
            50 patient requests × 5 therapists × 5 message variants = 250
            graded applies. Quantifies how patient free-text + therapist
            apply-message length / specificity move the apply_fit score.
            Used to calibrate the algorithm changes documented above.
          </p>
          {exp && exp.available ? (
            <button
              type="button"
              onClick={downloadExperiment}
              disabled={dlPending}
              className="inline-flex items-center gap-1.5 text-sm text-[#2D4A3E] font-medium hover:underline mt-3 disabled:opacity-60 disabled:cursor-not-allowed"
              data-testid="experiment-download-link"
            >
              <Download size={14} />
              {dlPending ? "Downloading…" : `Download ${exp.filename}`}
              <span className="text-[11px] text-[#6D6A65] font-normal">
                ({(exp.size_bytes / 1024).toFixed(1)} kB)
              </span>
            </button>
          ) : (
            <p className="text-xs italic text-[#9C9893] mt-3">
              {exp === null
                ? "Loading…"
                : "No report generated yet — run scripts/experiment_text_impact.py to create one."}
            </p>
          )}
        </div>
      </div>

      <div
        className="bg-[#F2F4F0] border border-[#D9DDD2] rounded-2xl p-5"
        data-testid="how-it-works-loop"
      >
        <h4 className="font-medium text-[#2B2A29] mb-2">
          The self-improving loop in one line
        </h4>
        <p className="text-sm text-[#2D4A3E] leading-relaxed font-medium">
          Ads → leads → requests → matches → successful matches →
          smarter algorithm + more targeted ads → more leads.
        </p>
        <p className="text-xs text-[#6D6A65] mt-2 leading-relaxed">
          The system breathes on its own. Our job is to make sure
          steps 1, 2, 6 and 11 keep pace — everything in between is
          algorithmic.
        </p>
      </div>
    </div>
  );
}

