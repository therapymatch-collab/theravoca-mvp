import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  ExternalLink,
  EyeOff,
  Loader2,
  Pencil,
  Search,
  Trash2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { bustSiteCopyCache } from "@/lib/useSiteCopy";

// ── Site-copy editor ─────────────────────────────────────────────────
// Lets admins override any visible text on the public site keyed by a
// stable identifier (e.g. `landing.hero.headline`). The list below
// seeds the editor with every key the React code references; admins
// can also add custom keys via the form at the bottom.
//
// `section` groups rows in the UI under a collapsible header.
// `previewPath` is the URL the "Preview" button opens with the override
// applied via `?preview=...` query param.
const SEED_KEYS = [
  // ─── LANDING — hero ────────────────────────────────────────────────
  { section: "Landing — Hero", key: "landing.hero.eyebrow",  label: "Eyebrow",          fallback: "Pilot live in Idaho", previewPath: "/" },
  { section: "Landing — Hero", key: "landing.hero.headline", label: "Headline",         fallback: "Let therapists come to you.", previewPath: "/" },
  { section: "Landing — Hero", key: "landing.hero.promise",  label: "Big promise",      fallback: "3+ matched therapists in 24 hours, guaranteed.", previewPath: "/" },
  { section: "Landing — Hero", key: "landing.hero.subhead",  label: "Subhead",          fallback: "No more searching, cold-calls, or waiting to hear back. Pick what matters, and we'll route your request to therapists in your network who actually want to work with you.", previewPath: "/" },
  { section: "Landing — Hero", key: "landing.hero.cta",      label: "Primary CTA",      fallback: "Get matched — free", previewPath: "/" },
  { section: "Landing — Hero", key: "landing.hero.subcta",   label: "Secondary CTA hint", fallback: "Free · No login required · ~2 min", previewPath: "/" },
  // Three proof-point bullets under the hero CTA. Each has a short
  // title + a 1-2 sentence body — same structure as we used to have
  // duplicated in the "How we're different" block but moved up so
  // first-time visitors see it before they scroll.
  { section: "Landing — Hero", key: "landing.hero.bullet1.title", label: "Bullet 1 · title", fallback: "Structured intake — no vague free-text guesses", previewPath: "/" },
  { section: "Landing — Hero", key: "landing.hero.bullet1.body",  label: "Bullet 1 · body",  fallback: "Multi-step questions about schedule, payment, identity, and your style preferences — so therapists see a real picture, not a paragraph they have to parse.", previewPath: "/" },
  { section: "Landing — Hero", key: "landing.hero.bullet2.title", label: "Bullet 2 · title", fallback: "Smarter matching across 5 weighted axes", previewPath: "/" },
  { section: "Landing — Hero", key: "landing.hero.bullet2.body",  label: "Bullet 2 · body",  fallback: "We score each therapist on hard filters, soft preferences, relationship style, way of working, and contextual resonance — not a single keyword search.", previewPath: "/" },
  { section: "Landing — Hero", key: "landing.hero.bullet3.title", label: "Bullet 3 · title", fallback: "Anonymous referrals, contact info revealed last", previewPath: "/" },
  { section: "Landing — Hero", key: "landing.hero.bullet3.body",  label: "Bullet 3 · body",  fallback: "Therapists see your needs, not your identity. You only share contact details with the one you choose, after they've opted in.", previewPath: "/" },

  // ─── LANDING — How it works ────────────────────────────────────────
  { section: "Landing — How it works", key: "landing.how.heading", label: "Section heading", fallback: "How it works", previewPath: "/#how" },
  { section: "Landing — How it works", key: "landing.how.subhead", label: "Section subhead", fallback: "Three steps. No forms-overload.", previewPath: "/#how" },
  { section: "Landing — How it works", key: "landing.how.step1.title", label: "Step 1 title", fallback: "Tell us what you need", previewPath: "/#how" },
  { section: "Landing — How it works", key: "landing.how.step1.body",  label: "Step 1 body",  fallback: "Two minutes, anonymous. No login. Pick what matters most: schedule, modality, identity, payment.", previewPath: "/#how" },
  { section: "Landing — How it works", key: "landing.how.step2.title", label: "Step 2 title", fallback: "We do the work", previewPath: "/#how" },
  { section: "Landing — How it works", key: "landing.how.step2.body",  label: "Step 2 body",  fallback: "Our matching engine ranks every Idaho therapist against your needs and reaches out to the top picks. They opt in or out.", previewPath: "/#how" },
  { section: "Landing — How it works", key: "landing.how.step3.title", label: "Step 3 title", fallback: "Pick your match", previewPath: "/#how" },
  { section: "Landing — How it works", key: "landing.how.step3.body",  label: "Step 3 body",  fallback: "Within 24h you get a ranked list of therapists who actually want to work with you. Pick one. Done.", previewPath: "/#how" },

  // ─── LANDING — Why TheraVoca ───────────────────────────────────────
  { section: "Landing — Why TheraVoca", key: "landing.different.eyebrow", label: "Eyebrow", fallback: "How we're different", previewPath: "/#different" },
  { section: "Landing — Why TheraVoca", key: "landing.different.heading", label: "Heading", fallback: "Finding the right therapist shouldn't feel like a full-time job.", previewPath: "/#different" },
  { section: "Landing — Why TheraVoca", key: "landing.different.subhead", label: "Subhead", fallback: "We flip the script. You describe what you need. Therapists come to you.", previewPath: "/#different" },
  // Note: the old `landing.different.bullet{1,2,3}.{title,body}` keys
  // moved into the Hero section (`landing.hero.bullet*`) — they render
  // above-the-fold now, not inside this differentiator block.

  // ─── LANDING — Our promise (manifesto card between How-it-works and Testimonials) ───
  { section: "Landing — Our promise", key: "landing.promise.eyebrow",  label: "Eyebrow",  fallback: "the match — our promise", previewPath: "/#promise" },
  { section: "Landing — Our promise", key: "landing.promise.heading",  label: "Heading",  fallback: "We exist for one outcome.", previewPath: "/#promise" },
  { section: "Landing — Our promise", key: "landing.promise.body",     label: "Body — the success definition", fallback: "A successful match means the patient and therapist work together long enough for the patient to report feeling better about their presenting issue — and to view the relationship and time together as ultimately beneficial in their life.", previewPath: "/#promise" },
  { section: "Landing — Our promise", key: "landing.promise.tagline",  label: "Closing tagline", fallback: "Patient + therapist + time = a third thing — a relationship that helps. Everything we build serves that.", previewPath: "/#promise" },

  // ─── LANDING — Testimonials / social proof ─────────────────────────
  { section: "Landing — Social proof", key: "landing.testimonials.heading", label: "Section heading", fallback: "What patients are saying", previewPath: "/#testimonials" },
  { section: "Landing — Social proof", key: "landing.testimonials.subhead", label: "Section subhead", fallback: "Real users. Lightly edited for privacy.", previewPath: "/#testimonials" },

  // ─── LANDING — FAQ ─────────────────────────────────────────────────
  { section: "Landing — FAQ", key: "landing.faq.eyebrow", label: "Eyebrow", fallback: "FAQs", previewPath: "/#faq" },
  { section: "Landing — FAQ", key: "landing.faq.heading", label: "Heading", fallback: "Things people ask", previewPath: "/#faq" },
  { section: "Landing — FAQ", key: "landing.faq.subhead", label: "Subhead", fallback: "Don't see your question? Email support@theravoca.com.", previewPath: "/#faq" },

  // ─── LANDING — Final CTA ───────────────────────────────────────────
  { section: "Landing — Final CTA", key: "landing.finalcta.heading", label: "Heading", fallback: "Ready to find your therapist?", previewPath: "/" },
  { section: "Landing — Final CTA", key: "landing.finalcta.subhead", label: "Subhead", fallback: "Two minutes. No login. We'll do the rest.", previewPath: "/" },
  { section: "Landing — Final CTA", key: "landing.finalcta.cta",     label: "CTA label", fallback: "Get matched — free", previewPath: "/" },

  // ─── HEADER + FOOTER ───────────────────────────────────────────────
  { section: "Header & Footer", key: "header.nav.how",         label: "Nav · How it works", fallback: "How it works", previewPath: "/" },
  { section: "Header & Footer", key: "header.nav.testimonials",label: "Nav · Testimonials", fallback: "Testimonials", previewPath: "/" },
  { section: "Header & Footer", key: "header.nav.different",   label: "Nav · Why TheraVoca", fallback: "Why TheraVoca", previewPath: "/" },
  { section: "Header & Footer", key: "header.nav.faq",         label: "Nav · FAQs", fallback: "FAQs", previewPath: "/" },
  { section: "Header & Footer", key: "header.nav.therapists",  label: "Nav · For therapists", fallback: "For therapists", previewPath: "/" },
  { section: "Header & Footer", key: "header.nav.signin",      label: "Nav · Sign in", fallback: "Sign in", previewPath: "/" },
  { section: "Header & Footer", key: "header.cta",             label: "Header CTA button", fallback: "Get matched", previewPath: "/" },
  { section: "Header & Footer", key: "footer.tagline",         label: "Tagline", fallback: "Let therapists come to you. We do the logistical work so you can focus on healing.", previewPath: "/" },
  { section: "Header & Footer", key: "footer.crisis.heading",  label: "Crisis support heading", fallback: "Crisis support", previewPath: "/" },
  { section: "Header & Footer", key: "footer.crisis.body",     label: "Crisis support body", fallback: "If you or someone you know is in crisis, please call 911 or contact the Suicide & Crisis Lifeline at 988 immediately.", previewPath: "/" },
  { section: "Header & Footer", key: "footer.privacy.heading", label: "Privacy heading", fallback: "Privacy", previewPath: "/" },
  { section: "Header & Footer", key: "footer.privacy.body",    label: "Privacy body", fallback: "We never share your personal information without your consent. Therapists only see anonymized referrals.", previewPath: "/" },

  // ─── THERAPIST JOIN — Hero ─────────────────────────────────────────
  { section: "Therapist Join — Hero", key: "therapist.hero.eyebrow",  label: "Eyebrow",  fallback: "For licensed therapists", previewPath: "/therapists/join" },
  { section: "Therapist Join — Hero", key: "therapist.hero.headline", label: "Headline", fallback: "You focus on care — we provide the referrals.", previewPath: "/therapists/join" },
  { section: "Therapist Join — Hero", key: "therapist.hero.subhead",  label: "Subhead",  fallback: "Marketing yourself to attract the right patients can feel frustrating and time-consuming. We do all the work by sending pre-screened referrals straight to your inbox — so you can spend your hours on clients, not on SEO.", previewPath: "/therapists/join" },

  // ─── THERAPIST JOIN — Why join cards ───────────────────────────────
  { section: "Therapist Join — Why join", key: "therapist.why.heading", label: "Section heading", fallback: "Why join TheraVoca?", previewPath: "/therapists/join#why" },
  { section: "Therapist Join — Why join", key: "therapist.why.subhead", label: "Section subhead", fallback: "Built by therapists, for therapists — to take the busywork off your plate.", previewPath: "/therapists/join#why" },
  { section: "Therapist Join — Why join", key: "therapist.why.card1.title", label: "Card 1 title", fallback: "Stop chasing leads",   previewPath: "/therapists/join#why" },
  { section: "Therapist Join — Why join", key: "therapist.why.card1.body",  label: "Card 1 body",  fallback: "Patients come to you, pre-screened. No more cold calls or networking dinners.", previewPath: "/therapists/join#why" },
  { section: "Therapist Join — Why join", key: "therapist.why.card2.title", label: "Card 2 title", fallback: "Right-fit referrals", previewPath: "/therapists/join#why" },
  { section: "Therapist Join — Why join", key: "therapist.why.card2.body",  label: "Card 2 body",  fallback: "Our match engine sends you only the patients you can actually help. Higher conversion, less attrition.", previewPath: "/therapists/join#why" },
  { section: "Therapist Join — Why join", key: "therapist.why.card3.title", label: "Card 3 title", fallback: "Skip the marketing", previewPath: "/therapists/join#why" },
  { section: "Therapist Join — Why join", key: "therapist.why.card3.body",  label: "Card 3 body",  fallback: "We handle the SEO, ads, and intake forms. You handle the therapy.", previewPath: "/therapists/join#why" },

  // ─── THERAPIST JOIN — Pricing / trial ──────────────────────────────
  { section: "Therapist Join — Pricing", key: "therapist.pricing.heading", label: "Heading", fallback: "Simple pricing — start free", previewPath: "/therapists/join#pricing" },
  { section: "Therapist Join — Pricing", key: "therapist.pricing.subhead", label: "Subhead", fallback: "30-day free trial. Cancel anytime. No setup fees.", previewPath: "/therapists/join#pricing" },
  { section: "Therapist Join — Pricing", key: "therapist.pricing.note",    label: "Note below pricing card", fallback: "Your card isn't charged until your trial ends. We'll email you 3 days before billing starts.", previewPath: "/therapists/join#pricing" },

  // ─── THERAPIST JOIN — FAQ ──────────────────────────────────────────
  { section: "Therapist Join — FAQ", key: "therapist.faq.heading", label: "Heading", fallback: "Therapist FAQs", previewPath: "/therapists/join#faq" },
  { section: "Therapist Join — FAQ", key: "therapist.faq.subhead", label: "Subhead", fallback: "Common questions from licensed clinicians.", previewPath: "/therapists/join#faq" },

  // ─── INTAKE — Step titles ──────────────────────────────────────────
  { section: "Intake form — Step titles", key: "intake.step.0", label: "Step 1 title", fallback: "Who is this for?", previewPath: "/#start" },
  { section: "Intake form — Step titles", key: "intake.step.1", label: "Step 2 title", fallback: "What's going on?", previewPath: "/#start" },
  { section: "Intake form — Step titles", key: "intake.step.2", label: "Step 3 title", fallback: "Format & location", previewPath: "/#start" },
  { section: "Intake form — Step titles", key: "intake.step.3", label: "Step 4 title", fallback: "Payment", previewPath: "/#start" },
  { section: "Intake form — Step titles", key: "intake.step.4", label: "Step 5 title", fallback: "Logistics", previewPath: "/#start" },
  { section: "Intake form — Step titles", key: "intake.step.5", label: "Step 6 title", fallback: "Therapist preferences", previewPath: "/#start" },
  { section: "Intake form — Step titles", key: "intake.step.6", label: "Step 7 title", fallback: "What matters most?", previewPath: "/#start" },
  { section: "Intake form — Step titles", key: "intake.step.7", label: "Step 8 title", fallback: "Where to reach you", previewPath: "/#start" },

  // ─── INTAKE — Priority picker ──────────────────────────────────────
  { section: "Intake form — Priorities", key: "intake.priorities.label",       label: "Question label",       fallback: "Which of these matter most to you?", previewPath: "/#start" },
  { section: "Intake form — Priorities", key: "intake.priorities.hint",        label: "Hint text",            fallback: "Tap any that really matter — we'll lean your matches toward those. Skip if you'd rather we use our default ranking.", previewPath: "/#start" },
  { section: "Intake form — Priorities", key: "intake.priorities.strict_label",label: "Strict-mode label",    fallback: "Strict mode", previewPath: "/#start" },
  { section: "Intake form — Priorities", key: "intake.priorities.strict_desc", label: "Strict-mode description", fallback: "only show me therapists who are a real fit on every priority I picked. (Fewer matches, but tighter.)", previewPath: "/#start" },

  // ─── INTAKE — Final / agreements ───────────────────────────────────
  { section: "Intake form — Final step", key: "intake.final.heading",        label: "'Where to reach you' lead-in", fallback: "Last bit — where should we send your matches?", previewPath: "/#start" },
  { section: "Intake form — Final step", key: "intake.final.adult",          label: "Adult-confirmation checkbox",  fallback: "I confirm I'm 18 or older.", previewPath: "/#start" },
  { section: "Intake form — Final step", key: "intake.final.not_emergency",  label: "Not-an-emergency checkbox",    fallback: "I understand this is not an emergency service. If this is a crisis, I'll call 911 or 988.", previewPath: "/#start" },
  { section: "Intake form — Final step", key: "intake.final.terms",          label: "Terms-agreement checkbox",     fallback: "I agree to the Terms of Use and Privacy Notice.", previewPath: "/#start" },

  // ─── INTAKE — Result-saved screen ──────────────────────────────────
  { section: "Intake form — Confirmation", key: "intake.success.heading", label: "Success heading", fallback: "Check your email", previewPath: "/get-matched/sent" },
  { section: "Intake form — Confirmation", key: "intake.success.body",    label: "Success body",    fallback: "We just sent a verification link. Click it to start matching — we'll follow up within 24 hours with your top picks.", previewPath: "/get-matched/sent" },

  // ─── SIGN IN ───────────────────────────────────────────────────────
  { section: "Sign in", key: "signin.heading",        label: "Heading",         fallback: "Sign in", previewPath: "/sign-in" },
  { section: "Sign in", key: "signin.subhead",        label: "Subhead",         fallback: "We'll email you a 6-digit code. No password required.", previewPath: "/sign-in" },
  { section: "Sign in", key: "signin.role.patient",   label: "Role tab · Patient",   fallback: "Patient", previewPath: "/sign-in" },
  { section: "Sign in", key: "signin.role.therapist", label: "Role tab · Therapist", fallback: "Therapist", previewPath: "/sign-in" },
  { section: "Sign in", key: "signin.email_label",    label: "Email field label",    fallback: "Email", previewPath: "/sign-in" },
  { section: "Sign in", key: "signin.email_hint",     label: "Email field hint",     fallback: "Use the email you signed up with.", previewPath: "/sign-in" },
  { section: "Sign in", key: "signin.code_hint",      label: "Code-entry hint",      fallback: "Enter the 6-digit code we just emailed you. Codes expire in 10 minutes.", previewPath: "/sign-in" },

  // ─── PATIENT PORTAL ────────────────────────────────────────────────
  { section: "Patient portal", key: "portal.heading",       label: "Heading",      fallback: "Your matches",  previewPath: "/portal/patient" },
  { section: "Patient portal", key: "portal.subhead",       label: "Subhead",      fallback: "Track every request you've made and the therapists who've reached out.", previewPath: "/portal/patient" },
  { section: "Patient portal", key: "portal.empty.heading", label: "Empty state heading", fallback: "No requests yet", previewPath: "/portal/patient" },
  { section: "Patient portal", key: "portal.empty.body",    label: "Empty state body",    fallback: "Submit an intake from the homepage and your matches will land here.", previewPath: "/portal/patient" },
  { section: "Patient portal", key: "portal.empty.cta",     label: "Empty state CTA",     fallback: "Get matched — free", previewPath: "/portal/patient" },

  // ─── PATIENT RESULTS ───────────────────────────────────────────────
  { section: "Patient results", key: "results.heading",     label: "Heading",     fallback: "Your top matches", previewPath: "/results/sample" },
  { section: "Patient results", key: "results.subhead",     label: "Subhead",     fallback: "These therapists reviewed your request and want to work with you. Reach out to whoever feels right.", previewPath: "/results/sample" },
  { section: "Patient results", key: "results.empty.heading", label: "Empty state heading", fallback: "Still gathering responses", previewPath: "/results/sample" },
  { section: "Patient results", key: "results.empty.body",    label: "Empty state body",    fallback: "Therapists have 24 hours to respond. We'll email you the moment your first match comes in.", previewPath: "/results/sample" },
  { section: "Patient results", key: "results.share.heading", label: "Share section heading", fallback: "Share with a friend", previewPath: "/results/sample" },
  { section: "Patient results", key: "results.share.body",    label: "Share section body",    fallback: "Know someone else looking? Share your link and they'll skip the line.", previewPath: "/results/sample" },

  // ─── BUTTONS — General ─────────────────────────────────────────────
  { section: "Buttons", key: "btn.intake.start",          label: "Intake · Start CTA",         fallback: "Get matched — free", previewPath: "/" },
  { section: "Buttons", key: "btn.intake.next",           label: "Intake · 'Continue'",        fallback: "Continue", previewPath: "/#start" },
  { section: "Buttons", key: "btn.intake.back",           label: "Intake · 'Back'",            fallback: "← Back", previewPath: "/#start" },
  { section: "Buttons", key: "btn.intake.submit",         label: "Intake · 'Review & submit'", fallback: "Review & submit", previewPath: "/#start" },
  { section: "Buttons", key: "btn.intake.preview_edit",   label: "Intake · 'Edit answers'",    fallback: "← Edit answers", previewPath: "/#start" },
  { section: "Buttons", key: "btn.intake.preview_submit", label: "Intake · 'Confirm & submit'",fallback: "Confirm & find my matches", previewPath: "/#start" },


  // ─── CTA BUTTONS — Per-location ────────────────────────────────────
  { section: "CTA buttons", key: "cta.after_how",       label: "After 'How it works'",    fallback: "Get matched today", previewPath: "/#how" },
  { section: "CTA buttons", key: "cta.after_different",  label: "After 'Why TheraVoca'",   fallback: "Get matched today", previewPath: "/#different" },
  { section: "CTA buttons", key: "cta.after_faq",        label: "After FAQ",               fallback: "Get matched today", previewPath: "/#faq" },
  { section: "CTA buttons", key: "cta.testimonials",     label: "After testimonials",      fallback: "Get matched today", previewPath: "/#testimonials" },
  { section: "CTA buttons", key: "cta.default",          label: "Default CTA fallback",    fallback: "Get matched today", previewPath: "/" },
  { section: "CTA buttons", key: "intake.eyebrow",       label: "Intake section eyebrow",  fallback: "Get started", previewPath: "/#start" },
  // ─── INTAKE — Review-modal lock warning (Iter-89) ────────────────────
  // Final reminder shown at the top of the Review modal so patients
  // know this is the last chance to change anything.
  { section: "Intake — Review modal", key: "intake.preview.warning.heading", label: "Lock-warning heading", fallback: "Once you submit, this can't be changed.", previewPath: "/#start" },
  { section: "Intake — Review modal", key: "intake.preview.warning.body",    label: "Lock-warning body",    fallback: "Please double-check your answers below before submitting. If something needs to change later, just email us and we'll resend a corrected match.", previewPath: "/#start" },
  { section: "Buttons", key: "btn.signin.send_code",      label: "Sign-in · 'Send me a code'", fallback: "Send me a code", previewPath: "/sign-in" },
  { section: "Buttons", key: "btn.signin.verify",         label: "Sign-in · 'Verify & sign in'", fallback: "Verify & sign in", previewPath: "/sign-in" },
  { section: "CTA buttons", key: "cta.therapist_faq",     label: "After therapist FAQ",             fallback: "Join our network", previewPath: "/therapists/join#faq" },
  { section: "Buttons", key: "btn.therapist.cta.headline",label: "Therapist · 'Get more referrals'", fallback: "Get more referrals", previewPath: "/therapists/join" },
  { section: "Buttons", key: "btn.therapist.cta.subline", label: "Therapist · CTA subline",    fallback: "30-day free trial · Cancel anytime", previewPath: "/therapists/join" },
  { section: "Buttons", key: "btn.therapist.signup_cta",  label: "Therapist · Hero signup CTA", fallback: "Sign up — start free trial", previewPath: "/therapists/join" },
  { section: "Buttons", key: "btn.therapist.add_payment", label: "Therapist · Add payment method", fallback: "Add payment method & start free trial", previewPath: "/therapists/join" },
  { section: "Buttons", key: "btn.therapist.skip_payment",label: "Therapist · 'I'll do this later'", fallback: "I'll do this later", previewPath: "/therapists/join" },
];

