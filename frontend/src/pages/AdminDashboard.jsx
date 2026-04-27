import { useEffect, useState, useCallback } from "react";
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
} from "lucide-react";
import { Header, Footer } from "@/components/SiteShell";
import { adminClient } from "@/lib/api";
import { ADMIN_POLL_INTERVAL_MS, STATUS_UNAUTHORIZED } from "@/lib/constants";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
              </div>

              {tab === "requests" && (
              <div className="mt-6 bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden">
                <table className="w-full text-sm" data-testid="requests-table">
                  <thead className="bg-[#FDFBF7] text-[#6D6A65]">
                    <tr className="text-left">
                      <Th>Email</Th>
                      <Th>Age / State</Th>
                      <Th>Status</Th>
                      <Th>Notified</Th>
                      <Th>Apps</Th>
                      <Th>Threshold</Th>
                      <Th>Created</Th>
                      <Th></Th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.length === 0 && (
                      <tr>
                        <td colSpan={8} className="p-10 text-center text-[#6D6A65]">
                          No requests yet.
                        </td>
                      </tr>
                    )}
                    {requests.map((r) => (
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
                        <td className="p-4">{r.notified_count || 0}</td>
                        <td className="p-4 font-semibold text-[#2D4A3E]">
                          {r.application_count || 0}
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
                      {pendingTherapists.map((t) => (
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
                      {allTherapists.map((t) => (
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
                <FieldRow label="Phone">
                  <Input
                    value={editTherapist.phone || ""}
                    onChange={(e) =>
                      setEditTherapist({ ...editTherapist, phone: e.target.value })
                    }
                    data-testid="edit-phone"
                  />
                </FieldRow>
              </div>
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
                  <option value="psychologist">Psychologist (PhD/PsyD)</option>
                  <option value="lcsw">LCSW</option>
                  <option value="lpc">LPC / LCPC / LPCC</option>
                  <option value="lmft">LMFT</option>
                  <option value="lmhc">LMHC</option>
                  <option value="psychiatrist">Psychiatrist (MD)</option>
                  <option value="other">Other</option>
                </select>
              </FieldRow>
              <FieldRow label="Primary specialties (comma-separated, e.g. anxiety, depression)">
                <Input
                  value={(editTherapist.primary_specialties || []).join(", ")}
                  onChange={(e) =>
                    setEditTherapist({
                      ...editTherapist,
                      primary_specialties: e.target.value
                        .split(",").map((s) => s.trim()).filter(Boolean),
                    })
                  }
                  data-testid="edit-primary-specialties"
                />
              </FieldRow>
              <FieldRow label="Secondary specialties (comma-separated)">
                <Input
                  value={(editTherapist.secondary_specialties || []).join(", ")}
                  onChange={(e) =>
                    setEditTherapist({
                      ...editTherapist,
                      secondary_specialties: e.target.value
                        .split(",").map((s) => s.trim()).filter(Boolean),
                    })
                  }
                  data-testid="edit-secondary-specialties"
                />
              </FieldRow>
              <FieldRow label="Modalities (comma-separated, e.g. CBT, DBT, EMDR)">
                <Input
                  value={(editTherapist.modalities || []).join(", ")}
                  onChange={(e) =>
                    setEditTherapist({
                      ...editTherapist,
                      modalities: e.target.value
                        .split(",").map((s) => s.trim()).filter(Boolean),
                    })
                  }
                  data-testid="edit-modalities"
                />
              </FieldRow>
              <FieldRow label="Insurances accepted (comma-separated)">
                <Input
                  value={(editTherapist.insurance_accepted || []).join(", ")}
                  onChange={(e) =>
                    setEditTherapist({
                      ...editTherapist,
                      insurance_accepted: e.target.value
                        .split(",").map((s) => s.trim()).filter(Boolean),
                    })
                  }
                  data-testid="edit-insurance-accepted"
                />
              </FieldRow>
              <FieldRow label="Office locations (comma-separated cities)">
                <Input
                  value={(editTherapist.office_locations || []).join(", ")}
                  onChange={(e) =>
                    setEditTherapist({
                      ...editTherapist,
                      office_locations: e.target.value
                        .split(",").map((s) => s.trim()).filter(Boolean),
                    })
                  }
                  data-testid="edit-office-locations"
                />
              </FieldRow>
              <FieldRow label="Client types (comma-separated: individual, couples, family, group)">
                <Input
                  value={(editTherapist.client_types || []).join(", ")}
                  onChange={(e) =>
                    setEditTherapist({
                      ...editTherapist,
                      client_types: e.target.value
                        .split(",").map((s) => s.trim()).filter(Boolean),
                    })
                  }
                  data-testid="edit-client-types"
                />
              </FieldRow>
              <FieldRow label="Age groups served (comma-separated: child, teen, young_adult, adult, older_adult)">
                <Input
                  value={(editTherapist.age_groups || []).join(", ")}
                  onChange={(e) =>
                    setEditTherapist({
                      ...editTherapist,
                      age_groups: e.target.value
                        .split(",").map((s) => s.trim()).filter(Boolean),
                    })
                  }
                  data-testid="edit-age-groups"
                />
              </FieldRow>
              <FieldRow label="Availability windows (comma-separated)">
                <Input
                  value={(editTherapist.availability_windows || []).join(", ")}
                  onChange={(e) =>
                    setEditTherapist({
                      ...editTherapist,
                      availability_windows: e.target.value
                        .split(",").map((s) => s.trim()).filter(Boolean),
                    })
                  }
                  data-testid="edit-availability"
                />
              </FieldRow>
              <FieldRow label="Style tags (comma-separated)">
                <Input
                  value={(editTherapist.style_tags || []).join(", ")}
                  onChange={(e) =>
                    setEditTherapist({
                      ...editTherapist,
                      style_tags: e.target.value
                        .split(",").map((s) => s.trim()).filter(Boolean),
                    })
                  }
                  data-testid="edit-style-tags"
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
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto bg-white border-[#E8E5DF]">
          <DialogHeader>
            <DialogTitle className="font-serif-display text-2xl text-[#2D4A3E]">
              Request detail
            </DialogTitle>
          </DialogHeader>
          {!detail ? (
            <Loader2 className="animate-spin mx-auto my-8 text-[#2D4A3E]" />
          ) : (
            <div className="space-y-5">
              <div className="bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl p-4">
                <div className="text-xs uppercase tracking-wider text-[#6D6A65] mb-2">
                  Patient
                </div>
                <div className="font-mono text-sm">{detail.request.email}</div>
                <div className="text-sm mt-2 text-[#2B2A29]">
                  Age {detail.request.client_age} • {detail.request.location_state}{" "}
                  • {detail.request.session_format} •{" "}
                  {detail.request.payment_type === "cash"
                    ? `$${detail.request.budget || "?"} cash`
                    : detail.request.insurance_name || "insurance"}
                </div>
                <p className="text-sm mt-3 text-[#2B2A29] whitespace-pre-wrap">
                  {detail.request.presenting_issues}
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  className="tv-btn-primary !py-2 !px-4 text-sm"
                  onClick={() => triggerResults(detail.request.id)}
                  data-testid="trigger-results-btn"
                >
                  <Send size={14} className="inline mr-1.5" /> Email matches now
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
                  onClick={() => releaseResults(detail.request.id)}
                  data-testid="release-results-btn"
                  disabled={!!detail.request.results_released_at}
                  title={detail.request.results_released_at
                    ? `Already released at ${detail.request.results_released_at}`
                    : "Manually release the 24h hold so the patient can see therapist responses"}
                >
                  {detail.request.results_released_at
                    ? "Results released"
                    : "Release results to patient"}
                </button>
                <ThresholdControl
                  current={detail.request.threshold}
                  onChange={(t) => updateThreshold(detail.request.id, t)}
                />
              </div>

              <div>
                <h4 className="font-semibold text-[#2B2A29] mb-2">
                  Notified therapists ({detail.notified.length})
                </h4>
                <div className="space-y-1.5 max-h-60 overflow-y-auto">
                  {detail.notified.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between text-sm border border-[#E8E5DF] rounded-lg px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-[#2B2A29] truncate">{t.name}</div>
                        <div className="text-xs text-[#6D6A65] flex flex-wrap gap-x-3">
                          <span>{t.email}</span>
                          {t.distance_miles != null && (
                            <span className="text-[#C87965]">
                              {t.distance_miles} mi away
                            </span>
                          )}
                          {t.office_locations?.length > 0 && (
                            <span>{t.office_locations.join(", ")}</span>
                          )}
                        </div>
                      </div>
                      <span className="font-mono text-xs bg-[#2D4A3E]/10 text-[#2D4A3E] px-2 py-0.5 rounded ml-2 shrink-0">
                        {Math.round(t.match_score)}%
                      </span>
                    </div>
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
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Footer />
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

