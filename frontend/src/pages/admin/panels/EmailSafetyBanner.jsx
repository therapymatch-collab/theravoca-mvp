import { useEffect, useState } from "react";

// Visible reminder of the pre-launch email safety mode. Critical for
// admin confidence -- without it, the outreach drawer shows real
// therapist email addresses and looks like real emails went out, when
// in fact they all landed in the EMAIL_OVERRIDE_TO test inbox.
//
// Polls /admin/email-safety-status once per mount.
export default function EmailSafetyBanner({ client }) {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    if (!client) return;
    let alive = true;
    (async () => {
      try {
        const r = await client.get("/admin/email-safety-status");
        if (alive) setStatus(r.data || null);
      } catch {
        // Silent failure -- worst case the banner just doesn't render.
      }
    })();
    return () => { alive = false; };
  }, [client]);

  if (!status) return null;

  if (status.mode === "live") {
    return (
      <div className="mb-3 rounded-lg border border-[#F4C7BE] bg-[#FDF1EF] px-3 py-2 text-xs text-[#8B3220]">
        <strong>LIVE MODE.</strong> Emails go to real recipients.{" "}
        <code className="text-[10px] bg-white/60 px-1 rounded">EMAIL_LIVE_MODE=true</code>
      </div>
    );
  }

  if (status.mode === "test_override") {
    return (
      <div
        className="mb-3 rounded-lg border border-[#E8DCC1] bg-[#FDF7EC] px-3 py-2 text-xs text-[#8B5A1F]"
        data-testid="email-safety-banner-test"
      >
        <strong>TEST MODE.</strong> Every outbound email is redirected to{" "}
        <code className="text-[10px] bg-white/60 px-1 rounded">{status.override_to}</code>
        {" "}(your inbox), regardless of the recipient address shown below.
        Original recipient is preserved in the email subject as{" "}
        <code className="text-[10px] bg-white/60 px-1 rounded">[was: ...]</code>.
        <strong className="ml-1">No real therapist receives anything.</strong>
      </div>
    );
  }

  // mode === "blocked"
  return (
    <div className="mb-3 rounded-lg border border-[#F4C7BE] bg-[#FDF1EF] px-3 py-2 text-xs text-[#8B3220]">
      <strong>BLOCKED.</strong> Neither EMAIL_OVERRIDE_TO nor EMAIL_LIVE_MODE
      is set on Render -- the safety guard will silently drop any send to a
      non-placeholder address. Set one of them to unblock.
    </div>
  );
}
