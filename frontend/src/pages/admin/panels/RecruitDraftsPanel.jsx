import { Copy, Loader2, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { FactStat } from "./_panelShared";

// Pre-launch recruit list — LLM-generated draft therapist invites grouped
// by the gap they were generated for. Pure presentational; the parent
// passes mutation handlers (onGenerate / onSendAll / onDelete / etc).
export default function RecruitDraftsPanel({
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
