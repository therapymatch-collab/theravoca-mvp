import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, MessageSquareWarning, CheckCircle2, ExternalLink } from "lucide-react";
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

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendTest = async () => {
    setTesting(true);
    try {
      const r = await client.post("/admin/test-sms", {});
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
        <button
          type="button"
          onClick={sendTest}
          disabled={testing}
          className="text-xs px-3 py-2 rounded-full bg-white border border-current shrink-0 disabled:opacity-50"
          data-testid="sms-test-btn"
        >
          {testing ? (
            <Loader2 size={12} className="inline mr-1 animate-spin" />
          ) : null}
          Send test SMS
        </button>
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
    </div>
  );
}
