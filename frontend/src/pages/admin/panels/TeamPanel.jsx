import { useState } from "react";
import { toast } from "sonner";

export default function TeamPanel({ data, client, onReload, currentEmail }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [busy, setBusy] = useState(false);
  const rows = data?.team || [];

  const submitInvite = async (e) => {
    e.preventDefault();
    if (!email.includes("@")) {
      toast.error("Valid email required");
      return;
    }
    if (pwd.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    setBusy(true);
    try {
      await client.post("/admin/team", { email: email.trim().toLowerCase(), name: name.trim(), password: pwd });
      toast.success(`Added ${email}. Share the password with them out-of-band.`);
      setName("");
      setEmail("");
      setPwd("");
      onReload();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Invite failed");
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (member) => {
    if (!window.confirm(`Remove access for ${member.email}?`)) return;
    try {
      await client.delete(`/admin/team/${member.id}`);
      toast.success(`${member.email} deactivated`);
      onReload();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Couldn't deactivate");
    }
  };

  const resetPassword = async (member) => {
    const next = window.prompt(`New password for ${member.email} (min 8 chars):`);
    if (!next) return;
    if (next.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    try {
      await client.post(`/admin/team/${member.id}/reset-password`, { password: next });
      toast.success(`Password reset for ${member.email}. Share it with them.`);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Couldn't reset password");
    }
  };

  return (
    <div className="mt-6 space-y-6" data-testid="team-panel">
      <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5 sm:p-6">
        <h3 className="font-serif-display text-2xl text-[#2D4A3E]">Invite a teammate</h3>
        <p className="text-sm text-[#6D6A65] mt-1">
          Each team member gets their own login so you don't share a password. Share
          the initial password securely (Slack DM, 1Password share link, etc.) — they
          can change it later by asking another admin to reset it.
        </p>
        <form
          onSubmit={submitInvite}
          className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3 items-end"
          data-testid="team-invite-form"
        >
          <div>
            <label className="text-[10px] uppercase tracking-wider text-[#6D6A65]">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full px-3 py-2 bg-[#FDFBF7] border border-[#E8E5DF] rounded-lg text-sm"
              placeholder="Jane Doe"
              data-testid="team-invite-name"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-[#6D6A65]">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full px-3 py-2 bg-[#FDFBF7] border border-[#E8E5DF] rounded-lg text-sm"
              placeholder="jane@theravoca.com"
              data-testid="team-invite-email"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-[#6D6A65]">Initial password</label>
            <input
              type="text"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              className="mt-1 w-full px-3 py-2 bg-[#FDFBF7] border border-[#E8E5DF] rounded-lg text-sm font-mono"
              placeholder="min 8 chars"
              data-testid="team-invite-password"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="tv-btn-primary !py-2 !px-4 text-sm sm:col-span-3 sm:justify-self-end disabled:opacity-50"
            data-testid="team-invite-submit"
          >
            {busy ? "Adding..." : "Add team member"}
          </button>
        </form>
      </div>

      <div className="bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-[#E8E5DF] flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-serif-display text-2xl text-[#2D4A3E]">Team members</h3>
            <p className="text-sm text-[#6D6A65] mt-1">
              {rows.length} active and inactive team member{rows.length === 1 ? "" : "s"}.
            </p>
          </div>
          <button
            type="button"
            onClick={onReload}
            className="text-xs text-[#2D4A3E] hover:underline"
            data-testid="team-refresh"
          >
            Refresh
          </button>
        </div>
        {!data && (
          <div className="p-10 text-center text-[#6D6A65]">Loading team…</div>
        )}
        {data && rows.length === 0 && (
          <div className="p-10 text-center text-[#6D6A65]">
            No team members yet. Use the form above to add your first.
          </div>
        )}
        {data && rows.length > 0 && (
          <table className="w-full text-sm">
            <thead className="bg-[#FDFBF7] text-[10px] uppercase tracking-wider text-[#6D6A65]">
              <tr>
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3">Email</th>
                <th className="text-left px-4 py-3">Last login</th>
                <th className="text-center px-4 py-3">Status</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const isMe = currentEmail && m.email === currentEmail;
                return (
                  <tr
                    key={m.id}
                    className="border-t border-[#E8E5DF]"
                    data-testid={`team-row-${m.email}`}
                  >
                    <td className="px-4 py-3 text-[#2B2A29] font-medium">
                      {m.name}
                      {isMe && (
                        <span className="ml-2 text-[10px] text-[#C87965]">(you)</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[#6D6A65] break-all">{m.email}</td>
                    <td className="px-4 py-3 text-[#6D6A65] whitespace-nowrap">
                      {m.last_login_at
                        ? new Date(m.last_login_at).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {m.is_active ? (
                        <span className="inline-flex text-[11px] px-2 py-0.5 rounded-full bg-[#2D4A3E]/10 text-[#2D4A3E]">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex text-[11px] px-2 py-0.5 rounded-full bg-[#E8E5DF] text-[#6D6A65]">
                          Removed
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {m.is_active && (
                        <>
                          <button
                            type="button"
                            onClick={() => resetPassword(m)}
                            className="text-xs text-[#2D4A3E] hover:underline mr-3"
                            data-testid={`team-reset-${m.email}`}
                          >
                            Reset password
                          </button>
                          {!isMe && (
                            <button
                              type="button"
                              onClick={() => removeMember(m)}
                              className="text-xs text-[#D45D5D] hover:underline"
                              data-testid={`team-remove-${m.email}`}
                            >
                              Remove
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
