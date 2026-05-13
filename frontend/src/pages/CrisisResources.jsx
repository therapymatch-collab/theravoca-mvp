import { Header, Footer } from "@/components/SiteShell";

/**
 * Standalone crisis resource page (/crisis).
 *
 * Single source of truth for the crisis-resource list that's also
 * inlined in two places: the intake "safety gate" when the patient
 * selects self-harm/safety concerns, and the feedback-survey
 * thank-you page when the backend's keyword detector flags the
 * response. Both inline locations link here for the full list.
 *
 * TheraVoca is NOT a crisis service. This page exists to direct
 * people to the right help fast and to make sure that disclaimer
 * is unambiguous.
 */
export default function CrisisResources() {
  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <Header />
      <main className="flex-1 px-5 py-12 sm:py-16">
        <div className="max-w-3xl mx-auto" data-testid="crisis-page">
          <h1 className="font-serif-display text-3xl sm:text-4xl text-[#2D4A3E]">
            If you're in crisis, get help right now
          </h1>
          <p className="mt-3 text-[#6D6A65] leading-relaxed">
            TheraVoca matches people with outpatient therapists. We are not
            equipped for safety crises. The resources below are free,
            confidential, and staffed 24/7.
          </p>

          {/* Immediate danger */}
          <section
            className="mt-8 rounded-2xl border-2 border-red-400 bg-red-50 p-6 sm:p-7"
            role="alert"
            data-testid="crisis-immediate"
          >
            <h2 className="text-xl font-semibold text-red-800">
              In immediate danger?
            </h2>
            <p className="mt-2 text-red-700 leading-relaxed">
              <strong>Call 911</strong> or go to your nearest emergency room.
            </p>
          </section>

          {/* Primary 24/7 lines */}
          <section className="mt-8" data-testid="crisis-primary">
            <h2 className="font-serif-display text-2xl text-[#2D4A3E]">
              24/7 crisis support
            </h2>
            <div className="mt-4 space-y-4">
              <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5">
                <div className="font-semibold text-[#2D4A3E]">
                  988 Suicide &amp; Crisis Lifeline
                </div>
                <div className="mt-1 text-[#2B2A29]">
                  Call or text{" "}
                  <a
                    href="tel:988"
                    className="text-[#8B3220] font-semibold underline"
                    data-testid="crisis-988-link"
                  >
                    988
                  </a>
                  . Free, confidential, available 24/7 in English and Spanish.
                </div>
              </div>

              <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5">
                <div className="font-semibold text-[#2D4A3E]">
                  Crisis Text Line
                </div>
                <div className="mt-1 text-[#2B2A29]">
                  Text <strong>HOME</strong> to{" "}
                  <a
                    href="sms:741741"
                    className="text-[#8B3220] font-semibold underline"
                  >
                    741741
                  </a>
                  . For people who'd rather text than talk.
                </div>
              </div>
            </div>
          </section>

          {/* Specialized */}
          <section className="mt-10" data-testid="crisis-specialized">
            <h2 className="font-serif-display text-2xl text-[#2D4A3E]">
              Specialized support
            </h2>
            <div className="mt-4 space-y-4">
              <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5">
                <div className="font-semibold text-[#2D4A3E]">
                  Veterans Crisis Line
                </div>
                <div className="mt-1 text-[#2B2A29]">
                  Dial{" "}
                  <a
                    href="tel:988"
                    className="text-[#8B3220] font-semibold underline"
                  >
                    988 then press 1
                  </a>
                  , or text{" "}
                  <a
                    href="sms:838255"
                    className="text-[#8B3220] font-semibold underline"
                  >
                    838255
                  </a>
                  . Confidential support for veterans and their families.
                </div>
              </div>

              <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5">
                <div className="font-semibold text-[#2D4A3E]">
                  Trevor Project (LGBTQ+ youth)
                </div>
                <div className="mt-1 text-[#2B2A29]">
                  Call{" "}
                  <a
                    href="tel:18664887386"
                    className="text-[#8B3220] font-semibold underline"
                  >
                    1-866-488-7386
                  </a>{" "}
                  or text <strong>START</strong> to{" "}
                  <a
                    href="sms:678678"
                    className="text-[#8B3220] font-semibold underline"
                  >
                    678-678
                  </a>
                  .
                </div>
              </div>

              <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5">
                <div className="font-semibold text-[#2D4A3E]">Trans Lifeline</div>
                <div className="mt-1 text-[#2B2A29]">
                  Call{" "}
                  <a
                    href="tel:18775658860"
                    className="text-[#8B3220] font-semibold underline"
                  >
                    1-877-565-8860
                  </a>
                  . Peer support staffed by trans operators.
                </div>
              </div>
            </div>
          </section>

          {/* Idaho-specific */}
          <section className="mt-10" data-testid="crisis-idaho">
            <h2 className="font-serif-display text-2xl text-[#2D4A3E]">
              Idaho resources
            </h2>
            <div className="mt-4 space-y-4">
              <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5">
                <div className="font-semibold text-[#2D4A3E]">
                  Idaho Behavioral Health Community Crisis Centers
                </div>
                <div className="mt-1 text-[#2B2A29] leading-relaxed">
                  Walk-in crisis centers operate in Boise, Idaho Falls,
                  Twin Falls, Coeur d'Alene, and Lewiston. Adults in crisis
                  can walk in 24/7 for short-term stabilization. Find your
                  nearest center:{" "}
                  <a
                    href="https://healthandwelfare.idaho.gov/services-programs/behavioral-health/crisis-centers"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#2D4A3E] underline"
                  >
                    healthandwelfare.idaho.gov
                  </a>
                </div>
              </div>

              <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5">
                <div className="font-semibold text-[#2D4A3E]">
                  Idaho Suicide Prevention Hotline
                </div>
                <div className="mt-1 text-[#2B2A29]">
                  Routes through{" "}
                  <a
                    href="tel:988"
                    className="text-[#8B3220] font-semibold underline"
                  >
                    988
                  </a>
                  . Staffed locally where possible.
                </div>
              </div>
            </div>
          </section>

          {/* Disclaimer */}
          <section
            className="mt-12 rounded-2xl bg-[#F4F0E8] border border-[#E8E5DF] p-6 text-sm text-[#6D6A65] leading-relaxed"
            data-testid="crisis-disclaimer"
          >
            <strong className="text-[#2B2A29]">A note from TheraVoca:</strong>{" "}
            We're a matching platform for outpatient therapy in Idaho. We are
            not a crisis service, do not provide treatment, and cannot respond
            to safety emergencies. If you're using TheraVoca to find a
            therapist for ongoing support, you can return to the{" "}
            <a href="/" className="text-[#2D4A3E] underline">
              home page
            </a>{" "}
            when you're ready. If you're in crisis right now, please reach out
            to one of the resources above first.
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
