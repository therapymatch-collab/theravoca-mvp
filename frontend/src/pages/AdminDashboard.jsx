import { useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Loader2,
  Send,
  RotateCw,
  Sliders,
  ChevronRight,
  X,
  CheckCircle2,
  XCircle,
  Inbox,
  Users,
  UserCheck,
  Pencil,
  MessageSquare,
  Mail,
  UserPlus,
  Star,
  TrendingUp,
  AlertTriangle,
  AlertCircle,
  Search,
  Trash2,
  Copy,
  Share2,
  Ban,
  ChevronDown,
  ChevronUp,
  Sparkles,
  ExternalLink,
  Eye,
  Brain,
  MessageSquareWarning,
  Activity,
} from "lucide-react";
import { Header, Footer } from "@/components/SiteShell";
import { adminClient } from "@/lib/api";
import { AdminClientProvider } from "@/lib/useAdminClient";
import credentialLabel from "@/lib/credentialLabel";
import { imageToDataUrl } from "@/lib/image";
import { ADMIN_POLL_INTERVAL_MS, STATUS_UNAUTHORIZED } from "@/lib/constants";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import OptOutsPanel from "@/pages/admin/panels/OptOutsPanel";import ProfileCompletionPanel from "@/pages/admin/panels/ProfileCompletionPanel";
import TeamPanel from "@/pages/admin/panels/TeamPanel";
import MasterQueryPanel from "@/pages/admin/panels/MasterQueryPanel";
import BlogAdminPanel from "@/pages/admin/panels/BlogAdminPanel";
import SettingsPanel from "@/pages/admin/panels/SettingsPanel";
import ScrapeSourcesPanel from "@/pages/admin/panels/ScrapeSourcesPanel";
import SmsStatusPanel from "@/pages/admin/panels/SmsStatusPanel";
import SiteCopyAdminPanel from "@/pages/admin/panels/SiteCopyAdminPanel";
import HowItWorksPanel from "@/pages/admin/panels/HowItWorksPanel";
import FaqAdminPanel from "@/pages/admin/panels/FaqAdminPanel";
import RequestsPanel from "@/pages/admin/panels/RequestsPanel";
import PendingTherapistsPanel from "@/pages/admin/panels/PendingTherapistsPanel";
import AllProvidersPanel from "@/pages/admin/panels/AllProvidersPanel";
import RequestFullBrief from "@/pages/admin/panels/RequestFullBrief";
import MatchGapPanel from "@/pages/admin/panels/MatchGapPanel";
import MatchedProviderCard from "@/pages/admin/panels/MatchedProviderCard";
import PendingSignupRow from "@/pages/admin/panels/PendingSignupRow";
import ReferralAnalyticsPanel from "@/pages/admin/panels/ReferralAnalyticsPanel";
import CoverageGapPanel from "@/pages/admin/panels/CoverageGapPanel";
import RecruitDraftsPanel from "@/pages/admin/panels/RecruitDraftsPanel";
import PatientsByEmailPanel from "@/pages/admin/panels/PatientsByEmailPanel";
import FeedbackPanel from "@/pages/admin/panels/FeedbackPanel";
import ProviderPreviewCard from "@/pages/admin/panels/ProviderPreviewCard";
import SimulatorPanel from "@/pages/admin/panels/SimulatorPanel";
import { StatBox } from "@/pages/admin/panels/_panelShared";

// ─── Editor option lists (mirrors TherapistSignup) ───
const ISSUES_LIST = [
  "anxiety", "depression", "ocd", "adhd", "trauma_ptsd",
  "relationship_issues", "life_transitions", "parenting_family",
  "substance_use", "eating_concerns", "autism_neurodivergence",
  "school_academic_stress",
];
const MODALITIES_LIST = [
  "CBT", "DBT", "EMDR", "Mindfulness-Based", "Psychodynamic", "ACT",
  "Solution-Focused", "Gottman", "IFS", "Somatic Experiencing", "Person-Centered",
];
const INSURERS_LIST = [
  "Blue Cross of Idaho", "Regence BlueShield of Idaho", "Mountain Health Co-op",
  "PacificSource Health Plans", "SelectHealth", "Aetna", "Cigna", "UnitedHealthcare",
  "Humana", "Idaho Medicaid", "Medicare", "Tricare West", "Optum", "Magellan Health",
];
const CLIENT_TYPES_LIST = ["individual", "couples", "family", "group"];
const AGE_GROUPS_LIST = ["child", "teen", "young_adult", "adult", "older_adult"];
const AVAIL_LIST = [
  "weekday_morning", "weekday_afternoon", "weekday_evening",
  "weekend_morning", "weekend_afternoon",
];
const STYLE_LIST = [
  "structured", "warm_supportive", "direct_practical", "trauma_informed",
  "insight_oriented", "faith_informed", "culturally_responsive", "lgbtq_affirming",
];
const URGENCY_LIST = ["asap", "within_2_3_weeks", "within_month", "full"];
const MODALITY_OFFERING_LIST = ["telehealth", "in_person", "both"];
const IDAHO_CITY_LIST = [
  "Boise", "Meridian", "Nampa", "Idaho Falls", "Pocatello", "Caldwell",
  "Coeur d'Alene", "Twin Falls", "Lewiston", "Post Falls", "Rexburg", "Eagle",
  "Kuna", "Moscow", "Ammon",
];

function PillPicker({ items, selected, onChange, max, testid }) {
  const sel = selected || [];
  return (
    <div className="flex flex-wrap gap-1.5" data-testid={testid}>
      {items.map((it) => {
        const active = sel.includes(it);
        return (
          <button
            key={it}
            type="button"
            data-testid={`${testid}-${it}`}
            onClick={() => {
              if (active) onChange(sel.filter((x) => x !== it));
              else if (max && sel.length >= max) return;
              else onChange([...sel, it]);
            }}
            className={`text-xs px-2.5 py-1 rounded-full border transition ${
              active
                ? "bg-[#2D4A3E] text-white border-[#2D4A3E]"
                : "bg-[#FDFBF7] text-[#2B2A29] border-[#E8E5DF] hover:border-[#2D4A3E]"
            }`}
          >
            {it.replace(/_/g, " ")}
          </button>
        );
      })}
    </div>
  );
}
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

