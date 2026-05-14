/**
 * BroadcastEmailsPanel — admin tool for one-off broadcast email campaigns.
 *
 * Three views in a single panel: list (default) -> builder (new/edit) ->
 * preview modal. The builder lets an admin compose a campaign, pick
 * recipients via filter or pasted list, preview the rendered HTML for a
 * sample recipient, send a test to their own inbox, and finally fire
 * the campaign to all resolved recipients.
 *
 * Backend lives at /api/admin/email-campaigns/*. Sends route through
 * email_service.send_broadcast which uses force=True to bypass the
 * pre-launch safety guard (deliberate -- admin-initiated, audited).
 */
import { useEffect, useMemo, useState } from "react";
import {
  Loader2, RotateCw, Send, Mail, Eye, Trash2, ArrowLeft, Plus, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { sessionClient, getSession } from "@/lib/api";
import { Th } from "./_shared";

const SOURCE_OPTIONS = ["imported_xlsx", "signup", "recruited"];
const SUBSCRIPTION_STATUS_OPTIONS = [
  "trialing", "active", "past_due", "canceled", "incomplete",
];

export default function BroadcastEmailsPanel({ filter }) {
  const session = getSession();
  const client = sessionClient(session?.token);
  const [view, setView] = useState("list"); // 'list' | 'edit'
  const [editing, setEditing] = useState(null); // campaign object
  const [list, setList] = useState([]);
  const [loadingList, setLoadingList] = useState(false);

  const loadList = async () => {
    setLoadingList(true);
    try {
      const r = await client.get("/admin/email-campaigns");
      setList(r.data?.campaigns || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't load campaigns");
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    if (view === "list") loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const q = (filter || "").trim().toLowerCase();
  const visibleList = q
    ? list.filter(
        (c) =>
          (c.subject || "").toLowerCase().includes(q) ||
          (c.status || "").toLowerCase().includes(q),
      )
    : list;

  if (view === "edit") {
    return (
      <BuilderView
        client={client}
        campaign={editing}
        onBack={() => { setEditing(null); setView("list"); }}
      />
    );
  }

  return (
    <div
      className="mt-6 bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden"
      data-testid="broadcast-emails-panel"
    >
      <div className="flex items-center justify-between gap-3 p-5 border-b border-[#E8E5DF]">
        <div>
          <h3 className="font-serif-display text-2xl text-[#2D4A3E]">
            Broadcast emails
          </h3>
          <p className="text-sm text-[#6D6A65] mt-1">
            Compose + send one-off email campaigns to filtered therapist segments.
            Uses each therapist's real_email when available.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadList}
            disabled={loadingList}
            className="inline-flex items-center gap-2 text-sm text-[#2D4A3E] hover:underline disabled:opacity-50"
            data-testid="broadcast-reload"
          >
            <RotateCw size={14} className={loadingList ? "animate-spin" : ""} />
            Refresh
          </button>
          <button
            onClick={() => { setEditing(null); setView("edit"); }}
            className="inline-flex items-center gap-2 text-sm bg-[#2D4A3E] text-white px-4 py-2 rounded-full font-medium hover:bg-[#3F6F4A] transition"
            data-testid="broadcast-new"
          >
            <Plus size={14} /> New campaign
          </button>
        </div>
      </div>
      {loadingList && list.length === 0 ? (
        <div className="p-10 text-center text-[#6D6A65]">
          <Loader2 className="animate-spin inline" /> Loading…
        </div>
      ) : visibleList.length === 0 ? (
        <div className="p-10 text-center text-[#6D6A65]">
          {q ? "No campaigns match your search." : "No campaigns yet. Click 'New campaign' to start."}
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-[#FDFBF7] text-[#6D6A65]">
            <tr className="text-left">
              <Th>Subject</Th>
              <Th>Status</Th>
              <Th>Sent / Failed</Th>
              <Th>Created</Th>
              <Th>Sent</Th>
              <Th>{""}</Th>
            </tr>
          </thead>
          <tbody>
            {visibleList.map((c) => (
              <tr
                key={c.id}
                className="border-t border-[#E8E5DF] hover:bg-[#FDFBF7]"
                data-testid={`broadcast-row-${c.id}`}
              >
                <td className="p-4 text-[#2B2A29]">{c.subject || <em className="text-[#C8C4BB]">(no subject)</em>}</td>
                <td className="p-4 text-xs">
                  <StatusBadge status={c.status} />
                </td>
                <td className="p-4 text-xs text-[#6D6A65]">
                  {c.sent_counts
                    ? <>{c.sent_counts.sent} sent · <span className={c.sent_counts.failed ? "text-[#8B3220]" : ""}>{c.sent_counts.failed} failed</span></>
                    : "—"}
                </td>
                <td className="p-4 text-xs text-[#6D6A65] whitespace-nowrap">
                  {c.created_at ? new Date(c.created_at).toLocaleString() : "—"}
                </td>
                <td className="p-4 text-xs text-[#6D6A65] whitespace-nowrap">
                  {c.sent_at ? new Date(c.sent_at).toLocaleString() : "—"}
                </td>
                <td className="p-4 text-right whitespace-nowrap">
                  <button
                    onClick={() => { setEditing(c); setView("edit"); }}
                    className="text-xs text-[#2D4A3E] hover:underline mr-3"
                    data-testid={`broadcast-open-${c.id}`}
                  >
                    {c.status === "sent" ? "View" : "Edit"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function StatusBadge({ status }) {
  if (status === "sent") return <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[#F2F7F1] border border-[#D2E2D0] text-[#3F6F4A] text-[10px] uppercase tracking-wider font-bold">sent</span>;
  if (status === "draft") return <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[#FDFBF7] border border-[#E8E5DF] text-[#6D6A65] text-[10px] uppercase tracking-wider font-bold">draft</span>;
  return <span className="text-[#6D6A65]">{status || "—"}</span>;
}

// =========================================================================
// Builder view
// =========================================================================

function BuilderView({ client, campaign, onBack }) {
  const initial = useMemo(
    () => ({
      subject: campaign?.subject || "",
      body_html: campaign?.body_html || "<p>Hi {{first_name}},</p>\n\n<p>...</p>",
      reply_to: campaign?.reply_to || "",
      transactional: !!campaign?.transactional,
      use_real_email: campaign?.use_real_email !== false,
      recipient_filter: campaign?.recipient_filter || {
        source: ["imported_xlsx"],
        is_active: true,
        notify_email: true,
      },
      recipient_paste: campaign?.recipient_paste || "",
      mode: campaign?.recipient_paste ? "paste" : "filter",
    }),
    [campaign],
  );
  const [draft, setDraft] = useState(initial);
  const [campaignId, setCampaignId] = useState(campaign?.id || null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [preview, setPreview] = useState(null); // {recipient_count, sample_recipient, sample_rendered_body}
  const isSent = campaign?.status === "sent";

  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

  const toggleSource = (s) => {
    const cur = draft.recipient_filter.source || [];
    set("recipient_filter", {
      ...draft.recipient_filter,
      source: cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s],
    });
  };
  const toggleSubStatus = (s) => {
    const cur = draft.recipient_filter.subscription_status || [];
    const next = cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s];
    set("recipient_filter", {
      ...draft.recipient_filter,
      subscription_status: next.length ? next : undefined,
    });
  };

  const buildPayload = () => ({
    subject: draft.subject,
    body_html: draft.body_html,
    reply_to: draft.reply_to || null,
    transactional: draft.transactional,
    use_real_email: draft.use_real_email,
    recipient_filter: draft.mode === "filter" ? draft.recipient_filter : null,
    recipient_paste: draft.mode === "paste" ? draft.recipient_paste : null,
  });

  const saveDraft = async () => {
    setSaving(true);
    try {
      if (campaignId) {
        await client.put(`/admin/email-campaigns/${campaignId}`, buildPayload());
        toast.success("Saved");
      } else {
        const r = await client.post("/admin/email-campaigns", buildPayload());
        setCampaignId(r.data.id);
        toast.success("Draft created");
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const doPreview = async () => {
    await saveDraft();
    const id = campaignId || (await getOrCreateId());
    if (!id) return;
    try {
      const r = await client.post(`/admin/email-campaigns/${id}/preview`, {});
      setPreview(r.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Preview failed");
    }
  };

  const getOrCreateId = async () => {
    if (campaignId) return campaignId;
    const r = await client.post("/admin/email-campaigns", buildPayload());
    setCampaignId(r.data.id);
    return r.data.id;
  };

  const sendTest = async () => {
    if (!testTo || !testTo.includes("@")) {
      toast.error("Enter a valid test email address");
      return;
    }
    await saveDraft();
    const id = campaignId || (await getOrCreateId());
    if (!id) return;
    setSending(true);
    try {
      const r = await client.post(`/admin/email-campaigns/${id}/test`, {
        test_recipient: testTo,
      });
      if (r.data.sent) toast.success(`Test sent to ${testTo}`);
      else toast.error("Send returned no result (check logs)");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Test send failed");
    } finally {
      setSending(false);
    }
  };

  const sendLive = async () => {
    await saveDraft();
    const id = campaignId || (await getOrCreateId());
    if (!id) return;
    const ok = window.confirm(
      `Send this campaign to all resolved recipients?\n\nThis cannot be undone. Recipients already in email_sends will be skipped.`,
    );
    if (!ok) return;
    setSending(true);
    try {
      const r = await client.post(`/admin/email-campaigns/${id}/send`, {});
      const d = r.data;
      toast.success(
        `Sent ${d.sent} / Skipped ${d.skipped} / Failed ${d.failed} (of ${d.resolved} resolved)`,
      );
      onBack();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Live send failed");
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="mt-6 bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden"
      data-testid="broadcast-builder"
    >
      <div className="flex items-center justify-between gap-3 p-5 border-b border-[#E8E5DF] bg-[#FDFBF7]">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm text-[#2D4A3E] hover:underline"
          data-testid="broadcast-back"
        >
          <ArrowLeft size={14} /> Back to campaigns
        </button>
        {isSent && (
          <span className="text-xs uppercase tracking-wider text-[#3F6F4A] font-semibold bg-[#F2F7F1] border border-[#D2E2D0] px-3 py-1 rounded-full">
            sent · locked
          </span>
        )}
      </div>

      <div className="p-6 space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs uppercase tracking-wider text-[#6D6A65] font-semibold mb-1.5">From</label>
            <input
              value="TheraVoca Support <support@theravoca.com>"
              readOnly
              disabled
              className="w-full px-3 py-2.5 text-sm rounded-xl bg-[#F5F3EF] border border-[#E8E5DF] text-[#6D6A65]"
            />
            <p className="text-[11px] text-[#8A8780] mt-1">Reads from SENDER_EMAIL env. Change on Render to override.</p>
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-[#6D6A65] font-semibold mb-1.5">Reply-to</label>
            <input
              value={draft.reply_to}
              onChange={(e) => set("reply_to", e.target.value)}
              placeholder="support@theravoca.com (default)"
              disabled={isSent}
              className="w-full px-3 py-2.5 text-sm rounded-xl bg-[#FDFBF7] border border-[#E8E5DF]"
              data-testid="broadcast-replyto"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider text-[#6D6A65] font-semibold mb-1.5">Subject *</label>
          <input
            value={draft.subject}
            onChange={(e) => set("subject", e.target.value)}
            placeholder="e.g. We're live in Idaho!"
            disabled={isSent}
            className="w-full px-3 py-2.5 text-sm rounded-xl bg-[#FDFBF7] border border-[#E8E5DF]"
            data-testid="broadcast-subject"
          />
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider text-[#6D6A65] font-semibold mb-2">Recipients *</label>
          <div className="flex gap-1 border-b border-[#E8E5DF]">
            <button
              type="button"
              onClick={() => set("mode", "filter")}
              disabled={isSent}
              className={`px-4 py-2 text-sm rounded-t-lg ${draft.mode === "filter" ? "bg-white border border-b-white border-[#E8E5DF] -mb-px font-semibold text-[#2D4A3E]" : "text-[#6D6A65]"}`}
              data-testid="broadcast-mode-filter"
            >
              Filter
            </button>
            <button
              type="button"
              onClick={() => set("mode", "paste")}
              disabled={isSent}
              className={`px-4 py-2 text-sm rounded-t-lg ${draft.mode === "paste" ? "bg-white border border-b-white border-[#E8E5DF] -mb-px font-semibold text-[#2D4A3E]" : "text-[#6D6A65]"}`}
              data-testid="broadcast-mode-paste"
            >
              Paste list
            </button>
          </div>
          <div className="border border-t-0 border-[#E8E5DF] rounded-b-lg rounded-tr-lg p-4 bg-[#FDFBF7]">
            {draft.mode === "filter" ? (
              <div className="space-y-3">
                <FilterChipRow
                  label="Source"
                  options={SOURCE_OPTIONS}
                  selected={draft.recipient_filter.source || []}
                  onToggle={toggleSource}
                  disabled={isSent}
                />
                <FilterChipRow
                  label="Subscription status"
                  options={SUBSCRIPTION_STATUS_OPTIONS}
                  selected={draft.recipient_filter.subscription_status || []}
                  onToggle={toggleSubStatus}
                  disabled={isSent}
                  hint="Leave empty for any"
                />
                <div className="flex items-center gap-4 text-sm">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.recipient_filter.is_active !== false}
                      onChange={(e) => set("recipient_filter", { ...draft.recipient_filter, is_active: e.target.checked })}
                      disabled={isSent}
                    />
                    is_active
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.recipient_filter.notify_email !== false}
                      onChange={(e) => set("recipient_filter", { ...draft.recipient_filter, notify_email: e.target.checked })}
                      disabled={isSent}
                    />
                    notify_email
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.use_real_email}
                      onChange={(e) => set("use_real_email", e.target.checked)}
                      disabled={isSent}
                    />
                    use real_email when available
                  </label>
                </div>
              </div>
            ) : (
              <div>
                <textarea
                  rows={5}
                  value={draft.recipient_paste}
                  onChange={(e) => set("recipient_paste", e.target.value)}
                  placeholder="One per line or comma-separated. Phones (+12085551234) or emails (sarah@example.com). Phones are matched against therapist.phone / phone_alert."
                  disabled={isSent}
                  className="w-full px-3 py-2 text-sm rounded-xl bg-white border border-[#E8E5DF] font-mono text-xs"
                  data-testid="broadcast-paste"
                />
                <p className="text-[11px] text-[#8A8780] mt-1">
                  Mixed phones + emails are OK. Phones resolved against existing therapists.
                  Emails not in the DB are sent as-is with first_name="there".
                </p>
              </div>
            )}
          </div>
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider text-[#6D6A65] font-semibold mb-1.5">Body (HTML) *</label>
          <textarea
            rows={14}
            value={draft.body_html}
            onChange={(e) => set("body_html", e.target.value)}
            disabled={isSent}
            className="w-full px-3 py-2 text-sm rounded-xl bg-[#FDFBF7] border border-[#E8E5DF] font-mono text-xs leading-relaxed"
            data-testid="broadcast-body"
          />
          <p className="text-[11px] text-[#8A8780] mt-1">
            Merge fields: <code>{"{{first_name}}"}</code>, <code>{"{{name}}"}</code>, <code>{"{{email}}"}</code>, <code>{"{{credential_type}}"}</code>.
            Body is wrapped in the standard TheraVoca shell (logo + footer) automatically.
          </p>
          <label className="inline-flex items-center gap-2 cursor-pointer text-sm mt-3">
            <input
              type="checkbox"
              checked={draft.transactional}
              onChange={(e) => set("transactional", e.target.checked)}
              disabled={isSent}
            />
            Transactional (skip unsubscribe footer)
          </label>
        </div>

        {preview && (
          <div className="border border-dashed border-[#E8E5DF] rounded-xl p-5 bg-[#FDFBF7]">
            <div className="text-xs text-[#6D6A65] border-b border-dashed border-[#E8E5DF] pb-3 mb-3">
              <strong>Preview · sample recipient 1 of {preview.recipient_count}</strong><br/>
              From: TheraVoca Support &lt;support@theravoca.com&gt;<br/>
              To: {preview.sample_recipient?.email || "—"}<br/>
              Subject: <strong>{preview.subject}</strong>
            </div>
            <div
              className="bg-white border border-[#E8E5DF] rounded-lg p-4 text-sm leading-relaxed"
              dangerouslySetInnerHTML={{ __html: preview.sample_rendered_body || "<em>(empty body)</em>" }}
            />
          </div>
        )}

        {!isSent && (
          <div className="flex items-center justify-end gap-2 pt-5 border-t border-[#E8E5DF] flex-wrap">
            <button
              onClick={saveDraft}
              disabled={saving}
              className="text-sm px-4 py-2 rounded-full border border-[#E8E5DF] text-[#2D4A3E] hover:bg-[#FDFBF7] disabled:opacity-50"
              data-testid="broadcast-save"
            >
              {saving ? <Loader2 size={14} className="inline animate-spin" /> : "Save draft"}
            </button>
            <button
              onClick={doPreview}
              disabled={saving || sending}
              className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-full border border-[#E8E5DF] text-[#2D4A3E] hover:bg-[#FDFBF7]"
              data-testid="broadcast-preview"
            >
              <Eye size={14} /> Preview
            </button>
            <input
              type="email"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="test@yourinbox.com"
              className="text-sm px-3 py-2 rounded-full border border-[#E8E5DF] bg-white w-56"
              data-testid="broadcast-test-to"
            />
            <button
              onClick={sendTest}
              disabled={sending || !testTo}
              className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-full border border-[#2D4A3E] text-[#2D4A3E] hover:bg-[#FDFBF7] disabled:opacity-50"
              data-testid="broadcast-test"
            >
              <Mail size={14} /> Send test
            </button>
            <button
              onClick={sendLive}
              disabled={sending}
              className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-full bg-[#8B3220] text-white hover:bg-[#6E2618] disabled:opacity-50"
              data-testid="broadcast-send-live"
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Send live
            </button>
          </div>
        )}

        {isSent && campaign?.sent_counts && (
          <div className="bg-[#F2F7F1] border border-[#D2E2D0] rounded-xl p-4 text-sm text-[#3F6F4A]">
            <strong>Sent {new Date(campaign.sent_at).toLocaleString()}.</strong>
            {" "}Resolved {campaign.sent_counts.resolved} · Sent {campaign.sent_counts.sent} ·
            Skipped {campaign.sent_counts.skipped} · Failed {campaign.sent_counts.failed}.
          </div>
        )}

        {!isSent && (
          <div className="bg-[#FDF7EC] border border-[#E8DCC1] rounded-xl p-3 text-xs text-[#8B5A1F] flex items-start gap-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>
              Live send fires real emails to real therapist addresses. Always preview + send test to your own inbox first.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function FilterChipRow({ label, options, selected, onToggle, hint, disabled }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-[#6D6A65] font-semibold mb-1.5">
        {label}{hint && <span className="text-[#8A8780] font-normal normal-case tracking-normal ml-2">({hint})</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = selected.includes(o);
          return (
            <button
              key={o}
              type="button"
              onClick={() => onToggle(o)}
              disabled={disabled}
              className={`px-3 py-1 text-xs rounded-full border transition ${on ? "bg-[#2D4A3E] text-white border-[#2D4A3E]" : "bg-white border-[#E8E5DF] text-[#2B2A29] hover:border-[#2D4A3E]"} ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
              data-testid={`broadcast-chip-${label.toLowerCase().replace(/\s/g,"_")}-${o}`}
            >
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
}
