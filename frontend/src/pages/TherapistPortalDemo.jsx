/**
 * Disposable demo: 3 distinct layouts for the therapist portal so the
 * user can pick one. Wired at /demo/therapist-portal. Uses mock data;
 * no API calls. Once a layout is picked we'll port it onto the real
 * page and delete this file.
 */
import {
  Settings,
  LogOut,
  CheckCircle2,
  Sparkles,
  ChevronRight,
  Inbox,
  Star,
  Clock,
  Filter,
  TrendingUp,
  Calendar,
  AlertCircle,
} from "lucide-react";

const MOCK_THERAPIST = {
  name: "Ann Omodt",
  email: "ann@example.com",
  trial_ends_at: "May 24, 2026",
  health_alerts: 2,
  completeness: 78,
};

const MOCK_REFERRALS = [
  { id: 1, score: 92, status: "new",      issue: "Anxiety, work stress", age: "Adult", state: "ID", format: "Telehealth", payment: "BCBS", when: "2h ago" },
  { id: 2, score: 88, status: "new",      issue: "PTSD",                 age: "Adult", state: "ID", format: "In-person",  payment: "Cash $150", when: "4h ago" },
  { id: 3, score: 81, status: "pending",  issue: "Couples / communication", age: "Couple", state: "ID", format: "Telehealth", payment: "Aetna", when: "Yesterday" },
  { id: 4, score: 76, status: "applied",  issue: "Grief, recent loss",    age: "Adult", state: "ID", format: "Hybrid",     payment: "Cash $120", when: "2d ago" },
];

const MOCK_STATS = {
  invited: 24,
  applied: 11,
  apply_rate: 46,
  avg_match: 81,
  unread: 2,
};

