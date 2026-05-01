import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, MessageSquareWarning, CheckCircle2, ExternalLink, FileText, RotateCcw } from "lucide-react";
import { Input } from "@/components/ui/input";

// SMS Status & A2P 10DLC Helper
//   Shows a deliverability verdict banner (green/yellow/red) computed from the
//   most-recent /admin/test-sms poll, and lets the admin store their A2P
//   brand_id + campaign_id in app_config for quick reference.
//
// Why this matters: Twilio's API will return "queued" even when US carriers
// are about to drop the message at the carrier hop (error 30034). A2P 10DLC
// registration is a one-time TCR process; until done, ALL SMS to US numbers
// from a 10-digit number is silently blocked. This panel makes that visible.
//
// Backend: GET/PUT /api/admin/sms-status, GET /admin/sms-status, POST /admin/test-sms.
const VERDICT_META = {
  delivered_recently: {
    color: "#2D4A3E",
    bg: "#E8F0EB",
    border: "#9DBDA8",
    icon: CheckCircle2,
    title: "Delivered ✓",
    body: "Your last test SMS was delivered successfully. Patients/therapists should receive their notifications.",
  },
  blocked_a2p_10dlc: {
    color: "#B0382A",
    bg: "#FBE9E5",
    border: "#F4C7BE",
    icon: MessageSquareWarning,
    title: "Blocked — A2P 10DLC registration required",
    body: "US carriers reject SMS from unregistered 10-digit numbers (Twilio error 30034). Register your brand + campaign at twilio.com/console/sms/a2p-messaging. Approval typically takes 1–3 business days.",
  },
  blocked: {
    color: "#B0382A",
    bg: "#FBE9E5",
    border: "#F4C7BE",
    icon: MessageSquareWarning,
    title: "Blocked",
    body: "Last test SMS was undelivered or failed. Check the error code below.",
  },
  twilio_disabled: {
    color: "#A37700",
    bg: "#FBF1D6",
    border: "#E9D78A",
    icon: MessageSquareWarning,
    title: "Twilio integration disabled",
    body: "TWILIO_ENABLED is set to false in the backend env. Re-enable it before SMS will dispatch.",
  },
  missing_credentials: {
    color: "#A37700",
    bg: "#FBF1D6",
    border: "#E9D78A",
    icon: MessageSquareWarning,
    title: "Missing Twilio credentials",
    body: "TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN is missing in backend .env.",
  },
  untested: {
    color: "#6D6A65",
    bg: "#F4F1EC",
    border: "#E8E5DF",
    icon: MessageSquareWarning,
    title: "Untested",
    body: "Click 'Send test SMS' below to send a test message and verify deliverability.",
  },
};

