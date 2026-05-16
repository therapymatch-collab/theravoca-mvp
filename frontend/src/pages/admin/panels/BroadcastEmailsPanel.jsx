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
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2, RotateCw, Send, Mail, Eye, ArrowLeft, Plus, AlertTriangle, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import ReactQuill from "react-quill-new";
import "react-quill-new/dist/quill.snow.css";
import useAdminClient from "@/lib/useAdminClient";
import { Th } from "./_shared";

const SOURCE_OPTIONS = ["imported_xlsx", "signup", "recruited"];
const SUBSCRIPTION_STATUS_OPTIONS = [
  "trialing", "active", "past_due", "canceled", "incomplete",
];

export default function BroadcastEmailsPanel({ filter }) {
  // useAdminClient pulls the right auth (X-Admin-Password header OR
  // admin Bearer token) from the AdminClientProvider context. Using
  // sessionClient here would silently 401 -- sessionClient is for
  // patient/therapist portals.
  const client = useAdminClient();
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

  // Delete a draft (or scheduled) campaign. Sent campaigns are blocked
  // server-side with a 409 -- they're audit trail and need to live
  // forever. We confirm via window.confirm because there's no toast
  // pattern in this panel and a raw click would be too easy to misfire.
  const deleteCampaign = async (c) => {
    const subjectLine = c.subject?.trim() || "(no subject)";
    if (!window.confirm(
      `Delete draft "${subjectLine}"?\n\nThis cannot be undone. Sent campaigns are kept regardless.`
    )) return;
    try {
      await client.delete(`/admin/email-campaigns/${c.id}`);
      setList((prev) => prev.filter((x) => x.id !== c.id));
      toast.success("Draft deleted");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Delete failed");
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
                  {c.status !== "sent" && (
                    <button
                      onClick={() => deleteCampaign(c)}
                      className="inline-flex items-center gap-1 text-xs text-[#8B3220] hover:text-[#C8412B] hover:underline"
                      title="Delete this draft. Sent campaigns are kept for audit and can't be deleted."
                      data-testid={`broadcast-delete-${c.id}`}
                    >
                      <Trash2 size={12} /> Delete
                    </button>
                  )}
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
      paste_format: campaign?.paste_format || "emails",
      recipient_ids: campaign?.recipient_ids || [],
      mode: campaign?.recipient_ids?.length
        ? "pick"
        : campaign?.recipient_paste
          ? "paste"
          : "filter",
    }),
    [campaign],
  );
  const [draft, setDraft] = useState(initial);
  const [campaignId, setCampaignId] = useState(campaign?.id || null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [preview, setPreview] = useState(null); // {recipient_count, sample_recipient, sample_rendered_body}
  // Therapist roster for the Pick-from-list mode; lazy-loaded when the
  // user opens that tab. Kept in panel state so switching tabs doesn't
  // re-fetch on every flip.
  const [roster, setRoster] = useState(null);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterSearch, setRosterSearch] = useState("");
  const isSent = campaign?.status === "sent";

  useEffect(() => {
    if (draft.mode === "pick" && roster === null && !rosterLoading) {
      setRosterLoading(true);
      client
        .get("/admin/broadcast/therapist-emails")
        .then((r) => setRoster(r.data?.therapists || []))
        .catch((e) =>
          toast.error(e?.response?.data?.detail || "Couldn't load therapist list"),
        )
        .finally(() => setRosterLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.mode]);

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
    paste_format: draft.mode === "paste" ? draft.paste_format : "emails",
    recipient_ids: draft.mode === "pick" ? (draft.recipient_ids || []) : null,
  });

  // saveDraft RETURNS the campaign id (creating-or-updating, idempotent
  // within a single call). Callers MUST use the returned id rather than
  // reading the campaignId state, because setCampaignId is async --
  // reading state right after setCampaignId still sees the old (null)
  // value, which previously caused a duplicate-create on the very next
  // line ("getOrCreateId" would fire and create a 2nd campaign).
  const saveDraft = async ({ silent = false } = {}) => {
    setSaving(true);
    try {
      if (campaignId) {
        await client.put(`/admin/email-campaigns/${campaignId}`, buildPayload());
        if (!silent) toast.success("Saved");
        return campaignId;
      }
      const r = await client.post("/admin/email-campaigns", buildPayload());
      setCampaignId(r.data.id);
      if (!silent) toast.success("Draft created");
      return r.data.id;
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const doPreview = async () => {
    const id = await saveDraft({ silent: true });
    if (!id) return;
    try {
      const r = await client.post(`/admin/email-campaigns/${id}/preview`, {});
      setPreview(r.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Preview failed");
    }
  };

  const sendTest = async () => {
    if (!testTo || !testTo.includes("@")) {
      toast.error("Enter a valid test email address");
      return;
    }
    const id = await saveDraft({ silent: true });
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
    const id = await saveDraft({ silent: true });
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
              onClick={() => set("mode", "pick")}
              disabled={isSent}
              className={`px-4 py-2 text-sm rounded-t-lg ${draft.mode === "pick" ? "bg-white border border-b-white border-[#E8E5DF] -mb-px font-semibold text-[#2D4A3E]" : "text-[#6D6A65]"}`}
              data-testid="broadcast-mode-pick"
            >
              Pick from list{draft.mode === "pick" && (draft.recipient_ids?.length || 0) > 0 ? ` (${draft.recipient_ids.length})` : ""}
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
            {draft.mode === "pick" ? (
              <PickFromListMode
                roster={roster}
                loading={rosterLoading}
                search={rosterSearch}
                onSearch={setRosterSearch}
                selectedIds={draft.recipient_ids || []}
                onSelectedChange={(ids) => set("recipient_ids", ids)}
                disabled={isSent}
              />
            ) : draft.mode === "filter" ? (
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
                <div className="flex items-center gap-2 mb-2">
                  <label className="text-[11px] uppercase tracking-wider text-[#6D6A65] font-semibold">
                    Pasting:
                  </label>
                  <select
                    value={draft.paste_format}
                    onChange={(e) => set("paste_format", e.target.value)}
                    disabled={isSent}
                    className="text-sm px-3 py-1.5 rounded-lg bg-white border border-[#E8E5DF] font-medium"
                    data-testid="broadcast-paste-format"
                  >
                    <option value="emails">Emails (send directly)</option>
                    <option value="phones">Phones (look up therapist + use their email)</option>
                  </select>
                </div>
                <textarea
                  rows={5}
                  value={draft.recipient_paste}
                  onChange={(e) => set("recipient_paste", e.target.value)}
                  placeholder={
                    draft.paste_format === "phones"
                      ? "One phone per line or comma-separated. e.g. +12085551234, +12089998765. Each phone is matched against therapist.phone or phone_alert."
                      : "One email per line or comma-separated. e.g. sarah@example.com, marcus@example.com. Emails not in our DB are sent as-is with first_name=\"there\"."
                  }
                  disabled={isSent}
                  className="w-full px-3 py-2 text-sm rounded-xl bg-white border border-[#E8E5DF] font-mono text-xs"
                  data-testid="broadcast-paste"
                />
                <p className="text-[11px] text-[#8A8780] mt-1">
                  {draft.paste_format === "phones"
                    ? "Tokens that don't look like 10-digit US phones are skipped silently."
                    : "Tokens without an @ are skipped silently."}
                </p>
              </div>
            )}
          </div>
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider text-[#6D6A65] font-semibold mb-1.5">Body *</label>
          <RichBodyEditor
            value={draft.body_html}
            onChange={(v) => set("body_html", v)}
            disabled={isSent}
          />
          <p className="text-[11px] text-[#8A8780] mt-1">
            Merge fields: <code>{"{{first_name}}"}</code>, <code>{"{{name}}"}</code>, <code>{"{{email}}"}</code>, <code>{"{{credential_type}}"}</code>.
            They render literally in the editor and get substituted on send.
            Body is wrapped in the standard TheraVoca shell (logo + footer) automatically.
            For a preview with real recipient data substituted, click <strong>Preview</strong> below.
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
          <div className="border border-dashed border-[#E8E5DF] rounded-xl p-5 bg-[#FDFBF7] overflow-hidden">
            <div className="text-xs text-[#6D6A65] border-b border-dashed border-[#E8E5DF] pb-3 mb-3 break-words">
              <strong>Preview · sample recipient 1 of {preview.recipient_count}</strong><br/>
              From: TheraVoca Support &lt;support@theravoca.com&gt;<br/>
              To: {preview.sample_recipient?.email || "—"}<br/>
              Subject: <strong>{preview.subject}</strong>
            </div>
            {/* Email-shaped preview: brand bar + body + footer rendered
                directly in React so the panel width is respected (no
                iframe horizontal-scroll fight, no sandbox issues, no
                height auto-sizing dance). Body uses the same 15px font
                / 1.7 line-height / overflow-wrap rules the inbox sees;
                width-capped at 100% of the panel column so long pasted
                URLs wrap at word boundaries instead of producing a
                horizontal scrollbar. */}
            <div
              className="bg-white border border-[#E8E5DF] rounded-lg overflow-hidden mx-auto"
              style={{ maxWidth: "640px" }}
              data-testid="broadcast-preview-shell"
            >
              {/* Brand bar (mirrors backend _wrap()'s header row) */}
              <div
                style={{
                  padding: "20px 24px",
                  borderBottom: "1px solid #E8E5DF",
                  background: "#ffffff",
                }}
                data-testid="broadcast-preview-brand"
              >
                <span
                  style={{
                    fontFamily: "Georgia, serif",
                    fontSize: "20px",
                    color: "#2D4A3E",
                    letterSpacing: "-0.5px",
                  }}
                >
                  TheraVoca
                </span>
              </div>
              {/* Body content -- the `dangerouslySetInnerHTML` payload
                  is rendered in WYSIWYG mode (no injected paragraph
                  margins, no spacer divs, bare <p><br></p> preserved)
                  by the backend so it matches the Quill editor exactly.
                  Force <p> margin to 0 here too so the preview pane's
                  browser default doesn't add any margin and override
                  the WYSIWYG match.

                  Inline `<style>` scoped via parent class so we don't
                  affect transactional email previews elsewhere. */}
              <style>{`
                .tv-broadcast-preview-body p { margin: 0; }
                .tv-broadcast-preview-body p:empty,
                .tv-broadcast-preview-body p:has(> br:only-child) {
                  min-height: 1em;
                }
              `}</style>
              <div
                className="tv-broadcast-preview-body"
                style={{
                  padding: "24px",
                  fontFamily:
                    "-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif",
                  fontSize: "15px",
                  lineHeight: 1.7,
                  color: "#2B2A29",
                  // Wrap at word boundaries (the default English-text
                  // behaviour). The earlier `wordBreak: keep-all` was a
                  // mis-fix for "mid-word splits" -- keep-all is a CJK
                  // setting that tells the browser NOT to break between
                  // tokens, which on English text causes lines to
                  // overflow the container's right edge (the actual bug
                  // Josh kept seeing). overflowWrap:break-word is the
                  // standard safety net for the one case that does
                  // matter -- a single unbroken token (long URL,
                  // base64 string) wider than the column gets broken
                  // rather than overflowing.
                  wordBreak: "normal",
                  overflowWrap: "break-word",
                  // hyphens:none stays; the issue was never hyphenation.
                  hyphens: "none",
                  // Hard cap to the shell width so even a renegade
                  // child element with its own min-width can't push the
                  // body past the 640px card edge.
                  maxWidth: "100%",
                }}
                data-testid="broadcast-preview-body"
                dangerouslySetInnerHTML={{
                  __html:
                    preview.sample_rendered_body || "<em>(empty body)</em>",
                }}
              />
              {/* Footer (mirrors backend _wrap()'s footer row) */}
              <div
                style={{
                  padding: "16px 24px",
                  borderTop: "1px solid #E8E5DF",
                  background: "#FDFBF7",
                  fontSize: "12px",
                  lineHeight: 1.6,
                  color: "#6D6A65",
                  // Same wrap policy as the body -- without these the
                  // footer's "support@theravoca.com" + unsubscribe line
                  // can run off the right edge on narrower panel
                  // widths (the issue Josh just reported alongside the
                  // body cutoff).
                  wordBreak: "normal",
                  overflowWrap: "break-word",
                  hyphens: "none",
                  maxWidth: "100%",
                }}
                data-testid="broadcast-preview-footer"
              >
                You received this email from TheraVoca. Questions? Reach us
                at support@theravoca.com.
                {!draft.transactional && (
                  <>
                    <br />
                    Don't want these emails? Unsubscribe with one click.
                  </>
                )}
              </div>
            </div>
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

function RichBodyEditor({ value, onChange, disabled }) {
  // Quill-based WYSIWYG. Generates clean semantic HTML that flows
  // through _wrap() on the backend. Merge fields ({{first_name}})
  // render as literal text in the editor and get substituted server-
  // side at send time.
  const quillRef = useRef(null);

  const insertMergeField = (field) => {
    const editor = quillRef.current?.getEditor?.();
    if (!editor) return;
    const range = editor.getSelection(true);
    const at = range ? range.index : editor.getLength();
    editor.insertText(at, `{{${field}}}`, "user");
    editor.setSelection(at + `{{${field}}}`.length, 0, "user");
  };

  const modules = useMemo(
    () => ({
      toolbar: [
        [{ header: [2, 3, false] }],
        ["bold", "italic", "underline"],
        [{ list: "ordered" }, { list: "bullet" }],
        ["link", "blockquote"],
        ["clean"],
      ],
    }),
    [],
  );

  const formats = [
    "header", "bold", "italic", "underline",
    "list", "bullet", "link", "blockquote",
  ];

  return (
    <div
      data-testid="broadcast-rich-body"
      className={`broadcast-rich-body ${disabled ? "opacity-60 pointer-events-none" : ""}`}
    >
      {/* Editor uses Quill snow defaults (tight single-line spacing).
          The preview pane below shows the actual email layout with
          paragraph margins -- editor stays compact for fast typing,
          preview shows what will land in the inbox. */}
      <ReactQuill
        ref={quillRef}
        theme="snow"
        value={value}
        onChange={onChange}
        readOnly={disabled}
        modules={modules}
        formats={formats}
        placeholder="Write your email body. Use the toolbar for formatting; merge fields can be inserted below."
      />
      <div className="mt-2 flex items-center gap-1.5 flex-wrap text-[11px]">
        <span className="uppercase tracking-wider text-[#6D6A65] font-semibold mr-1">
          Insert merge field:
        </span>
        {["first_name", "name", "email", "credential_type"].map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => insertMergeField(f)}
            disabled={disabled}
            className="px-2 py-1 rounded-md border border-[#E8E5DF] bg-[#FDFBF7] hover:bg-white text-[#2D4A3E] font-mono disabled:opacity-50"
            data-testid={`broadcast-merge-${f}`}
          >
            {`{{${f}}}`}
          </button>
        ))}
      </div>
    </div>
  );
}

function PickFromListMode({
  roster, loading, search, onSearch,
  selectedIds, onSelectedChange, disabled,
}) {
  const selectedSet = useMemo(() => new Set(selectedIds || []), [selectedIds]);
  const q = (search || "").trim().toLowerCase();
  const visible = useMemo(() => {
    if (!roster) return [];
    if (!q) return roster;
    return roster.filter(
      (t) =>
        (t.name || "").toLowerCase().includes(q) ||
        (t.email || "").toLowerCase().includes(q) ||
        (t.source || "").toLowerCase().includes(q) ||
        (t.credential_type || "").toLowerCase().includes(q),
    );
  }, [roster, q]);

  const visibleIds = visible.map((t) => t.id);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedSet.has(id));

  const toggleOne = (id) => {
    if (disabled) return;
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedChange(Array.from(next));
  };

  const selectAllVisible = () => {
    if (disabled) return;
    const next = new Set(selectedSet);
    visibleIds.forEach((id) => next.add(id));
    onSelectedChange(Array.from(next));
  };

  const clearAllVisible = () => {
    if (disabled) return;
    const next = new Set(selectedSet);
    visibleIds.forEach((id) => next.delete(id));
    onSelectedChange(Array.from(next));
  };

  if (loading && !roster) {
    return (
      <div className="text-center py-8 text-[#6D6A65]">
        <Loader2 className="animate-spin inline" /> Loading therapist list…
      </div>
    );
  }
  if (!roster) {
    return <div className="text-[#6D6A65] text-sm">Loading…</div>;
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={`Search ${roster.length} therapists by name, email, source…`}
          disabled={disabled}
          className="flex-1 px-3 py-2 text-sm rounded-lg bg-white border border-[#E8E5DF] min-w-[200px]"
          data-testid="broadcast-pick-search"
        />
        <button
          type="button"
          onClick={allVisibleSelected ? clearAllVisible : selectAllVisible}
          disabled={disabled || visibleIds.length === 0}
          className="text-xs px-3 py-2 rounded-lg border border-[#E8E5DF] text-[#2D4A3E] hover:bg-white disabled:opacity-50"
          data-testid="broadcast-pick-select-all"
        >
          {allVisibleSelected ? "Clear all visible" : `Select all visible (${visibleIds.length})`}
        </button>
      </div>
      <div className="text-xs text-[#6D6A65] mb-2">
        <strong className="text-[#2D4A3E]">{selectedIds?.length || 0} selected</strong> of {roster.length} total · {visible.length} match the search
      </div>
      <div
        className="border border-[#E8E5DF] rounded-lg bg-white overflow-y-auto"
        style={{ maxHeight: "320px" }}
      >
        {visible.length === 0 ? (
          <div className="text-center py-8 text-[#6D6A65] text-sm">No matches.</div>
        ) : (
          visible.map((t) => {
            const on = selectedSet.has(t.id);
            return (
              <label
                key={t.id}
                className={`flex items-center gap-3 px-3 py-2 border-b border-[#E8E5DF] last:border-b-0 hover:bg-[#FDFBF7] cursor-pointer ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
                data-testid={`broadcast-pick-row-${t.id}`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggleOne(t.id)}
                  disabled={disabled}
                  className="cursor-pointer"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[#2B2A29] truncate">
                    {t.name || <em className="text-[#C8C4BB]">(unnamed)</em>}
                    {t.credential_type && (
                      <span className="text-xs text-[#6D6A65] font-normal ml-2">{t.credential_type}</span>
                    )}
                  </div>
                  <div className="text-xs text-[#6D6A65] truncate">
                    {t.email}
                    {t.email_source === "email" && (
                      <span className="text-[10px] text-[#C87965] ml-2">no real_email</span>
                    )}
                  </div>
                </div>
                <div className="text-[10px] text-[#8A8780] whitespace-nowrap">
                  {t.source && <span className="px-1.5 py-0.5 rounded bg-[#FDFBF7] border border-[#E8E5DF] mr-1">{t.source}</span>}
                  {t.subscription_status && <span>{t.subscription_status}</span>}
                </div>
              </label>
            );
          })
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
