/**
 * Demo page showcasing 3 UI options for "patient-customizable matching weights".
 * Visit /demo/weights to view all three side-by-side and pick a winner.
 * This page is throwaway — once the user picks one, we wire it into IntakeForm.
 */
import { useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { GripVertical, ArrowUp, ArrowDown } from "lucide-react";

const PRIORITY_KEYS = [
  { k: "specialty", label: "Issue / specialty fit", desc: "Therapist treats your specific concern" },
  { k: "modality", label: "Therapy approach", desc: "CBT, EMDR, IFS, etc." },
  { k: "schedule", label: "Schedule & availability", desc: "When they can see you" },
  { k: "payment", label: "Insurance / cost fit", desc: "In-network or your budget" },
  { k: "identity", label: "Identity & style", desc: "Gender, faith, LGBTQ+ affirming, etc." },
];

export default function WeightsDemo() {
  return (
    <div className="min-h-screen bg-[#FDFBF7] py-12 px-4">
      <div className="max-w-7xl mx-auto">
        <h1 className="font-serif text-4xl text-[#2D4A3E] text-center mb-2">
          Pick a UI: patient-customizable weights
        </h1>
        <p className="text-center text-[#6D6A65] mb-10">
          Three options for how patients can tell us what matters most. Pick A, B, or C.
        </p>
        <div className="grid lg:grid-cols-3 gap-6">
          <Mock title="Option A — Sliders" subtitle="Each factor 0-100. Direct & granular.">
            <SliderUI />
          </Mock>
          <Mock title="Option B — Drag-to-rank" subtitle="Order priorities top-to-bottom. Conversational.">
            <RankUI />
          </Mock>
          <Mock title="Option C — Pick what matters" subtitle="Multi-select with implicit weights. Fastest.">
            <MultiSelectUI />
          </Mock>
        </div>

        <div className="mt-12 max-w-3xl mx-auto bg-white border border-[#E8E5DF] rounded-2xl p-6">
          <h3 className="font-serif text-2xl text-[#2D4A3E] mb-3">Trade-offs</h3>
          <ul className="text-sm text-[#2B2A29] space-y-2">
            <li><strong>Option A (Sliders)</strong>: Most precise. Shows the patient how the algorithm thinks. Risk: feels like a tax form.</li>
            <li><strong>Option B (Rank)</strong>: Most intuitive ("what matters most?"). Maps cleanly to weights (1st = 5x, 2nd = 4x, ..., 5th = 1x). Best UX for non-technical users.</li>
            <li><strong>Option C (Multi-select)</strong>: Fastest — just tap what matters. Less granular but adds zero friction. Best for a 2-min intake.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function Mock({ title, subtitle, children }) {
  return (
    <div className="bg-white border border-[#E8E5DF] rounded-2xl p-6 shadow-sm">
      <h2 className="font-serif text-2xl text-[#2D4A3E] mb-1">{title}</h2>
      <p className="text-xs text-[#6D6A65] mb-5">{subtitle}</p>
      {children}
    </div>
  );
}

function SliderUI() {
  const [vals, setVals] = useState({
    specialty: 80,
    modality: 50,
    schedule: 60,
    payment: 70,
    identity: 30,
  });
  return (
    <div className="space-y-5">
      <p className="text-sm text-[#6D6A65]">
        Slide each one. Higher = more important.
      </p>
      {PRIORITY_KEYS.map((p) => (
        <div key={p.k}>
          <div className="flex items-center justify-between mb-1">
            <div>
              <div className="text-sm font-semibold text-[#2B2A29]">{p.label}</div>
              <div className="text-xs text-[#6D6A65]">{p.desc}</div>
            </div>
            <div className="text-sm font-semibold text-[#C87965] tabular-nums">
              {vals[p.k]}
            </div>
          </div>
          <Slider
            value={[vals[p.k]]}
            min={0}
            max={100}
            step={5}
            onValueChange={(v) => setVals((s) => ({ ...s, [p.k]: v[0] }))}
            className="[&_[role=slider]]:bg-[#2D4A3E]"
          />
        </div>
      ))}
    </div>
  );
}

function RankUI() {
  const [order, setOrder] = useState(PRIORITY_KEYS.map((p) => p.k));
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const arr = [...order];
    [arr[i], arr[j]] = [arr[j], arr[i]];
    setOrder(arr);
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-[#6D6A65]">
        Tap the arrows to reorder. Top = most important.
      </p>
      {order.map((k, i) => {
        const p = PRIORITY_KEYS.find((x) => x.k === k);
        return (
          <div
            key={k}
            className="flex items-center gap-3 bg-[#FDFBF7] border border-[#E8E5DF] rounded-xl px-3 py-3"
          >
            <div className="w-7 h-7 rounded-full bg-[#2D4A3E] text-white text-sm font-semibold flex items-center justify-center">
              {i + 1}
            </div>
            <GripVertical size={16} className="text-[#A4A29E]" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-[#2B2A29]">{p.label}</div>
              <div className="text-xs text-[#6D6A65] truncate">{p.desc}</div>
            </div>
            <div className="flex flex-col gap-1">
              <button
                onClick={() => move(i, -1)}
                disabled={i === 0}
                className="p-1 rounded hover:bg-[#E8E5DF] disabled:opacity-20"
              >
                <ArrowUp size={14} />
              </button>
              <button
                onClick={() => move(i, 1)}
                disabled={i === order.length - 1}
                className="p-1 rounded hover:bg-[#E8E5DF] disabled:opacity-20"
              >
                <ArrowDown size={14} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MultiSelectUI() {
  const [picks, setPicks] = useState({ specialty: true, payment: true });
  const toggle = (k) => setPicks((s) => ({ ...s, [k]: !s[k] }));
  return (
    <div className="space-y-3">
      <p className="text-sm text-[#6D6A65]">
        Tap any that <em>really</em> matter. Pick as many or few as you want.
      </p>
      <div className="space-y-2">
        {PRIORITY_KEYS.map((p) => {
          const on = !!picks[p.k];
          return (
            <button
              key={p.k}
              type="button"
              onClick={() => toggle(p.k)}
              className={`w-full text-left rounded-xl border px-4 py-3 transition flex items-center gap-3 ${
                on
                  ? "bg-[#2D4A3E] text-white border-[#2D4A3E]"
                  : "bg-[#FDFBF7] text-[#2B2A29] border-[#E8E5DF] hover:border-[#2D4A3E]"
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                  on ? "bg-white border-white" : "border-[#A4A29E]"
                }`}
              >
                {on && <div className="w-2.5 h-2.5 rounded-full bg-[#2D4A3E]" />}
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold">{p.label}</div>
                <div className={`text-xs ${on ? "text-white/80" : "text-[#6D6A65]"}`}>
                  {p.desc}
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <div className="mt-4 pt-4 border-t border-[#E8E5DF] flex items-center justify-between bg-[#FDFBF7] rounded-xl px-3 py-2.5">
        <div>
          <div className="text-sm font-semibold text-[#2B2A29]">Strict mode</div>
          <div className="text-xs text-[#6D6A65]">Only show therapists matching all picks</div>
        </div>
        <Switch />
      </div>
    </div>
  );
}