export default function SmsStatusPanel({ client }) {
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState(null);
  const [brandId, setBrandId] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [a2pStatus, setA2pStatus] = useState("unregistered");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  // SMS templates state
  const [templates, setTemplates] = useState([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [editingKey, setEditingKey] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [testingTemplate, setTestingTemplate] = useState(null);
  const [testTo, setTestTo] = useState("");

  const refresh = async () => {
    try {
      const r = await client.get("/admin/sms-status");
      setStatus(r.data);
      setBrandId(r.data.a2p_brand_id || "");
      setCampaignId(r.data.a2p_campaign_id || "");
      setA2pStatus(r.data.a2p_status || "unregistered");
      setNotes(r.data.a2p_notes || "");
      setLoaded(true);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load SMS status");
    }
  };

  const refreshTemplates = async () => {
    try {
      const r = await client.get("/admin/sms-templates");
      setTemplates(r.data?.templates || []);
      setTemplatesLoaded(true);
    } catch {
      // endpoint may not exist yet on older deploy
      setTemplatesLoaded(true);
    }
  };

  const saveTemplate = async (key) => {
    setSavingTemplate(true);
    try {
      await client.put("/admin/sms-templates", { key, value: editValue });
      toast.success("Template saved");
      setEditingKey(null);
      await refreshTemplates();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally {
      setSavingTemplate(false);
    }
  };

  const resetTemplate = async (key) => {
    setSavingTemplate(true);
    try {
      await client.put("/admin/sms-templates", { key, value: "" });
      toast.success("Reset to default");
      setEditingKey(null);
      await refreshTemplates();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Reset failed");
    } finally {
      setSavingTemplate(false);
    }
  };

  const testTemplate = async (key) => {
    setTestingTemplate(key);
    try {
      const r = await client.post("/admin/test-sms", { template: key, to: testTo.trim() || undefined });
      if (r.data?.final_status === "delivered") {
        toast.success("Template SMS delivered ✓");
      } else {
        toast.success("Template SMS queued");
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Test failed");
    } finally {
      setTestingTemplate(null);
    }
  };

  useEffect(() => {
    refresh();
    refreshTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendTest = async () => {
    if (!testTo.trim()) {
      toast.error("Enter a phone number to send the test to");
      return;
    }
    setTesting(true);
    try {
      const r = await client.post("/admin/test-sms", { to: testTo.trim() });
      if (r.data?.final_status === "delivered") {
        toast.success("SMS delivered ✓");
      } else if (r.data?.error_code) {
        toast.error(
          `Twilio err ${r.data.error_code}: ${r.data.troubleshooting_hint || r.data.error_message}`,
          { duration: 12000 },
        );
      } else {
        toast.success("SMS queued — refreshing status…");
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Test SMS failed");
    } finally {
      setTesting(false);
      await refresh();
    }
  };

  const saveA2p = async () => {
    setSaving(true);
    try {
      await client.put("/admin/sms-status/a2p", {
        brand_id: brandId,
        campaign_id: campaignId,
        status: a2pStatus,
        notes,
      });
      toast.success("A2P registration details saved");
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) {
    return (
      <div className="mt-6 text-sm text-[#6D6A65] inline-flex items-center gap-2">
        <Loader2 size={14} className="animate-spin" /> Loading…
      </div>
    );
  }

  const meta = VERDICT_META[status?.verdict] || VERDICT_META.untested;
  const Icon = meta.icon;

  return (
    <div className="mt-6 space-y-6" data-testid="sms-status-panel">
      <div
        className="rounded-2xl border p-5 flex items-start gap-3"
        style={{ background: meta.bg, borderColor: meta.border, color: meta.color }}
        data-testid={`sms-status-banner-${status?.verdict}`}
      >
        <Icon size={22} className="mt-0.5 shrink-0" />
        <div className="flex-1">
          <div className="font-serif-display text-xl">{meta.title}</div>
          <p className="text-sm mt-1 leading-relaxed">{meta.body}</p>
          {status?.last_test_sms?.error_code ? (
            <p className="text-xs mt-2 opacity-80">
              Last error: code <strong>{status.last_test_sms.error_code}</strong> ·{" "}
              {status.last_test_sms.error_message || "—"} · tested{" "}
              {status.last_test_sms.tested_at
                ? new Date(status.last_test_sms.tested_at).toLocaleString()
                : "(unknown)"}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <input
            type="tel"
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            placeholder="+1 (555) 123-4567"
            className="w-40 px-2.5 py-1.5 text-xs border rounded-full bg-white text-[#2B2A29] placeholder:text-[#B0ADA8]"
            style={{ borderColor: "currentColor" }}
            data-testid="sms-test-to"
          />
          <button
            type="button"
            onClick={sendTest}
            disabled={testing || !testTo.trim()}
            className="text-xs px-3 py-2 rounded-full bg-white border border-current shrink-0 disabled:opacity-50"
            data-testid="sms-test-btn"
          >
            {testing ? (
              <Loader2 size={12} className="inline mr-1 animate-spin" />
            ) : null}
            Send test
          </button>
        </div>
      </div>

      <div className="bg-white border border-[#E8E5DF] rounded-2xl p-6 space-y-4">
        <div>
          <h3 className="font-serif-display text-2xl text-[#2D4A3E]">
            A2P 10DLC registration tracker
          </h3>
          <p className="text-sm text-[#6D6A65] mt-2 max-w-2xl leading-relaxed">
            Store your TCR brand_id + campaign_id here for the team's reference.
            Registration happens on Twilio's console (link below) — this panel
            only tracks where you are in the process.
          </p>
          <a
            href="https://console.twilio.com/us1/develop/sms/regulatory-compliance/a2p-10dlc"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 mt-2 text-sm text-[#2D4A3E] hover:underline"
          >
            <ExternalLink size={12} /> Open Twilio A2P 10DLC console
          </a>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs uppercase tracking-wider text-[#6D6A65]">
              Brand ID (BN…)
            </label>
            <Input
              value={brandId}
              onChange={(e) => setBrandId(e.target.value)}
              placeholder="BN1234abcd…"
              className="mt-1"
              data-testid="a2p-brand-id"
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider text-[#6D6A65]">
              Campaign ID (CM…)
            </label>
            <Input
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
              placeholder="CM1234abcd…"
              className="mt-1"
              data-testid="a2p-campaign-id"
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider text-[#6D6A65]">
              Status
            </label>
            <select
              value={a2pStatus}
              onChange={(e) => setA2pStatus(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-[#E8E5DF] rounded-md bg-white text-sm"
              data-testid="a2p-status"
            >
              <option value="unregistered">Unregistered</option>
              <option value="brand_pending">Brand pending</option>
              <option value="brand_approved">Brand approved</option>
              <option value="campaign_pending">Campaign pending</option>
              <option value="campaign_approved">Campaign approved</option>
              <option value="rejected">Rejected — needs review</option>
            </select>
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider text-[#6D6A65]">
              From number
            </label>
            <div className="mt-1 px-3 py-2 border border-[#E8E5DF] rounded-md bg-[#FDFBF7] text-sm text-[#6D6A65]">
              {status?.from_number || "(not set)"}
            </div>
          </div>
        </div>

        <div>
          <label className="text-xs uppercase tracking-wider text-[#6D6A65]">
            Notes
          </label>
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Submitted on 2026-04-28; expect 1-3 day approval."
            className="mt-1"
            data-testid="a2p-notes"
          />
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={saveA2p}
            disabled={saving}
            className="tv-btn-primary !py-2 !px-4 text-sm disabled:opacity-50"
            data-testid="a2p-save-btn"
          >
            {saving ? (
              <Loader2 size={14} className="inline mr-1.5 animate-spin" />
            ) : null}
            Save A2P details
          </button>
        </div>
      </div>

      {/* SMS Templates */}
      {templatesLoaded && templates.length > 0 && (
        <div className="bg-white border border-[#E8E5DF] rounded-2xl p-6 space-y-4">
          <div>
            <h3 className="font-serif-display text-2xl text-[#2D4A3E]">
              SMS templates
            </h3>
            <p className="text-sm text-[#6D6A65] mt-2 max-w-2xl leading-relaxed">
              Edit the wording patients and therapists see. Use{" "}
              <code className="text-xs bg-[#F4F1EC] px-1 py-0.5 rounded">
                {"{placeholder}"}
              </code>{" "}
              syntax for dynamic values. Empty saves reset to the default.
            </p>
          </div>

          {templates.map((t) => {
            const isEditing = editingKey === t.key;
            const label = t.key
              .replace("sms.", "")
              .replace(/_/g, " ")
              .replace(/\b\w/g, (c) => c.toUpperCase());

            return (
              <div
                key={t.key}
                className="border border-[#E8E5DF] rounded-xl p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <FileText size={14} className="text-[#6D6A65]" />
                    <span className="font-medium text-sm text-[#2D4A3E]">
                      {label}
                    </span>
                    {t.is_customized && (
                      <span className="text-[10px] bg-[#E8F0EB] text-[#2D4A3E] px-1.5 py-0.5 rounded-full">
                        customized
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {!isEditing && (
                      <>
                        <button
                          type="button"
                          onClick={() => testTemplate(t.key)}
                          disabled={testingTemplate === t.key}
                          className="text-xs px-2.5 py-1.5 rounded-full border border-[#E8E5DF] text-[#6D6A65] hover:bg-[#F4F1EC] disabled:opacity-50"
                        >
                          {testingTemplate === t.key ? (
                            <Loader2
                              size={10}
                              className="inline mr-1 animate-spin"
                            />
                          ) : null}
                          Test
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingKey(t.key);
                            setEditValue(t.current_value);
                          }}
                          className="text-xs px-2.5 py-1.5 rounded-full border border-[#E8E5DF] text-[#6D6A65] hover:bg-[#F4F1EC]"
                        >
                          Edit
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {isEditing ? (
                  <div className="space-y-3">
                    <textarea
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      rows={3}
                      className="w-full px-3 py-2 border border-[#E8E5DF] rounded-lg text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-[#2D4A3E]/20"
                    />
                    {t.placeholders?.length > 0 && (
                      <p className="text-xs text-[#6D6A65]">
                        Placeholders:{" "}
                        {t.placeholders.map((p) => (
                          <code
                            key={p}
                            className="bg-[#F4F1EC] px-1 py-0.5 rounded mr-1"
                          >
                            {"{" + p + "}"}
                          </code>
                        ))}
                      </p>
                    )}
                    <div className="flex items-center gap-2 justify-end">
                      {t.is_customized && (
                        <button
                          type="button"
                          onClick={() => resetTemplate(t.key)}
                          disabled={savingTemplate}
                          className="text-xs px-2.5 py-1.5 rounded-full border border-[#E8E5DF] text-[#6D6A65] hover:bg-[#F4F1EC] inline-flex items-center gap-1 disabled:opacity-50"
                        >
                          <RotateCcw size={10} /> Reset to default
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setEditingKey(null)}
                        className="text-xs px-2.5 py-1.5 rounded-full border border-[#E8E5DF] text-[#6D6A65] hover:bg-[#F4F1EC]"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => saveTemplate(t.key)}
                        disabled={savingTemplate}
                        className="tv-btn-primary !py-1.5 !px-3 text-xs disabled:opacity-50"
                      >
                        {savingTemplate ? (
                          <Loader2
                            size={10}
                            className="inline mr-1 animate-spin"
                          />
                        ) : null}
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-[#6D6A65] bg-[#FDFBF7] rounded-lg px-3 py-2 font-mono whitespace-pre-wrap">
                    {t.current_value}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
