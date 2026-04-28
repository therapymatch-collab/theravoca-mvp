/**
 * FeedbackWidget — floating "Feedback" button on every page.
 *
 * Design goals:
 *   • Non-intrusive: small corner button, never blocks content.
 *   • Three fields only: name (optional) + email (optional) + message.
 *   • Quiet fail-modes: if the POST fails, toast the user and keep the
 *     draft so they don't lose their message on a blip.
 *   • Submissions land in `/api/feedback/widget`, which persists to
 *     `feedback` collection AND emails theravoca@gmail.com.
 */
import { useState } from "react";
import { MessageSquarePlus, X, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";

export default function FeedbackWidget({ role = "anonymous" }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const submit = async (e) => {
    e?.preventDefault?.();
    if (message.trim().length < 5) {
      toast.error("Please share a bit more detail.");
      return;
    }
    setSending(true);
    try {
      await api.post("/feedback/widget", {
        name: name.trim() || undefined,
        email: email.trim() || undefined,
        message: message.trim(),
        role,
        source_url: window.location.pathname + window.location.search,
      });
      toast.success("Thanks! We got your feedback.");
      setMessage("");
      setName("");
      setEmail("");
      setOpen(false);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Couldn't send feedback. Try again?");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 bg-[#2D4A3E] text-white rounded-full shadow-lg hover:shadow-xl hover:bg-[#3A5E50] transition-all flex items-center gap-2 px-4 py-2.5 text-sm font-medium"
        data-testid="feedback-widget-open"
        aria-label="Send feedback"
      >
        <MessageSquarePlus size={16} />
        Feedback
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/30 flex items-end sm:items-center justify-center p-4"
          onClick={() => !sending && setOpen(false)}
          data-testid="feedback-widget-overlay"
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={submit}
            className="bg-white rounded-2xl border border-[#E8E5DF] shadow-xl w-full max-w-md p-6 space-y-4"
            data-testid="feedback-widget-modal"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-serif-display text-2xl text-[#2D4A3E]">
                Send us feedback
              </h3>
              <button
                type="button"
                onClick={() => !sending && setOpen(false)}
                className="text-[#6D6A65] hover:text-[#2B2A29]"
                data-testid="feedback-widget-close"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-[#6D6A65] text-pretty">
              Bugs, wishes, praise — anything. Name and email are optional, but
              leaving your email helps us follow up if we need to.
            </p>
            <div>
              <label className="text-xs text-[#6D6A65] uppercase tracking-wider">
                Name (optional)
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full border border-[#E8E5DF] rounded-lg px-3 py-2 text-sm focus:border-[#2D4A3E] focus:outline-none"
                data-testid="feedback-name"
                placeholder="Jane Doe"
              />
            </div>
            <div>
              <label className="text-xs text-[#6D6A65] uppercase tracking-wider">
                Email (optional)
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full border border-[#E8E5DF] rounded-lg px-3 py-2 text-sm focus:border-[#2D4A3E] focus:outline-none"
                data-testid="feedback-email"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="text-xs text-[#6D6A65] uppercase tracking-wider">
                Your message
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={5}
                maxLength={2000}
                className="mt-1 w-full border border-[#E8E5DF] rounded-lg px-3 py-2 text-sm focus:border-[#2D4A3E] focus:outline-none resize-none"
                placeholder="What would make TheraVoca work better for you?"
                data-testid="feedback-message"
                required
              />
              <div className="text-xs text-[#6D6A65] mt-1">
                {message.length}/2000
              </div>
            </div>
            <button
              type="submit"
              disabled={sending || message.trim().length < 5}
              className="w-full inline-flex items-center justify-center gap-2 bg-[#2D4A3E] text-white rounded-full py-2.5 text-sm font-medium hover:bg-[#3A5E50] disabled:opacity-60 disabled:cursor-not-allowed"
              data-testid="feedback-submit"
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {sending ? "Sending…" : "Send feedback"}
            </button>
          </form>
        </div>
      )}
    </>
  );
}
