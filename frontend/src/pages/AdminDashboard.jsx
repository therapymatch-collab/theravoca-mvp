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
} from "lucide-react";
import { Header, Footer } from "@/components/SiteShell";
import { adminClient } from "@/lib/api";
import { ADMIN_POLL_INTERVAL_MS, STATUS_UNAUTHORIZED } from "@/lib/constants";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

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
  const client = adminClient(pwd);
  const [stats, setStats] = useState(null);
  const [requests, setRequests] = useState([]);
  const [pendingTherapists, setPendingTherapists] = useState([]);
  const [allTherapists, setAllTherapists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("requests");
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [editTherapist, setEditTherapist] = useState(null);
  const [savingTherapist, setSavingTherapist] = useState(false);
  const [emailTemplates, setEmailTemplates] = useState([]);
  const [editingTplKey, setEditingTplKey] = useState(null);
  const [tplFields, setTplFields] = useState({});
  const [savingTpl, setSavingTpl] = useState(false);
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
    () => pendingTherapists.filter((t) =>
      matches(search, t.name, t.email, t.credential_type, t.license_number,
        (t.modalities || []).join(" "), (t.primary_specialties || []).join(" ")),
    ),
    [pendingTherapists, search, matches],
  );
  const filteredAllTherapists = useMemo(
    () => allTherapists.filter((t) =>
      matches(search, t.name, t.email, t.credential_type, t.license_number,
        (t.modalities || []).join(" "), (t.primary_specialties || []).join(" "),
        (t.office_locations || []).join(" "), t.subscription_status),
    ),
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
        navigate("/admin");
      }
    } finally {
      setLoading(false);
    }
  }, [client, navigate]);

  useEffect(() => {
    if (!pwd) {
      navigate("/admin");
      return;
    }
    refresh();
    const intervalId = setInterval(refresh, ADMIN_POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [pwd, navigate, refresh]);

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
      "Searches Psychology Today's live directory + Claude for additional Idaho therapists who match this patient's brief, " +
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

  const sendTestSms = async () => {
    try {
      const res = await client.post("/admin/test-sms", {});
      if (res.data?.ok) {
        toast.success(`SMS queued — sid ${res.data.sid?.slice(0, 12)}…`);
      } else {
        toast.error(res.data?.detail || "SMS not sent — check Twilio config");
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "SMS send failed");
    }
  };

  const runBackfill = async () => {
    if (!confirm(
      "Backfill ALL therapist profiles with realistic fake data + therapymatch+tNNN@gmail.com emails?\n\nThis is idempotent (only fills missing fields)."
    )) return;
    try {
      const res = await client.post("/admin/backfill-therapists", {});
      toast.success(`Backfill done — ${res.data.updated}/${res.data.scanned} updated`);
      refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Backfill failed");
    }
  };

  const [researchingReviews, setResearchingReviews] = useState(false);
  const runReviewResearch = async () => {
    if (!confirm(
      "Run LLM review research across all active therapists who haven't been researched in 30+ days?\n\n" +
      "This calls Claude Sonnet 4.5 to recall public review data (Psychology Today, Google, Yelp, Healthgrades). " +
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
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <Header minimal />
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

              <div className="mt-10 flex gap-2 border-b border-[#E8E5DF]">
                <TabBtn
                  active={tab === "requests"}
                  onClick={() => setTab("requests")}
                  icon={<Inbox size={14} />}
                  label="Patient requests"
                  count={requests.length}
                  testid="tab-requests"
                />
                <TabBtn
                  active={tab === "therapists"}
                  onClick={() => setTab("therapists")}
                  icon={<Users size={14} />}
                  label="Therapist signups"
                  count={pendingTherapists.length}
                  testid="tab-therapists"
                  highlight={pendingTherapists.length > 0}
                />
                <TabBtn
                  active={tab === "all_therapists"}
                  onClick={() => setTab("all_therapists")}
                  icon={<UserCheck size={14} />}
                  label="All providers"
                  count={allTherapists.length}
                  testid="tab-all-therapists"
                />
                <TabBtn
                  active={tab === "email_templates"}
                  onClick={() => {
                    setTab("email_templates");
                    if (emailTemplates.length === 0) loadEmailTemplates();
                  }}
                  icon={<Mail size={14} />}
                  label="Email templates"
                  count={emailTemplates.length || null}
                  testid="tab-email-templates"
                />
                <TabBtn
                  active={tab === "referral_sources"}
                  onClick={() => {
                    setTab("referral_sources");
                    if (!refSources) loadReferralSources();
                    if (!refOptionsLoaded) loadRefOptions();
                  }}
                  icon={<Sliders size={14} />}
                  label="Referral sources"
                  count={refSources?.sources?.length || null}
                  testid="tab-referral-sources"
                />
                <TabBtn
                  active={tab === "invited_therapists"}
                  onClick={() => {
                    setTab("invited_therapists");
                    if (!outreach) loadOutreach();
                  }}
                  icon={<Send size={14} />}
                  label="Invited therapists"
                  count={outreach?.total ?? null}
                  testid="tab-invited-therapists"
                />
                <TabBtn
                  active={tab === "coverage_gap"}
                  onClick={() => {
                    setTab("coverage_gap");
                    if (!coverageGap) loadCoverageGap();
                    if (!recruitDrafts) loadRecruitDrafts();
                  }}
                  icon={<TrendingUp size={14} />}
                  label="Coverage gaps"
                  count={coverageGap?.gap_summary?.total ?? null}
                  testid="tab-coverage-gap"
                  highlight={(coverageGap?.gap_summary?.critical ?? 0) > 0}
                />
                <TabBtn
                  active={tab === "referrals"}
                  onClick={() => {
                    setTab("referrals");
                    if (!referralAnalytics) loadReferralAnalytics();
                  }}
                  icon={<Share2 size={14} />}
                  label="Referrals"
                  count={
                    referralAnalytics
                      ? (referralAnalytics.patient_referrals.total_invited +
                         referralAnalytics.therapist_referrals.total_invited)
                      : null
                  }
                  testid="tab-referrals"
                />
              </div>

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
              <div className="mt-6 bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden">
                <table className="w-full text-sm" data-testid="requests-table">
                  <thead className="bg-[#FDFBF7] text-[#6D6A65]">
                    <tr className="text-left">
                      <Th>Email</Th>
                      <Th>Age / State</Th>
                      <Th>Status</Th>
                      <Th>Source</Th>
                      <Th>Notified</Th>
                      <Th>Apps</Th>
                      <Th>Invited</Th>
                      <Th>Threshold</Th>
                      <Th>Created</Th>
                      <Th></Th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.length === 0 && (
                      <tr>
                        <td colSpan={10} className="p-10 text-center text-[#6D6A65]">
                          No requests yet.
                        </td>
                      </tr>
                    )}
                    {filteredRequests.map((r) => (
                      <tr
                        key={r.id}
                        className="border-t border-[#E8E5DF] hover:bg-[#FDFBF7] cursor-pointer"
                        onClick={() => openDetail(r.id)}
                        data-testid={`request-row-${r.id}`}
                      >
                        <td className="p-4">
                          <div className="text-[#2B2A29] font-medium">{r.email}</div>
                          <div className="text-xs text-[#6D6A65]">
                            {r.id.slice(0, 8)}
                          </div>
                        </td>
                        <td className="p-4 text-[#2B2A29]">
                          {r.client_age} / {r.location_state}
                        </td>
                        <td className="p-4">
                          <StatusBadge s={r.status} verified={r.verified} />
                        </td>
                        <td
                          className="p-4 text-xs text-[#2B2A29] max-w-[140px] truncate"
                          title={r.referral_source || ""}
                          data-testid={`request-referral-source-${r.id}`}
                        >
                          {r.referral_source || (
                            <span className="text-[#C8C4BB] italic">—</span>
                          )}
                        </td>
                        <td className="p-4">{r.notified_count || 0}</td>
                        <td className="p-4 font-semibold text-[#2D4A3E]">
                          {r.application_count || 0}
                        </td>
                        <td
                          className="p-4 font-semibold text-[#C87965]"
                          data-testid={`request-invited-count-${r.id}`}
                          title="LLM outreach invites sent for this request"
                        >
                          {r.invited_count || 0}
                        </td>
                        <td className="p-4">{r.threshold}%</td>
                        <td className="p-4 text-xs text-[#6D6A65]">
                          {new Date(r.created_at).toLocaleString()}
                        </td>
                        <td className="p-4 text-[#6D6A65]">
                          <ChevronRight size={16} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              )}

              {tab === "therapists" && (
                <div className="mt-6 bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden">
                  {pendingTherapists.length === 0 ? (
                    <div className="p-12 text-center text-[#6D6A65]">
                      <Users className="mx-auto mb-3 text-[#C87965]" size={28} strokeWidth={1.5} />
                      No therapist signups awaiting review.
                    </div>
                  ) : (
                    <div className="divide-y divide-[#E8E5DF]" data-testid="pending-therapists-list">
                      {filteredPendingTherapists.map((t) => (
                        <div key={t.id} className="p-5 flex items-start gap-5 hover:bg-[#FDFBF7]">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3 flex-wrap">
                              <h4 className="font-medium text-[#2B2A29]">{t.name}</h4>
                              <span className="text-xs text-[#6D6A65]">{t.email}</span>
                              {t.phone && (
                                <span className="text-xs text-[#6D6A65]">• {t.phone}</span>
                              )}
                            </div>
                            <div className="text-xs text-[#6D6A65] mt-1">
                              {t.years_experience} yrs • ${t.cash_rate}/session •{" "}
                              {t.modalities?.join(", ")} •{" "}
                              {(t.specialties || []).map((s) => `${s.name} (${s.weight})`).join(", ")}
                            </div>
                            {t.bio && (
                              <p className="text-sm text-[#2B2A29] mt-2 leading-relaxed">
                                {t.bio}
                              </p>
                            )}
                            <div className="text-xs text-[#6D6A65] mt-2">
                              Cities: {t.office_locations?.join(", ") || "telehealth only"} •
                              Insurance: {t.insurance_accepted?.length ? t.insurance_accepted.join(", ") : "—"} •
                              Ages: {t.ages_served?.join(", ")}
                            </div>
                          </div>
                          <div className="flex flex-col gap-2 shrink-0">
                            <button
                              className="tv-btn-primary !py-1.5 !px-4 text-sm"
                              onClick={() => approveTherapist(t.id)}
                              data-testid={`approve-${t.id}`}
                            >
                              <CheckCircle2 size={14} className="inline mr-1.5" /> Approve
                            </button>
                            <button
                              className="text-sm text-[#D45D5D] hover:underline"
                              onClick={() => rejectTherapist(t.id)}
                              data-testid={`reject-${t.id}`}
                            >
                              <XCircle size={14} className="inline mr-1.5" /> Reject
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {tab === "all_therapists" && (
                <div className="mt-6 bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden">
                  <table className="w-full text-sm" data-testid="all-therapists-table">
                    <thead className="bg-[#FDFBF7] text-[#6D6A65]">
                      <tr className="text-left">
                        <Th>Name</Th>
                        <Th>Email</Th>
                        <Th>Status</Th>
                        <Th>Rate</Th>
                        <Th>Specialties</Th>
                        <Th>Cities</Th>
                        <Th></Th>
                      </tr>
                    </thead>
                    <tbody>
                      {allTherapists.length === 0 && (
                        <tr>
                          <td colSpan={7} className="p-10 text-center text-[#6D6A65]">
                            No providers in the directory yet.
                          </td>
                        </tr>
                      )}
                      {filteredAllTherapists.map((t) => (
                        <tr
                          key={t.id}
                          className="border-t border-[#E8E5DF] hover:bg-[#FDFBF7]"
                          data-testid={`provider-row-${t.id}`}
                        >
                          <td className="p-4">
                            <div className="font-medium text-[#2B2A29]">{t.name}</div>
                            <div className="text-xs text-[#6D6A65]">
                              {t.years_experience ?? "?"} yrs •{" "}
                              {(t.gender || "—")}
                            </div>
                          </td>
                          <td className="p-4 text-[#2B2A29] text-xs break-all">{t.email}</td>
                          <td className="p-4">
                            <ProviderStatus t={t} />
                            <SubBadge t={t} />
                          </td>
                          <td className="p-4 text-[#2B2A29]">
                            ${t.cash_rate ?? "—"}
                            {t.sliding_scale ? (
                              <span className="ml-1 text-[10px] uppercase tracking-wider text-[#C87965]">
                                + sliding
                              </span>
                            ) : null}
                          </td>
                          <td className="p-4 text-xs text-[#2B2A29]">
                            {(t.primary_specialties || []).slice(0, 2).join(", ") || "—"}
                          </td>
                          <td className="p-4 text-xs text-[#6D6A65]">
                            {(t.office_locations || []).slice(0, 2).join(", ") ||
                              (t.modality_offering === "telehealth" ? "telehealth" : "—")}
                          </td>
                          <td className="p-4 text-right">
                            <button
                              className="text-[#2D4A3E] hover:underline text-xs inline-flex items-center gap-1"
                              onClick={() => setEditTherapist({ ...t })}
                              data-testid={`edit-provider-${t.id}`}
                            >
                              <Pencil size={12} /> Edit
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
                      Production note: real Psychology Today / state-board
                      scraping is not yet wired up — the LLM uses its training
                      data to seed plausible candidates. Swap in a scraper at{" "}
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

              {tab === "coverage_gap" && (
                <>
                  <CoverageGapPanel
                    data={coverageGap}
                    loading={coverageGapLoading}
                    onReload={loadCoverageGap}
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
                          <button
                            className="text-[#2D4A3E] hover:underline text-sm inline-flex items-center gap-1.5"
                            onClick={() => startEditTpl(t.key)}
                            data-testid={`edit-template-${t.key}`}
                          >
                            <Pencil size={14} /> Edit
                          </button>
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
          <DialogFooter className="mt-4 flex gap-2 justify-end">
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
                      <MatchedProviderCard key={t.id} t={t} />
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
                            {(inv.source || c.source) === "psychology_today" && (
                              <span className="inline-flex items-center gap-1 bg-[#F2F4F0] text-[#2D4A3E] border border-[#D9DDD2] rounded-full px-2 py-0.5">
                                Psychology Today
                              </span>
                            )}
                            {c.profile_url && (
                              <a
                                href={c.profile_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[#2D4A3E] underline hover:text-[#3A5E50]"
                              >
                                View PT profile ↗
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
  );
}

function RequestFullBrief({ request }) {
  if (!request) return null;
  const fields = [
    { label: "Patient email", value: request.email },
    { label: "Phone", value: request.phone || "—" },
    { label: "Location", value: `${request.location_city || ""} ${request.location_state || ""} ${request.location_zip || ""}`.trim() || "—" },
    { label: "Client age / type", value: `${request.client_age || "—"} · ${request.client_type || "—"}` },
    { label: "Age group", value: request.age_group || "—" },
    { label: "Session format", value: request.session_format || request.modality_preference || "—" },
    { label: "Urgency", value: request.urgency || "—" },
    { label: "Prior therapy", value: request.prior_therapy || "—" },
    { label: "Experience pref", value: Array.isArray(request.experience_preference) ? request.experience_preference.join(", ") : (request.experience_preference || "—") },
    { label: "Gender pref", value: request.gender_preference || "no_pref" },
    { label: "Style pref", value: Array.isArray(request.style_preference) ? request.style_preference.join(", ") : (request.style_preference || "—") },
    { label: "Modality pref", value: Array.isArray(request.modality_preferences) ? request.modality_preferences.join(", ") : (request.modality_preferences || "—") },
    { label: "Payment", value: request.payment_type === "cash" ? `Cash $${request.budget || "?"}` : (request.insurance_name || "Insurance") },
    { label: "Threshold", value: (() => {
      const t = request.threshold;
      if (t == null) return "—";
      const num = Number(t);
      // Backwards-compat: thresholds stored as 0–1 fraction OR 0–100 integer.
      const pct = num <= 1 ? num * 100 : num;
      return `${Math.round(pct)}%`;
    })() },
    { label: "Status", value: request.status || "—" },
    { label: "Referral source", value: request.referral_source || "—" },
    { label: "Referred by code", value: request.referred_by_patient_code || "—" },
    { label: "SMS opt-in", value: request.sms_opt_in ? "Yes" : "No" },
    { label: "Created", value: request.created_at ? new Date(request.created_at).toLocaleString() : "—" },
    { label: "Matched", value: request.matched_at ? new Date(request.matched_at).toLocaleString() : "—" },
    { label: "Results sent", value: request.results_sent_at ? new Date(request.results_sent_at).toLocaleString() : "—" },
  ];
  const issues = Array.isArray(request.presenting_issues)
    ? request.presenting_issues.join(", ")
    : (request.presenting_issues || "—");
  const availability = Array.isArray(request.availability_windows)
    ? request.availability_windows.join(", ")
    : (request.availability_windows || "—");
  return (
    <div className="bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl p-5 space-y-4" data-testid="request-full-brief">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2 text-sm">
        {fields.map((f) => (
          <div key={f.label}>
            <div className="text-[10px] uppercase tracking-wider text-[#6D6A65]">{f.label}</div>
            <div className="text-[#2B2A29] break-words">{f.value || "—"}</div>
          </div>
        ))}
      </div>
      <div className="border-t border-[#E8E5DF] pt-3 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[#6D6A65]">Presenting issues</div>
          <div className="text-[#2B2A29] mt-0.5 leading-relaxed">{issues}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[#6D6A65]">Availability windows</div>
          <div className="text-[#2B2A29] mt-0.5">{availability}</div>
        </div>
      </div>
    </div>
  );
}

function MatchedProviderCard({ t }) {
  const [open, setOpen] = useState(false);
  const breakdown = t.match_breakdown || {};
  const breakdownEntries = Object.entries(breakdown).filter(([, v]) => v > 0);
  return (
    <div
      className="border border-[#E8E5DF] rounded-xl bg-white overflow-hidden"
      data-testid={`matched-provider-${t.id}`}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left px-4 py-3 flex items-center justify-between gap-3 hover:bg-[#FDFBF7] transition"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-medium text-[#2B2A29] truncate">{t.name}</span>
            <span className="text-xs text-[#6D6A65]">{t.credential_type || "—"}</span>
            {t.review_count >= 10 && t.review_avg >= 4.0 && (
              <span className="text-[10px] text-[#C87965]">
                ★{t.review_avg.toFixed(1)} · {t.review_count}
              </span>
            )}
          </div>
          <div className="text-xs text-[#6D6A65] mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
            <span>{t.email}</span>
            {t.distance_miles != null && (
              <span className="text-[#C87965]">{t.distance_miles} mi</span>
            )}
            {(t.office_locations || []).length > 0 && (
              <span>{t.office_locations.join(", ")}</span>
            )}
          </div>
        </div>
        <span className="font-mono text-xs bg-[#2D4A3E] text-white px-2.5 py-0.5 rounded shrink-0">
          {Math.round(t.match_score)}%
        </span>
      </button>
      {open && (
        <div className="border-t border-[#E8E5DF] bg-[#FDFBF7] px-4 py-3 text-xs space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1.5">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#6D6A65]">Years exp</div>
              <div className="text-[#2B2A29]">{t.years_experience ?? "—"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#6D6A65]">Cash rate</div>
              <div className="text-[#2B2A29]">${t.cash_rate ?? "—"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#6D6A65]">Sliding scale</div>
              <div className="text-[#2B2A29]">{t.sliding_scale ? "Yes" : "No"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#6D6A65]">Telehealth</div>
              <div className="text-[#2B2A29]">{t.telehealth ? "Yes" : "No"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#6D6A65]">In-person</div>
              <div className="text-[#2B2A29]">{t.offers_in_person ? "Yes" : "No"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#6D6A65]">Plans</div>
              <div className="text-[#2B2A29]">{(t.insurance_accepted || []).length || 0}</div>
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#6D6A65]">Specialties</div>
            <div className="text-[#2B2A29]">{(t.primary_specialties || []).join(" · ") || "—"}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#6D6A65]">Modalities</div>
            <div className="text-[#2B2A29]">{(t.modalities || []).join(" · ") || "—"}</div>
          </div>
          {breakdownEntries.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#6D6A65] mb-1">
                Score breakdown ({Math.round(breakdownEntries.reduce((a, [, v]) => a + v, 0))} pts)
              </div>
              <div className="grid grid-cols-2 gap-1">
                {breakdownEntries.map(([axis, pts]) => (
                  <div key={axis} className="flex items-center justify-between bg-white border border-[#E8E5DF] rounded px-2 py-1">
                    <span className="text-[#6D6A65]">{axis.replace(/_/g, " ")}</span>
                    <span className="font-mono text-[#2D4A3E]">+{pts}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
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

function ReferralAnalyticsPanel({ data, loading, onReload }) {
  if (loading || !data) {
    return (
      <div className="mt-6 bg-white border border-[#E8E5DF] rounded-2xl p-12 text-center text-[#6D6A65]">
        <Loader2 className="animate-spin mx-auto mb-3 text-[#2D4A3E]" />
        Loading referral analytics…
      </div>
    );
  }
  const { patient_referrals: pr, therapist_referrals: tr, referral_sources: srcs, gap_recruit: gr } = data;
  return (
    <div className="mt-6 space-y-6" data-testid="referral-analytics-panel">
      <div className="bg-[#FDFBF7] border border-[#E8E5DF] rounded-2xl p-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-serif-display text-2xl text-[#2D4A3E] leading-tight">
            Referral analytics
          </h2>
          <p className="text-sm text-[#6D6A65] mt-1.5 leading-relaxed max-w-2xl">
            Tracks patient-to-patient invites, therapist refer-a-colleague chains,
            intake-form &ldquo;how did you hear&rdquo; breakdown, and gap-recruit
            conversion attribution.
          </p>
        </div>
        <button
          type="button"
          onClick={onReload}
          className="text-xs text-[#2D4A3E] underline hover:text-[#3A5E50]"
          data-testid="referrals-refresh-btn"
        >
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <FactStat label="Patient referrals" value={pr.total_invited} />
        <FactStat label="Patient referrers" value={pr.unique_referrers} />
        <FactStat label="Therapist referrals" value={tr.total_invited} />
        <FactStat label="Therapist referrers" value={tr.unique_referrers} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5">
          <div className="text-xs uppercase tracking-wider text-[#6D6A65] mb-3">
            Top patient referrers
          </div>
          {pr.top.length === 0 ? (
            <div className="text-sm text-[#6D6A65]">No patient invites yet.</div>
          ) : (
            <ul className="space-y-1.5">
              {pr.top.map((r) => (
                <li key={r.code} className="flex items-center justify-between text-sm gap-2">
                  <span className="font-mono text-[11px] text-[#6D6A65] shrink-0">{r.code}</span>
                  <span className="flex-1 truncate text-[#2B2A29]">{r.inviter_email}</span>
                  <span className="font-mono text-[#2D4A3E] tabular-nums">{r.invited_count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5">
          <div className="text-xs uppercase tracking-wider text-[#6D6A65] mb-3">
            Top therapist referrers
          </div>
          {tr.top.length === 0 ? (
            <div className="text-sm text-[#6D6A65]">No therapist invites yet.</div>
          ) : (
            <ul className="space-y-1.5">
              {tr.top.map((r) => (
                <li key={r.code} className="flex items-center justify-between text-sm gap-2">
                  <span className="font-mono text-[11px] text-[#6D6A65] shrink-0">{r.code}</span>
                  <span className="flex-1 truncate text-[#2B2A29]">{r.inviter_name}</span>
                  <span className="font-mono text-[#2D4A3E] tabular-nums">{r.invited_count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5">
        <div className="text-xs uppercase tracking-wider text-[#6D6A65] mb-3">
          Intake &ldquo;How did you hear?&rdquo; breakdown
        </div>
        {Object.keys(srcs).length === 0 ? (
          <div className="text-sm text-[#6D6A65]">No requests submitted yet.</div>
        ) : (
          <ul className="space-y-1.5">
            {Object.entries(srcs).map(([k, v]) => {
              const total = Object.values(srcs).reduce((s, n) => s + n, 0) || 1;
              const pct = Math.round((v / total) * 100);
              return (
                <li key={k} className="flex items-center gap-3 text-sm">
                  <div className="flex-1 min-w-0 truncate text-[#2B2A29]">{k}</div>
                  <div className="w-40 h-1.5 rounded-full bg-[#FDFBF7] border border-[#E8E5DF] overflow-hidden">
                    <div className="h-full bg-[#2D4A3E]" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="w-12 text-right text-[#6D6A65] tabular-nums">
                    {v} ({pct}%)
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5">
        <div className="text-xs uppercase tracking-wider text-[#6D6A65] mb-3">
          Gap-recruit conversion (pre-launch)
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <FactStat label="Drafts queued" value={gr.total_drafts} />
          <FactStat label="Sent" value={gr.sent} />
          <FactStat label="Converted to signups" value={gr.converted} />
          <FactStat label="Conversion rate" value={`${gr.conversion_rate}%`} />
        </div>
        {gr.sent === 0 && (
          <p className="text-xs text-[#6D6A65] mt-3 italic">
            Conversion tracking activates once you go live and send real (non-dry-run) recruit emails.
          </p>
        )}
      </div>
    </div>
  );
}

function StatBox({ label, value, highlight }) {
  return (
    <div
      className={`bg-white border rounded-2xl p-4 ${
        highlight ? "border-[#C87965] shadow-sm" : "border-[#E8E5DF]"
      }`}
    >
      <div className="text-xs uppercase tracking-wider text-[#6D6A65]">{label}</div>
      <div
        className={`font-serif-display text-3xl mt-1 ${
          highlight ? "text-[#C87965]" : "text-[#2D4A3E]"
        }`}
      >
        {value ?? "—"}
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, icon, label, count, testid, highlight }) {
  return (
    <button
      onClick={onClick}
      data-testid={testid}
      className={`flex items-center gap-2 px-4 py-3 text-sm border-b-2 transition -mb-px ${
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

function Th({ children }) {
  return (
    <th className="p-4 font-medium text-xs uppercase tracking-wider">{children}</th>
  );
}

function CoverageGapPanel({ data, loading, onReload }) {
  if (loading || !data) {
    return (
      <div className="mt-6 bg-white border border-[#E8E5DF] rounded-2xl p-12 text-center text-[#6D6A65]" data-testid="coverage-gap-loading">
        <Loader2 className="animate-spin mx-auto mb-3 text-[#2D4A3E]" />
        Analyzing therapist coverage…
      </div>
    );
  }
  const { total_active_therapists: total, summary, gaps, gap_summary } = data;
  const groupedGaps = gaps.reduce((acc, g) => {
    (acc[g.dimension] = acc[g.dimension] || []).push(g);
    return acc;
  }, {});
  const dimensionLabels = {
    specialty: "Clinical specialties",
    modality: "Treatment modalities",
    age_group: "Age groups",
    client_type: "Therapy formats",
    insurance: "Insurance plans",
    urgency: "Urgent intake capacity",
    geography: "In-person Idaho coverage",
    fee: "Fee diversity",
  };
  return (
    <div className="mt-6 space-y-6" data-testid="coverage-gap-panel">
      <div className="bg-[#FDFBF7] border border-[#E8E5DF] rounded-2xl p-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-serif-display text-2xl text-[#2D4A3E] leading-tight">
            Pre-launch coverage report
          </h2>
          <p className="text-sm text-[#6D6A65] mt-1.5 leading-relaxed max-w-2xl">
            Analyzing <strong className="text-[#2B2A29]">{total}</strong> active
            therapists. Targets are calibrated to TheraVoca's matching algorithm
            weights — gaps below tell you where to focus pre-launch outreach.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-xs bg-[#D45D5D]/15 text-[#D45D5D] rounded-full px-2.5 py-1" data-testid="gap-critical-count">
            <AlertCircle size={12} /> {gap_summary.critical} critical
          </span>
          <span className="inline-flex items-center gap-1 text-xs bg-[#C87965]/15 text-[#C87965] rounded-full px-2.5 py-1" data-testid="gap-warning-count">
            <AlertTriangle size={12} /> {gap_summary.warning} warning
          </span>
          <button
            type="button"
            onClick={onReload}
            className="text-xs text-[#2D4A3E] underline hover:text-[#3A5E50]"
            data-testid="gap-refresh-btn"
          >
            Refresh
          </button>
        </div>
      </div>

      {gap_summary.total === 0 ? (
        <div className="bg-white border border-[#2D4A3E]/30 rounded-2xl p-8 text-center" data-testid="gap-zero-state">
          <CheckCircle2 size={32} className="mx-auto text-[#2D4A3E]" />
          <h3 className="font-serif-display text-xl text-[#2D4A3E] mt-3">
            No coverage gaps detected
          </h3>
          <p className="text-sm text-[#6D6A65] mt-2 max-w-md mx-auto leading-relaxed">
            Your directory hits every recommended target for launch. You can
            still expand individual buckets, but the matching engine will
            return results for nearly every plausible patient profile today.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(groupedGaps).map(([dim, list]) => (
            <div key={dim} className="bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden" data-testid={`gap-section-${dim}`}>
              <div className="px-5 py-3 border-b border-[#E8E5DF] bg-[#FDFBF7]">
                <h3 className="text-sm font-semibold text-[#2B2A29]">
                  {dimensionLabels[dim] || dim}
                  <span className="ml-2 text-xs text-[#6D6A65]">
                    {list.length} gap{list.length === 1 ? "" : "s"}
                  </span>
                </h3>
              </div>
              <ul className="divide-y divide-[#E8E5DF]">
                {list.map((g) => (
                  <li
                    key={`${g.dimension}-${g.key}`}
                    className="px-5 py-4 flex items-start gap-3"
                    data-testid={`gap-${g.dimension}-${g.key}`}
                  >
                    <div className="shrink-0 mt-0.5">
                      {g.severity === "critical" ? (
                        <AlertCircle size={16} className="text-[#D45D5D]" />
                      ) : (
                        <AlertTriangle size={16} className="text-[#C87965]" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-3 flex-wrap">
                        <div className="font-medium text-sm text-[#2B2A29]">
                          {g.key.replace(/_/g, " ")}
                        </div>
                        <div className="text-xs text-[#6D6A65]">
                          <span className={`font-semibold ${g.severity === "critical" ? "text-[#D45D5D]" : "text-[#C87965]"}`}>
                            {g.have}
                          </span>
                          <span className="mx-1">/</span>
                          <span>{g.target} target</span>
                          {g.demand && (
                            <span className="ml-2 text-[10px] uppercase tracking-wider">
                              · {g.demand} demand
                            </span>
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-[#6D6A65] mt-1.5 leading-relaxed">
                        {g.recommendation}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* Distribution charts — useful even without gaps */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DistBlock title="Specialties" entries={summary.specialties} />
        <DistBlock title="Top modalities" entries={summary.modalities} max={10} />
        <DistBlock title="Age groups served" entries={summary.age_groups} />
        <DistBlock title="Therapy formats" entries={summary.client_types} />
        <DistBlock title="Insurance accepted" entries={summary.insurance} max={12} />
        <DistBlock title="Credentials" entries={summary.credentials} />
      </div>

      <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5 grid grid-cols-2 md:grid-cols-4 gap-4 text-center text-sm">
        <FactStat label="With Idaho office" value={summary.with_idaho_office} />
        <FactStat label="Telehealth-only" value={summary.telehealth_only} />
        <FactStat label="Sliding scale" value={summary.sliding_scale_count} />
        <FactStat label="Free consult" value={summary.free_consult_count} />
      </div>
    </div>
  );
}

function DistBlock({ title, entries, max = 8 }) {
  const list = Object.entries(entries || {}).slice(0, max);
  const total = list.reduce((s, [, v]) => s + v, 0);
  if (list.length === 0) return null;
  return (
    <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5">
      <div className="text-xs uppercase tracking-wider text-[#6D6A65] mb-3">{title}</div>
      <ul className="space-y-1.5">
        {list.map(([k, v]) => (
          <li key={k} className="flex items-center gap-3 text-sm">
            <div className="flex-1 min-w-0 truncate text-[#2B2A29]">{k}</div>
            <div className="w-32 h-1.5 rounded-full bg-[#FDFBF7] border border-[#E8E5DF] overflow-hidden">
              <div
                className="h-full bg-[#2D4A3E]"
                style={{ width: `${total ? Math.round((v / total) * 100) : 0}%` }}
              />
            </div>
            <div className="w-8 text-right text-[#6D6A65] tabular-nums">{v}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FactStat({ label, value }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-[#6D6A65]">{label}</div>
      <div className="font-serif-display text-2xl text-[#2D4A3E] mt-1">{value}</div>
    </div>
  );
}

function RecruitDraftsPanel({
  data, loading, generating, search, onLoad, onGenerate, onDelete, onSendAll, onSendPreview,
}) {
  const drafts = (data?.drafts || []).filter((d) => {
    if (!search) return true;
    const q = search.toLowerCase();
    const c = d.candidate || {};
    return [c.name, c.email, c.city, c.license_type, (c.specialties || []).join(" "), (c.modalities || []).join(" "), d.gap?.key, d.gap?.dimension]
      .some((v) => v && String(v).toLowerCase().includes(q));
  });
  const grouped = drafts.reduce((acc, d) => {
    const k = `${d.gap?.dimension || "?"} → ${d.gap?.key || "?"}`;
    (acc[k] = acc[k] || []).push(d);
    return acc;
  }, {});

  const copyDraft = (d) => {
    const c = d.candidate || {};
    const subject = "Idaho therapist outreach — joining TheraVoca's launch network";
    const body = `Hi ${(c.name || "there").split(" ")[0]},

I'm reaching out from TheraVoca, a small Idaho-based therapist matching service. We're building our directory ahead of launch, and your practice came up as a strong fit for an underserved area we're trying to fill.

Why we're reaching out: ${c.match_rationale || "Your specialties align with where we're growing."}

Specialties we'd showcase: ${(c.specialties || []).join(", ") || "(your choice)"}
Modalities: ${(c.modalities || []).join(", ") || "(your choice)"}

If you're open to a 30-day free trial (then $45/mo, cancellable any time), here's the signup link:
https://www.theravoca.com/therapists/join

Cheers,
TheraVoca team`;
    const block = `TO: ${c.email}\nSUBJECT: ${subject}\n\n${body}`;
    navigator.clipboard.writeText(block).then(
      () => toast.success(`Copied draft for ${c.name}`),
      () => toast.error("Couldn't copy"),
    );
  };

  return (
    <div className="mt-8 space-y-4" data-testid="recruit-drafts-panel">
      <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-serif-display text-2xl text-[#2D4A3E] leading-tight">
            Recruit list
          </h2>
          <p className="text-sm text-[#6D6A65] mt-1.5 leading-relaxed max-w-2xl">
            Pre-launch drafts the LLM has queued for each gap above. Emails
            currently use safe placeholders (<code className="text-xs bg-[#FDFBF7] px-1 py-0.5 rounded">therapymatch+recruitNNN@gmail.com</code>) — no
            real outreach is sent. Click &ldquo;Copy email&rdquo; to preview the draft, or
            &ldquo;Send all&rdquo; once you're ready post-launch.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={onLoad}
            className="text-xs text-[#2D4A3E] underline hover:text-[#3A5E50]"
            data-testid="recruit-drafts-refresh-btn"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={onGenerate}
            disabled={generating}
            className="tv-btn-secondary !py-2 !px-4 text-sm disabled:opacity-60"
            data-testid="recruit-drafts-generate-btn"
          >
            {generating ? <Loader2 size={14} className="inline mr-1.5 animate-spin" /> : <UserPlus size={14} className="inline mr-1.5" />}
            Generate more drafts
          </button>
          <button
            type="button"
            onClick={onSendPreview}
            className="bg-[#C87965] text-white rounded-lg px-3 py-2 text-xs font-medium hover:bg-[#B86855]"
            data-testid="recruit-drafts-send-preview"
            title="Send 3 sample emails to fake therapymatch+recruitNNN@gmail.com — lands in your therapymatch@gmail.com inbox"
          >
            Preview 3 emails
          </button>
          <button
            type="button"
            onClick={onSendAll}
            className="bg-[#2D4A3E] text-white rounded-lg px-3 py-2 text-xs font-medium hover:bg-[#3A5E50] disabled:opacity-50"
            data-testid="recruit-drafts-send-all"
            title="Pre-launch: all drafts are dry-run, this will report 0 sent"
          >
            Send all (post-launch)
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <FactStat label="Total drafts" value={data?.total ?? "—"} />
        <FactStat label="Pending" value={data?.pending ?? "—"} />
        <FactStat label="Sent" value={data?.sent ?? "—"} />
        <FactStat label="Dry-run (placeholder)" value={data?.dry_run_count ?? "—"} />
      </div>

      {loading && !data ? (
        <div className="bg-white border border-[#E8E5DF] rounded-2xl p-12 text-center text-[#6D6A65]">
          <Loader2 className="animate-spin mx-auto mb-3 text-[#2D4A3E]" />
          Loading drafts…
        </div>
      ) : drafts.length === 0 ? (
        <div className="bg-white border border-dashed border-[#E8E5DF] rounded-2xl p-10 text-center" data-testid="recruit-drafts-empty">
          <p className="text-sm text-[#6D6A65]">
            {search ? "No drafts match your search." : "No drafts yet. Click \"Generate more drafts\" to populate."}
          </p>
        </div>
      ) : (
        Object.entries(grouped).map(([groupLabel, items]) => (
          <div key={groupLabel} className="bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-[#E8E5DF] bg-[#FDFBF7] text-xs font-semibold text-[#2B2A29] uppercase tracking-wider">
              Targeting: {groupLabel}{" "}
              <span className="ml-2 text-[#6D6A65] normal-case font-normal">
                {items.length} draft{items.length === 1 ? "" : "s"}
              </span>
            </div>
            <ul className="divide-y divide-[#E8E5DF]">
              {items.map((d, i) => {
                const c = d.candidate || {};
                return (
                  <li key={d.id} className="px-5 py-4 flex items-start gap-4 flex-wrap" data-testid={`recruit-draft-${i}`}>
                    <div className="flex-1 min-w-[260px]">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <div className="font-medium text-sm text-[#2B2A29]">{c.name}</div>
                        <span className="text-xs text-[#6D6A65]">
                          {c.license_type} · {c.city}, {c.state}
                        </span>
                        {d.dry_run && (
                          <span className="text-[10px] uppercase tracking-wider bg-[#C87965]/15 text-[#C87965] rounded-full px-2 py-0.5">
                            dry-run
                          </span>
                        )}
                        {d.google_verified && (
                          <span
                            className="text-[10px] uppercase tracking-wider bg-[#2D4A3E]/15 text-[#2D4A3E] rounded-full px-2 py-0.5"
                            title={d.google_place?.address || "Verified via Google Business Profile"}
                          >
                            ✓ Google verified
                          </span>
                        )}
                        {d.name_match_directory && (
                          <span
                            className="text-[10px] uppercase tracking-wider bg-[#D45D5D]/15 text-[#D45D5D] rounded-full px-2 py-0.5"
                            title="A therapist with a similar name already exists in your directory — likely duplicate"
                          >
                            ⚠ name in directory
                          </span>
                        )}
                        {d.sent_at_preview && (
                          <span
                            className="text-[10px] uppercase tracking-wider bg-[#FDFBF7] text-[#6D6A65] border border-[#E8E5DF] rounded-full px-2 py-0.5"
                            title={`Preview email sent at ${d.sent_at_preview}`}
                          >
                            preview sent
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-[#6D6A65] mt-1 break-all">
                        {c.email}
                      </div>
                      {d.google_place?.address && (
                        <div className="text-[11px] text-[#2D4A3E] mt-1">
                          📍 {d.google_place.address}
                        </div>
                      )}
                      {c.match_rationale && (
                        <p className="text-xs text-[#6D6A65] mt-1.5 italic leading-relaxed">
                          &ldquo;{c.match_rationale}&rdquo;
                        </p>
                      )}
                      <div className="text-[11px] text-[#6D6A65] mt-1.5">
                        {(c.specialties || []).slice(0, 4).join(" · ")}
                        {c.modalities?.length ? ` · ${(c.modalities || []).slice(0, 3).join(", ")}` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => copyDraft(d)}
                        className="inline-flex items-center gap-1 text-[11px] text-[#2D4A3E] bg-[#FDFBF7] border border-[#E8E5DF] rounded-md px-2 py-1 hover:border-[#2D4A3E]"
                        data-testid={`recruit-copy-${i}`}
                      >
                        <Copy size={11} /> Copy email
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(d.id)}
                        className="inline-flex items-center gap-1 text-[11px] text-[#D45D5D] bg-white border border-[#E8E5DF] rounded-md px-2 py-1 hover:border-[#D45D5D]"
                        data-testid={`recruit-delete-${i}`}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
    </div>
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
      className={`inline-flex text-[10px] px-2 py-0.5 rounded-full mt-1 ${palette[status] || palette.incomplete}`}
      data-testid={`sub-badge-${t.id}`}
    >
      {status.replace("_", " ")}
    </div>
  );
}