export default function TherapistPortalDemo() {
  return (
    <div className="min-h-screen bg-[#FDFBF7] py-10 px-4">
      <div className="max-w-7xl mx-auto">
        <h1 className="font-serif-display text-4xl text-[#2D4A3E] text-center mb-2">
          Therapist Portal — 3 layout options
        </h1>
        <p className="text-center text-[#6D6A65] mb-10 max-w-2xl mx-auto">
          Same data, three layouts. Pick A, B, or C — we'll wire it onto
          the real page and delete this demo.
        </p>
        <div className="grid xl:grid-cols-3 gap-6">
          <Mock title="Option A — Command-center sidebar" subtitle="Sticky left rail · main content right · desktop-first" testid="demo-portal-a">
            <CommandCenter />
          </Mock>
          <Mock title="Option B — Inbox style" subtitle="Filter chips · clean list · scannable like Gmail" testid="demo-portal-b">
            <InboxStyle />
          </Mock>
          <Mock title="Option C — KPI chips + cards" subtitle="Stats strip · big match cards · mobile-friendly" testid="demo-portal-c">
            <KpiCards />
          </Mock>
        </div>

        <div className="mt-12 max-w-3xl mx-auto bg-white border border-[#E8E5DF] rounded-2xl p-6">
          <h3 className="font-serif-display text-xl text-[#2D4A3E] mb-3">Trade-offs</h3>
          <ul className="text-sm text-[#2B2A29] space-y-3">
            <li><strong>A — Command center</strong>: tightest information density. The therapist sees referrals + their context (subscription, profile health, stats) without scrolling. Looks like Linear/Notion. Best on desktop. Slightly cramped on mobile (sidebar collapses to top strip).</li>
            <li><strong>B — Inbox</strong>: most familiar pattern — therapists already live in their email. Status chips (New / Pending / Applied / Declined) double as filters. Each row mimics an email row (sender = patient demographic, subject = presenting issue, preview = key fit notes). Risk: feels less brand-distinct.</li>
            <li><strong>C — KPI chips</strong>: most "growth dashboard" — leads with metrics that matter (Apply rate · Avg match · Days remaining in trial · Profile health). Match cards are bigger and show more context per card. Best for therapists who care about the numbers; worst for therapists who just want to triage referrals fast.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function Mock({ title, subtitle, children, testid }) {
  return (
    <div
      className="bg-white border border-[#E8E5DF] rounded-2xl p-4 shadow-sm flex flex-col"
      data-testid={testid}
    >
      <h2 className="font-serif-display text-xl text-[#2D4A3E]">{title}</h2>
      <p className="text-xs text-[#6D6A65] mb-4">{subtitle}</p>
      <div className="flex-1 bg-[#FDFBF7] rounded-xl p-3 overflow-hidden border border-[#E8E5DF]">
        {children}
      </div>
    </div>
  );
}

// ─── A · Command-center sidebar ──────────────────────────────────────
function CommandCenter() {
  return (
    <div className="grid grid-cols-3 gap-3 text-[12px]">
      {/* Sticky left rail */}
      <aside className="col-span-1 space-y-2.5">
        <div className="bg-white rounded-lg p-2.5 border border-[#E8E5DF]">
          <div className="font-serif-display text-sm text-[#2D4A3E]">Ann Omodt</div>
          <div className="text-[10px] text-[#6D6A65] mt-0.5">LPC · Boise, ID</div>
          <button className="text-[10px] text-[#2D4A3E] hover:underline mt-2 inline-flex items-center gap-1">
            <Settings size={9} /> Edit profile
          </button>
        </div>
        <div className="bg-[#F2F7F1] border border-[#D2E2D0] rounded-lg p-2.5">
          <div className="flex items-center gap-1.5 text-[10px] text-[#3F6F4A] font-medium">
            <CheckCircle2 size={10} /> Trial active
          </div>
          <div className="text-[9px] text-[#6D6A65] mt-1">Ends May 24</div>
        </div>
        <div className="bg-white rounded-lg p-2.5 border border-[#E8E5DF]">
          <div className="text-[9px] uppercase tracking-wider text-[#6D6A65] mb-1.5">Stats</div>
          <Mini label="Apply rate" value="46%" />
          <Mini label="Avg match" value="81%" />
          <Mini label="Total received" value="24" />
        </div>
        <div className="bg-[#FDF7EC] border border-[#E8DCC1] rounded-lg p-2.5">
          <div className="flex items-center gap-1 text-[10px] text-[#9A6E1A] font-medium">
            <AlertCircle size={10} /> Profile 78%
          </div>
          <div className="text-[9px] text-[#6D6A65] mt-1">Add headshot to boost</div>
        </div>
        <button className="w-full bg-white border border-[#E8E5DF] rounded-lg p-2 text-[10px] text-[#2D4A3E] hover:bg-[#FDFBF7]">
          Refer a colleague →
        </button>
      </aside>
      {/* Main */}
      <main className="col-span-2 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-serif-display text-base text-[#2D4A3E]">Your referrals</h2>
          <span className="text-[9px] text-[#C87965] font-semibold">2 NEW</span>
        </div>
        {MOCK_REFERRALS.map((r) => (
          <div key={r.id} className="bg-white border border-[#E8E5DF] rounded-lg p-2.5 hover:border-[#2D4A3E] transition cursor-pointer">
            <div className="flex items-center justify-between gap-2">
              <span className="bg-[#2D4A3E] text-white text-[9px] font-semibold px-1.5 py-0.5 rounded">★ {r.score}%</span>
              <span className="text-[9px] text-[#6D6A65]">{r.when}</span>
            </div>
            <div className="text-xs font-medium text-[#2B2A29] mt-1.5">{r.issue}</div>
            <div className="text-[9px] text-[#6D6A65] mt-0.5">{r.age} · {r.format} · {r.payment}</div>
          </div>
        ))}
      </main>
    </div>
  );
}

// ─── B · Inbox style ─────────────────────────────────────────────────
function InboxStyle() {
  return (
    <div className="text-[12px]">
      {/* Header strip */}
      <div className="flex items-center justify-between mb-2.5">
        <div>
          <h2 className="font-serif-display text-base text-[#2D4A3E]">Ann's referrals</h2>
          <div className="text-[10px] text-[#6D6A65]">24 total · 2 new</div>
        </div>
        <span className="bg-[#F2F7F1] border border-[#D2E2D0] text-[9px] text-[#3F6F4A] px-1.5 py-0.5 rounded-full inline-flex items-center gap-1">
          <CheckCircle2 size={8} /> Trial
        </span>
      </div>
      {/* Filter chips */}
      <div className="flex gap-1.5 mb-2 overflow-x-auto pb-1">
        <Chip active label="All" count={24} />
        <Chip label="New" count={2} hue="orange" />
        <Chip label="Pending" count={1} />
        <Chip label="Applied" count={11} />
        <Chip label="Declined" count={10} />
      </div>
      {/* Inbox list */}
      <div className="bg-white rounded-lg border border-[#E8E5DF] divide-y divide-[#E8E5DF]">
        {MOCK_REFERRALS.map((r) => {
          const unread = r.status === "new";
          return (
            <div
              key={r.id}
              className={`flex items-center gap-2 p-2 hover:bg-[#FDFBF7] cursor-pointer ${unread ? "font-semibold" : ""}`}
            >
              <div className="w-1 h-8 rounded bg-[#C87965]" style={{ opacity: unread ? 1 : 0 }} />
              <div className="bg-[#2D4A3E] text-white text-[8px] px-1 py-0.5 rounded-sm tabular-nums shrink-0">{r.score}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-[#2B2A29] truncate">{r.age} · {r.state}</span>
                  <span className="text-[9px] text-[#6D6A65] shrink-0">{r.when}</span>
                </div>
                <div className="text-[10px] text-[#6D6A65] truncate">{r.issue} — {r.format} · {r.payment}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 pt-2 border-t border-[#E8E5DF] flex items-center justify-between text-[9px] text-[#6D6A65]">
        <span>Profile 78% complete</span>
        <button className="text-[#2D4A3E] hover:underline">Refer a colleague</button>
      </div>
    </div>
  );
}

// ─── C · KPI chips + big cards ───────────────────────────────────────
function KpiCards() {
  return (
    <div className="text-[12px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-2.5">
        <div>
          <div className="text-[9px] uppercase tracking-wider text-[#C87965]">Therapist portal</div>
          <h2 className="font-serif-display text-base text-[#2D4A3E]">Ann Omodt</h2>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-[#3F6F4A] inline-flex items-center gap-1 bg-[#F2F7F1] border border-[#D2E2D0] px-1.5 py-0.5 rounded-full">
            <CheckCircle2 size={8} /> Trial
          </span>
          <Settings size={10} className="text-[#6D6A65]" />
          <LogOut size={10} className="text-[#6D6A65]" />
        </div>
      </div>
      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-1.5 mb-2.5">
        <Kpi icon={<Star size={9} />} label="Match avg" value="81%" />
        <Kpi icon={<TrendingUp size={9} />} label="Apply rate" value="46%" />
        <Kpi icon={<Inbox size={9} />} label="New" value="2" hue="#C87965" />
        <Kpi icon={<Calendar size={9} />} label="Trial" value="26d" />
      </div>
      {/* Big match cards */}
      <div className="space-y-2">
        {MOCK_REFERRALS.slice(0, 3).map((r) => (
          <div key={r.id} className="bg-white rounded-lg border border-[#E8E5DF] p-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="bg-[#2D4A3E] text-white text-[9px] font-semibold px-1.5 py-0.5 rounded">★ {r.score}% match</span>
                  {r.status === "new" && <span className="text-[8px] text-[#C87965] font-bold">NEW</span>}
                  <span className="text-[9px] text-[#6D6A65] ml-auto">{r.when}</span>
                </div>
                <div className="text-xs font-medium text-[#2B2A29] truncate">{r.issue}</div>
                <div className="flex flex-wrap gap-1 mt-1.5">
                  <Tag>{r.age}</Tag>
                  <Tag>{r.format}</Tag>
                  <Tag>{r.payment}</Tag>
                </div>
              </div>
              <ChevronRight size={12} className="text-[#6D6A65] mt-1 shrink-0" />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 pt-2 border-t border-[#E8E5DF] flex items-center justify-between gap-2 text-[9px]">
        <span className="inline-flex items-center gap-1 text-[#9A6E1A] bg-[#FDF7EC] border border-[#E8DCC1] px-1.5 py-0.5 rounded">
          <AlertCircle size={9} /> Profile 78%
        </span>
        <button className="text-[#2D4A3E] hover:underline">Refer a colleague →</button>
      </div>
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────
function Mini({ label, value }) {
  return (
    <div className="flex items-center justify-between text-[10px] py-0.5">
      <span className="text-[#6D6A65]">{label}</span>
      <span className="font-semibold text-[#2D4A3E] tabular-nums">{value}</span>
    </div>
  );
}
function Chip({ label, count, active, hue }) {
  const cls = active
    ? "bg-[#2D4A3E] text-white border-[#2D4A3E]"
    : hue === "orange"
    ? "bg-[#FBF3E8] text-[#C87965] border-[#E8DCC1]"
    : "bg-white text-[#2B2A29] border-[#E8E5DF]";
  return (
    <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full border ${cls}`}>
      {label} <span className="opacity-70">{count}</span>
    </span>
  );
}
function Kpi({ icon, label, value, hue }) {
  return (
    <div className="bg-white border border-[#E8E5DF] rounded-lg px-2 py-1.5">
      <div className="flex items-center gap-1 text-[8px] text-[#6D6A65] uppercase tracking-wider">
        {icon} {label}
      </div>
      <div className="font-serif-display text-sm tabular-nums" style={{ color: hue || "#2D4A3E" }}>
        {value}
      </div>
    </div>
  );
}
function Tag({ children }) {
  return (
    <span className="text-[9px] bg-[#FDFBF7] border border-[#E8E5DF] text-[#2B2A29] px-1.5 py-0.5 rounded-full">
      {children}
    </span>
  );
}