export default function AdminDashboard() {
  const navigate = useNavigate();
  const pwd = sessionStorage.getItem("tv_admin_pwd");
  const adminToken = sessionStorage.getItem("tv_admin_token");
  const adminEmail = sessionStorage.getItem("tv_admin_email");
  const adminName = sessionStorage.getItem("tv_admin_name");
  // Memoize the axios client so it has a stable reference across renders.
  // Without this, every parent re-render (poll, state change, etc.)
  // would mint a new client object and trigger any `[client]`-deps
  // useEffect inside child panels (e.g. SettingsPanel re-loading the
  // rate-limit form mid-typing and overwriting the user's input).
  const client = useMemo(() => adminClient(pwd), [pwd]);
  const [stats, setStats] = useState(null);
  const [requests, setRequests] = useState([]);
  const [pendingTherapists, setPendingTherapists] = useState([]);
  const [allTherapists, setAllTherapists] = useState([]);
  const [patientsByEmail, setPatientsByEmail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("requests");
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [editTherapist, setEditTherapist] = useState(null);
  // Patient-preview modal: opened from the "Preview" button on each
  // provider row so admins can see what patients will see.
  const [previewTherapist, setPreviewTherapist] = useState(null);
  const [savingTherapist, setSavingTherapist] = useState(false);
  const [emailTemplates, setEmailTemplates] = useState([]);
  const [editingTplKey, setEditingTplKey] = useState(null);
  const [tplFields, setTplFields] = useState({});
  const [savingTpl, setSavingTpl] = useState(false);
  // Email template preview modal — html string is the rendered email
  // (full <html> doc) returned from POST /api/admin/email-templates/{key}/preview
  const [previewTpl, setPreviewTpl] = useState(null); // {key, subject, html, loading}
  // Referral source analytics
  const [refSources, setRefSources] = useState(null);
  const [refStart, setRefStart] = useState("");
  const [refEnd, setRefEnd] = useState("");
  const [refLoading, setRefLoading] = useState(false);
  // Admin-managed dropdown options for the patient intake's "How did you hear" field
  const [refOptions, setRefOptions] = useState([]);
  const [refOptionsLoaded, setRefOptionsLoaded] = useState(false);
  const [refNewOption, setRefNewOption] = useState("");
  const [refSavingOptions, setRefSavingOptions] = useState(false);
  // LLM outreach invites — therapists we scraped + emailed (separate from in-app signups)
  const [outreach, setOutreach] = useState(null);
  const [outreachLoading, setOutreachLoading] = useState(false);
  const [outreachShowAll, setOutreachShowAll] = useState(false);
  const [convertingInviteId, setConvertingInviteId] = useState(null);
  const [optOuts, setOptOuts] = useState(null);
  const [optOutsLoading, setOptOutsLoading] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [team, setTeam] = useState(null);
  const [completion, setCompletion] = useState(null);
  const [showOnlyReapproval, setShowOnlyReapproval] = useState(false);
  const [providerPageSize, setProviderPageSize] = useState(20);
  const [providerPage, setProviderPage] = useState(0);
  const { visibleCols, setVisibleCols, defaultCols, setDefaultCols } = useProviderColumnPrefs();

  // Coverage-gap analysis — recruiting recommendations.
  const [coverageGap, setCoverageGap] = useState(null);
  const [coverageGapLoading, setCoverageGapLoading] = useState(false);
  // Pre-launch recruit drafts (LLM-generated candidates for each gap).
  const [recruitDrafts, setRecruitDrafts] = useState(null);
  const [recruitDraftsLoading, setRecruitDraftsLoading] = useState(false);
  const [generatingDrafts, setGeneratingDrafts] = useState(false);
  // Patient + therapist referral analytics.
  const [referralAnalytics, setReferralAnalytics] = useState(null);
  const [referralAnalyticsLoading, setReferralAnalyticsLoading] = useState(false);

  // Per-tab search query — filters whatever list is open.
  const [search, setSearch] = useState("");
  useEffect(() => setSearch(""), [tab]);

  // ── Search filter helpers ──
  const matches = useCallback((needle, ...haystacks) => {
    if (!needle) return true;
    const q = needle.toLowerCase();
    return haystacks.some((h) =>
      h && String(h).toLowerCase().includes(q),
    );
  }, []);

  const filteredRequests = useMemo(
    () => requests.filter((r) =>
      matches(search, r.email, r.location_state, r.location_zip,
        r.referral_source, r.status, r.client_type, r.age_group,
        (r.presenting_issues || []).join(" ")),
    ),
    [requests, search, matches],
  );
  const filteredPendingTherapists = useMemo(
    () => pendingTherapists.filter((t) => {
      if (!search) return true;
      return matches(
        search,
        t.name, t.email, t.real_email, t.phone, t.bio,
        t.credential_type,
        credentialLabel(t.credential_type || ""),
        t.license_number, t.subscription_status,
        (t.modalities || []).join(" "),
        (t.primary_specialties || []).join(" "),
        (t.secondary_specialties || []).join(" "),
        (t.office_locations || []).join(" "),
        (t.languages_spoken || []).join(" "),
        (t.insurance_accepted || []).join(" "),
        (t.licensed_states || []).join(" "),
      );
    }),
    [pendingTherapists, search, matches],
  );
  const filteredAllTherapists = useMemo(
    () => allTherapists.filter((t) => {
      if (!search) return true;
      // Wide search: stitch together every text-bearing field on the
      // therapist record so admins can find providers by typing any
      // attribute (e.g. "psychologist", "telehealth", "trauma",
      // "Boise", "aetna", "spanish"). We also fold in the humanized
      // credential label (PsyD/PhD → Psychologist, LCSW → Social Worker)
      // so credential-type queries match the friendly word the patient sees.
      const haystack = [
        t.name,
        t.email,
        t.real_email,
        t.phone,
        t.office_phone,
        t.bio,
        t.credential_type,
        credentialLabel(t.credential_type || ""),
        t.license_number,
        t.gender,
        t.subscription_status,
        t.modality_offering,
        t.urgency_capacity,
        t.research_summary,
        t.research_depth_signal,
        t.review_research_source,
        t.website,
        t.google_place_name,
        t.google_place_address,
        t.source,
        (t.modalities || []).join(" "),
        (t.primary_specialties || []).join(" "),
        (t.secondary_specialties || []).join(" "),
        (t.general_treats || []).join(" "),
        (t.style_tags || []).join(" "),
        (t.research_style_signals || []).join(" "),
        (t.office_locations || []).join(" "),
        (t.office_addresses || []).join(" "),
        (t.licensed_states || []).join(" "),
        (t.languages_spoken || []).join(" "),
        (t.insurance_accepted || []).join(" "),
        (t.client_types || []).join(" "),
        (t.age_groups || []).join(" "),
        (t.availability_windows || []).join(" "),
        t.telehealth ? "telehealth virtual online" : "",
        t.offers_in_person ? "in-person in person office" : "",
        t.free_consult ? "free consult" : "",
        t.sliding_scale ? "sliding scale" : "",
        t.cash_rate ? `$${t.cash_rate}` : "",
        t.years_experience ? `${t.years_experience} years` : "",
      ];
      return matches(search, ...haystack);
    }),
    [allTherapists, search, matches],
  );
  const filteredOutreach = useMemo(() => {
    if (!outreach) return outreach;
    return {
      ...outreach,
      invites: (outreach.invites || []).filter((inv) =>
        matches(search, inv?.candidate?.name, inv?.candidate?.email,
          inv?.candidate?.city, (inv?.candidate?.specialties || []).join(" "),
          (inv?.candidate?.modalities || []).join(" "), inv?.status),
      ),
    };
  }, [outreach, search, matches]);

  const refresh = useCallback(async () => {
    try {
      const [s, r, pt, allT] = await Promise.all([
        client.get("/admin/stats"),
        client.get("/admin/requests"),
        client.get("/admin/therapists?pending=true"),
        client.get("/admin/therapists"),
      ]);
      setStats(s.data);
      setRequests(r.data);
      setPendingTherapists(pt.data);
      setAllTherapists(allT.data);
    } catch (e) {
      if (e?.response?.status === STATUS_UNAUTHORIZED) {
        sessionStorage.removeItem("tv_admin_pwd");
        sessionStorage.removeItem("tv_admin_token");
        sessionStorage.removeItem("tv_admin_email");
        sessionStorage.removeItem("tv_admin_name");
        navigate("/admin");
      }
    } finally {
      setLoading(false);
    }
  }, [client, navigate]);

  useEffect(() => {
    // Either auth mode is acceptable: master env password OR a per-user JWT.
    if (!pwd && !adminToken) {
      navigate("/admin");
      return;
    }
    refresh();
    const intervalId = setInterval(refresh, ADMIN_POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [pwd, adminToken, navigate, refresh]);

  const openDetail = async (id) => {
    setOpenId(id);
    setDetail(null);
    try {
      const res = await client.get(`/admin/requests/${id}`);
      setDetail(res.data);
    } catch {
      toast.error("Failed to load detail");
    }
  };

  const triggerResults = async (id) => {
    try {
      const res = await client.post(`/admin/requests/${id}/trigger-results`);
      toast.success(`Results emailed to patient (${res.data.count} matches)`);
      refresh();
      if (openId === id) openDetail(id);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    }
  };

  const resend = async (id) => {
    try {
      const res = await client.post(`/admin/requests/${id}/resend-notifications`);
      toast.success(`Notified ${res.data.notified} therapists`);
      refresh();
      if (openId === id) openDetail(id);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    }
  };

  const runOutreachNow = async (id) => {
    if (!confirm(
      "Run LLM outreach for this patient now?\n\n" +
      "Searches our external directory pool + Claude for additional Idaho therapists who match this patient's brief, " +
      "then queues invite emails (or SMS for therapists with no public email) to fill the gap. " +
      "Use this if the auto-trigger didn't run or the directory had < 30 matches."
    )) return;
    try {
      const res = await client.post(`/admin/requests/${id}/run-outreach`);
      const emails = res.data?.emails_sent ?? 0;
      const smsCt = res.data?.sms_sent ?? 0;
      const found = res.data?.candidates_found ?? 0;
      const parts = [];
      if (emails > 0) parts.push(`${emails} email${emails === 1 ? "" : "s"}`);
      if (smsCt > 0) parts.push(`${smsCt} SMS`);
      const sentDesc = parts.join(" + ") || "0 sent";
      toast.success(`Outreach: ${found} candidate(s) found, ${sentDesc}`);
      refresh();
      if (openId === id) openDetail(id);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Outreach failed");
    }
  };

  const updateThreshold = async (id, threshold) => {
    try {
      await client.put(`/admin/requests/${id}/threshold`, { threshold });
      toast.success(`Threshold set to ${threshold}%`);
      refresh();
      if (openId === id) openDetail(id);
    } catch (e) {
      toast.error("Failed");
    }
  };

  const approveTherapist = async (id) => {
    try {
      await client.post(`/admin/therapists/${id}/approve`);
      toast.success("Therapist approved");
      refresh();
    } catch (e) {
      toast.error("Failed to approve");
    }
  };

  const rejectTherapist = async (id) => {
    try {
      await client.post(`/admin/therapists/${id}/reject`);
      toast.success("Therapist rejected");
      refresh();
    } catch (e) {
      toast.error("Failed to reject");
    }
  };

  const archiveTherapist = async (t) => {
    if (!window.confirm(
      `Archive "${t.name}"?\n\nThey'll be hidden from matching but their history (past matches, applications) stays intact. You can restore them later.`,
    )) return;
    try {
      await client.post(`/admin/therapists/${t.id}/archive`);
      toast.success(`${t.name} archived`);
      refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to archive");
    }
  };

  const restoreTherapist = async (t) => {
    try {
      await client.post(`/admin/therapists/${t.id}/restore`);
      toast.success(`${t.name} restored — back in matching`);
      refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to restore");
    }
  };

  const deleteTherapist = async (t) => {
    if (!window.confirm(
      `HARD DELETE "${t.name}"?\n\nThis is irreversible. If they have any applications on file, the request will fail and you'll need to archive instead.\n\nProceed?`,
    )) return;
    try {
      const res = await client.delete(`/admin/therapists/${t.id}`);
      const stale = res.data?.stale_invites || 0;
      toast.success(
        `${t.name} deleted${stale ? ` (${stale} stale invite${stale === 1 ? "" : "s"} remain)` : ""}`,
      );
      refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to delete");
    }
  };

  // Deep web-research for ONE therapist — DDG search + 5 page fetches +
  // LLM evidence extraction. Slow (~30-60s) so we show a loader on the row.
  const deepResearchTherapist = async (t) => {
    try {
      const tStart = Date.now();
      const res = await client.post(
        `/admin/research-enrichment/deep/${t.id}`,
        {},
        { timeout: 90000 },
      );
      const sec = Math.round((Date.now() - tStart) / 1000);
      toast.success(
        `Deep research done — ${(res.data?.extra_sources || []).length} sources in ${sec}s`,
      );
      return res.data;
    } catch (e) {
      toast.error(
        e?.response?.data?.detail || e.message || "Deep research failed",
      );
      return null;
    }
  };

  const saveTherapist = async () => {
    if (!editTherapist) return;
    setSavingTherapist(true);
    try {
      const { id, ...payload } = editTherapist;
      await client.put(`/admin/therapists/${id}`, payload);
      toast.success("Therapist updated");
      setEditTherapist(null);
      refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to update therapist");
    } finally {
      setSavingTherapist(false);
    }
  };

  // Clear the `pending_reapproval` flag once the admin has eyeballed the
  // therapist's self-edit and is happy to publish it. This is the
  // counterpart to the orange "⚠ Re-review: …" badge in the row — that
  // badge tells the admin WHICH fields changed, this action says "yes,
  // ship those changes to patients". Backend route also stamps
  // `reapproved_at` so we have an audit trail.
  const approveReapproval = async (therapistId) => {
    if (!therapistId) return;
    try {
      await client.post(`/admin/therapists/${therapistId}/clear-reapproval`);
      toast.success("Changes approved — therapist is live again");
      // Reflect the cleared state in the open modal so the banner disappears
      // immediately without waiting for the full /admin/therapists refresh.
      setEditTherapist((cur) =>
        cur && cur.id === therapistId
          ? {
              ...cur,
              pending_reapproval: false,
              pending_reapproval_fields: [],
            }
          : cur,
      );
      refresh();
    } catch (e) {
      toast.error(
        e?.response?.data?.detail || "Failed to approve changes",
      );
    }
  };

  const sendTestSms = async () => {
    try {
      const res = await client.post("/admin/test-sms", {});
      if (res.data?.ok && res.data?.final_status === "delivered") {
        toast.success(`SMS delivered ✓ — sid ${res.data.sid?.slice(0, 12)}…`);
      } else if (res.data?.error_code) {
        toast.error(
          `SMS ${res.data.final_status || "failed"} (Twilio err ${res.data.error_code}): ${res.data.troubleshooting_hint || res.data.error_message || ""}`,
          { duration: 12000 },
        );
      } else if (res.data?.ok) {
        toast.success(
          `SMS queued — sid ${res.data.sid?.slice(0, 12)}… (status: ${res.data.final_status || "pending"})`,
        );
      } else {
        toast.error(res.data?.detail || "SMS send returned no result");
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "SMS send failed");
    }
  };

  const runBackfill = async () => {
    if (!confirm(
      "Backfill ALL therapist profiles with realistic fake data + therapymatch+tNNN@gmail.com emails?\n\nThis is idempotent (only fills missing fields).\n\nNote: every backfill pass writes a `_backfill_audit` record so you can later run \"Strip backfilled data\" to restore real emails before going live."
    )) return;
    try {
      const res = await client.post("/admin/backfill-therapists", {});
      toast.success(`Backfill done — ${res.data.updated}/${res.data.scanned} updated`);
      refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Backfill failed");
    }
  };

  const stripBackfill = async () => {
    // Two-step confirmation since this is destructive: first fetch status
    // so the admin sees how many will actually restore, then prompt with
    // those concrete numbers before firing.
    let status;
    try {
      const r = await client.get("/admin/backfill-status");
      status = r.data;
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't fetch backfill status");
      return;
    }
    if (status.restorable_count === 0) {
      alert(
        `No therapists are eligible for restoration.\n\n` +
        `Total backfilled: ${status.backfilled}\n` +
        `Therapists whose pre-backfill email was a real address: ${status.restorable_count}\n\n` +
        `Run "Backfill profiles" only AFTER you've added real therapist emails — otherwise the audit captures placeholder emails and there's nothing to restore.`,
      );
      return;
    }
    const ok = confirm(
      `STRIP BACKFILLED DATA — pre-launch reversal\n\n` +
      `This will:\n` +
      `  • Restore ${status.restorable_count} therapists' REAL email addresses\n` +
      `  • REMOVE every field that backfill itself populated (bio, specialties, modalities, availability, etc.)\n` +
      `  • Skip ${status.stripping_will_skip} therapists whose pre-backfill email was already a placeholder\n\n` +
      `User-edited fields are NEVER touched.\n\n` +
      `Proceed?`,
    );
    if (!ok) return;
    try {
      const res = await client.post("/admin/strip-backfill", {});
      toast.success(
        `Stripped — restored ${res.data.restored}, skipped ${res.data.skipped_no_real_email}.`,
      );
      refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Strip failed");
    }
  };

  const [researchingReviews, setResearchingReviews] = useState(false);
  const runReviewResearch = async () => {
    if (!confirm(
      "Run LLM review research across all active therapists who haven't been researched in 30+ days?\n\n" +
      "This calls Claude Sonnet 4.5 to recall public review data across the open web. " +
      "It can take several minutes for large batches. Found data is folded into the matching score automatically."
    )) return;
    setResearchingReviews(true);
    try {
      const res = await client.post("/admin/therapists/research-reviews-all", { limit: 100 });
      toast.success(
        `Researched ${res.data.researched} therapists — ${res.data.with_data} had verifiable review data.`,
      );
      refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Review research failed");
    } finally {
      setResearchingReviews(false);
    }
  };

  const releaseResults = async (rid) => {
    try {
      await client.post(`/admin/requests/${rid}/release-results`, {});
      toast.success("Results released to patient");
      if (openId === rid) {
        const d = await client.get(`/admin/requests/${rid}`);
        setDetail(d.data);
      }
      refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Release failed");
    }
  };


  const loadEmailTemplates = async () => {
    try {
      const res = await client.get("/admin/email-templates");
      setEmailTemplates(res.data);
    } catch (e) {
      toast.error("Failed to load email templates");
    }
  };

  const startEditTpl = (key) => {
    const t = emailTemplates.find((x) => x.key === key);
    if (!t) return;
    setEditingTplKey(key);
    setTplFields({
      subject: t.subject || "",
      heading: t.heading || "",
      greeting: t.greeting || "",
      intro: t.intro || "",
      cta_label: t.cta_label || "",
      footer_note: t.footer_note || "",
    });
  };

  const saveTpl = async () => {
    if (!editingTplKey) return;
    setSavingTpl(true);
    try {
      await client.put(`/admin/email-templates/${editingTplKey}`, tplFields);
      toast.success("Template saved");
      setEditingTplKey(null);
      await loadEmailTemplates();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally {
      setSavingTpl(false);
    }
  };

  // Render the template (with the live draft, if the editor is open
  // for this key) and surface the result in the preview modal. Used
  // both from the row "Preview" button and from a button inside the
  // edit dialog so admins can iterate on copy WYSIWYG-style.
  const openTplPreview = async (key, draft) => {
    setPreviewTpl({ key, subject: "", html: "", loading: true });
    try {
      const res = await client.post(
        `/admin/email-templates/${key}/preview`,
        { draft: draft || null },
      );
      setPreviewTpl({
        key,
        subject: res.data?.subject || "",
        html: res.data?.html || "",
        loading: false,
      });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Preview failed");
      setPreviewTpl(null);
    }
  };

  const loadReferralSources = useCallback(
    async (s = refStart, e = refEnd) => {
      setRefLoading(true);
      try {
        const params = new URLSearchParams();
        if (s) params.set("start", new Date(s).toISOString());
        if (e) params.set("end", new Date(e + "T23:59:59").toISOString());
        const res = await client.get(
          `/admin/referral-sources${params.toString() ? `?${params}` : ""}`,
        );
        setRefSources(res.data);
      } catch (err) {
        toast.error(err?.response?.data?.detail || "Failed to load referral sources");
      } finally {
        setRefLoading(false);
      }
    },
    [client, refStart, refEnd],
  );

  const loadRefOptions = useCallback(async () => {
    try {
      const res = await client.get("/admin/referral-source-options");
      setRefOptions(res.data?.options || []);
      setRefOptionsLoaded(true);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Couldn't load options");
    }
  }, [client]);

  const loadOutreach = useCallback(async () => {
    setOutreachLoading(true);
    try {
      const res = await client.get("/admin/outreach");
      setOutreach(res.data);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Couldn't load invited therapists");
    } finally {
      setOutreachLoading(false);
    }
  }, [client]);

  const loadOptOuts = useCallback(async () => {
    setOptOutsLoading(true);
    try {
      const res = await client.get("/admin/outreach/opt-outs");
      setOptOuts(res.data);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Couldn't load opt-outs");
    } finally {
      setOptOutsLoading(false);
    }
  }, [client]);

  const loadFeedback = useCallback(async () => {
    setFeedbackLoading(true);
    try {
      const res = await client.get("/admin/feedback");
      setFeedback(res.data);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Couldn't load feedback");
    } finally {
      setFeedbackLoading(false);
    }
  }, [client]);

  const loadPatientsByEmail = useCallback(async () => {
    try {
      const res = await client.get("/admin/patients");
      setPatientsByEmail(res.data);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Couldn't load patient list");
    }
  }, [client]);

  const loadTeam = useCallback(async () => {
    try {
      const res = await client.get("/admin/team");
      setTeam(res.data);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Couldn't load team list");
    }
  }, [client]);

  const loadCompletion = useCallback(async () => {
    try {
      const res = await client.get("/admin/profile-completeness");
      setCompletion(res.data);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Couldn't load completion roster");
    }
  }, [client]);

  const loadCoverageGap = useCallback(async () => {
    setCoverageGapLoading(true);
    try {
      const res = await client.get("/admin/coverage-gap-analysis");
      setCoverageGap(res.data);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Couldn't load gap analysis");
    } finally {
      setCoverageGapLoading(false);
    }
  }, [client]);

  const loadRecruitDrafts = useCallback(async () => {
    setRecruitDraftsLoading(true);
    try {
      const res = await client.get("/admin/gap-recruit/drafts");
      setRecruitDrafts(res.data);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Couldn't load drafts");
    } finally {
      setRecruitDraftsLoading(false);
    }
  }, [client]);

  const generateRecruitDrafts = useCallback(async () => {
    setGeneratingDrafts(true);
    try {
      const res = await client.post(
        "/admin/gap-recruit/run",
        { dry_run: true, max_drafts: 15 },
      );
      toast.success(
        `Generated ${res.data.drafts_created} new draft(s) for ${res.data.gaps_processed} gap(s).`,
      );
      await loadRecruitDrafts();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Recruit run failed");
    } finally {
      setGeneratingDrafts(false);
    }
  }, [client, loadRecruitDrafts]);

  const deleteRecruitDraft = useCallback(
    async (id) => {
      try {
        await client.delete(`/admin/gap-recruit/drafts/${id}`);
        await loadRecruitDrafts();
      } catch (err) {
        toast.error(err?.response?.data?.detail || "Couldn't delete draft");
      }
    },
    [client, loadRecruitDrafts],
  );

  const sendAllRecruitDrafts = useCallback(async () => {
    if (!confirm(
      "Send ALL pending non-dry-run recruit drafts via Resend?\n\n" +
      "Pre-launch all drafts are dry_run=true (fake emails), so this will report 0 sent."
    )) return;
    try {
      const res = await client.post("/admin/gap-recruit/send-all");
      toast.success(`Sent ${res.data.sent || 0}, failed ${res.data.failed || 0}`);
      await loadRecruitDrafts();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Send failed");
    }
  }, [client, loadRecruitDrafts]);

  const sendPreviewRecruitDrafts = useCallback(async () => {
    if (!confirm(
      "Send 3 SAMPLE preview recruit emails via Resend?\n\n" +
      "These go to the draft's fake therapymatch+recruitNNN@gmail.com address — they'll land in your therapymatch@gmail.com inbox via Gmail's +alias trick. Subject prefixed [PREVIEW] for easy filtering."
    )) return;
    try {
      const res = await client.post("/admin/gap-recruit/send-preview", { limit: 3 });
      const names = (res.data.previewed || []).map((p) => p.name).join(", ");
      toast.success(`Sent ${res.data.sent} preview email(s): ${names}`);
      await loadRecruitDrafts();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Preview send failed");
    }
  }, [client, loadRecruitDrafts]);

  const loadReferralAnalytics = useCallback(async () => {
    setReferralAnalyticsLoading(true);
    try {
      const res = await client.get("/admin/referral-analytics");
      setReferralAnalytics(res.data);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Couldn't load referral analytics");
    } finally {
      setReferralAnalyticsLoading(false);
    }
  }, [client]);

  const convertInvite = useCallback(
    async (invite) => {
      const inviteId = invite?.id;
      const cand = invite?.candidate || {};
      if (!inviteId) return;
      const ok = window.confirm(
        `Convert "${cand.name || "this invite"}" to a draft therapist profile?\n\n` +
        `This creates an INVITED therapist record (carries name/email/license/specialties), ` +
        `which the admin can then approve once they finish onboarding.`,
      );
      if (!ok) return;
      setConvertingInviteId(inviteId);
      try {
        const res = await client.post(`/admin/outreach/${inviteId}/convert`);
        toast.success(
          `Converted to therapist (id ${(res.data?.therapist_id || "").slice(0, 8)}…)`,
        );
        await loadOutreach();
        // Also refresh the open detail dialog so the inline card flips to "Converted"
        if (openId) {
          try {
            const r = await client.get(`/admin/requests/${openId}`);
            setDetail(r.data);
          } catch {
            // non-fatal — dialog will re-fetch on next open
          }
        }
      } catch (err) {
        toast.error(err?.response?.data?.detail || "Conversion failed");
      } finally {
        setConvertingInviteId(null);
      }
    },
    [client, loadOutreach, openId],
  );

  const saveRefOptions = async (next) => {
    setRefSavingOptions(true);
    try {
      const res = await client.put("/admin/referral-source-options", {
        options: next,
      });
      setRefOptions(res.data?.options || []);
      toast.success("Saved");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Save failed");
    } finally {
      setRefSavingOptions(false);
    }
  };

  return (
    <AdminClientProvider password={pwd}>
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <Header />
      <main className="flex-1 px-5 py-10 md:py-14" data-testid="admin-dashboard">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-[#C87965]">
                Admin
              </p>
              <h1 className="font-serif-display text-4xl text-[#2D4A3E] mt-1">
                Operations
              </h1>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                className="tv-btn-secondary !py-2 !px-4 text-sm"
                onClick={runBackfill}
                data-testid="backfill-btn"
                title="Complete every therapist profile with realistic fake data"
              >
                Backfill profiles
              </button>
              <button
                className="!py-2 !px-4 text-sm rounded-md border border-[#D45D5D] text-[#D45D5D] bg-white hover:bg-[#D45D5D] hover:text-white transition"
                onClick={stripBackfill}
                data-testid="strip-backfill-btn"
                title="Pre-launch reversal: restore real emails + remove all fields backfill added. User-edited fields are preserved."
              >
                Strip backfilled data
              </button>
              <button
                className="tv-btn-secondary !py-2 !px-4 text-sm disabled:opacity-60"
                onClick={runReviewResearch}
                disabled={researchingReviews}
                data-testid="research-reviews-btn"
                title="LLM-research public reviews for therapists (folds into match score)"
              >
                {researchingReviews ? (
                  <Loader2 size={14} className="inline mr-1.5 animate-spin" />
                ) : (
                  <Star size={14} className="inline mr-1.5" />
                )}
                Research reviews
              </button>
              <button
                className="tv-btn-secondary !py-2 !px-4 text-sm"
                onClick={sendTestSms}
                data-testid="test-sms-btn"
                title="Send a test SMS to the configured Twilio dev override number"
              >
                <MessageSquare size={14} className="inline mr-1.5" /> Test SMS
              </button>
              <button
                className="tv-btn-secondary !py-2 !px-4 text-sm"
                onClick={refresh}
                data-testid="refresh-btn"
              >
                <RotateCw size={14} className="inline mr-1.5" /> Refresh
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="animate-spin text-[#2D4A3E]" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-7 gap-4 mt-8">
                <StatBox label="Requests" value={stats?.total_requests} />
                <StatBox label="Pending" value={stats?.pending} />
                <StatBox label="Open" value={stats?.open} />
                <StatBox label="Completed" value={stats?.completed} />
                <StatBox label="Therapists" value={stats?.therapists} />
                <StatBox
                  label="Pending review"
                  value={stats?.pending_therapists}
                  highlight={stats?.pending_therapists > 0}
                />
                <StatBox label="Applications" value={stats?.applications} />
              </div>

              <AdminTabsBar
                tab={tab}
                setTab={setTab}
                requestsCount={requests.length}
                pendingTherapists={pendingTherapists.length}
                allTherapists={allTherapists.length}
                emailTemplatesCount={emailTemplates.length || null}
                onLoadEmailTemplates={loadEmailTemplates}
                refSources={refSources}
                onLoadReferralSources={() => {
                  if (!refSources) loadReferralSources();
                  if (!refOptionsLoaded) loadRefOptions();
                }}
                outreach={outreach}
                onLoadOutreach={() => {
                  if (!outreach) loadOutreach();
                }}
                optOuts={optOuts}
                onLoadOptOuts={() => {
                  if (!optOuts) loadOptOuts();
                }}
                feedback={feedback}
                onLoadFeedback={() => {
                  if (!feedback) loadFeedback();
                }}
                patientsByEmail={patientsByEmail}
                onLoadPatients={() => {
                  if (!patientsByEmail) loadPatientsByEmail();
                }}
                team={team}
                onLoadTeam={() => {
                  if (!team) loadTeam();
                }}
                completion={completion}
                onLoadCompletion={() => {
                  if (!completion) loadCompletion();
                }}
                coverageGap={coverageGap}
                onLoadCoverageGap={() => {
                  if (!coverageGap) loadCoverageGap();
                  if (!recruitDrafts) loadRecruitDrafts();
                }}
                referralAnalytics={referralAnalytics}
                onLoadReferralAnalytics={() => {
                  if (!referralAnalytics) loadReferralAnalytics();
                }}
              />

              {/* Per-tab search — applies a substring filter to whichever list is open */}
              <div className="mt-4 flex items-center gap-2 max-w-md" data-testid="admin-search-wrap">
                <div className="relative flex-1">
                  <Search
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6D6A65] pointer-events-none"
                  />
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={`Search ${tab.replace("_", " ")}…`}
                    className="w-full bg-white border border-[#E8E5DF] rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[#2D4A3E]"
                    data-testid="admin-search-input"
                  />
                </div>
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="text-xs text-[#6D6A65] underline hover:text-[#2D4A3E]"
                    data-testid="admin-search-clear"
                  >
                    Clear
                  </button>
                )}
              </div>

              {tab === "requests" && (
                <RequestsPanel
                  requests={requests}
                  filteredRequests={filteredRequests}
                  openDetail={openDetail}
                  StatusBadge={StatusBadge}
                />
              )}

              {tab === "therapists" && (
                <PendingTherapistsPanel
                  client={client}
                  pendingTherapists={pendingTherapists}
                  filteredPendingTherapists={filteredPendingTherapists}
                  PendingSignupRow={PendingSignupRow}
                  onApprove={approveTherapist}
                  onReject={rejectTherapist}
                  onEdit={(t) => setEditTherapist({ ...t })}
                  onPreview={(t) => setPreviewTherapist(t)}
                  onReload={refresh}
                />
              )}

              {tab === "all_therapists" && (
                <AllProvidersPanel
                  allTherapists={allTherapists}
                  filteredAllTherapists={filteredAllTherapists}
                  showOnlyReapproval={showOnlyReapproval}
                  setShowOnlyReapproval={setShowOnlyReapproval}
                  providerPageSize={providerPageSize}
                  setProviderPageSize={setProviderPageSize}
                  providerPage={providerPage}
                  setProviderPage={setProviderPage}
                  visibleCols={visibleCols}
                  setVisibleCols={setVisibleCols}
                  defaultCols={defaultCols}
                  setDefaultCols={setDefaultCols}
                  PROVIDER_COLUMNS={PROVIDER_COLUMNS}
                  ProviderTableControls={ProviderTableControls}
                  ProviderRow={ProviderRow}
                  ProviderTablePager={ProviderTablePager}
                  onEdit={(t) => setEditTherapist({ ...t })}
                  onPreview={(t) => setPreviewTherapist(t)}
                  onArchive={archiveTherapist}
                  onRestore={restoreTherapist}
                  onDelete={deleteTherapist}
                  onDeepResearch={deepResearchTherapist}
                />
              )}
              {tab === "referral_sources" && (
                <div className="mt-6 space-y-4" data-testid="referral-sources-panel">
                  <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5" data-testid="ref-options-editor">
                    <div className="flex items-baseline justify-between gap-3 flex-wrap">
                      <div>
                        <h3 className="font-medium text-[#2B2A29]">
                          Patient intake dropdown options
                        </h3>
                        <p className="text-xs text-[#6D6A65] mt-0.5">
                          These appear on the patient form's "How did you hear about us?" select.
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {refOptions.map((opt, i) => (
                        <span
                          key={`${opt}-${i}`}
                          className="inline-flex items-center gap-1.5 text-sm bg-[#FDFBF7] border border-[#E8E5DF] text-[#2B2A29] px-3 py-1.5 rounded-full"
                          data-testid={`ref-option-${i}`}
                        >
                          {opt}
                          <button
                            type="button"
                            className="text-[#6D6A65] hover:text-[#D45D5D] -mr-1"
                            disabled={refSavingOptions || refOptions.length <= 1}
                            onClick={() =>
                              saveRefOptions(refOptions.filter((o) => o !== opt))
                            }
                            data-testid={`ref-option-delete-${i}`}
                            aria-label={`Remove ${opt}`}
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="mt-4 flex gap-2">
                      <Input
                        value={refNewOption}
                        onChange={(e) => setRefNewOption(e.target.value)}
                        placeholder="Add a new option (e.g. Reddit)"
                        className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                        data-testid="ref-option-new"
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && refNewOption.trim()) {
                            const n = refNewOption.trim();
                            if (!refOptions.includes(n)) {
                              saveRefOptions([...refOptions, n]);
                            }
                            setRefNewOption("");
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="tv-btn-primary !py-2 !px-4 text-sm shrink-0"
                        disabled={refSavingOptions || !refNewOption.trim()}
                        onClick={() => {
                          const n = refNewOption.trim();
                          if (!n) return;
                          if (refOptions.includes(n)) {
                            toast.error("Already in the list");
                            return;
                          }
                          saveRefOptions([...refOptions, n]);
                          setRefNewOption("");
                        }}
                        data-testid="ref-option-add"
                      >
                        {refSavingOptions ? "Saving…" : "Add"}
                      </button>
                    </div>
                  </div>
                  <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5 flex flex-wrap items-end gap-3">
                    <div className="flex-1 min-w-[160px]">
                      <label className="block text-[11px] uppercase tracking-wider text-[#6D6A65] mb-1">
                        Start date
                      </label>
                      <Input
                        type="date"
                        value={refStart}
                        onChange={(e) => setRefStart(e.target.value)}
                        className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                        data-testid="ref-source-start"
                      />
                    </div>
                    <div className="flex-1 min-w-[160px]">
                      <label className="block text-[11px] uppercase tracking-wider text-[#6D6A65] mb-1">
                        End date
                      </label>
                      <Input
                        type="date"
                        value={refEnd}
                        onChange={(e) => setRefEnd(e.target.value)}
                        className="bg-[#FDFBF7] border-[#E8E5DF] rounded-xl"
                        data-testid="ref-source-end"
                      />
                    </div>
                    <button
                      type="button"
                      className="tv-btn-primary !py-2 !px-4 text-sm"
                      onClick={() => loadReferralSources()}
                      disabled={refLoading}
                      data-testid="ref-source-apply"
                    >
                      {refLoading ? "Loading…" : "Apply filter"}
                    </button>
                    {(refStart || refEnd) && (
                      <button
                        type="button"
                        className="text-sm text-[#6D6A65] hover:text-[#2D4A3E] underline"
                        onClick={() => {
                          setRefStart("");
                          setRefEnd("");
                          loadReferralSources("", "");
                        }}
                        data-testid="ref-source-clear"
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  <div className="bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden">
                    {refLoading || !refSources ? (
                      <div className="p-12 text-center text-[#6D6A65]">
                        <Loader2 className="animate-spin mx-auto mb-3 text-[#2D4A3E]" />
                        Loading referral sources…
                      </div>
                    ) : (
                      <>
                        <div className="px-5 py-4 border-b border-[#E8E5DF] flex items-baseline justify-between">
                          <h3 className="font-medium text-[#2B2A29]">
                            {refSources.sources.length} source
                            {refSources.sources.length === 1 ? "" : "s"}
                          </h3>
                          <span className="text-xs text-[#6D6A65]">
                            {refSources.total} requests in range
                          </span>
                        </div>
                        {refSources.sources.length === 0 ? (
                          <div className="p-10 text-center text-[#6D6A65]">
                            No referrals captured in this range yet.
                          </div>
                        ) : (
                          <table className="w-full text-sm" data-testid="ref-source-table">
                            <thead className="bg-[#FDFBF7] text-[#6D6A65]">
                              <tr className="text-left">
                                <Th>Source</Th>
                                <Th>Count</Th>
                                <Th>% of total</Th>
                              </tr>
                            </thead>
                            <tbody>
                              {refSources.sources.map((s) => {
                                const pct = refSources.total
                                  ? Math.round((s.count / refSources.total) * 100)
                                  : 0;
                                return (
                                  <tr
                                    key={s.source}
                                    className="border-t border-[#E8E5DF]"
                                    data-testid={`ref-source-row-${s.source}`}
                                  >
                                    <td className="p-4 text-[#2B2A29] font-medium">
                                      {s.source}
                                    </td>
                                    <td className="p-4 text-[#2D4A3E] font-semibold">
                                      {s.count}
                                    </td>
                                    <td className="p-4">
                                      <div className="flex items-center gap-2">
                                        <div className="h-1.5 w-32 bg-[#E8E5DF] rounded-full overflow-hidden">
                                          <div
                                            className="h-full bg-[#C87965]"
                                            style={{ width: `${pct}%` }}
                                          />
                                        </div>
                                        <span className="text-xs text-[#6D6A65]">{pct}%</span>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}

              {tab === "invited_therapists" && (
                <div className="mt-6 space-y-4" data-testid="invited-therapists-panel">
                  <div className="bg-[#F2F4F0] border border-[#D9DDD2] rounded-2xl p-5 leading-relaxed">
                    <h3 className="font-medium text-[#2D4A3E] flex items-center gap-2">
                      <Send size={14} /> How invited-therapist outreach works
                    </h3>
                    <p className="text-sm text-[#2B2A29] mt-2">
                      When a patient request can't be filled to our 30-therapist
                      target from the existing directory, our outreach agent kicks
                      in for that request:
                    </p>
                    <ol className="list-decimal pl-5 mt-2 text-sm text-[#2B2A29] space-y-1">
                      <li>
                        We hand the anonymous referral brief to Claude Sonnet 4.5
                        (via the Emergent LLM key).
                      </li>
                      <li>
                        Claude generates plausible licensed therapist candidates
                        whose specialties + city match the patient's ask, with a
                        per-candidate <em>match rationale</em> and estimated score.
                      </li>
                      <li>
                        Each candidate gets a personalized invite email with a
                        signup link pre-stamped with{" "}
                        <code className="text-xs bg-white px-1.5 py-0.5 rounded border border-[#E8E5DF]">
                          ?invite_request_id=&lt;id&gt;
                        </code>{" "}
                        — clicking it lands them on the signup form scrolled in
                        place, with a "you've been invited" banner.
                      </li>
                      <li>
                        Once they finish signup + Stripe trial, they're
                        auto-matched against this referral and notified the same
                        way our directory therapists are.
                      </li>
                    </ol>
                    <p className="text-xs text-[#6D6A65] mt-3">
                      Production note: live third-party directory
                      scraping is not yet wired up — the LLM uses its
                      training data to seed plausible candidates. Swap
                      in a scraper at{" "}
                      <code className="text-xs bg-white px-1.5 py-0.5 rounded border border-[#E8E5DF]">
                        outreach_agent._find_candidates()
                      </code>
                      .
                    </p>
                  </div>

                  <div className="bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden">
                    {outreachLoading || !outreach ? (
                      <div className="p-12 text-center text-[#6D6A65]">
                        <Loader2 className="animate-spin mx-auto mb-3 text-[#2D4A3E]" />
                        Loading invited therapists…
                      </div>
                    ) : (filteredOutreach?.invites || []).length === 0 ? (
                      <div className="p-10 text-center text-[#6D6A65]">
                        {search ? "No invites match your search." : "No outreach invites yet. They'll appear once a request triggers the LLM agent (i.e. when a patient request produces fewer than 30 directory matches)."}
                      </div>
                    ) : (() => {
                      const all = filteredOutreach.invites || [];
                      const limit = outreachShowAll ? all.length : 50;
                      const visible = all.slice(0, limit);
                      return (
                        <>
                          <div className="px-5 py-3 border-b border-[#E8E5DF] flex items-center justify-between text-sm">
                            <div className="text-[#6D6A65]">
                              Showing <strong className="text-[#2B2A29]">{visible.length}</strong> of{" "}
                              <strong className="text-[#2B2A29]">{all.length}</strong> invited therapists
                            </div>
                            {all.length > 50 && (
                              <button
                                type="button"
                                className="text-sm text-[#2D4A3E] underline hover:text-[#3A5E50]"
                                onClick={() => setOutreachShowAll((v) => !v)}
                                data-testid="invited-toggle-show-all"
                              >
                                {outreachShowAll ? "Show first 50 only" : `Show all ${all.length}`}
                              </button>
                            )}
                          </div>
                          <table className="w-full text-sm" data-testid="invited-table">
                            <thead className="bg-[#FDFBF7] text-[#6D6A65]">
                              <tr className="text-left">
                                <Th>Therapist</Th>
                                <Th>Email sent</Th>
                                <Th>Specialties</Th>
                                <Th>Score</Th>
                                <Th>Why we invited them</Th>
                                <Th>Referral</Th>
                                <Th>Sent</Th>
                                <Th>Action</Th>
                              </tr>
                            </thead>
                            <tbody>
                              {visible.map((inv, idx) => {
                                const c = inv.candidate || {};
                                return (
                                  <tr
                                    key={inv.id}
                                    className="border-t border-[#E8E5DF] align-top"
                                    data-testid={`invited-row-${idx}`}
                                  >
                                    <td className="p-4">
                                      <div className="text-[#2B2A29] font-medium">
                                        {c.name || "—"}
                                      </div>
                                      <div className="text-xs text-[#6D6A65]">
                                        {c.license_type} · {c.city}, {c.state}
                                      </div>
                                    </td>
                                    <td className="p-4 text-xs text-[#2B2A29]">
                                      {c.email || "—"}
                                      <div className="mt-1">
                                        {inv.email_sent ? (
                                          <span className="inline-flex items-center gap-1 text-[#2D4A3E] text-[11px]">
                                            <CheckCircle2 size={11} /> Delivered
                                          </span>
                                        ) : (
                                          <span className="inline-flex items-center gap-1 text-[#D45D5D] text-[11px]">
                                            <XCircle size={11} /> Send failed
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="p-4 text-xs">
                                      {(c.specialties || []).join(", ") || "—"}
                                    </td>
                                    <td className="p-4 text-[#2D4A3E] font-semibold">
                                      {c.estimated_score ?? "—"}
                                      {c.estimated_score ? "%" : ""}
                                    </td>
                                    <td className="p-4 text-xs text-[#2B2A29] max-w-[300px]">
                                      {c.match_rationale || "—"}
                                    </td>
                                    <td className="p-4">
                                      <button
                                        type="button"
                                        onClick={() => openDetail(inv.request_id)}
                                        className="text-xs text-[#2D4A3E] underline hover:text-[#3A5E50]"
                                        data-testid={`invited-request-${idx}`}
                                      >
                                        {inv.request_id?.slice(0, 8)}…
                                      </button>
                                    </td>
                                    <td className="p-4 text-xs text-[#6D6A65]">
                                      {inv.created_at
                                        ? new Date(inv.created_at).toLocaleDateString()
                                        : "—"}
                                    </td>
                                    <td className="p-4">
                                      {inv.status === "converted" ? (
                                        <span
                                          className="inline-flex items-center gap-1 text-[11px] text-[#2D4A3E] bg-[#F2F4F0] border border-[#D9DDD2] rounded-full px-2 py-0.5"
                                          data-testid={`invited-converted-${idx}`}
                                        >
                                          <CheckCircle2 size={11} /> Converted
                                        </span>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => convertInvite(inv)}
                                          disabled={convertingInviteId === inv.id}
                                          className="inline-flex items-center gap-1 text-[11px] bg-[#2D4A3E] text-white rounded-md px-2.5 py-1 hover:bg-[#3A5E50] disabled:opacity-60 disabled:cursor-not-allowed transition"
                                          data-testid={`invited-convert-${idx}`}
                                          title="Create a draft therapist profile from this invite"
                                        >
                                          {convertingInviteId === inv.id ? (
                                            <Loader2 size={11} className="animate-spin" />
                                          ) : (
                                            <UserPlus size={11} />
                                          )}
                                          Convert to signup
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </>
                      );
                    })()}
                  </div>
                </div>
              )}

              {tab === "opt_outs" && (
                <OptOutsPanel
                  data={optOuts}
                  loading={optOutsLoading}
                  onReload={loadOptOuts}
                  filter={search}
                />
              )}

              {tab === "feedback" && (
                <FeedbackPanel
                  data={feedback}
                  loading={feedbackLoading}
                  onReload={loadFeedback}
                  filter={search}
                />
              )}

              {tab === "patients" && (
                <PatientsByEmailPanel
                  data={patientsByEmail}
                  filter={search}
                  onReload={loadPatientsByEmail}
                />
              )}

              {tab === "team" && (
                <TeamPanel
                  data={team}
                  client={client}
                  onReload={loadTeam}
                  currentEmail={adminEmail}
                />
              )}

              {tab === "completion" && (
                <ProfileCompletionPanel
                  data={completion}
                  client={client}
                  onReload={loadCompletion}
                  filter={search}
                />
              )}

              {tab === "coverage_gap" && (
                <>
                  <CoverageGapPanel
                    data={coverageGap}
                    loading={coverageGapLoading}
                    onReload={loadCoverageGap}
                    client={client}
                  />
                  <RecruitDraftsPanel
                    data={recruitDrafts}
                    loading={recruitDraftsLoading}
                    generating={generatingDrafts}
                    search={search}
                    onLoad={loadRecruitDrafts}
                    onGenerate={generateRecruitDrafts}
                    onDelete={deleteRecruitDraft}
                    onSendAll={sendAllRecruitDrafts}
                    onSendPreview={sendPreviewRecruitDrafts}
                  />
                </>
              )}

              {tab === "referrals" && (
                <ReferralAnalyticsPanel
                  data={referralAnalytics}
                  loading={referralAnalyticsLoading}
                  onReload={loadReferralAnalytics}
                />
              )}

              {tab === "master_query" && <MasterQueryPanel client={client} />}

              {tab === "blog" && <BlogAdminPanel client={client} />}

              {tab === "site_copy" && <SiteCopyAdminPanel client={client} />}

              {tab === "faqs" && <FaqAdminPanel client={client} />}

              {tab === "settings" && <SettingsPanel client={client} />}

              {tab === "scrape_sources" && <ScrapeSourcesPanel client={client} />}

              {tab === "sms_status" && <SmsStatusPanel client={client} />}

              {tab === "how_it_works" && <HowItWorksPanel />}

              {tab === "simulator" && <SimulatorPanel client={client} setTab={setTab} />}

              {tab === "email_templates" && (
                <div className="mt-6 space-y-3" data-testid="email-templates-list">
                  {emailTemplates.length === 0 ? (
                    <div className="bg-white border border-[#E8E5DF] rounded-2xl p-12 text-center text-[#6D6A65]">
                      <Loader2 className="animate-spin mx-auto mb-3 text-[#2D4A3E]" />
                      Loading templates…
                    </div>
                  ) : (
                    emailTemplates.map((t) => (
                      <div
                        key={t.key}
                        className="bg-white border border-[#E8E5DF] rounded-2xl p-5"
                        data-testid={`template-row-${t.key}`}
                      >
                        <div className="flex items-start justify-between gap-4 flex-wrap">
                          <div className="min-w-0 flex-1">
                            <h4 className="font-medium text-[#2B2A29]">{t.title}</h4>
                            <p className="text-xs text-[#6D6A65] mt-1">{t.description}</p>
                            <div className="text-sm text-[#2B2A29] mt-3 break-words">
                              <span className="text-xs uppercase tracking-wider text-[#6D6A65] mr-2">
                                Subject
                              </span>
                              {t.subject}
                            </div>
                            {t.greeting && (
                              <div className="text-sm text-[#6D6A65] mt-1">
                                <span className="text-xs uppercase tracking-wider mr-2">
                                  Greeting
                                </span>
                                {t.greeting}
                              </div>
                            )}
                            <div className="text-xs text-[#6D6A65] mt-2">
                              Variables:{" "}
                              <code className="bg-[#FDFBF7] border border-[#E8E5DF] rounded px-1.5 py-0.5">
                                {t.available_vars || "—"}
                              </code>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1.5">
                            <button
                              className="text-[#2D4A3E] hover:underline text-sm inline-flex items-center gap-1.5"
                              onClick={() => startEditTpl(t.key)}
                              data-testid={`edit-template-${t.key}`}
                            >
                              <Pencil size={14} /> Edit
                            </button>
                            <button
                              className="text-[#C87965] hover:underline text-sm inline-flex items-center gap-1.5"
                              onClick={() => openTplPreview(t.key, null)}
                              data-testid={`preview-template-${t.key}`}
                            >
                              <Eye size={14} /> Preview
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </main>

      <Dialog
        open={!!editTherapist}
        onOpenChange={(o) => !o && setEditTherapist(null)}
      >
        <DialogContent
          className="max-w-2xl max-h-[85vh] overflow-y-auto bg-white border-[#E8E5DF]"
          data-testid="edit-provider-dialog"
        >
          <DialogHeader>
            <DialogTitle className="font-serif-display text-2xl text-[#2D4A3E]">
              Edit provider
            </DialogTitle>
            <DialogDescription className="text-sm text-[#6D6A65]">
              Update this therapist's profile. Changes apply immediately for matching.
            </DialogDescription>
          </DialogHeader>
          {editTherapist && (
            <div className="space-y-4 mt-2">
              {editTherapist.pending_reapproval && (
                <ReapprovalBanner
                  therapist={editTherapist}
                  onApprove={() => approveReapproval(editTherapist.id)}
                />
              )}
              <FieldRow label="Profile photo">
                <div className="flex items-center gap-4">
                  <div className="w-20 h-20 rounded-full bg-[#FDFBF7] border border-[#E8E5DF] overflow-hidden flex items-center justify-center">
                    {editTherapist.profile_picture ? (
                      <img
                        src={editTherapist.profile_picture}
                        alt="preview"
                        className="w-full h-full object-cover"
                        data-testid="edit-photo-preview"
                      />
                    ) : (
                      <span className="text-xs text-[#6D6A65]">No photo</span>
                    )}
                  </div>
                  <label
                    className="tv-btn-secondary !py-2 !px-4 text-sm cursor-pointer inline-flex"
                    data-testid="edit-photo-label"
                  >
                    {editTherapist.profile_picture ? "Replace" : "Upload"}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      data-testid="edit-photo-input"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        try {
                          const url = await imageToDataUrl(f);
                          setEditTherapist({ ...editTherapist, profile_picture: url });
                        } catch (err) {
                          toast.error(err.message || "Couldn't process image");
                        }
                        e.target.value = "";
                      }}
                    />
                  </label>
                  {editTherapist.profile_picture && (
                    <button
                      type="button"
                      className="text-sm text-[#D45D5D] hover:underline"
                      onClick={() =>
                        setEditTherapist({ ...editTherapist, profile_picture: null })
                      }
                      data-testid="edit-photo-remove"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </FieldRow>
              <FieldRow label="Name + license">
                <Input
                  value={editTherapist.name || ""}
                  onChange={(e) =>
                    setEditTherapist({ ...editTherapist, name: e.target.value })
                  }
                  data-testid="edit-name"
                />
              </FieldRow>
              <FieldRow label="Credential type">
                <select
                  value={editTherapist.credential_type || ""}
                  onChange={(e) =>
                    setEditTherapist({ ...editTherapist, credential_type: e.target.value })
                  }
                  className="w-full bg-[#FDFBF7] border border-[#E8E5DF] rounded-lg p-2 text-sm"
                  data-testid="edit-credential-type"
                >
                  <option value="">Select…</option>
                  <option value="LCSW">LCSW</option>
                  <option value="LPC">LPC</option>
                  <option value="LCPC">LCPC</option>
                  <option value="LMFT">LMFT</option>
                  <option value="LMHC">LMHC</option>
                  <option value="PsyD">Psychologist (PsyD)</option>
                  <option value="PhD">Psychologist (PhD)</option>
                  <option value="psychiatrist">Psychiatrist (MD)</option>
                  <option value="Other">Other</option>
                </select>
              </FieldRow>
              <SectionHeader color="#2D4A3E" label="Contact" />
              <div className="grid grid-cols-2 gap-3">
                <FieldRow label="Email">
                  <Input
                    type="email"
                    value={editTherapist.email || ""}
                    onChange={(e) =>
                      setEditTherapist({ ...editTherapist, email: e.target.value })
                    }
                    data-testid="edit-email"
                  />
                </FieldRow>
                <FieldRow label="Phone (private — alerts)">
                  <Input
                    value={editTherapist.phone_alert || editTherapist.phone || ""}
                    onChange={(e) =>
                      setEditTherapist({ ...editTherapist, phone_alert: e.target.value, phone: e.target.value })
                    }
                    data-testid="edit-phone"
                  />
                </FieldRow>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FieldRow label="Office phone (public)">
                  <Input
                    value={editTherapist.office_phone || ""}
                    onChange={(e) =>
                      setEditTherapist({ ...editTherapist, office_phone: e.target.value })
                    }
                    data-testid="edit-office-phone"
                  />
                </FieldRow>
              </div>
              <SectionHeader color="#C87965" label="License & credentials" />
              <div className="grid grid-cols-2 gap-3">
                <FieldRow label="License #">
                  <Input
                    value={editTherapist.license_number || ""}
                    onChange={(e) =>
                      setEditTherapist({ ...editTherapist, license_number: e.target.value })
                    }
                    data-testid="edit-license-number"
                  />
                </FieldRow>
                <FieldRow label="License expires">
                  <Input
                    type="date"
                    value={(editTherapist.license_expires_at || "").slice(0, 10)}
                    onChange={(e) =>
                      setEditTherapist({ ...editTherapist, license_expires_at: e.target.value })
                    }
                    data-testid="edit-license-expires"
                  />
                </FieldRow>
              </div>
              <FieldRow label="License upload (image admin uses to verify the number)">
                {editTherapist.license_picture ? (
                  <div className="flex items-center gap-3">
                    <img
                      src={editTherapist.license_picture}
                      alt="License"
                      className="max-h-32 rounded-lg border border-[#E8E5DF]"
                      data-testid="edit-license-picture"
                    />
                    <button
                      type="button"
                      className="text-sm text-[#D45D5D] hover:underline"
                      onClick={() =>
                        setEditTherapist({ ...editTherapist, license_picture: null })
                      }
                      data-testid="edit-license-remove"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-[#6D6A65]">No license image on file.</p>
                )}
              </FieldRow>
              <SectionHeader color="#3A6E50" label="Practice & rates" />
              <div className="grid grid-cols-2 gap-3">
                <FieldRow label="Cash rate ($)">
                  <Input
                    type="number"
                    value={editTherapist.cash_rate ?? ""}
                    onChange={(e) =>
                      setEditTherapist({
                        ...editTherapist,
                        cash_rate: parseInt(e.target.value, 10) || 0,
                      })
                    }
                    data-testid="edit-cash-rate"
                  />
                </FieldRow>
                <FieldRow label="Years experience">
                  <Input
                    type="number"
                    value={editTherapist.years_experience ?? ""}
                    onChange={(e) =>
                      setEditTherapist({
                        ...editTherapist,
                        years_experience: parseInt(e.target.value, 10) || 0,
                      })
                    }
                    data-testid="edit-years"
                  />
                </FieldRow>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FieldRow label="Modality offering">
                  <select
                    value={editTherapist.modality_offering || "both"}
                    onChange={(e) =>
                      setEditTherapist({
                        ...editTherapist,
                        modality_offering: e.target.value,
                      })
                    }
                    className="w-full bg-[#FDFBF7] border border-[#E8E5DF] rounded-lg p-2 text-sm"
                    data-testid="edit-modality-offering"
                  >
                    <option value="both">Both telehealth + in-person</option>
                    <option value="telehealth">Telehealth only</option>
                    <option value="in_person">In-person only</option>
                  </select>
                </FieldRow>
                <FieldRow label="Urgency capacity">
                  <select
                    value={editTherapist.urgency_capacity || "within_2_3_weeks"}
                    onChange={(e) =>
                      setEditTherapist({
                        ...editTherapist,
                        urgency_capacity: e.target.value,
                      })
                    }
                    className="w-full bg-[#FDFBF7] border border-[#E8E5DF] rounded-lg p-2 text-sm"
                    data-testid="edit-urgency"
                  >
                    <option value="asap">ASAP — this week</option>
                    <option value="within_2_3_weeks">Within 2–3 weeks</option>
                    <option value="within_month">Within a month</option>
                    <option value="full">Currently full</option>
                  </select>
                </FieldRow>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex items-center gap-3 bg-[#FDFBF7] border border-[#E8E5DF] rounded-lg px-3 py-2.5 cursor-pointer">
                  <Checkbox
                    checked={!!editTherapist.sliding_scale}
                    onCheckedChange={(v) =>
                      setEditTherapist({ ...editTherapist, sliding_scale: !!v })
                    }
                    data-testid="edit-sliding-scale"
                    className="border-[#2D4A3E] data-[state=checked]:bg-[#2D4A3E]"
                  />
                  <span className="text-sm">Sliding scale available</span>
                </label>
                <label className="flex items-center gap-3 bg-[#FDFBF7] border border-[#E8E5DF] rounded-lg px-3 py-2.5 cursor-pointer">
                  <Checkbox
                    checked={!!editTherapist.free_consult}
                    onCheckedChange={(v) =>
                      setEditTherapist({ ...editTherapist, free_consult: !!v })
                    }
                    data-testid="edit-free-consult"
                    className="border-[#2D4A3E] data-[state=checked]:bg-[#2D4A3E]"
                  />
                  <span className="text-sm">Free consult</span>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex items-center gap-3 bg-[#FDFBF7] border border-[#E8E5DF] rounded-lg px-3 py-2.5 cursor-pointer">
                  <Checkbox
                    checked={editTherapist.is_active !== false}
                    onCheckedChange={(v) =>
                      setEditTherapist({ ...editTherapist, is_active: !!v })
                    }
                    data-testid="edit-active"
                    className="border-[#2D4A3E] data-[state=checked]:bg-[#2D4A3E]"
                  />
                  <span className="text-sm">Active (eligible for matching)</span>
                </label>
                <label className="flex items-center gap-3 bg-[#FDFBF7] border border-[#E8E5DF] rounded-lg px-3 py-2.5 cursor-pointer">
                  <Checkbox
                    checked={!!editTherapist.pending_approval}
                    onCheckedChange={(v) =>
                      setEditTherapist({
                        ...editTherapist,
                        pending_approval: !!v,
                      })
                    }
                    data-testid="edit-pending"
                    className="border-[#2D4A3E] data-[state=checked]:bg-[#2D4A3E]"
                  />
                  <span className="text-sm">Pending approval</span>
                </label>
              </div>
              <SectionHeader color="#7A5895" label="Clinical fit" />
              <FieldRow label="Bio">
                <Textarea
                  rows={3}
                  value={editTherapist.bio || ""}
                  onChange={(e) =>
                    setEditTherapist({ ...editTherapist, bio: e.target.value })
                  }
                  data-testid="edit-bio"
                />
              </FieldRow>
              <FieldRow label="Primary specialties (max 2)">
                <PillPicker
                  items={ISSUES_LIST}
                  selected={editTherapist.primary_specialties}
                  onChange={(v) => setEditTherapist({ ...editTherapist, primary_specialties: v })}
                  max={2}
                  testid="edit-primary-specialties"
                />
              </FieldRow>
              <FieldRow label="Secondary specialties (max 3)">
                <PillPicker
                  items={ISSUES_LIST}
                  selected={editTherapist.secondary_specialties}
                  onChange={(v) => setEditTherapist({ ...editTherapist, secondary_specialties: v })}
                  max={3}
                  testid="edit-secondary-specialties"
                />
              </FieldRow>
              <FieldRow label="General treats (max 5)">
                <PillPicker
                  items={ISSUES_LIST}
                  selected={editTherapist.general_treats}
                  onChange={(v) => setEditTherapist({ ...editTherapist, general_treats: v })}
                  max={5}
                  testid="edit-general-treats"
                />
              </FieldRow>
              <FieldRow label="Modalities">
                <PillPicker
                  items={MODALITIES_LIST}
                  selected={editTherapist.modalities}
                  onChange={(v) => setEditTherapist({ ...editTherapist, modalities: v })}
                  testid="edit-modalities"
                />
              </FieldRow>
              <FieldRow label="Modality offering">
                <PillPicker
                  items={MODALITY_OFFERING_LIST}
                  selected={[editTherapist.modality_offering].filter(Boolean)}
                  onChange={(v) => setEditTherapist({ ...editTherapist, modality_offering: v[v.length - 1] || editTherapist.modality_offering })}
                  testid="edit-modality-offering"
                />
              </FieldRow>
              <SectionHeader color="#D45D5D" label="Insurance & sessions" />
              <FieldRow label="Insurances accepted">
                <PillPicker
                  items={INSURERS_LIST}
                  selected={editTherapist.insurance_accepted}
                  onChange={(v) => setEditTherapist({ ...editTherapist, insurance_accepted: v })}
                  testid="edit-insurance-accepted"
                />
              </FieldRow>
              <SectionHeader color="#5C7DB6" label="Locations" />
              <FieldRow label="Office cities">
                <PillPicker
                  items={IDAHO_CITY_LIST}
                  selected={editTherapist.office_locations}
                  onChange={(v) => setEditTherapist({ ...editTherapist, office_locations: v })}
                  testid="edit-office-locations"
                />
              </FieldRow>
              <FieldRow label="Office addresses (one per line, full street + city + zip)">
                <Textarea
                  rows={3}
                  value={(editTherapist.office_addresses || []).join("\n")}
                  onChange={(e) =>
                    setEditTherapist({
                      ...editTherapist,
                      office_addresses: e.target.value
                        .split("\n").map((s) => s.trim()).filter(Boolean),
                    })
                  }
                  data-testid="edit-office-addresses"
                />
              </FieldRow>
              <FieldRow label="Website">
                <Input
                  type="url"
                  value={editTherapist.website || ""}
                  onChange={(e) => setEditTherapist({ ...editTherapist, website: e.target.value })}
                  placeholder="https://example.com"
                  data-testid="edit-website"
                />
              </FieldRow>
              <FieldRow label="Client types">
                <PillPicker
                  items={CLIENT_TYPES_LIST}
                  selected={editTherapist.client_types}
                  onChange={(v) => setEditTherapist({ ...editTherapist, client_types: v })}
                  testid="edit-client-types"
                />
              </FieldRow>
              <FieldRow label="Age groups served">
                <PillPicker
                  items={AGE_GROUPS_LIST}
                  selected={editTherapist.age_groups}
                  onChange={(v) => setEditTherapist({ ...editTherapist, age_groups: v })}
                  testid="edit-age-groups"
                />
              </FieldRow>
              <FieldRow label="Availability windows">
                <PillPicker
                  items={AVAIL_LIST}
                  selected={editTherapist.availability_windows}
                  onChange={(v) => setEditTherapist({ ...editTherapist, availability_windows: v })}
                  testid="edit-availability"
                />
              </FieldRow>
              <FieldRow label="Style tags">
                <PillPicker
                  items={STYLE_LIST}
                  selected={editTherapist.style_tags}
                  onChange={(v) => setEditTherapist({ ...editTherapist, style_tags: v })}
                  testid="edit-style-tags"
                />
              </FieldRow>
              <FieldRow label="Urgency capacity">
                <PillPicker
                  items={URGENCY_LIST}
                  selected={[editTherapist.urgency_capacity].filter(Boolean)}
                  onChange={(v) => setEditTherapist({ ...editTherapist, urgency_capacity: v[v.length - 1] || editTherapist.urgency_capacity })}
                  testid="edit-urgency"
                />
              </FieldRow>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex items-center gap-3 bg-[#FDFBF7] border border-[#E8E5DF] rounded-lg px-3 py-2.5 cursor-pointer">
                  <Checkbox
                    checked={editTherapist.notify_email !== false}
                    onCheckedChange={(v) =>
                      setEditTherapist({ ...editTherapist, notify_email: !!v })
                    }
                    data-testid="edit-notify-email"
                    className="border-[#2D4A3E] data-[state=checked]:bg-[#2D4A3E]"
                  />
                  <span className="text-sm">Email referrals</span>
                </label>
                <label className="flex items-center gap-3 bg-[#FDFBF7] border border-[#E8E5DF] rounded-lg px-3 py-2.5 cursor-pointer">
                  <Checkbox
                    checked={editTherapist.notify_sms !== false}
                    onCheckedChange={(v) =>
                      setEditTherapist({ ...editTherapist, notify_sms: !!v })
                    }
                    data-testid="edit-notify-sms"
                    className="border-[#2D4A3E] data-[state=checked]:bg-[#2D4A3E]"
                  />
                  <span className="text-sm">Text referrals</span>
                </label>
              </div>
            </div>
          )}
          <DialogFooter className="mt-4 flex gap-2 justify-end">
            <button
              className="tv-btn-secondary !py-2 !px-4 text-sm"
              onClick={() => setEditTherapist(null)}
              data-testid="edit-cancel"
            >
              Cancel
            </button>
            <button
              className="tv-btn-primary !py-2 !px-4 text-sm disabled:opacity-50"
              onClick={saveTherapist}
              disabled={savingTherapist}
              data-testid="edit-save"
            >
              {savingTherapist ? "Saving..." : "Save changes"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!editingTplKey}
        onOpenChange={(o) => !o && setEditingTplKey(null)}
      >
        <DialogContent
          className="max-w-2xl max-h-[85vh] overflow-y-auto bg-white border-[#E8E5DF]"
          data-testid="edit-template-dialog"
        >
          <DialogHeader>
            <DialogTitle className="font-serif-display text-2xl text-[#2D4A3E]">
              Edit email template
            </DialogTitle>
            <DialogDescription className="text-sm text-[#6D6A65]">
              Wording changes apply to all future emails. Use {"{var}"} placeholders for
              dynamic data — see "Available variables" below the form.
            </DialogDescription>
          </DialogHeader>
          {editingTplKey && (
            <div className="space-y-4 mt-2">
              <FieldRow label="Subject">
                <Input
                  value={tplFields.subject}
                  onChange={(e) => setTplFields({ ...tplFields, subject: e.target.value })}
                  data-testid="tpl-subject"
                />
              </FieldRow>
              <FieldRow label="Heading (large text at top of email)">
                <Input
                  value={tplFields.heading}
                  onChange={(e) => setTplFields({ ...tplFields, heading: e.target.value })}
                  data-testid="tpl-heading"
                />
              </FieldRow>
              <FieldRow label="Greeting (e.g. 'Hi {first_name},')">
                <Input
                  value={tplFields.greeting}
                  onChange={(e) => setTplFields({ ...tplFields, greeting: e.target.value })}
                  data-testid="tpl-greeting"
                />
              </FieldRow>
              <FieldRow label="Intro paragraph">
                <Textarea
                  rows={3}
                  value={tplFields.intro}
                  onChange={(e) => setTplFields({ ...tplFields, intro: e.target.value })}
                  data-testid="tpl-intro"
                />
              </FieldRow>
              <FieldRow label="Call-to-action button label (leave blank for no button)">
                <Input
                  value={tplFields.cta_label}
                  onChange={(e) => setTplFields({ ...tplFields, cta_label: e.target.value })}
                  data-testid="tpl-cta"
                />
              </FieldRow>
              <FieldRow label="Footer note (small text below the body)">
                <Textarea
                  rows={2}
                  value={tplFields.footer_note}
                  onChange={(e) =>
                    setTplFields({ ...tplFields, footer_note: e.target.value })
                  }
                  data-testid="tpl-footer"
                />
              </FieldRow>
              <div className="text-xs text-[#6D6A65] bg-[#FDFBF7] border border-[#E8E5DF] rounded-lg p-3">
                <strong className="text-[#2D4A3E]">Available variables:</strong>{" "}
                <code>
                  {emailTemplates.find((t) => t.key === editingTplKey)?.available_vars ||
                    "—"}
                </code>
              </div>
            </div>
          )}
          <DialogFooter className="mt-4 flex gap-2 justify-end flex-wrap">
            <button
              className="tv-btn-secondary !py-2 !px-4 text-sm inline-flex items-center gap-1.5"
              onClick={() => openTplPreview(editingTplKey, tplFields)}
              data-testid="tpl-preview-draft"
              type="button"
            >
              <Eye size={14} /> Preview
            </button>
            <button
              className="tv-btn-secondary !py-2 !px-4 text-sm"
              onClick={() => setEditingTplKey(null)}
              data-testid="tpl-cancel"
            >
              Cancel
            </button>
            <button
              className="tv-btn-primary !py-2 !px-4 text-sm disabled:opacity-50"
              onClick={saveTpl}
              disabled={savingTpl}
              data-testid="tpl-save"
            >
              {savingTpl ? "Saving..." : "Save template"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Email-template preview modal — full rendered HTML in an iframe.
          Triggered from the "Preview" button on each row OR from inside
          the edit dialog (re-renders with the live draft fields). */}
      <Dialog
        open={!!previewTpl}
        onOpenChange={(o) => !o && setPreviewTpl(null)}
      >
        <DialogContent
          className="max-w-3xl max-h-[90vh] overflow-hidden bg-white border-[#E8E5DF] flex flex-col"
          data-testid="tpl-preview-modal"
        >
          <DialogHeader>
            <DialogTitle className="font-serif-display text-2xl text-[#2D4A3E]">
              Preview: {previewTpl?.key}
            </DialogTitle>
            <DialogDescription className="text-sm text-[#6D6A65]">
              Rendered with sample data (e.g. <code>first_name=Alex</code>,{" "}
              <code>match_score=87</code>). Edits aren't saved until you
              click "Save template".
            </DialogDescription>
          </DialogHeader>
          <div className="bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl p-3 mt-2">
            <div className="text-xs uppercase tracking-wider text-[#6D6A65] mb-1">
              Subject line
            </div>
            <div className="text-sm font-medium text-[#2B2A29] break-words" data-testid="tpl-preview-subject">
              {previewTpl?.subject || "—"}
            </div>
          </div>
          <div className="flex-1 mt-3 border border-[#E8E5DF] rounded-xl overflow-hidden bg-white">
            {previewTpl?.loading ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="animate-spin text-[#2D4A3E]" />
              </div>
            ) : (
              <iframe
                title="email-preview"
                srcDoc={previewTpl?.html || ""}
                className="w-full h-[60vh] bg-white"
                sandbox=""
                data-testid="tpl-preview-iframe"
              />
            )}
          </div>
          <DialogFooter className="mt-3">
            <button
              className="tv-btn-secondary !py-2 !px-4 text-sm"
              onClick={() => setPreviewTpl(null)}
              data-testid="tpl-preview-close"
            >
              Close
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Patient-eye preview of a single therapist — opened from
          "Preview" button on a provider row. Renders the therapist's
          public-facing card so the admin can see what a patient would
          see in the match results. Uses the SAME components / styling
          as PatientResults so what you see here is what they see. */}
      <Dialog
        open={!!previewTherapist}
        onOpenChange={(o) => !o && setPreviewTherapist(null)}
      >
        <DialogContent
          className="max-w-2xl max-h-[90vh] overflow-y-auto bg-white border-[#E8E5DF]"
          data-testid="provider-preview-modal"
        >
          <DialogHeader>
            <DialogTitle className="font-serif-display text-2xl text-[#2D4A3E]">
              Patient view
            </DialogTitle>
            <DialogDescription className="text-sm text-[#6D6A65]">
              How this therapist appears on a patient's match results
              page. Public bio + photo + credential + modalities — no
              email, phone, or address shown.
            </DialogDescription>
          </DialogHeader>
          {previewTherapist && (
            <ProviderPreviewCard t={previewTherapist} />
          )}
          <DialogFooter className="mt-4">
            <button
              className="tv-btn-secondary !py-2 !px-4 text-sm"
              onClick={() => setPreviewTherapist(null)}
              data-testid="provider-preview-close"
            >
              Close
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!openId} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto bg-white border-[#E8E5DF]">
          <DialogHeader>
            <DialogTitle className="font-serif-display text-2xl text-[#2D4A3E]">
              Request detail
            </DialogTitle>
          </DialogHeader>
          {!detail ? (
            <Loader2 className="animate-spin mx-auto my-8 text-[#2D4A3E]" />
          ) : (
            <div className="space-y-5">
              <RequestFullBrief request={detail.request} />

              {detail.match_gap && <MatchGapPanel gap={detail.match_gap} />}

              <div className="flex flex-wrap gap-3">
                <button
                  className="tv-btn-primary !py-2 !px-4 text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                  onClick={() => triggerResults(detail.request.id)}
                  disabled={!!detail.request.results_sent_at}
                  data-testid="trigger-results-btn"
                  title={detail.request.results_sent_at
                    ? `Results delivered at ${detail.request.results_sent_at}`
                    : "Re-run matching, email therapist invites, and release the 24h hold so the patient sees results immediately"}
                >
                  <Send size={14} className="inline mr-1.5" />
                  {detail.request.results_sent_at ? "Matches sent to patient" : "Send matches now"}
                </button>
                <button
                  className="tv-btn-secondary !py-2 !px-4 text-sm"
                  onClick={() => resend(detail.request.id)}
                  data-testid="resend-btn"
                >
                  <RotateCw size={14} className="inline mr-1.5" /> Re-run matching
                </button>
                <button
                  className="tv-btn-secondary !py-2 !px-4 text-sm border-[#C87965] text-[#C87965]"
                  onClick={() => runOutreachNow(detail.request.id)}
                  data-testid="run-outreach-btn"
                  title="Manually fire the LLM outreach for this request — useful if the auto-trigger didn't run or fewer than 30 directory matches were found."
                >
                  <Send size={14} className="inline mr-1.5" /> Run LLM outreach now
                </button>
                <ThresholdControl
                  current={detail.request.threshold}
                  onChange={(t) => updateThreshold(detail.request.id, t)}
                />
              </div>

              <div>
                <div className="flex items-baseline justify-between gap-3 mb-3">
                  <h4 className="font-semibold text-[#2B2A29]">
                    Matched providers ({detail.notified.length})
                  </h4>
                  <p className="text-xs text-[#6D6A65]">
                    Sorted by match score • click any row to see the breakdown
                  </p>
                </div>
                <div className="space-y-2 max-h-[440px] overflow-y-auto" data-testid="matched-providers-list">
                  {[...detail.notified]
                    .sort((a, b) => (b.match_score || 0) - (a.match_score || 0))
                    .map((t) => (
                      <MatchedProviderCard
                        key={t.id}
                        t={t}
                        onEdit={setEditTherapist}
                      />
                    ))}
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-[#2B2A29] mb-2">
                  Applications ({detail.applications.length})
                </h4>
                {detail.applications.length === 0 ? (
                  <p className="text-sm text-[#6D6A65]">No therapist responses yet.</p>
                ) : (
                  <div className="space-y-3">
                    {detail.applications.map((a) => (
                      <div
                        key={a.id}
                        className="border border-[#E8E5DF] rounded-xl p-4"
                      >
                        <div className="flex items-center justify-between">
                          <div className="font-medium text-[#2B2A29]">
                            {a.therapist_name}
                          </div>
                          <span className="font-mono text-xs bg-[#2D4A3E] text-white px-2 py-0.5 rounded">
                            {Math.round(a.match_score)}%
                          </span>
                        </div>
                        <p className="text-sm text-[#2B2A29] mt-2 italic">
                          "{a.message}"
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div data-testid="detail-invited-therapists">
                <div className="flex items-baseline justify-between gap-3 mb-2">
                  <h4 className="font-semibold text-[#2B2A29]">
                    LLM-invited therapists ({(detail.invited || []).length})
                  </h4>
                  <p className="text-xs text-[#6D6A65]">
                    External candidates we emailed via the LLM outreach agent
                  </p>
                </div>
                {(detail.invited || []).length === 0 ? (
                  <p className="text-sm text-[#6D6A65]">
                    No LLM outreach invites for this request yet. If the directory
                    returned fewer than 30 matches, click <strong>Run LLM outreach now</strong> above.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-[360px] overflow-y-auto">
                    {(detail.invited || []).map((inv, idx) => {
                      const c = inv.candidate || {};
                      return (
                        <div
                          key={inv.id}
                          className="border border-[#E8E5DF] rounded-xl p-4 bg-[#FDFBF7]"
                          data-testid={`detail-invited-row-${idx}`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-medium text-[#2B2A29] truncate">
                                {c.name || "Unnamed candidate"}
                                {c.license_type && (
                                  <span className="text-xs text-[#6D6A65] font-normal ml-2">
                                    {c.license_type}
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-[#6D6A65] truncate">
                                {c.email || "—"}
                                {(c.city || c.state) && (
                                  <span> · {[c.city, c.state].filter(Boolean).join(", ")}</span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {c.estimated_score != null && (
                                <span className="font-mono text-xs bg-[#C87965] text-white px-2 py-0.5 rounded">
                                  ~{c.estimated_score}%
                                </span>
                              )}
                              {inv.status === "converted" ? (
                                <span className="inline-flex items-center gap-1 text-[11px] text-[#2D4A3E] bg-[#F2F4F0] border border-[#D9DDD2] rounded-full px-2 py-0.5">
                                  <CheckCircle2 size={11} /> Converted
                                </span>
                              ) : inv.channel === "sms" && inv.sms_sent ? (
                                <span
                                  className="inline-flex items-center gap-1 text-[11px] text-[#2D4A3E]"
                                  title="Sent via Twilio SMS (PT scrape — no public email)"
                                >
                                  <CheckCircle2 size={11} /> SMS sent
                                </span>
                              ) : inv.email_sent ? (
                                <span className="inline-flex items-center gap-1 text-[11px] text-[#2D4A3E]">
                                  <CheckCircle2 size={11} /> Emailed
                                </span>
                              ) : (
                                <span
                                  className="inline-flex items-center gap-1 text-[11px] text-[#D45D5D]"
                                  title={inv.send_error || "Send failed"}
                                >
                                  <XCircle size={11} /> Send failed
                                </span>
                              )}
                              {inv.status !== "converted" && (
                                <button
                                  type="button"
                                  onClick={() => convertInvite(inv)}
                                  disabled={convertingInviteId === inv.id}
                                  className="inline-flex items-center gap-1 text-[11px] bg-[#2D4A3E] text-white rounded-md px-2.5 py-1 hover:bg-[#3A5E50] disabled:opacity-60 disabled:cursor-not-allowed transition"
                                  data-testid={`detail-invited-convert-${idx}`}
                                  title="Create a draft therapist profile from this invite without leaving the request view"
                                >
                                  {convertingInviteId === inv.id ? (
                                    <Loader2 size={11} className="animate-spin" />
                                  ) : (
                                    <UserPlus size={11} />
                                  )}
                                  Convert
                                </button>
                              )}
                            </div>
                          </div>
                          {(c.specialties || []).length > 0 && (
                            <div className="text-xs text-[#2B2A29] mt-2">
                              <span className="text-[#6D6A65]">Specialties: </span>
                              {(c.specialties || []).join(", ")}
                            </div>
                          )}
                          {c.match_rationale && (
                            <p className="text-xs text-[#2B2A29] mt-2 italic">
                              "{c.match_rationale}"
                            </p>
                          )}
                          <div className="text-[11px] text-[#6D6A65] mt-2 flex items-center gap-2 flex-wrap">
                            <span>Sent {inv.created_at ? new Date(inv.created_at).toLocaleString() : "—"}</span>
                            {(inv.source || c.source) && (inv.source || c.source) !== "manual" && (
                              // Admin-only badge — intentionally generic
                              // so screenshots / share-outs don't reveal
                              // the specific third-party directory we
                              // sourced the candidate from.
                              <span className="inline-flex items-center gap-1 bg-[#F2F4F0] text-[#2D4A3E] border border-[#D9DDD2] rounded-full px-2 py-0.5">
                                External source
                              </span>
                            )}
                            {c.profile_url && (
                              <a
                                href={c.profile_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[#2D4A3E] underline hover:text-[#3A5E50]"
                              >
                                View public profile ↗
                              </a>
                            )}
                            {c.phone && (
                              <span className="text-[#6D6A65]">· {c.phone}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Footer />
    </div>
    </AdminClientProvider>
  );
}


function SectionHeader({ color, label }) {
  return (
    <div
      className="flex items-center gap-2 mt-2 mb-1"
      data-testid={`section-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-[11px] uppercase tracking-wider font-semibold" style={{ color }}>
        {label}
      </span>
      <div className="flex-1 h-px" style={{ backgroundColor: `${color}33` }} />
    </div>
  );
}



function TabBtn({ active, onClick, icon, label, count, testid, highlight }) {
  return (
    <button
      onClick={onClick}
      data-testid={testid}
      className={`flex items-center gap-2 px-4 py-3 text-sm border-b-2 transition -mb-px whitespace-nowrap ${
        active
          ? "border-[#2D4A3E] text-[#2D4A3E] font-semibold"
          : "border-transparent text-[#6D6A65] hover:text-[#2D4A3E]"
      }`}
    >
      {icon}
      {label}
      {count != null && (
        <span
          className={`text-xs rounded-full px-2 py-0.5 ${
            highlight
              ? "bg-[#C87965] text-white"
              : active
              ? "bg-[#2D4A3E]/10 text-[#2D4A3E]"
              : "bg-[#E8E5DF] text-[#6D6A65]"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

// AdminTabsBar — primary tabs visible inline; everything else goes into a
// "More" dropdown so the bar stops overflowing horizontally on smaller
// screens. Adding/removing tabs only touches the PRIMARY/SECONDARY arrays
// below.
function AdminTabsBar({
  tab,
  setTab,
  requestsCount,
  pendingTherapists,
  allTherapists,
  emailTemplatesCount,
  onLoadEmailTemplates,
  refSources,
  onLoadReferralSources,
  outreach,
  onLoadOutreach,
  optOuts,
  onLoadOptOuts,
  feedback,
  onLoadFeedback,
  patientsByEmail,
  onLoadPatients,
  team,
  onLoadTeam,
  completion,
  onLoadCompletion,
  coverageGap,
  onLoadCoverageGap,
  referralAnalytics,
  onLoadReferralAnalytics,
}) {
  const PRIMARY = [
    {
      id: "requests",
      label: "Requests",
      icon: <Inbox size={14} />,
      count: requestsCount,
    },
    {
      id: "therapists",
      label: "Pending therapists",
      icon: <UserCheck size={14} />,
      count: pendingTherapists,
      highlight: pendingTherapists > 0,
    },
    {
      id: "all_therapists",
      label: "All providers",
      icon: <Users size={14} />,
      count: allTherapists,
    },
    {
      id: "master_query",
      label: "Master Query",
      icon: <Sparkles size={14} />,
    },
  ];

  const SECONDARY = [
    {
      id: "patients",
      label: "Patients (by email)",
      icon: <Users size={14} />,
      count: patientsByEmail?.total ?? null,
      onClick: onLoadPatients,
    },
    {
      id: "completion",
      label: "Profile completion",
      icon: <UserCheck size={14} />,
      count: completion?.incomplete ?? null,
      highlight: (completion?.incomplete || 0) > 0,
      onClick: onLoadCompletion,
    },
    {
      id: "invited_therapists",
      label: "Invited therapists",
      icon: <UserPlus size={14} />,
      count: outreach?.total ?? null,
      onClick: onLoadOutreach,
    },
    {
      id: "coverage_gap",
      label: "Coverage gaps",
      icon: <AlertTriangle size={14} />,
      count:
        (coverageGap?.summary?.critical_gaps || 0) +
        (coverageGap?.summary?.warning_gaps || 0) || null,
      highlight: (coverageGap?.summary?.critical_gaps || 0) > 0,
      onClick: onLoadCoverageGap,
    },
    {
      id: "opt_outs",
      label: "Opt-outs",
      icon: <Ban size={14} />,
      count: optOuts?.total ?? null,
      onClick: onLoadOptOuts,
    },
    {
      id: "feedback",
      label: "Feedback",
      icon: <MessageSquare size={14} />,
      count: feedback?.total ?? null,
      onClick: onLoadFeedback,
    },
    {
      id: "referrals",
      label: "Referral analytics",
      icon: <Share2 size={14} />,
      onClick: onLoadReferralAnalytics,
    },
    {
      id: "referral_sources",
      label: "Referral sources",
      icon: <TrendingUp size={14} />,
      onClick: onLoadReferralSources,
    },
    {
      id: "team",
      label: "Team",
      icon: <Users size={14} />,
      count: team?.total ?? null,
      onClick: onLoadTeam,
    },
    {
      id: "blog",
      label: "Blog",
      icon: <Pencil size={14} />,
    },
    {
      id: "site_copy",
      label: "Site copy",
      icon: <Pencil size={14} />,
    },
    {
      id: "faqs",
      label: "FAQs",
      icon: <Pencil size={14} />,
    },
    {
      id: "settings",
      label: "Settings",
      icon: <Sliders size={14} />,
    },
    {
      id: "scrape_sources",
      label: "Scrape sources",
      icon: <ExternalLink size={14} />,
    },
    {
      id: "sms_status",
      label: "SMS status",
      icon: <MessageSquareWarning size={14} />,
    },
    {
      id: "email_templates",
      label: "Email templates",
      icon: <Mail size={14} />,
      count: emailTemplatesCount,
      onClick: onLoadEmailTemplates,
    },
    {
      id: "how_it_works",
      label: "How it works",
      icon: <Brain size={14} />,
    },
    {
      id: "simulator",
      label: "Matching simulator",
      icon: <Activity size={14} />,
    },
  ];

  const [moreOpen, setMoreOpen] = useState(false);
  const activeSecondary = SECONDARY.find((t) => t.id === tab);

  const handleClick = (entry) => {
    if (entry.onClick) entry.onClick();
    setTab(entry.id);
    setMoreOpen(false);
  };

  return (
    <div
      className="mt-8 border-b border-[#E8E5DF] flex flex-wrap items-end gap-x-1"
      data-testid="admin-tabs-bar"
    >
      {PRIMARY.map((entry) => (
        <TabBtn
          key={entry.id}
          active={tab === entry.id}
          onClick={() => handleClick(entry)}
          icon={entry.icon}
          label={entry.label}
          count={entry.count}
          testid={`tab-${entry.id}`}
          highlight={entry.highlight}
        />
      ))}

      {/* Active secondary tab gets pinned inline so admins know where they
          are; the rest stay tucked under "More". */}
      {activeSecondary && (
        <TabBtn
          active
          onClick={() => handleClick(activeSecondary)}
          icon={activeSecondary.icon}
          label={activeSecondary.label}
          count={activeSecondary.count}
          testid={`tab-${activeSecondary.id}`}
          highlight={activeSecondary.highlight}
        />
      )}

      <div className="relative">
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          className="flex items-center gap-1.5 px-4 py-3 text-sm border-b-2 border-transparent text-[#6D6A65] hover:text-[#2D4A3E] -mb-px whitespace-nowrap"
          data-testid="tab-more-btn"
          aria-expanded={moreOpen}
        >
          More
          <ChevronDown
            size={14}
            className={`transition ${moreOpen ? "rotate-180" : ""}`}
          />
        </button>
        {moreOpen && (
          <>
            <button
              type="button"
              onClick={() => setMoreOpen(false)}
              aria-label="Close menu"
              className="fixed inset-0 z-10 cursor-default"
            />
            <div
              // On mobile (up to sm), anchor the menu to the LEFT edge
              // of the trigger so the 256-px panel doesn't clip off the
              // left edge of a 375-px viewport. From sm+ we keep the
              // historical right-aligned position. The width also
              // clamps to the viewport so very narrow screens still
              // show every menu item.
              className="absolute left-0 sm:left-auto sm:right-0 z-20 mt-1 w-[min(16rem,calc(100vw-1.5rem))] sm:w-64 bg-white border border-[#E8E5DF] rounded-xl shadow-lg py-1"
              data-testid="tab-more-menu"
            >
              {SECONDARY.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => handleClick(entry)}
                  className={`flex items-center gap-2 w-full text-left px-3 py-2 text-sm hover:bg-[#FDFBF7] ${
                    tab === entry.id
                      ? "text-[#2D4A3E] font-semibold bg-[#FDFBF7]"
                      : "text-[#3F3D3B]"
                  }`}
                  data-testid={`more-tab-${entry.id}`}
                >
                  <span className="text-[#6D6A65]">{entry.icon}</span>
                  <span className="flex-1">{entry.label}</span>
                  {entry.count != null && (
                    <span
                      className={`text-[11px] rounded-full px-2 py-0.5 ${
                        entry.highlight
                          ? "bg-[#C87965] text-white"
                          : "bg-[#E8E5DF] text-[#6D6A65]"
                      }`}
                    >
                      {entry.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Th({ children }) {
  return (
    <th className="p-4 font-medium text-xs uppercase tracking-wider">{children}</th>
  );
}



function StatusBadge({ s, verified }) {
  const map = {
    pending_verification: "bg-[#C87965]/15 text-[#C87965]",
    open: "bg-[#2D4A3E]/10 text-[#2D4A3E]",
    matched: "bg-[#2D4A3E]/10 text-[#2D4A3E]",
    completed: "bg-[#4A6B5D]/15 text-[#4A6B5D]",
  };
  return (
    <span
      className={`inline-flex text-xs px-2.5 py-1 rounded-full ${map[s] || "bg-[#E8E5DF]"}`}
    >
      {verified ? s?.replace("_", " ") : "unverified"}
    </span>
  );
}

function ThresholdControl({ current, onChange }) {  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(current);
  return (
    <div className="relative">
      <button
        className="tv-btn-secondary !py-2 !px-4 text-sm"
        onClick={() => setOpen((o) => !o)}
        data-testid="threshold-btn"
      >
        <Sliders size={14} className="inline mr-1.5" /> Threshold ({current}%)
      </button>
      {open && (
        <div className="absolute right-0 mt-2 bg-white border border-[#E8E5DF] rounded-xl p-3 shadow-lg z-10 w-56">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[#6D6A65]">Match threshold</span>
            <button onClick={() => setOpen(false)}>
              <X size={14} className="text-[#6D6A65]" />
            </button>
          </div>
          <Input
            type="number"
            min="20"
            max="100"
            value={val}
            onChange={(e) => setVal(Number(e.target.value))}
            className="bg-[#FDFBF7] border-[#E8E5DF] rounded-lg text-sm"
            data-testid="threshold-input"
          />
          <button
            className="tv-btn-primary w-full mt-2 justify-center !py-2 text-sm"
            onClick={() => {
              onChange(val);
              setOpen(false);
            }}
            data-testid="threshold-save"
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}

function FieldRow({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-[#6D6A65] mb-1.5 uppercase tracking-wider">
        {label}
      </label>
      {children}
    </div>
  );
}

// Inline banner shown at the top of the Edit-provider modal whenever the
// therapist has self-edited a sensitive field (license #, specialties,
// etc.) via the portal. It explains EXACTLY which fields the therapist
// just changed, what the new values are, and gives the admin a one-click
// "approve & publish" action that calls
// POST /api/admin/therapists/{id}/clear-reapproval.
//
// Without this banner, the orange "⚠ Re-review: …" pill on the row was a
// dead-end — the admin saw something needed attention but had no way to
// resolve it from the UI (the backend route existed since iter-65 but
// was never wired up frontend-side).
function ReapprovalBanner({ therapist, onApprove }) {
  const fields = therapist.pending_reapproval_fields || [];
  const FIELD_LABELS = {
    primary_specialties: "Primary specialties",
    secondary_specialties: "Secondary specialties",
    general_treats: "General treatment areas",
    license_number: "License number",
    license_expires_at: "License expiration",
    licensed_states: "Licensed states",
    years_experience: "Years of experience",
    credential_type: "Credential type",
    gender: "Gender",
    name: "Name",
  };
  const fmtValue = (k, v) => {
    if (v == null || v === "") return "—";
    if (Array.isArray(v)) {
      return v.length ? v.map((x) => String(x).replace(/_/g, " ")).join(", ") : "—";
    }
    if (typeof v === "string" && k === "license_expires_at") {
      return v.slice(0, 10);
    }
    return String(v);
  };
  return (
    <div
      className="rounded-xl border border-[#F0DEC8] bg-[#FBF2E8] p-4"
      data-testid="reapproval-banner"
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-[#B8742A] text-white flex items-center justify-center text-sm">
          !
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#8B5A1F]">
            Therapist self-edited {fields.length || "some"} sensitive{" "}
            {fields.length === 1 ? "field" : "fields"} — review &amp; approve to
            publish
          </p>
          <p className="text-xs text-[#8B5A1F]/80 mt-1 leading-relaxed">
            These fields are NOT visible to patients yet. They go live the
            moment you click <strong>Approve &amp; publish</strong> below.
          </p>
          {fields.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {fields.map((k) => (
                <div
                  key={k}
                  className="text-xs flex items-baseline gap-2 bg-white/60 border border-[#F0DEC8] rounded-md px-2 py-1.5"
                  data-testid={`reapproval-field-${k}`}
                >
                  <span className="text-[#8B5A1F] font-medium whitespace-nowrap">
                    {FIELD_LABELS[k] || k.replace(/_/g, " ")}:
                  </span>
                  <span className="text-[#2B2A29] break-words">
                    {fmtValue(k, therapist[k])}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onApprove}
              className="text-xs font-semibold bg-[#2D4A3E] text-white rounded-full px-4 py-1.5 hover:bg-[#1F362C] transition"
              data-testid="reapproval-approve-btn"
            >
              Approve &amp; publish
            </button>
            <span className="text-[11px] text-[#8B5A1F]/70 self-center leading-tight">
              Or just edit the values below + Save — that also approves them.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}



function ProviderStatus({ t }) {
  let label = "active";
  let cls = "bg-[#2D4A3E]/10 text-[#2D4A3E]";
  if (t.pending_approval) {
    label = "pending";
    cls = "bg-[#C87965]/15 text-[#C87965]";
  } else if (t.is_active === false) {
    label = "rejected";
    cls = "bg-[#D45D5D]/15 text-[#D45D5D]";
  }
  return (
    <span className={`inline-flex text-xs px-2.5 py-1 rounded-full ${cls}`}>
      {label}
    </span>
  );
}

function LicenseBadge({ t }) {
  const s = t?.license_status || {};
  const verifyUrl = t?.license_verify_url;
  const palette = {
    ok: { bg: "#F2F4F0", text: "#2D4A3E", border: "#D9DDD2" },
    warn: { bg: "#FBF2E8", text: "#B8742A", border: "#F0DEC8" },
    error: { bg: "#FBE9E6", text: "#C8412B", border: "#F2CFC6" },
  };
  const p = palette[s.severity || "warn"];
  const icon = s.severity === "error" ? "✕" : s.severity === "warn" ? "!" : "✓";
  return (
    <div className="flex flex-col gap-1">
      <span
        className="inline-flex items-center gap-1 text-[10px] font-medium rounded-full px-2 py-0.5 w-fit"
        style={{ background: p.bg, color: p.text, border: `1px solid ${p.border}` }}
        title={s.status}
        data-testid={`license-badge-${t.id}`}
      >
        <span className="font-bold">{icon}</span>
        {s.label || "Unknown"}
      </span>
      {t?.license_number && (
        <span className="text-[10px] text-[#6D6A65] font-mono">#{t.license_number}</span>
      )}
      {verifyUrl && (
        <a
          href={verifyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-[#2D4A3E] underline hover:text-[#3A5E50]"
          data-testid={`license-verify-link-${t.id}`}
        >
          Verify on DOPL ↗
        </a>
      )}
    </div>
  );
}


function SubBadge({ t }) {
  const status = t?.subscription_status || "incomplete";
  const palette = {
    trialing: "bg-[#4A6B5D]/15 text-[#4A6B5D]",
    active: "bg-[#2D4A3E]/15 text-[#2D4A3E]",
    past_due: "bg-[#D45D5D]/15 text-[#D45D5D]",
    canceled: "bg-[#6D6A65]/15 text-[#6D6A65]",
    unpaid: "bg-[#D45D5D]/15 text-[#D45D5D]",
    incomplete: "bg-[#C87965]/15 text-[#C87965]",
    legacy_free: "bg-[#6D6A65]/10 text-[#6D6A65]",
  };
  return (
    <div
      className={`inline-flex text-[10px] px-2 py-0.5 rounded-full ${palette[status] || palette.incomplete}`}
      data-testid={`sub-badge-${t.id}`}
    >
      {status.replace("_", " ")}
    </div>
  );
}

// Column registry — single source of truth for the All-Providers table.
// Each column knows how to render its cell from the therapist record so the
// table body can be driven dynamically by the visible-columns array.
const PROVIDER_COLUMNS = [
  {
    key: "provider",
    label: "Provider",
    required: true,
    headClass: "",
    render: (t, ctx) => (
      <td className="p-4 max-w-[260px] align-top">
        {ctx?.onEdit ? (
          <button
            type="button"
            onClick={ctx.onEdit}
            className="font-medium text-[#2D4A3E] hover:text-[#3A5E50] hover:underline truncate text-left max-w-full block"
            title={`Edit ${t.name}'s profile`}
            data-testid={`provider-name-link-${t.id}`}
          >
            {t.name}
          </button>
        ) : (
          <div className="font-medium text-[#2B2A29] truncate" title={t.name}>
            {t.name}
          </div>
        )}
        {/* Each sub-detail on its own line so the column can stay narrow
            and we have horizontal room for additional columns. Credential
            uses the patient-friendly title (e.g., "Professional
            Counselor") instead of the bare letters. */}
        <div className="mt-1 space-y-0.5 text-[11px] text-[#6D6A65] leading-tight">
          {t.credential_type && (
            <div className="truncate" title={t.credential_type}>
              {credentialLabel(t.credential_type) || t.credential_type}
            </div>
          )}
          {t.years_experience != null && (
            <div>{t.years_experience} yrs experience</div>
          )}
          {t.email && (
            <div className="truncate" title={t.email}>
              {t.email}
            </div>
          )}
          {t.phone && <div>{t.phone}</div>}
        </div>
      </td>
    ),
  },
  {
    key: "status",
    label: "Status",
    render: (t, ctx) => (
      <td className="p-4 align-top">
        {/* Vertical stack so each badge gets its own row — leaves more
            horizontal room in the table for added columns. Each child is
            wrapped in `w-fit` via flex so the badges don't stretch. */}
        <div className="flex flex-col items-start gap-1">
          <ProviderStatus t={t} />
          <SubBadge t={t} />
          {t.pending_reapproval && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                ctx?.onEdit && ctx.onEdit(t);
              }}
              className="inline-flex items-center gap-1 text-[10px] bg-[#FBF2E8] text-[#B8742A] border border-[#F0DEC8] rounded-full px-2 py-0.5 max-w-[200px] hover:bg-[#F4E3CD] cursor-pointer transition"
              title={`Therapist edited ${(t.pending_reapproval_fields || []).join(", ") || "sensitive fields"}. Click to review and approve.`}
              data-testid={`pending-reapproval-badge-${t.id}`}
            >
              ⚠ Re-review:{" "}
              <span className="font-medium truncate">
                {((t.pending_reapproval_fields || []).map((f) =>
                  f.replace(/_/g, " "),
                ).join(", ")) || "fields"}
              </span>
            </button>
          )}
        </div>
      </td>
    ),
  },
  {
    key: "license",
    label: "License",
    render: (t) => (
      <td className="p-4 whitespace-nowrap">
        <LicenseBadge t={t} />
      </td>
    ),
  },
  {
    key: "reviews",
    label: "Reviews",
    render: (t) => (
      <td className="p-4 whitespace-nowrap">
        {t.review_count > 0 ? (
          <>
            <div className="font-medium text-[#C87965] text-sm">
              {"★".repeat(Math.round(t.review_avg || 0))}
              <span className="text-[#E8E5DF]">
                {"★".repeat(5 - Math.round(t.review_avg || 0))}
              </span>
            </div>
            <div className="text-[11px] text-[#6D6A65]">
              {(t.review_avg ?? 0).toFixed(1)} · {t.review_count} review
              {t.review_count === 1 ? "" : "s"}
            </div>
          </>
        ) : (
          <span className="text-xs text-[#C8C4BB]">No reviews</span>
        )}
      </td>
    ),
  },
  {
    key: "rate",
    label: "Rate",
    render: (t) => {
      const offices = t.office_locations || [];
      const inPerson = t.offers_in_person ?? (offices.length > 0);
      const telehealth = t.telehealth ?? (t.modality_offering === "telehealth" || t.modality_offering === "both");
      const formatHint = inPerson && telehealth
        ? "In-person + telehealth"
        : inPerson
          ? `In-person${offices[0] ? ` · ${offices[0]}` : ""}`
          : "Telehealth only";
      return (
        <td className="p-4 whitespace-nowrap">
          <div className="text-[#2B2A29] font-medium">
            ${t.cash_rate ?? "—"}
          </div>
          <div className="text-[11px] text-[#6D6A65]">
            {t.sliding_scale && <span className="text-[#C87965]">sliding scale</span>}
            {t.free_consult && (
              <span className={t.sliding_scale ? "ml-2" : ""}>free consult</span>
            )}
            {!t.sliding_scale && !t.free_consult && "per session"}
          </div>
          <div className="text-[10px] text-[#6D6A65] mt-1 truncate max-w-[160px]" title={formatHint}>
            {formatHint}
          </div>
        </td>
      );
    },
  },
  {
    key: "specialties",
    label: "Specialties",
    render: (t) => {
      const specs = [
        ...(t.primary_specialties || []),
        ...(t.secondary_specialties || []),
      ];
      const insurances = t.insurance_accepted || [];
      return (
        <td className="p-4 text-xs text-[#2B2A29] max-w-[280px]">
          {specs.length > 0 ? (
            <div className="leading-snug" title={specs.join(", ")}>
              {specs.slice(0, 2).map((s) => (typeof s === "string" ? s : s?.name || "")).filter(Boolean).join(", ")}
              {specs.length > 2 && <span className="text-[#6D6A65]"> +{specs.length - 2}</span>}
            </div>
          ) : (
            <span className="text-[#C8C4BB]">—</span>
          )}
          <div className="text-[11px] text-[#6D6A65] mt-1 truncate" title={insurances.join(", ") || "Cash only"}>
            {insurances.length > 0
              ? `Insurance: ${insurances.slice(0, 2).join(", ")}${insurances.length > 2 ? ` +${insurances.length - 2}` : ""}`
              : "Cash only"}
          </div>
        </td>
      );
    },
  },
  // Optional columns — admin can opt-in via the columns editor.
  {
    key: "phone",
    label: "Phone",
    render: (t) => (
      <td className="p-4 whitespace-nowrap text-xs text-[#2B2A29]">
        {t.phone || t.phone_alert || t.office_phone || "—"}
      </td>
    ),
  },
  {
    key: "modality",
    label: "Format",
    render: (t) => (
      <td className="p-4 whitespace-nowrap text-xs text-[#2B2A29]">
        {t.modality_offering || (t.telehealth ? "telehealth" : "—")}
      </td>
    ),
  },
  {
    key: "office_addresses",
    label: "Office address",
    render: (t) => (
      <td className="p-4 text-xs text-[#2B2A29] max-w-[260px]">
        <div className="truncate" title={(t.office_addresses || []).join(" | ")}>
          {(t.office_addresses && t.office_addresses[0]) ||
            (t.office_locations && t.office_locations[0]) || "—"}
        </div>
      </td>
    ),
  },
  {
    key: "languages",
    label: "Languages",
    render: (t) => {
      const langs = ["English", ...(t.languages_spoken || [])];
      return (
        <td className="p-4 whitespace-nowrap text-xs text-[#2B2A29]">
          {langs.join(", ")}
        </td>
      );
    },
  },
  {
    key: "age_groups",
    label: "Age groups",
    render: (t) => (
      <td className="p-4 text-xs text-[#2B2A29] max-w-[220px]">
        <div className="truncate" title={(t.age_groups || []).join(", ")}>
          {(t.age_groups || []).join(", ") || "—"}
        </div>
      </td>
    ),
  },
  {
    key: "client_types",
    label: "Client types",
    render: (t) => (
      <td className="p-4 whitespace-nowrap text-xs text-[#2B2A29]">
        {(t.client_types || []).join(", ") || "—"}
      </td>
    ),
  },
  {
    key: "modalities",
    label: "Modalities",
    render: (t) => (
      <td className="p-4 text-xs text-[#2B2A29] max-w-[220px]">
        <div className="truncate" title={(t.modalities || []).join(", ")}>
          {(t.modalities || []).slice(0, 3).join(", ") || "—"}
          {(t.modalities || []).length > 3 && (
            <span className="text-[#6D6A65]"> +{(t.modalities || []).length - 3}</span>
          )}
        </div>
      </td>
    ),
  },
  {
    key: "website",
    label: "Website",
    render: (t) => (
      <td className="p-4 whitespace-nowrap text-xs text-[#2D4A3E] max-w-[220px]">
        {t.website ? (
          <a
            href={t.website.startsWith("http") ? t.website : `https://${t.website}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-dotted truncate inline-block max-w-full align-bottom"
          >
            {t.website.replace(/^https?:\/\//, "")}
          </a>
        ) : "—"}
      </td>
    ),
  },
  {
    key: "subscription",
    label: "Subscription",
    render: (t) => (
      <td className="p-4 whitespace-nowrap text-xs text-[#2B2A29]">
        {t.subscription_status || "—"}
      </td>
    ),
  },
  {
    key: "created_at",
    label: "Joined",
    render: (t) => (
      <td className="p-4 whitespace-nowrap text-xs text-[#6D6A65]">
        {t.created_at
          ? new Date(t.created_at).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })
          : "—"}
      </td>
    ),
  },
];

const PROVIDER_DEFAULT_COLUMNS = [
  "provider", "status", "license", "reviews", "rate", "specialties",
];

// Hook for persisting visible columns + an admin-saved default per browser.
// Stored under two keys so an admin can override their working set without
// losing the defaults they previously committed.
function useProviderColumnPrefs() {
  const [defaultCols, setDefaultColsState] = useState(() => {
    try {
      const raw = localStorage.getItem("tv_admin_provider_default_cols");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch { /* ignore */ }
    return [...PROVIDER_DEFAULT_COLUMNS];
  });
  const [visibleCols, setVisibleColsState] = useState(() => {
    try {
      const raw = localStorage.getItem("tv_admin_provider_visible_cols");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch { /* ignore */ }
    return [...PROVIDER_DEFAULT_COLUMNS];
  });
  const setVisibleCols = (next) => {
    setVisibleColsState(next);
    try {
      localStorage.setItem("tv_admin_provider_visible_cols", JSON.stringify(next));
    } catch { /* ignore */ }
  };
  const setDefaultCols = (next) => {
    setDefaultColsState(next);
    try {
      localStorage.setItem("tv_admin_provider_default_cols", JSON.stringify(next));
    } catch { /* ignore */ }
  };
  return { visibleCols, setVisibleCols, defaultCols, setDefaultCols };
}

function ProviderRow({
  t, onEdit, onPreview, onArchive, onRestore, onDelete, onDeepResearch, visibleCols,
}) {
  const cols = PROVIDER_COLUMNS.filter((c) => visibleCols.includes(c.key));
  const archived = t.is_active === false;
  const [drExpanded, setDrExpanded] = useState(false);
  const [drBusy, setDrBusy] = useState(false);
  const [drResult, setDrResult] = useState(null);

  const runDeep = async () => {
    if (!onDeepResearch) return;
    setDrBusy(true);
    try {
      const res = await onDeepResearch(t);
      setDrResult(res);
      setDrExpanded(true);
    } finally {
      setDrBusy(false);
    }
  };

  return (
    <>
    <tr
      className={`border-t border-[#E8E5DF] hover:bg-[#FDFBF7] align-top ${archived ? "opacity-50" : ""}`}
      data-testid={`provider-row-${t.id}`}
    >
      {cols.map((c) => (
        <ProviderCell key={c.key} column={c} therapist={t} onEdit={onEdit} />
      ))}
      <td className="p-4 text-right whitespace-nowrap w-px">
        <div className="inline-flex flex-col items-end gap-1">
          {/* Edit · Preview share a row — most-used actions, side-by-side */}
          <div className="inline-flex items-center gap-3">
            <button
              className="text-[#2D4A3E] hover:underline text-xs inline-flex items-center gap-1"
              onClick={onEdit}
              data-testid={`edit-provider-${t.id}`}
            >
              <Pencil size={12} /> Edit
            </button>
            <span className="text-[#E8E5DF]">|</span>
            <button
              className="text-[#C87965] hover:underline text-xs inline-flex items-center gap-1"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (onPreview) onPreview(t);
              }}
              data-testid={`preview-provider-${t.id}`}
              title="Preview the therapist's profile as a patient would see it"
            >
              <Eye size={12} /> Preview
            </button>
          </div>
          {onDeepResearch ? (
            <button
              className="text-[#C87965] hover:text-[#a96050] hover:underline text-xs inline-flex items-center gap-1 disabled:opacity-50"
              onClick={runDeep}
              disabled={drBusy}
              title="Run LLM deep research — DuckDuckGo + 5 web pages + AI extraction (~30-60s)"
              data-testid={`deep-research-provider-${t.id}`}
            >
              {drBusy ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Sparkles size={12} />
              )}{" "}
              {drBusy ? "Researching" : "Deep research"}
            </button>
          ) : null}
          {archived ? (
            <button
              className="text-[#2D4A3E] hover:underline text-xs inline-flex items-center gap-1"
              onClick={onRestore}
              data-testid={`restore-provider-${t.id}`}
              title="Restore — make this provider active again"
            >
              <RotateCw size={12} /> Restore
            </button>
          ) : (
            <button
              className="text-[#6D6A65] hover:text-[#2D4A3E] hover:underline text-xs inline-flex items-center gap-1"
              onClick={onArchive}
              data-testid={`archive-provider-${t.id}`}
              title="Archive — hides from matching but keeps history"
            >
              <Ban size={12} /> Archive
            </button>
          )}
          <button
            className="text-[#B0382A] hover:underline text-xs inline-flex items-center gap-1"
            onClick={onDelete}
            data-testid={`delete-provider-${t.id}`}
            title="Hard delete — only allowed if no applications reference this provider"
          >
            <Trash2 size={12} /> Delete
          </button>
        </div>
      </td>
    </tr>
    {drExpanded && drResult ? (
      <tr
        className="border-t border-[#F4C7BE] bg-[#FBE9E5]"
        data-testid={`deep-research-result-${t.id}`}
      >
        <td colSpan={cols.length + 1} className="p-4 text-xs">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="flex-1">
              <div className="text-[10px] uppercase tracking-wider text-[#C87965] font-semibold">
                Deep research · {drResult.depth_signal} depth ·{" "}
                {(drResult.extra_sources || []).length} extra sources fetched
              </div>
              <div className="mt-1 text-[#2B2A29] leading-relaxed">
                {drResult.summary || "(no summary returned)"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setDrExpanded(false)}
              className="text-[#6D6A65] hover:text-[#2B2A29] text-[10px]"
            >
              Close
            </button>
          </div>
          {Object.keys(drResult.evidence_themes || {}).length > 0 ? (
            <div className="mt-2">
              <div className="text-[10px] uppercase tracking-wider text-[#6D6A65] mb-1">
                Specialty evidence
              </div>
              <ul className="space-y-1">
                {Object.entries(drResult.evidence_themes).map(([k, v]) => (
                  <li key={k} className="text-[#2B2A29]">
                    <strong className="text-[#2D4A3E]">
                      {k.replaceAll("_", " ")}:
                    </strong>{" "}
                    {v}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {(drResult.public_footprint || []).length > 0 ? (
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wider text-[#6D6A65] mb-1">
                Public footprint
              </div>
              <ul className="list-disc ml-4 space-y-0.5">
                {drResult.public_footprint.map((f, i) => (
                  <li key={`${f.slice(0, 40)}-${i}`}>{f}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {(drResult.extra_sources || []).length > 0 ? (
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wider text-[#6D6A65] mb-1">
                Sources researched
              </div>
              <ul className="space-y-0.5">
                {drResult.extra_sources.map((u) => (
                  <li key={u}>
                    <a
                      href={u}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#2D4A3E] hover:underline break-all"
                    >
                      {u}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </td>
      </tr>
    ) : null}
    </>
  );
}

// Wrapper so React can key off `column.key` while still rendering the
// real <td> element produced by `column.render(therapist)`.
function ProviderCell({ column, therapist, onEdit }) {
  return column.render(therapist, { onEdit });
}

function ProviderTableControls({
  total, visibleTotal, showOnlyReapproval, setShowOnlyReapproval,
  pageSize, setPageSize, setPage, pendingCount,
  visibleCols, setVisibleCols, defaultCols, setDefaultCols,
}) {
  const [showColMenu, setShowColMenu] = useState(false);
  return (
    <div className="flex items-center gap-3 p-4 border-b border-[#E8E5DF] flex-wrap">
      <span className="text-xs text-[#6D6A65]">
        Showing <strong className="text-[#2B2A29]">{visibleTotal}</strong> of {total}
      </span>
      <button
        onClick={() => {
          setShowOnlyReapproval((v) => !v);
          setPage(0);
        }}
        className={`text-xs px-3 py-1 rounded-full border transition ${
          showOnlyReapproval
            ? "bg-[#FBF2E8] border-[#F0DEC8] text-[#B8742A]"
            : "bg-white border-[#E8E5DF] text-[#6D6A65] hover:border-[#B8742A]"
        }`}
        data-testid="filter-pending-reapproval"
      >
        ⚠ Needs re-review ({pendingCount})
      </button>
      <div className="ml-auto flex items-center gap-3 text-xs text-[#6D6A65]">
        {/* Columns editor — open inline dropdown */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowColMenu((v) => !v)}
            className="px-3 py-1 rounded-md border border-[#E8E5DF] hover:border-[#2D4A3E] text-[#2B2A29] inline-flex items-center gap-1.5"
            data-testid="provider-columns-trigger"
            aria-expanded={showColMenu}
          >
            Columns ({visibleCols.length})
            {showColMenu ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          {showColMenu && (
            <div
              className="absolute right-0 top-full mt-2 w-72 max-h-[60vh] overflow-y-auto bg-white border border-[#E8E5DF] rounded-xl shadow-lg z-30 p-3"
              data-testid="provider-columns-menu"
            >
              <div className="text-[10px] uppercase tracking-wider text-[#6D6A65] mb-2">
                Choose columns
              </div>
              <div className="space-y-1">
                {PROVIDER_COLUMNS.map((c) => {
                  const checked = visibleCols.includes(c.key);
                  return (
                    <label
                      key={c.key}
                      className="flex items-center gap-2 text-sm text-[#2B2A29] py-1 px-2 rounded hover:bg-[#FDFBF7] cursor-pointer"
                      data-testid={`col-toggle-${c.key}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          if (checked) {
                            // Don't allow zero columns
                            if (visibleCols.length <= 1) return;
                            setVisibleCols(visibleCols.filter((x) => x !== c.key));
                          } else {
                            // Preserve registry order so the table reads naturally
                            setVisibleCols(
                              PROVIDER_COLUMNS
                                .map((x) => x.key)
                                .filter((k) => k === c.key || visibleCols.includes(k))
                            );
                          }
                        }}
                      />
                      <span className="flex-1">{c.label}</span>
                      {c.required && (
                        <span className="text-[9px] uppercase text-[#C87965]">core</span>
                      )}
                    </label>
                  );
                })}
              </div>
              <div className="mt-3 pt-3 border-t border-[#E8E5DF] flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setVisibleCols(defaultCols)}
                  className="text-xs px-3 py-1 rounded-md border border-[#E8E5DF] hover:border-[#2D4A3E] text-[#2B2A29]"
                  data-testid="cols-reset-default"
                >
                  Reset to default
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDefaultCols([...visibleCols]);
                    toast.success("Default columns saved.");
                  }}
                  className="text-xs px-3 py-1 rounded-md bg-[#2D4A3E] text-white hover:bg-[#3A5E50]"
                  data-testid="cols-save-default"
                >
                  Save as default
                </button>
                <button
                  type="button"
                  onClick={() => setShowColMenu(false)}
                  className="text-xs text-[#6D6A65] hover:text-[#2D4A3E] ml-auto"
                  data-testid="cols-close"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
        <label htmlFor="provider-page-size">Rows per page:</label>
        <select
          id="provider-page-size"
          value={pageSize}
          onChange={(e) => {
            setPageSize(Number(e.target.value));
            setPage(0);
          }}
          className="border border-[#E8E5DF] rounded-md px-2 py-1 text-xs bg-white text-[#2B2A29]"
          data-testid="provider-page-size"
        >
          <option value={10}>10</option>
          <option value={20}>20</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
        </select>
      </div>
    </div>
  );
}

function ProviderTablePager({ total, pageSize, page, setPage }) {
  if (total <= pageSize) return null;
  const pageCount = Math.ceil(total / pageSize);
  const from = page * pageSize + 1;
  const to = Math.min(total, from + pageSize - 1);
  return (
    <div className="flex items-center justify-between gap-3 p-3 border-t border-[#E8E5DF] text-xs text-[#6D6A65] flex-wrap">
      <span>
        Showing <strong className="text-[#2B2A29]">{from}–{to}</strong> of {total}
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => setPage(Math.max(0, page - 1))}
          disabled={page === 0}
          className="px-3 py-1 rounded-md border border-[#E8E5DF] disabled:opacity-50 hover:border-[#2D4A3E] text-[#2B2A29]"
          data-testid="provider-page-prev"
        >
          ← Prev
        </button>
        <span className="px-2 text-[#2B2A29] font-medium">
          {page + 1} / {pageCount}
        </span>
        <button
          onClick={() => setPage(Math.min(pageCount - 1, page + 1))}
          disabled={page >= pageCount - 1}
          className="px-3 py-1 rounded-md border border-[#E8E5DF] disabled:opacity-50 hover:border-[#2D4A3E] text-[#2B2A29]"
          data-testid="provider-page-next"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
