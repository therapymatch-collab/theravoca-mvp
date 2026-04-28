import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Pencil, Trash2, Plus, ArrowUp, ArrowDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { bustFaqsCache } from "@/lib/useFaqs";

// ── FAQ admin panel ────────────────────────────────────────────────
// Add / edit / delete / reorder FAQ entries shown on Landing page
// (audience='patient') and on the therapist signup page
// (audience='therapist'). New entries are immediately published unless
// admin un-checks the publish toggle.
export default function FaqAdminPanel({ client }) {
  const [audience, setAudience] = useState("patient");
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null); // null | "new" | row
  const [form, setForm] = useState({ question: "", answer: "", published: true });
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await client.get(`/admin/faqs?audience=${audience}`);
        if (!alive) return;
        setRows(r.data?.items || []);
      } catch (e) {
        toast.error(
          e?.response?.data?.detail || e.message || "Failed to load FAQs",
        );
      }
    })();
    return () => {
      alive = false;
    };
  }, [client, audience, reload]);

  const startNew = () => {
    setEditing("new");
    setForm({ question: "", answer: "", published: true });
  };
  const startEdit = (r) => {
    setEditing(r);
    setForm({
      question: r.question,
      answer: r.answer,
      published: r.published !== false,
    });
  };
  const cancel = () => setEditing(null);

  const save = async () => {
    if (!form.question.trim() || !form.answer.trim()) {
      toast.error("Question and answer are required");
      return;
    }
    setSaving(true);
    try {
      if (editing === "new") {
        await client.post("/admin/faqs", { audience, ...form });
        toast.success("FAQ added");
      } else {
        await client.put(`/admin/faqs/${editing.id}`, form);
        toast.success("FAQ updated");
      }
      bustFaqsCache(audience);
      setEditing(null);
      setReload((n) => n + 1);
    } catch (e) {
      toast.error(e?.response?.data?.detail || e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r) => {
    if (!window.confirm(`Delete "${r.question}"? This cannot be undone.`)) return;
    try {
      await client.delete(`/admin/faqs/${r.id}`);
      bustFaqsCache(audience);
      toast.success("Deleted");
      setReload((n) => n + 1);
    } catch (e) {
      toast.error(e?.response?.data?.detail || e.message || "Delete failed");
    }
  };

  const move = async (idx, dir) => {
    const list = [...(rows || [])];
    const swap = idx + dir;
    if (swap < 0 || swap >= list.length) return;
    [list[idx], list[swap]] = [list[swap], list[idx]];
    const ids = list.map((r) => r.id);
    setRows(list);
    try {
      await client.put("/admin/faqs/reorder", { audience, ids });
      bustFaqsCache(audience);
    } catch (e) {
      toast.error("Reorder failed");
      setReload((n) => n + 1);
    }
  };

  const seed = async () => {
    if (
      !window.confirm(
        "Seed the legacy default FAQs? Only seeds when the database is empty for the selected audience.",
      )
    )
      return;
    try {
      await client.post("/admin/faqs/seed", {});
      bustFaqsCache(audience);
      toast.success("Seeded");
      setReload((n) => n + 1);
    } catch (e) {
      toast.error(e?.response?.data?.detail || e.message || "Seed failed");
    }
  };

  return (
    <div className="mt-6 space-y-4" data-testid="faq-admin-panel">
      <div className="bg-white border border-[#E8E5DF] rounded-2xl p-6">
        <h3 className="font-serif-display text-2xl text-[#2D4A3E]">
          FAQ editor
        </h3>
        <p className="text-sm text-[#6D6A65] mt-2 max-w-3xl leading-relaxed">
          Edit the FAQ list shown on the Landing page (Patient) and the
          Therapist signup page. Reorder with the arrows; add or delete
          freely. Saved changes appear within 60 seconds of a hard refresh.
        </p>
        <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
          <div
            className="inline-flex bg-[#FDFBF7] border border-[#E8E5DF] rounded-full p-1"
            data-testid="faq-audience-toggle"
          >
            {["patient", "therapist"].map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAudience(a)}
                className={`px-4 py-1.5 text-xs rounded-full transition ${
                  audience === a
                    ? "bg-[#2D4A3E] text-white font-semibold"
                    : "text-[#6D6A65] hover:text-[#2D4A3E]"
                }`}
                data-testid={`faq-audience-${a}`}
              >
                {a === "patient" ? "Patient (Landing)" : "Therapist (Signup)"}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={seed}
              className="text-xs text-[#6D6A65] hover:text-[#2D4A3E] underline"
              data-testid="faq-seed-btn"
            >
              Seed defaults
            </button>
            <button
              type="button"
              onClick={startNew}
              className="tv-btn-primary !py-2 !px-4 text-sm inline-flex items-center gap-1.5"
              data-testid="faq-new-btn"
            >
              <Plus size={14} /> New FAQ
            </button>
          </div>
        </div>
      </div>

      {editing && (
        <div
          className="bg-white border border-[#E8E5DF] rounded-2xl p-6 space-y-3"
          data-testid="faq-editor"
        >
          <div className="text-xs uppercase tracking-wider text-[#C87965]">
            {editing === "new"
              ? `New ${audience} FAQ`
              : `Editing — ${editing.question}`}
          </div>
          <div>
            <label className="text-xs text-[#6D6A65]">Question</label>
            <Input
              value={form.question}
              onChange={(e) => setForm({ ...form, question: e.target.value })}
              data-testid="faq-question-input"
              placeholder="What happens after I submit my request?"
            />
          </div>
          <div>
            <label className="text-xs text-[#6D6A65]">Answer</label>
            <Textarea
              rows={5}
              value={form.answer}
              onChange={(e) => setForm({ ...form, answer: e.target.value })}
              data-testid="faq-answer-input"
              placeholder="Plain text or short paragraphs."
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="faq-published"
              checked={form.published}
              onChange={(e) => setForm({ ...form, published: e.target.checked })}
              data-testid="faq-publish-checkbox"
            />
            <label htmlFor="faq-published" className="text-sm text-[#2B2A29]">
              Published (visible to the public)
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-[#E8E5DF]">
            <button
              type="button"
              onClick={cancel}
              disabled={saving}
              className="tv-btn-secondary !py-2 !px-4 text-sm"
              data-testid="faq-cancel-btn"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="tv-btn-primary !py-2 !px-4 text-sm disabled:opacity-50"
              data-testid="faq-save-btn"
            >
              {saving ? <Loader2 size={14} className="inline mr-1.5 animate-spin" /> : null}
              {editing === "new" ? "Add FAQ" : "Save changes"}
            </button>
          </div>
        </div>
      )}

      {rows == null ? (
        <div className="bg-white border border-[#E8E5DF] rounded-2xl p-12 text-center text-[#6D6A65]">
          <Loader2 className="animate-spin mx-auto mb-3 text-[#2D4A3E]" />
          Loading FAQs…
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white border border-[#E8E5DF] rounded-2xl p-12 text-center text-[#6D6A65]">
          No FAQs yet. Click <strong>New FAQ</strong> to add one — or{" "}
          <button
            type="button"
            onClick={seed}
            className="underline text-[#2D4A3E]"
          >
            seed defaults
          </button>
          .
        </div>
      ) : (
        <div className="space-y-3" data-testid="faq-list">
          {rows.map((r, idx) => (
            <div
              key={r.id}
              className="bg-white border border-[#E8E5DF] rounded-2xl p-5"
              data-testid={`faq-row-${r.id}`}
            >
              <div className="flex gap-3 items-start">
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => move(idx, -1)}
                    disabled={idx === 0}
                    className="text-[#6D6A65] hover:text-[#2D4A3E] disabled:opacity-30"
                    data-testid={`faq-up-${r.id}`}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(idx, 1)}
                    disabled={idx === rows.length - 1}
                    className="text-[#6D6A65] hover:text-[#2D4A3E] disabled:opacity-30"
                    data-testid={`faq-down-${r.id}`}
                  >
                    <ArrowDown size={14} />
                  </button>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="font-medium text-[#2B2A29]">
                      {r.question}
                    </div>
                    {r.published === false && (
                      <span className="text-xs bg-[#E8E5DF] text-[#6D6A65] rounded-full px-2 py-0.5">
                        Draft
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-[#6D6A65] mt-2 whitespace-pre-wrap leading-relaxed">
                    {r.answer}
                  </div>
                  <div className="mt-3 flex gap-3">
                    <button
                      type="button"
                      onClick={() => startEdit(r)}
                      className="text-[#2D4A3E] hover:underline text-xs inline-flex items-center gap-1"
                      data-testid={`faq-edit-${r.id}`}
                    >
                      <Pencil size={12} /> Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(r)}
                      className="text-[#D45D5D] hover:underline text-xs inline-flex items-center gap-1"
                      data-testid={`faq-delete-${r.id}`}
                    >
                      <Trash2 size={12} /> Delete
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
