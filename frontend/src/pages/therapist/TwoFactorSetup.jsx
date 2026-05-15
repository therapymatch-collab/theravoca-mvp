import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft, ArrowRight, ShieldCheck, ShieldOff, Loader2,
  Copy, Download, CheckCircle2, AlertTriangle,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Header, Footer } from "@/components/SiteShell";
import DeleteAccountPanel from "@/components/DeleteAccountPanel";
import PauseAccountPanel from "@/components/PauseAccountPanel";
import DataExportPanel from "@/components/DataExportPanel";
import { sessionClient, getSession } from "@/lib/api";

/**
 * Therapist 2FA (TOTP) management page.
 *
 * Route: /portal/therapist/security
 *
 * States it can be in:
 *   - off     -- show intro + "Set up 2FA" button
 *   - enroll1 -- intro / authenticator app picker
 *   - enroll2 -- QR code + secret + 6-digit verify input
 *   - enroll3 -- 10 recovery codes shown once
 *   - on      -- manage / disable / regenerate-recovery
 *
 * Powered by the 5 endpoints under /portal/therapist/2fa/ shipped in
 * the backend commit just before this.
 */
export default function TwoFactorSetup() {
  const navigate = useNavigate();
  const session = getSession();
  const [status, setStatus] = useState(null);
  const [view, setView] = useState("off");
  // Pause/resume state lives on the therapist profile doc; fetched
  // alongside the 2fa status so the Pause panel renders the right
  // CTA without a second loading flash.
  const [pausedAt, setPausedAt] = useState(null);
  // Recovery codes are shown once after a successful enroll. Local to
  // this page; cleared on Finish so we never re-render them.
  const [recoveryCodes, setRecoveryCodes] = useState([]);

  useEffect(() => {
    if (!session || session.role !== "therapist") {
      navigate("/sign-in?role=therapist", { replace: true });
      return;
    }
    refreshStatus();
    refreshPauseState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshStatus = async () => {
    try {
      const res = await sessionClient().get("/portal/therapist/2fa/status");
      setStatus(res.data);
      setView(res.data?.enabled ? "on" : "off");
    } catch {
      setStatus({ enabled: false });
      setView("off");
    }
  };

  const refreshPauseState = async () => {
    try {
      const res = await sessionClient().get("/portal/therapist/profile");
      setPausedAt(res.data?.paused_at || null);
    } catch {
      setPausedAt(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <Header />
      <main className="flex-1 px-5 py-12 md:py-16">
        <div className="max-w-2xl mx-auto" data-testid="therapist-2fa-page">
          <Link
            to="/portal/therapist"
            className="inline-flex items-center gap-1.5 text-sm text-[#6D6A65] hover:text-[#2D4A3E]"
          >
            <ArrowLeft size={14} /> My referrals
          </Link>
          <h1 className="font-serif-display text-3xl sm:text-4xl text-[#2D4A3E] mt-3">
            Two-factor authentication
          </h1>
          <p className="text-[#6D6A65] mt-2 leading-relaxed">
            Adds a 6-digit code from an authenticator app on every sign-in.
            Recommended for therapist accounts that see patient referrals.
            Optional &mdash; you can turn it on or off any time.
          </p>

          {status === null && (
            <div className="mt-8 bg-white border border-[#E8E5DF] rounded-xl p-10 text-center text-[#6D6A65]">
              <Loader2 className="animate-spin inline mr-2" /> Loading...
            </div>
          )}

          {status && view === "off" && (
            <OffPanel onStart={() => setView("enroll1")} />
          )}
          {status && view === "enroll1" && (
            <Enroll1 onCancel={() => setView("off")} onContinue={() => setView("enroll2")} />
          )}
          {status && view === "enroll2" && (
            <Enroll2
              onCancel={() => setView("off")}
              onVerified={(codes) => {
                setRecoveryCodes(codes);
                setView("enroll3");
              }}
            />
          )}
          {status && view === "enroll3" && (
            <Enroll3
              codes={recoveryCodes}
              onFinish={async () => {
                setRecoveryCodes([]);
                await refreshStatus();
              }}
            />
          )}
          {status && view === "on" && (
            <OnPanel
              status={status}
              onRegenerated={refreshStatus}
              onDisabled={async () => {
                await refreshStatus();
              }}
            />
          )}

          {/* Account-lifecycle stack, least to most destructive:
              Pause (reversible) -> Export (read-only) -> Delete
              (terminal). Order reflects how users should think
              about leaving: try pausing first, take your data,
              then delete only if you're sure. */}
          <PauseAccountPanel
            role="therapist"
            pausedAt={pausedAt}
            onChange={refreshPauseState}
          />
          <DataExportPanel role="therapist" />

          {/* Danger zone -- account deletion. Lives at the bottom of
              the security page so it's discoverable without dominating
              the page. Borders/colors are red-500-ish to clearly mark
              the destructive action. */}
          <DeleteAccountPanel sessionEmail={session?.email || ""} role="therapist" />
        </div>
      </main>
      <Footer />
    </div>
  );
}

// ─── Sub-views ────────────────────────────────────────────────────────────

function OffPanel({ onStart }) {
  return (
    <div className="mt-8 bg-white border border-[#E8E5DF] rounded-2xl p-7" data-testid="2fa-off-panel">
      <div className="flex items-start gap-3">
        <ShieldOff className="text-[#6D6A65] flex-shrink-0 mt-1" size={22} />
        <div>
          <div className="font-medium text-[#2B2A29]">Two-factor authentication is OFF</div>
          <p className="text-sm text-[#6D6A65] mt-1 leading-relaxed">
            Right now, anyone with access to your email could sign in to your
            therapist portal and see your incoming patient referrals.
            Turning on 2FA adds a 6-digit code from an authenticator app to
            every sign-in, so an attacker would need both your email AND
            your phone.
          </p>
        </div>
      </div>
      <button
        onClick={onStart}
        className="mt-5 tv-btn-primary"
        data-testid="2fa-start-btn"
      >
        Set up 2FA <ArrowRight size={16} />
      </button>
    </div>
  );
}

function Enroll1({ onCancel, onContinue }) {
  return (
    <div className="mt-8 bg-white border border-[#E8E5DF] rounded-2xl p-7" data-testid="2fa-enroll1">
      <StepTag step="1 of 3" />
      <h2 className="font-serif-display text-2xl text-[#2D4A3E] mt-2">
        Set up two-factor authentication
      </h2>
      <p className="text-sm text-[#2B2A29] mt-3 leading-relaxed">
        You'll need a free authenticator app on your phone. We recommend{" "}
        <strong>Google Authenticator</strong>, <strong>1Password</strong>,{" "}
        <strong>Authy</strong>, or <strong>Microsoft Authenticator</strong>.
        Any TOTP-compatible app works.
      </p>
      <p className="text-sm text-[#6D6A65] mt-4 leading-relaxed">
        After you turn this on, every sign-in to your therapist portal will
        ask for a 6-digit code from the app.
      </p>
      <div className="mt-6 flex gap-3 flex-wrap">
        <button onClick={onContinue} className="tv-btn-primary" data-testid="2fa-continue-btn">
          Continue <ArrowRight size={16} />
        </button>
        <button onClick={onCancel} className="tv-btn-secondary">
          Cancel
        </button>
      </div>
    </div>
  );
}

function Enroll2({ onCancel, onVerified }) {
  const [secret, setSecret] = useState("");
  const [uri, setUri] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    setLoading(true);
    sessionClient()
      .post("/portal/therapist/2fa/enroll/start")
      .then((res) => {
        setSecret(res.data?.secret || "");
        setUri(res.data?.otpauth_uri || "");
      })
      .catch((e) => {
        toast.error(e?.response?.data?.detail || "Couldn't start enrollment.");
        onCancel();
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e) => {
    e?.preventDefault();
    if (code.length !== 6) return;
    setVerifying(true);
    try {
      const res = await sessionClient().post(
        "/portal/therapist/2fa/enroll/verify",
        { secret, code },
      );
      onVerified(res.data?.recovery_codes || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Verification failed.");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="mt-8 bg-white border border-[#E8E5DF] rounded-2xl p-7" data-testid="2fa-enroll2">
      <StepTag step="2 of 3" />
      <h2 className="font-serif-display text-2xl text-[#2D4A3E] mt-2">
        Scan the code with your app
      </h2>
      <p className="text-sm text-[#2B2A29] mt-3 leading-relaxed">
        Open your authenticator app and add a new account by scanning this
        QR code. If you can't scan, paste the secret below instead.
      </p>

      {loading ? (
        <div className="my-8 text-center text-sm text-[#6D6A65]">
          <Loader2 className="animate-spin inline mr-2" /> Generating your code...
        </div>
      ) : (
        <>
          <div className="my-6 flex justify-center">
            <div className="bg-white p-3 rounded-lg border border-[#E8E5DF]">
              {uri ? <QRCodeSVG value={uri} size={196} level="M" /> : null}
            </div>
          </div>
          <div className="text-center text-xs text-[#6D6A65]">
            Can't scan? Enter this secret manually:
          </div>
          <div className="mt-2 text-center">
            <button
              onClick={() => {
                navigator.clipboard.writeText(secret);
                toast.success("Secret copied to clipboard");
              }}
              className="inline-flex items-center gap-2 bg-[#F2EFE8] border border-[#E8E5DF] rounded-md px-3 py-2 text-sm font-mono text-[#2D4A3E] tracking-[0.1em] hover:bg-[#E8E5DF]"
              data-testid="2fa-copy-secret"
            >
              {secret} <Copy size={13} />
            </button>
          </div>

          <form onSubmit={submit} className="mt-8 text-center">
            <p className="text-sm text-[#2B2A29] mb-3">
              Then enter the 6-digit code your app shows:
            </p>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              data-testid="2fa-verify-code-input"
              className="inline-block w-48 text-center font-serif-display text-3xl tracking-[0.4em] border border-[#E8E5DF] rounded-lg px-3 py-3 focus:outline-none focus:border-[#2D4A3E]"
              placeholder="000000"
              autoFocus
            />
            <div className="mt-5">
              <button
                type="submit"
                disabled={code.length !== 6 || verifying}
                className="tv-btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="2fa-verify-btn"
              >
                {verifying ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                {verifying ? "Verifying..." : "Verify and continue"}
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="tv-btn-secondary ml-2"
              >
                Cancel
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}

function Enroll3({ codes, onFinish }) {
  const [acknowledged, setAcknowledged] = useState(false);
  const downloadCodes = () => {
    const blob = new Blob(
      [`TheraVoca recovery codes -- ${new Date().toISOString().slice(0, 10)}\n\n` +
       "Each code can be used ONCE to sign in if you lose your authenticator.\n" +
       "Store these somewhere safe (password manager, paper backup in your office).\n\n" +
       codes.join("\n") + "\n"],
      { type: "text/plain;charset=utf-8" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "theravoca-recovery-codes.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="mt-8 bg-white border border-[#E8E5DF] rounded-2xl p-7" data-testid="2fa-enroll3">
      <StepTag step="3 of 3" />
      <h2 className="font-serif-display text-2xl text-[#2D4A3E] mt-2">
        Save your recovery codes
      </h2>
      <p className="text-sm text-[#2B2A29] mt-3 leading-relaxed">
        If you lose your phone, you can use one of these codes{" "}
        <strong>once</strong> to get back in. We'll only show them this one
        time. Save them somewhere safe: a password manager, a paper backup
        in your office, anywhere you'll find them again.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-y-2 gap-x-8 bg-[#FDFBF7] border border-[#E8E5DF] rounded-lg p-5 font-mono text-sm text-[#2B2A29]"
           data-testid="2fa-recovery-codes">
        {codes.map((c, i) => (
          <span key={i} className="tracking-[0.1em]">{c}</span>
        ))}
      </div>

      <div className="mt-4 flex gap-2 flex-wrap">
        <button onClick={downloadCodes} className="tv-btn-secondary inline-flex items-center gap-2">
          <Download size={14} /> Download as .txt
        </button>
        <button
          onClick={() => {
            navigator.clipboard.writeText(codes.join("\n"));
            toast.success("All 10 codes copied");
          }}
          className="tv-btn-secondary inline-flex items-center gap-2"
        >
          <Copy size={14} /> Copy all
        </button>
      </div>

      <div className="mt-5 bg-[#FDF1EF] border border-[#E8C4BB] rounded-lg p-4 text-sm text-[#5C2620] leading-relaxed">
        <div className="flex items-start gap-2">
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5 text-[#8B3220]" />
          <div>
            <strong className="text-[#8B3220]">Important:</strong> Without
            your phone OR one of these codes, you'll need to email{" "}
            <a href="mailto:support@theravoca.com" className="font-semibold text-[#8B3220]">
              support@theravoca.com
            </a>{" "}
            to recover your account. Recovery requires us to manually
            verify your identity. It can take 24-48 hours.
          </div>
        </div>
      </div>

      <label className="mt-5 flex items-center gap-2 text-sm text-[#2B2A29] cursor-pointer">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          className="accent-[#2D4A3E] w-4 h-4"
          data-testid="2fa-ack-saved"
        />
        I've saved these codes somewhere safe.
      </label>

      <button
        onClick={onFinish}
        disabled={!acknowledged}
        className="mt-5 tv-btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
        data-testid="2fa-finish-btn"
      >
        Finish setup
      </button>
    </div>
  );
}

function OnPanel({ status, onRegenerated, onDisabled }) {
  const [busy, setBusy] = useState(false);
  const [showDisableForm, setShowDisableForm] = useState(false);
  const [showRegen, setShowRegen] = useState(false);
  const [code, setCode] = useState("");
  const [regenCodes, setRegenCodes] = useState([]);

  const handleRegenerate = async () => {
    if (code.length !== 6) return;
    setBusy(true);
    try {
      const res = await sessionClient().post(
        "/portal/therapist/2fa/regenerate-recovery", { code },
      );
      setRegenCodes(res.data?.recovery_codes || []);
      setCode("");
      onRegenerated();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't regenerate codes.");
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async () => {
    if (code.length !== 6) return;
    setBusy(true);
    try {
      await sessionClient().post("/portal/therapist/2fa/disable", { code });
      toast.success("Two-factor authentication turned off.");
      setShowDisableForm(false);
      setCode("");
      onDisabled();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't disable 2FA.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-8 space-y-4" data-testid="2fa-on-panel">
      <div className="bg-white border border-[#E8E5DF] rounded-2xl p-7">
        <div className="flex items-start gap-3">
          <ShieldCheck className="text-[#2D4A3E] flex-shrink-0 mt-1" size={22} />
          <div className="flex-1">
            <div className="font-medium text-[#2D4A3E]">Two-factor authentication is ON</div>
            <p className="text-sm text-[#6D6A65] mt-1">
              Enabled {formatDate(status.enabled_at)} &middot;{" "}
              <strong className="text-[#2D4A3E]">{status.recovery_codes_remaining}</strong>{" "}
              of 10 recovery codes remaining
            </p>
          </div>
        </div>

        <div className="mt-5 flex gap-2 flex-wrap">
          <button
            onClick={() => { setShowRegen((x) => !x); setShowDisableForm(false); setCode(""); }}
            className="tv-btn-secondary"
            data-testid="2fa-show-regen"
          >
            Regenerate recovery codes
          </button>
          <button
            onClick={() => { setShowDisableForm((x) => !x); setShowRegen(false); setCode(""); }}
            className="tv-btn-secondary"
            data-testid="2fa-show-disable"
          >
            Turn off 2FA
          </button>
        </div>

        {showRegen && regenCodes.length === 0 && (
          <CodeConfirmForm
            title="Confirm with a code from your authenticator app"
            description="Generates a fresh set of 10 codes. Your old codes stop working."
            code={code}
            setCode={setCode}
            onSubmit={handleRegenerate}
            busy={busy}
            cta="Regenerate codes"
          />
        )}

        {showRegen && regenCodes.length > 0 && (
          <div className="mt-6">
            <p className="text-sm text-[#2D4A3E] font-medium">
              New recovery codes (save these now &mdash; we won't show them again):
            </p>
            <div className="mt-3 grid grid-cols-2 gap-y-2 gap-x-8 bg-[#FDFBF7] border border-[#E8E5DF] rounded-lg p-5 font-mono text-sm">
              {regenCodes.map((c, i) => <span key={i} className="tracking-[0.1em]">{c}</span>)}
            </div>
            <button
              onClick={() => {
                navigator.clipboard.writeText(regenCodes.join("\n"));
                toast.success("Codes copied");
              }}
              className="mt-3 tv-btn-secondary inline-flex items-center gap-2"
            >
              <Copy size={14} /> Copy all
            </button>
          </div>
        )}

        {showDisableForm && (
          <CodeConfirmForm
            title="Confirm with a code from your authenticator app"
            description="After 2FA is off, sign-in will only require your email + password / magic code."
            code={code}
            setCode={setCode}
            onSubmit={handleDisable}
            busy={busy}
            cta="Turn 2FA off"
            destructive
          />
        )}
      </div>
    </div>
  );
}

function CodeConfirmForm({ title, description, code, setCode, onSubmit, busy, cta, destructive = false }) {
  return (
    <form
      className="mt-5 bg-[#FDFBF7] border border-[#E8E5DF] rounded-lg p-5"
      onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
    >
      <p className="text-sm font-medium text-[#2D4A3E]">{title}</p>
      <p className="text-xs text-[#6D6A65] mt-1">{description}</p>
      <div className="mt-4 flex items-center gap-3">
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          className="w-36 text-center font-serif-display text-xl tracking-[0.3em] border border-[#E8E5DF] rounded-md px-2 py-2 focus:outline-none focus:border-[#2D4A3E]"
          placeholder="000000"
          autoFocus
        />
        <button
          type="submit"
          disabled={code.length !== 6 || busy}
          className={`${destructive ? "tv-btn-secondary !text-[#8B3220] !border-[#E8C4BB]" : "tv-btn-primary"} disabled:opacity-50 disabled:cursor-not-allowed`}
          data-testid="2fa-confirm-action"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : cta}
        </button>
      </div>
    </form>
  );
}

function StepTag({ step }) {
  return (
    <span className="inline-block text-[10px] uppercase tracking-[0.12em] font-semibold text-[#C87965] bg-[#C87965]/10 px-2.5 py-1 rounded-full">
      Step {step}
    </span>
  );
}

function formatDate(iso) {
  if (!iso) return "(unknown)";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric", month: "short", day: "numeric",
    });
  } catch {
    return iso;
  }
}

