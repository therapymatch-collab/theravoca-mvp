import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Loader2,
  Send,
  RotateCw,
  Sliders,
  ChevronRight,
  X,
} from "lucide-react";
import { Header, Footer } from "@/components/SiteShell";
import { adminClient } from "@/lib/api";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function AdminDashboard() {
  const navigate = useNavigate();
  const pwd = sessionStorage.getItem("tv_admin_pwd");
  const client = adminClient(pwd);
  const [stats, setStats] = useState(null);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([
        client.get("/admin/stats"),
        client.get("/admin/requests"),
      ]);
      setStats(s.data);
      setRequests(r.data);
    } catch (e) {
      if (e?.response?.status === 401) {
        sessionStorage.removeItem("tv_admin_pwd");
        navigate("/admin");
      }
    } finally {
      setLoading(false);
    }
  }, [client, navigate]);

  useEffect(() => {
    if (!pwd) {
      navigate("/admin");
      return;
    }
    refresh();
    const id = setInterval(refresh, 10000);
    return () => clearInterval(id);
  }, [pwd, navigate, refresh]);

  const openDetail = async (id) => {
    setOpenId(id);
    setDetail(null);
    try {
      const res = await client.get(`/admin/requests/${id}`);
      setDetail(res.data);
    } catch {
      toast.error("Failed to load detail");
    }
  };

  const triggerResults = async (id) => {
    try {
      const res = await client.post(`/admin/requests/${id}/trigger-results`);
      toast.success(`Results emailed to patient (${res.data.count} matches)`);
      refresh();
      if (openId === id) openDetail(id);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    }
  };

  const resend = async (id) => {
    try {
      const res = await client.post(`/admin/requests/${id}/resend-notifications`);
      toast.success(`Notified ${res.data.notified} therapists`);
      refresh();
      if (openId === id) openDetail(id);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    }
  };

  const updateThreshold = async (id, threshold) => {
    try {
      await client.put(`/admin/requests/${id}/threshold`, { threshold });
      toast.success(`Threshold set to ${threshold}%`);
      refresh();
      if (openId === id) openDetail(id);
    } catch (e) {
      toast.error("Failed");
    }
  };

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <Header minimal />
      <main className="flex-1 px-5 py-10 md:py-14" data-testid="admin-dashboard">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-[#C87965]">
                Admin
              </p>
              <h1 className="font-serif-display text-4xl text-[#2D4A3E] mt-1">
                Operations
              </h1>
            </div>
            <button
              className="tv-btn-secondary !py-2 !px-4 text-sm"
              onClick={refresh}
              data-testid="refresh-btn"
            >
              <RotateCw size={14} className="inline mr-1.5" /> Refresh
            </button>
          </div>

          {loading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="animate-spin text-[#2D4A3E]" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mt-8">
                <StatBox label="Requests" value={stats?.total_requests} />
                <StatBox label="Pending" value={stats?.pending} />
                <StatBox label="Open" value={stats?.open} />
                <StatBox label="Completed" value={stats?.completed} />
                <StatBox label="Therapists" value={stats?.therapists} />
                <StatBox label="Applications" value={stats?.applications} />
              </div>

              <div className="mt-10 bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden">
                <table className="w-full text-sm" data-testid="requests-table">
                  <thead className="bg-[#FDFBF7] text-[#6D6A65]">
                    <tr className="text-left">
                      <Th>Email</Th>
                      <Th>Age / State</Th>
                      <Th>Status</Th>
                      <Th>Notified</Th>
                      <Th>Apps</Th>
                      <Th>Threshold</Th>
                      <Th>Created</Th>
                      <Th></Th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.length === 0 && (
                      <tr>
                        <td colSpan={8} className="p-10 text-center text-[#6D6A65]">
                          No requests yet.
                        </td>
                      </tr>
                    )}
                    {requests.map((r) => (
                      <tr
                        key={r.id}
                        className="border-t border-[#E8E5DF] hover:bg-[#FDFBF7] cursor-pointer"
                        onClick={() => openDetail(r.id)}
                        data-testid={`request-row-${r.id}`}
                      >
                        <td className="p-4">
                          <div className="text-[#2B2A29] font-medium">{r.email}</div>
                          <div className="text-xs text-[#6D6A65]">
                            {r.id.slice(0, 8)}
                          </div>
                        </td>
                        <td className="p-4 text-[#2B2A29]">
                          {r.client_age} / {r.location_state}
                        </td>
                        <td className="p-4">
                          <StatusBadge s={r.status} verified={r.verified} />
                        </td>
                        <td className="p-4">{r.notified_count || 0}</td>
                        <td className="p-4 font-semibold text-[#2D4A3E]">
                          {r.application_count || 0}
                        </td>
                        <td className="p-4">{r.threshold}%</td>
                        <td className="p-4 text-xs text-[#6D6A65]">
                          {new Date(r.created_at).toLocaleString()}
                        </td>
                        <td className="p-4 text-[#6D6A65]">
                          <ChevronRight size={16} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </main>

      <Dialog open={!!openId} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto bg-white border-[#E8E5DF]">
          <DialogHeader>
            <DialogTitle className="font-serif-display text-2xl text-[#2D4A3E]">
              Request detail
            </DialogTitle>
          </DialogHeader>
          {!detail ? (
            <Loader2 className="animate-spin mx-auto my-8 text-[#2D4A3E]" />
          ) : (
            <div className="space-y-5">
              <div className="bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl p-4">
                <div className="text-xs uppercase tracking-wider text-[#6D6A65] mb-2">
                  Patient
                </div>
                <div className="font-mono text-sm">{detail.request.email}</div>
                <div className="text-sm mt-2 text-[#2B2A29]">
                  Age {detail.request.client_age} • {detail.request.location_state}{" "}
                  • {detail.request.session_format} •{" "}
                  {detail.request.payment_type === "cash"
                    ? `$${detail.request.budget || "?"} cash`
                    : detail.request.insurance_name || "insurance"}
                </div>
                <p className="text-sm mt-3 text-[#2B2A29] whitespace-pre-wrap">
                  {detail.request.presenting_issues}
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  className="tv-btn-primary !py-2 !px-4 text-sm"
                  onClick={() => triggerResults(detail.request.id)}
                  data-testid="trigger-results-btn"
                >
                  <Send size={14} className="inline mr-1.5" /> Email matches now
                </button>
                <button
                  className="tv-btn-secondary !py-2 !px-4 text-sm"
                  onClick={() => resend(detail.request.id)}
                  data-testid="resend-btn"
                >
                  <RotateCw size={14} className="inline mr-1.5" /> Re-run matching
                </button>
                <ThresholdControl
                  current={detail.request.threshold}
                  onChange={(t) => updateThreshold(detail.request.id, t)}
                />
              </div>

              <div>
                <h4 className="font-semibold text-[#2B2A29] mb-2">
                  Notified therapists ({detail.notified.length})
                </h4>
                <div className="space-y-1.5 max-h-60 overflow-y-auto">
                  {detail.notified.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between text-sm border border-[#E8E5DF] rounded-lg px-3 py-2"
                    >
                      <div>
                        <span className="font-medium text-[#2B2A29]">{t.name}</span>
                        <span className="text-[#6D6A65] ml-2">{t.email}</span>
                      </div>
                      <span className="font-mono text-xs bg-[#2D4A3E]/10 text-[#2D4A3E] px-2 py-0.5 rounded">
                        {Math.round(t.match_score)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-[#2B2A29] mb-2">
                  Applications ({detail.applications.length})
                </h4>
                {detail.applications.length === 0 ? (
                  <p className="text-sm text-[#6D6A65]">No therapist responses yet.</p>
                ) : (
                  <div className="space-y-3">
                    {detail.applications.map((a) => (
                      <div
                        key={a.id}
                        className="border border-[#E8E5DF] rounded-xl p-4"
                      >
                        <div className="flex items-center justify-between">
                          <div className="font-medium text-[#2B2A29]">
                            {a.therapist_name}
                          </div>
                          <span className="font-mono text-xs bg-[#2D4A3E] text-white px-2 py-0.5 rounded">
                            {Math.round(a.match_score)}%
                          </span>
                        </div>
                        <p className="text-sm text-[#2B2A29] mt-2 italic">
                          "{a.message}"
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Footer />
    </div>
  );
}

function StatBox({ label, value }) {
  return (
    <div className="bg-white border border-[#E8E5DF] rounded-2xl p-4">
      <div className="text-xs uppercase tracking-wider text-[#6D6A65]">{label}</div>
      <div className="font-serif-display text-3xl text-[#2D4A3E] mt-1">
        {value ?? "—"}
      </div>
    </div>
  );
}

function Th({ children }) {
  return (
    <th className="p-4 font-medium text-xs uppercase tracking-wider">{children}</th>
  );
}

function StatusBadge({ s, verified }) {
  const map = {
    pending_verification: "bg-[#C87965]/15 text-[#C87965]",
    open: "bg-[#2D4A3E]/10 text-[#2D4A3E]",
    matched: "bg-[#2D4A3E]/10 text-[#2D4A3E]",
    completed: "bg-[#4A6B5D]/15 text-[#4A6B5D]",
  };
  return (
    <span
      className={`inline-flex text-xs px-2.5 py-1 rounded-full ${map[s] || "bg-[#E8E5DF]"}`}
    >
      {verified ? s?.replace("_", " ") : "unverified"}
    </span>
  );
}

function ThresholdControl({ current, onChange }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(current);
  return (
    <div className="relative">
      <button
        className="tv-btn-secondary !py-2 !px-4 text-sm"
        onClick={() => setOpen((o) => !o)}
        data-testid="threshold-btn"
      >
        <Sliders size={14} className="inline mr-1.5" /> Threshold ({current}%)
      </button>
      {open && (
        <div className="absolute right-0 mt-2 bg-white border border-[#E8E5DF] rounded-xl p-3 shadow-lg z-10 w-56">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[#6D6A65]">Match threshold</span>
            <button onClick={() => setOpen(false)}>
              <X size={14} className="text-[#6D6A65]" />
            </button>
          </div>
          <Input
            type="number"
            min="20"
            max="100"
            value={val}
            onChange={(e) => setVal(Number(e.target.value))}
            className="bg-[#FDFBF7] border-[#E8E5DF] rounded-lg text-sm"
            data-testid="threshold-input"
          />
          <button
            className="tv-btn-primary w-full mt-2 justify-center !py-2 text-sm"
            onClick={() => {
              onChange(val);
              setOpen(false);
            }}
            data-testid="threshold-save"
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}