export default function SiteCopyAdminPanel({ client }) {
  const [overrides, setOverrides] = useState(null); // {key: {value, updated_at}}
  const [drafts, setDrafts] = useState({});
  const [savingKey, setSavingKey] = useState(null);
  const [customKey, setCustomKey] = useState("");
  const [customValue, setCustomValue] = useState("");
  const [reload, setReload] = useState(0);
  // UX state for handling 100+ keys
  const [search, setSearch] = useState("");
  const [showOnlyOverridden, setShowOnlyOverridden] = useState(false);
  const [collapsed, setCollapsed] = useState(() => new Set());

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await client.get("/admin/site-copy");
        if (!alive) return;
        const map = {};
        (r.data?.rows || []).forEach((row) => {
          map[row.key] = row;
        });
        setOverrides(map);
      } catch (e) {
        toast.error(e?.response?.data?.detail || e.message || "Failed to load copy");
      }
    })();
    return () => { alive = false; };
  }, [client, reload]);

  const save = async (key, value) => {
    setSavingKey(key);
    try {
      await client.put("/admin/site-copy", { key, value });
      bustSiteCopyCache();
      toast.success("Saved — refresh the page to see it live.");
      setDrafts((d) => { const next = { ...d }; delete next[key]; return next; });
      setReload((n) => n + 1);
    } catch (e) {
      toast.error(e?.response?.data?.detail || e.message || "Save failed");
    } finally {
      setSavingKey(null);
    }
  };

  const hide = async (key, label) => {
    if (!window.confirm(
      `Hide "${label || key}" on the public site?\n\n` +
      "This blanks the text wherever it appears. To bring the default " +
      "back, click Reset.",
    )) return;
    await save(key, "");
  };

  const remove = async (key) => {
    if (!window.confirm(`Reset "${key}" to default copy?`)) return;
    try {
      await client.delete(`/admin/site-copy/${encodeURIComponent(key)}`);
      bustSiteCopyCache();
      toast.success("Reset to default");
      setReload((n) => n + 1);
    } catch (e) {
      toast.error(e?.response?.data?.detail || e.message || "Reset failed");
    }
  };

  const removeCustom = async (key) => {
    if (!window.confirm(
      `Delete custom key "${key}"?\n\n` +
      "This removes the override entirely. If your code references this " +
      "key with a fallback, the fallback will render. If not, nothing " +
      "will appear there.",
    )) return;
    try {
      await client.delete(`/admin/site-copy/${encodeURIComponent(key)}`);
      bustSiteCopyCache();
      toast.success("Custom key deleted");
      setReload((n) => n + 1);
    } catch (e) {
      toast.error(e?.response?.data?.detail || e.message || "Delete failed");
    }
  };

  const addCustom = async () => {
    if (!customKey.trim()) { toast.error("Key is required"); return; }
    await save(customKey.trim(), customValue);
    setCustomKey("");
    setCustomValue("");
  };

  // Filter + group seeds by section. Memoised so typing in the search
  // box doesn't re-allocate on every render.
  const visibleGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = new Map(); // section -> [seed, ...]
    SEED_KEYS.forEach((seed) => {
      if (showOnlyOverridden && !(overrides && overrides[seed.key])) return;
      if (q) {
        const overrideVal = overrides?.[seed.key]?.value || "";
        const hay = `${seed.label} ${seed.key} ${seed.fallback} ${seed.section} ${overrideVal}`.toLowerCase();
        if (!hay.includes(q)) return;
      }
      if (!out.has(seed.section)) out.set(seed.section, []);
      out.get(seed.section).push(seed);
    });
    return out;
  }, [search, showOnlyOverridden, overrides]);

  // Custom keys = overrides whose key isn't one of our SEED_KEYS. Surface
  // them so admins can review and delete keys they (or a previous engineer)
  // added without losing track.
  const customKeys = useMemo(() => {
    if (!overrides) return [];
    const seedSet = new Set(SEED_KEYS.map((s) => s.key));
    const q = search.trim().toLowerCase();
    return Object.keys(overrides)
      .filter((k) => !seedSet.has(k))
      .filter((k) => {
        if (showOnlyOverridden) return true; // they're all overrides
        return true;
      })
      .filter((k) => {
        if (!q) return true;
        const hay = `${k} ${overrides[k]?.value || ""}`.toLowerCase();
        return hay.includes(q);
      })
      .sort();
  }, [overrides, search, showOnlyOverridden]);

  const totalKeys = SEED_KEYS.length;
  const overriddenCount = overrides ? Object.keys(overrides).length : 0;

  const toggleSection = (s) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });

  return (
    <div className="mt-6 space-y-4" data-testid="site-copy-panel">
      <div className="bg-white border border-[#E8E5DF] rounded-2xl p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h3 className="font-serif-display text-2xl text-[#2D4A3E]">Site copy editor</h3>
            <p className="text-sm text-[#6D6A65] mt-2 max-w-3xl leading-relaxed">
              Override any visible text on the public site. Saved values appear within ~60s of a hard refresh. Reset removes the override and the default wins.
            </p>
          </div>
          <div className="text-xs text-[#6D6A65] font-mono whitespace-nowrap" data-testid="copy-counter">
            <span className="text-[#2D4A3E] font-semibold">{overriddenCount}</span>
            <span className="mx-1">/</span>
            <span>{totalKeys}</span>
            <span className="ml-1">overridden</span>
          </div>
        </div>
        {/* Search + filter row */}
        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A4A29E]" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search keys, labels, or default text…"
              className="pl-9"
              data-testid="copy-search"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-[#2B2A29] cursor-pointer">
            <Switch
              checked={showOnlyOverridden}
              onCheckedChange={setShowOnlyOverridden}
              data-testid="copy-filter-overridden"
            />
            Only overridden
          </label>
        </div>
      </div>

      {overrides == null ? (
        <div className="bg-white border border-[#E8E5DF] rounded-2xl p-12 text-center text-[#6D6A65]">
          <Loader2 className="animate-spin mx-auto mb-3 text-[#2D4A3E]" />
          Loading copy…
        </div>
      ) : visibleGroups.size === 0 ? (
        <div className="bg-white border border-[#E8E5DF] rounded-2xl p-10 text-center text-[#6D6A65] text-sm" data-testid="copy-empty">
          No keys match your filter.
        </div>
      ) : (
        <div className="space-y-3">
          {Array.from(visibleGroups.entries()).map(([section, rows]) => {
            const isCollapsed = search.trim() ? false : collapsed.has(section);
            const sectionOverrides = rows.filter((r) => overrides[r.key]).length;
            return (
              <div
                key={section}
                className="bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden"
                data-testid={`copy-section-${section.replace(/\s+/g, "-").toLowerCase()}`}
              >
                <button
                  type="button"
                  onClick={() => toggleSection(section)}
                  className="w-full flex items-center justify-between px-5 py-3 bg-[#FDFBF7] border-b border-[#E8E5DF] hover:bg-[#F2EFE9] transition text-left"
                  data-testid={`copy-section-toggle-${section.replace(/\s+/g, "-").toLowerCase()}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <ChevronDown
                      size={16}
                      className={`text-[#6D6A65] transition shrink-0 ${isCollapsed ? "-rotate-90" : ""}`}
                    />
                    <span className="font-medium text-[#2D4A3E] truncate">{section}</span>
                    <span className="text-xs text-[#6D6A65] font-mono">
                      {rows.length} key{rows.length === 1 ? "" : "s"}
                      {sectionOverrides > 0 && (
                        <span className="ml-2 text-[#C87965]">· {sectionOverrides} edited</span>
                      )}
                    </span>
                  </div>
                </button>
                {!isCollapsed && (
                  <table className="w-full text-sm">
                    <tbody>
                      {rows.map((seed) => {
                        const row = overrides[seed.key];
                        const draft = drafts[seed.key];
                        const current = draft != null ? draft : row?.value ?? "";
                        const isOverridden = !!row;
                        return (
                          <tr
                            key={seed.key}
                            className="border-b border-[#E8E5DF] last:border-0 align-top"
                            data-testid={`copy-row-${seed.key}`}
                          >
                            <td className="p-4 w-1/4">
                              <div className="text-[#2B2A29] font-medium break-words">{seed.label}</div>
                              <code className="text-[11px] text-[#6D6A65] break-all">{seed.key}</code>
                              {isOverridden && (
                                <span className="ml-2 text-[10px] text-[#C87965] font-semibold">EDITED</span>
                              )}
                            </td>
                            <td className="p-4 text-xs text-[#6D6A65] w-1/4 break-words">{seed.fallback}</td>
                            <td className="p-4">
                              {seed.fallback.length > 80 ? (
                                <Textarea
                                  rows={3}
                                  value={current}
                                  placeholder="(using default)"
                                  onChange={(e) => setDrafts((d) => ({ ...d, [seed.key]: e.target.value }))}
                                  data-testid={`copy-input-${seed.key}`}
                                />
                              ) : (
                                <Input
                                  value={current}
                                  placeholder="(using default)"
                                  onChange={(e) => setDrafts((d) => ({ ...d, [seed.key]: e.target.value }))}
                                  data-testid={`copy-input-${seed.key}`}
                                />
                              )}
                            </td>
                            <td className="p-4 w-32">
                              <div className="flex flex-col gap-1">
                                <button
                                  type="button"
                                  onClick={() => save(seed.key, current)}
                                  disabled={savingKey === seed.key || (!isOverridden && !current.trim())}
                                  className="text-[#2D4A3E] hover:underline text-xs inline-flex items-center gap-1 disabled:opacity-40 disabled:no-underline"
                                  data-testid={`copy-save-${seed.key}`}
                                >
                                  {savingKey === seed.key ? (
                                    <Loader2 size={11} className="animate-spin" />
                                  ) : (
                                    <Pencil size={11} />
                                  )}
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const payload = encodeURIComponent(
                                      btoa(JSON.stringify({ [seed.key]: current })),
                                    );
                                    const path = seed.previewPath || "/";
                                    const sep = path.includes("?") ? "&" : "?";
                                    const hashIdx = path.indexOf("#");
                                    const url =
                                      hashIdx >= 0
                                        ? `${path.slice(0, hashIdx)}${sep}preview=${payload}${path.slice(hashIdx)}`
                                        : `${path}${sep}preview=${payload}`;
                                    window.open(url, "_blank", "noopener");
                                  }}
                                  disabled={!current.trim()}
                                  className="text-[#C87965] hover:underline text-xs inline-flex items-center gap-1 disabled:opacity-40 disabled:no-underline"
                                  title={`Open ${seed.previewPath || "/"} in a new tab with this override applied`}
                                  data-testid={`copy-preview-${seed.key}`}
                                >
                                  <ExternalLink size={11} />
                                  Preview
                                </button>
                                {isOverridden && (
                                  <button
                                    type="button"
                                    onClick={() => remove(seed.key)}
                                    className="text-[#D45D5D] hover:underline text-xs inline-flex items-center gap-1"
                                    data-testid={`copy-reset-${seed.key}`}
                                  >
                                    <Trash2 size={11} />
                                    Reset
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => hide(seed.key, seed.label)}
                                  className="text-[#A4A29E] hover:text-[#2D4A3E] hover:underline text-xs inline-flex items-center gap-1"
                                  title="Blank this text on the public site (override with empty value)."
                                  data-testid={`copy-hide-${seed.key}`}
                                >
                                  <EyeOff size={11} />
                                  Hide on site
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      )}

      {customKeys.length > 0 && (
        <div
          className="bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden"
          data-testid="custom-keys-section"
        >
          <div className="px-5 py-3 bg-[#FDFBF7] border-b border-[#E8E5DF]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <span className="font-medium text-[#2D4A3E]">Custom keys</span>
                <span className="ml-3 text-xs text-[#6D6A65] font-mono">
                  {customKeys.length} key{customKeys.length === 1 ? "" : "s"}
                </span>
              </div>
              <span className="text-[11px] text-[#6D6A65]">
                Keys you added below — not part of the seed list.
              </span>
            </div>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {customKeys.map((k) => (
                <tr
                  key={k}
                  className="border-b border-[#E8E5DF] last:border-0 align-top"
                  data-testid={`copy-row-${k}`}
                >
                  <td className="p-4 w-1/3">
                    <code className="text-[11px] text-[#6D6A65] break-all">
                      {k}
                    </code>
                    <span className="ml-2 text-[10px] text-[#C87965] font-semibold">
                      CUSTOM
                    </span>
                  </td>
                  <td className="p-4 break-words text-[#2B2A29]">
                    {overrides[k]?.value || (
                      <span className="text-[#A4A29E] italic">
                        (empty — hides on site)
                      </span>
                    )}
                  </td>
                  <td className="p-4 w-32">
                    <button
                      type="button"
                      onClick={() => removeCustom(k)}
                      className="text-[#D45D5D] hover:underline text-xs inline-flex items-center gap-1"
                      data-testid={`copy-delete-custom-${k}`}
                    >
                      <Trash2 size={11} />
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5">
        <h4 className="text-sm font-medium text-[#2B2A29]">Add custom key</h4>
        <p className="text-xs text-[#6D6A65] mt-1">
          Use this when engineering has wired a new key into a page that isn't in the seed list yet.
        </p>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2">
          <Input
            value={customKey}
            onChange={(e) => setCustomKey(e.target.value)}
            placeholder="landing.section.key"
            data-testid="copy-custom-key"
          />
          <Input
            className="md:col-span-2"
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
            placeholder="Override text"
            data-testid="copy-custom-value"
          />
        </div>
        <button
          type="button"
          onClick={addCustom}
          disabled={!customKey.trim()}
          className="tv-btn-primary !py-2 !px-4 text-sm mt-3 disabled:opacity-50"
          data-testid="copy-custom-save-btn"
        >
          Save custom key
        </button>
      </div>
    </div>
  );
}
