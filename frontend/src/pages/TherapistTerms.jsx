/**
 * Therapist Terms of Use -- separate from the patient-facing ToS.
 *
 * The Patient ToS (TermsOfUse.jsx) explicitly says "any access or use
 * of the Services by a Therapist is governed by separate terms." This
 * is that doc. The centerpiece is the non-BA / non-CE disclaimer that
 * makes the consumer-directed marketing-platform posture explicit,
 * per the 2026-05-13 HIPAA scope-out audit.
 */
import { Header, Footer } from "@/components/SiteShell";

export default function TherapistTerms() {
  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <Header />
      <main className="flex-1 px-5 py-12 md:py-16" data-testid="therapist-terms-page">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs uppercase tracking-[0.2em] text-[#C87965]">Legal</p>
          <h1 className="font-serif-display text-4xl sm:text-5xl text-[#2D4A3E] mt-2 leading-tight">
            TheraVoca Terms of Use &ndash; Therapists
          </h1>
          <p className="text-sm text-[#6D6A65] mt-3">
            Last updated: May 13, 2026
          </p>

          <div className="mt-8 prose prose-sm max-w-none text-[#2B2A29] leading-relaxed space-y-6">

            {/* ---- Intro ---- */}
            <p>
              TheraVoca, LLC ("<strong>TheraVoca</strong>", "<strong>we</strong>",
              "<strong>us</strong>", "<strong>our</strong>") operates the
              TheraVoca platform that helps people in Idaho
              ("<strong>Searchers</strong>") find licensed therapists
              ("<strong>Therapists</strong>", "<strong>you</strong>",
              "<strong>your</strong>") for themselves or for the
              individual they are seeking care for (each, a
              "<strong>Patient</strong>"). A Searcher and a Patient are
              often the same person, but a Searcher may also be a
              parent, partner, or other family member submitting on the
              Patient's behalf. These Therapist Terms of Use
              ("<strong>Therapist Terms</strong>") govern your access to
              and use of TheraVoca in your capacity as a Therapist. The
              Patient-facing{" "}
              <a href="/terms" className="text-[#2D4A3E] underline">Patient Terms of Use</a>{" "}
              govern Searchers' and Patients' use of TheraVoca.
            </p>
            <p>
              By signing up, listing your profile, or accepting referrals on
              TheraVoca you agree to these Therapist Terms. If you do not
              agree, please do not use the platform.
            </p>

            {/* ---- The big disclaimer ---- */}
            <section>
              <h2 className="font-serif-display text-xl text-[#2D4A3E] mt-8 mb-3">
                Our role: marketing platform, not Business Associate
              </h2>
              <p>
                TheraVoca is a <strong>consumer-directed marketing and
                matching service</strong>. Patients submit search requests
                directly to TheraVoca; we then surface those requests to
                Therapists for marketing purposes so that Therapists can
                decide whether to invite the Patient into their practice.
              </p>
              <p className="mt-3">
                <strong>TheraVoca is not a Covered Entity</strong> under the
                Health Insurance Portability and Accountability Act of 1996
                ("<strong>HIPAA</strong>"). We do not render clinical care,
                bill insurance, diagnose, prescribe, schedule appointments
                inside any Therapist's electronic health record or practice
                management system, or transmit any HIPAA-covered transaction.
              </p>
              <p className="mt-3">
                <strong>TheraVoca is not a Business Associate</strong> of any
                Therapist under HIPAA. We do not collect, create, receive,
                maintain, or transmit Protected Health Information ("PHI") on
                behalf of any Therapist. Patient information that you receive
                through TheraVoca is shared with you by the Patient (or by
                TheraVoca on the Patient's behalf as part of our marketing
                service to the Patient), not by you to us. The
                therapist-patient relationship begins when you accept a
                referral and contact the Patient directly. Once you accept a
                referral, you become responsible for the Patient's PHI under
                whatever HIPAA, state, and professional obligations apply to
                your practice.
              </p>
              <p className="mt-3">
                Because TheraVoca is neither a Covered Entity nor a Business
                Associate, <strong>we do not sign Business Associate
                Agreements ("BAAs")</strong>. This is the same posture taken
                by other consumer-directed directory and matching services
                (e.g., Psychology Today, GoodTherapy).
              </p>
              <p className="mt-3">
                Independent of HIPAA, TheraVoca takes Patient privacy
                seriously and complies with applicable state health-privacy
                laws, including (as relevant to Patients in TheraVoca's
                service area) the Idaho Patient Act. We describe our privacy
                practices in detail in our{" "}
                <a href="/privacy" className="text-[#2D4A3E] underline">
                  Privacy Notice
                </a>
                .
              </p>
            </section>

            {/* ---- Eligibility ---- */}
            <section>
              <h2 className="font-serif-display text-xl text-[#2D4A3E] mt-8 mb-3">
                Eligibility
              </h2>
              <p>
                To list your services on TheraVoca, you must:
              </p>
              <ul className="list-disc pl-5 mt-2 space-y-2">
                <li>
                  Hold a current, active license to provide outpatient mental
                  or behavioral health services in the state of Idaho
                  (including but not limited to LCSW, LMFT, LCPC, LPC, PsyD,
                  PhD in clinical psychology, MD, DO, NP-Psych, PA-Psych).
                </li>
                <li>
                  Be in good standing with the Idaho Division of Occupational
                  and Professional Licenses (DOPL) and any other applicable
                  licensing board.
                </li>
                <li>
                  Carry professional liability (malpractice) insurance
                  appropriate to the scope of services you offer.
                </li>
                <li>
                  Have the authority and intent to provide the services
                  described in your TheraVoca profile.
                </li>
              </ul>
              <p className="mt-3">
                You agree to keep your license information current on
                TheraVoca. If your license is suspended, lapses, or is
                revoked, you must update your profile immediately and stop
                accepting new referrals through the platform.
              </p>
            </section>

            {/* ---- Profile + Referral handling ---- */}
            <section>
              <h2 className="font-serif-display text-xl text-[#2D4A3E] mt-8 mb-3">
                Profile content and referrals
              </h2>
              <p>
                You are solely responsible for the accuracy of your TheraVoca
                profile, including specialties, modalities, populations
                served, insurance accepted, availability, and any biographical
                content. You agree to update your profile when material
                information changes.
              </p>
              <p className="mt-3">
                When you receive a referral notification, TheraVoca shares
                only the minimum information needed to let you decide whether
                to invite the Patient into your practice. Patient information
                you receive may have been submitted by the Patient directly or
                by a Searcher acting on the Patient's behalf (for example, a
                parent submitting on behalf of a teen). You may decline any
                referral for any reason that complies with applicable law and
                your professional ethics. If you accept a referral, you
                contact the Patient (or the Searcher who submitted on the
                Patient's behalf) directly outside of TheraVoca and from
                that point forward operate independently of TheraVoca with
                respect to that Patient's care.
              </p>
              <p className="mt-3">
                You agree not to share Patient information you receive
                through TheraVoca with any third party except as permitted
                by applicable law and your own privacy obligations to the
                Patient.
              </p>
            </section>

            {/* ---- Fees / Subscription (placeholder) ---- */}
            <section>
              <h2 className="font-serif-display text-xl text-[#2D4A3E] mt-8 mb-3">
                Fees and subscription
              </h2>
              <p>
                Some TheraVoca features are available without charge.
                Continued use of the full platform may require an active
                paid subscription. Current pricing is shown on your account
                page and may be updated from time to time on reasonable
                notice. You may cancel your subscription at any time; your
                profile will remain visible until the end of the period you
                have paid for.
              </p>
            </section>

            {/* ---- Conduct ---- */}
            <section>
              <h2 className="font-serif-display text-xl text-[#2D4A3E] mt-8 mb-3">
                Acceptable use
              </h2>
              <p>
                You agree not to: (i) misrepresent your credentials,
                experience, or services; (ii) solicit Patients to bypass
                TheraVoca's referral flow; (iii) use TheraVoca to harass,
                discriminate against, or harm any Patient, other Therapist,
                or TheraVoca staff; (iv) attempt to scrape, mass-export, or
                otherwise extract data beyond what's reasonably needed to
                evaluate referrals you have received; (v) impersonate any
                other person; or (vi) use TheraVoca in violation of any law
                or your professional licensing requirements.
              </p>
            </section>

            {/* ---- Indemnification / Disclaimers ---- */}
            <section>
              <h2 className="font-serif-display text-xl text-[#2D4A3E] mt-8 mb-3">
                Disclaimers and limitation of liability
              </h2>
              <p className="uppercase">
                THERAVOCA PROVIDES THE PLATFORM ON AN "AS IS" AND "AS
                AVAILABLE" BASIS. WE DO NOT GUARANTEE ANY MINIMUM VOLUME OR
                QUALITY OF REFERRALS, RESPONSE TIMES, OR PATIENT FIT. TO THE
                FULLEST EXTENT PERMITTED BY LAW, THERAVOCA DISCLAIMS ALL
                WARRANTIES, EXPRESS OR IMPLIED, INCLUDING THE IMPLIED
                WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
                PURPOSE, AND NON-INFRINGEMENT.
              </p>
              <p className="mt-3 uppercase">
                IN NO EVENT WILL THERAVOCA BE LIABLE TO YOU FOR ANY
                INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY,
                OR PUNITIVE DAMAGES, OR FOR ANY LOSS OF PROFITS OR REVENUE,
                ARISING FROM OR RELATING TO YOUR USE OF THE PLATFORM,
                WHETHER BASED ON WARRANTY, CONTRACT, TORT, OR ANY OTHER
                LEGAL THEORY. THERAVOCA'S TOTAL CUMULATIVE LIABILITY TO YOU
                FOR ALL CLAIMS ARISING FROM OR RELATING TO THE PLATFORM IS
                LIMITED TO THE GREATER OF (A) THE AMOUNTS YOU HAVE PAID
                THERAVOCA IN THE TWELVE MONTHS PRECEDING THE CLAIM, OR
                (B) ONE HUNDRED U.S. DOLLARS ($100).
              </p>
              <p className="mt-3">
                You agree to indemnify and hold TheraVoca harmless from any
                claims, damages, or liabilities arising from (i) your
                provision of services to any Patient introduced via
                TheraVoca, (ii) your violation of these Therapist Terms,
                (iii) your violation of any applicable law or professional
                obligation, or (iv) your handling of Patient PHI after a
                referral has been accepted.
              </p>
            </section>

            {/* ---- Termination ---- */}
            <section>
              <h2 className="font-serif-display text-xl text-[#2D4A3E] mt-8 mb-3">
                Termination
              </h2>
              <p>
                You may stop using TheraVoca at any time by deactivating
                your profile and canceling any paid subscription. TheraVoca
                may suspend or terminate your access to the platform if you
                violate these Therapist Terms, lose your license to practice,
                or in our reasonable discretion to protect the safety or
                trust of Patients on the platform. We will give you
                reasonable notice where practical.
              </p>
            </section>

            {/* ---- Changes ---- */}
            <section>
              <h2 className="font-serif-display text-xl text-[#2D4A3E] mt-8 mb-3">
                Changes to these Therapist Terms
              </h2>
              <p>
                We may revise these Therapist Terms from time to time. When
                we make material changes, we will notify you by email or via
                the platform at least thirty (30) days before the change
                takes effect (or as required by law). Your continued use of
                the platform after the effective date constitutes acceptance
                of the revised Therapist Terms.
              </p>
            </section>

            {/* ---- Contact ---- */}
            <section>
              <h2 className="font-serif-display text-xl text-[#2D4A3E] mt-8 mb-3">
                Contact
              </h2>
              <p>
                Questions about these Therapist Terms, including questions
                about TheraVoca's non-Business-Associate posture, can be
                sent to{" "}
                <a href="mailto:legal@theravoca.com" className="text-[#2D4A3E] underline">
                  legal@theravoca.com
                </a>
                .
              </p>
            </section>

          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
