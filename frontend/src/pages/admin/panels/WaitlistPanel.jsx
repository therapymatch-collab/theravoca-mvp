import { useState, useEffect } from "react";
import { Users, MapPin, Mail, Clock, Briefcase } from "lucide-react";

/**
 * WaitlistPanel — admin view of patient + therapist waitlist signups.
 * Shows demand by state so Josh can prioritize expansion.
 */
export default function WaitlistPanel({ client }) {
  const [patientData, setPatientData] = useState(null);
  const [therapistData, setTherapistData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("patients");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [pRes, tRes] = await Promise.all([
          client.get("/admin/waitlist"),
          client.get("/admin/therapist-waitlist"),
        ]);
        setPatientData(pRes.data);
        setTherapistData(tRes.data);
      } catch (e) {
        console.error("Waitlist load error:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [client]);

  if (loading) return <p className="text-sm text-[#6D6A65] py-8 text-center">Loading waitlist data...</p>;

  const pTotal = patientData?.total || 0;
  const tTotal = therapistData?.total || 0;

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5">
          <div className="flex items-center gap-2 text-[#6D6A65] text-xs uppercase tracking-wider mb-1">
            <Users size={14} /> Patient waitlist
          </div>
          <p className="text-3xl font-serif-display text-[#2D4A3E]">{pTotal}</p>
        </div>
        <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5">
          <div className="flex items-center gap-2 text-[#6D6A65] text-xs uppercase tracking-wider mb-1">
            <Briefcase size={14} /> Therapist waitlist
          </div>
          <p className="text-3xl font-serif-display text-[#2D4A3E]">{tTotal}</p>
        </div>
      </div>

      {/* Tab toggle */}
      <div className="flex gap-2 border-b border-[#E8E5DF]">
        {[
          { id: "patients", label: `Patients (${pTotal})` },
          { id: "therapists", label: `Therapists (${tTotal})` },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2 text-sm border-b-2 transition ${
              activeTab === t.id
                ? "border-[#C87965] text-[#2D4A3E] font-medium"
                : "border-transparent text-[#6D6A65] hover:text-[#2D4A3E]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "patients" && (
        <div className="space-y-4">
          {/* By state breakdown */}
          {patientData?.by_state?.length > 0 && (
            <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5">
              <h3 className="text-sm font-semibold text-[#2D4A3E] mb-3 flex items-center gap-2">
                <MapPin size={14} /> Demand by state
              </h3>
              <div className="space-y-2">
                {patientData.by_state.map(([state, count]) => (
                  <div key={state} className="flex items-center justify-between text-sm">
                    <span className="text-[#2B2A29] font-medium">{state}</span>
                    <span className="text-[#6D6A65]">{count} signup{count !== 1 ? "s" : ""}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent entries */}
          <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-[#2D4A3E] mb-3 flex items-center gap-2">
              <Mail size={14} /> Recent signups
            </h3>
            {(patientData?.entries || []).length === 0 ? (
              <p className="text-sm text-[#6D6A65]">No waitlist signups yet.</p>
            ) : (
              <div className="divide-y divide-[#E8E5DF]">
                {patientData.entries.map((e) => (
                  <div key={e.id} className="py-2 flex items-center justify-between text-sm">
                    <div>
                      <span className="text-[#2B2A29]">{e.email}</span>
                      <span className="ml-2 text-xs bg-[#FDFBF7] border border-[#E8E5DF] rounded-full px-2 py-0.5 text-[#6D6A65]">{e.state}</span>
                    </div>
                    <span className="text-xs text-[#6D6A65] flex items-center gap-1">
                      <Clock size={12} /> {new Date(e.created_at).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "therapists" && (
        <div className="space-y-4">
          {/* By state breakdown */}
          {therapistData?.by_state?.length > 0 && (
            <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5">
              <h3 className="text-sm font-semibold text-[#2D4A3E] mb-3 flex items-center gap-2">
                <MapPin size={14} /> Demand by state
              </h3>
              <div className="space-y-2">
                {therapistData.by_state.map(([state, count]) => (
                  <div key={state} className="flex items-center justify-between text-sm">
                    <span className="text-[#2B2A29] font-medium">{state}</span>
                    <span className="text-[#6D6A65]">{count} signup{count !== 1 ? "s" : ""}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent entries */}
          <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-[#2D4A3E] mb-3 flex items-center gap-2">
              <Mail size={14} /> Recent signups
            </h3>
            {(therapistData?.entries || []).length === 0 ? (
              <p className="text-sm text-[#6D6A65]">No therapist waitlist signups yet.</p>
            ) : (
              <div className="divide-y divide-[#E8E5DF]">
                {therapistData.entries.map((e) => (
                  <div key={e.id} className="py-2 text-sm">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-[#2B2A29] font-medium">{e.name}</span>
                        <span className="ml-2 text-[#6D6A65]">{e.email}</span>
                      </div>
                      <span className="text-xs text-[#6D6A65] flex items-center gap-1">
                        <Clock size={12} /> {new Date(e.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="mt-1 flex gap-2">
                      <span className="text-xs bg-[#FDFBF7] border border-[#E8E5DF] rounded-full px-2 py-0.5 text-[#6D6A65]">{e.state}</span>
                      {e.credential_type && (
                        <span className="text-xs bg-[#FDFBF7] border border-[#E8E5DF] rounded-full px-2 py-0.5 text-[#6D6A65]">{e.credential_type}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
