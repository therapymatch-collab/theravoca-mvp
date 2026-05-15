/**
 * SMS Terms / Messaging Policy -- public CTIA-compliant SMS opt-in
 * disclosure page. Required by Telnyx (and any other CPaaS provider)
 * for toll-free verification: a publicly accessible URL that documents
 * the SMS use case, message type, frequency, data-rate notice, STOP +
 * HELP keywords, and links to the Privacy Notice.
 *
 * Linked from the footer + the Telnyx toll-free verification form.
 */
import { Link } from "react-router-dom";
import { Header, Footer } from "@/components/SiteShell";

export default function SmsTerms() {
  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <Header />
      <main className="flex-1 px-5 py-12 md:py-16" data-testid="sms-terms-page">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs uppercase tracking-[0.2em] text-[#C87965]">Legal</p>
          <h1 className="font-serif-display text-4xl sm:text-5xl text-[#2D4A3E] mt-2 leading-tight">
            SMS Messaging Terms
          </h1>
          <p className="text-sm text-[#6D6A65] mt-3">
            Effective Date: May 15, 2026
          </p>

          <div className="mt-8 prose prose-sm max-w-none text-[#2B2A29] leading-relaxed space-y-6">

            <section>
              <h2 className="font-serif-display text-xl text-[#2D4A3E] mt-8 mb-3">
                Program Description
              </h2>
              <p>
                TheraVoca, LLC ("TheraVoca," "we," "us") sends SMS text messages to
                licensed mental and behavioral health professionals in connection with
                our therapist-recruitment program. The purpose of these messages is to
                invite qualified clinicians to join the TheraVoca patient-matching
                network and to follow up on their interest. We do not use SMS to send
                marketing messages to patients or to send unsolicited promotional
                content.
              </p>
            </section>

            <section>
              <h2 className="font-serif-display text-xl text-[#2D4A3E] mt-8 mb-3">
                Message Types
              </h2>
              <ul className="list-disc pl-5 mt-2 space-y-1">
                <li>
                  <strong>Recruiting outreach (account/onboarding):</strong>{" "}
                  short invitations to join the TheraVoca therapist network, sent to
                  publicly listed practice phone numbers obtained from state
                  licensing boards and public professional directories.
                </li>
                <li>
                  <strong>Follow-up messages:</strong> a small number of follow-ups if
                  the recipient expresses interest but doesn't complete signup.
                </li>
                <li>
                  <strong>Account/transactional (future use):</strong> two-factor
                  authentication codes and account security alerts for therapists who
                  have already signed up and explicitly opt into SMS in their account
                  settings.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="font-serif-display text-xl text-[#2D4A3E] mt-8 mb-3">
                Message Frequency
              </h2>
              <p>
                Message frequency varies. Most recipients will receive between
                <strong> 1 and 3 messages per month</strong>, and most receive only
                one message in total. We do not send recurring promotional broadcasts.
              </p>
            </section>

            <section>
              <h2 className="font-serif-display text-xl text-[#2D4A3E] mt-8 mb-3">
                Message and Data Rates
              </h2>
              <p>
                <strong>Message and data rates may apply.</strong> Standard text
                messaging rates from your wireless carrier apply to every message you
                send or receive. TheraVoca does not charge a fee to receive these
                messages, but your carrier may. Contact your carrier for details about
                your messaging plan.
              </p>
            </section>

            <section>
              <h2 className="font-serif-display text-xl text-[#2D4A3E] mt-8 mb-3">
                Opt-Out (STOP)
              </h2>
              <p>
                You can opt out of TheraVoca SMS at any time by replying{" "}
                <strong>STOP</strong> to any message we send. After you reply STOP,
                you will receive one final confirmation message and then no further
                messages from TheraVoca. You can also opt out by emailing{" "}
                <a href="mailto:support@theravoca.com" className="text-[#2D4A3E] underline">
                  support@theravoca.com
                </a>{" "}
                with the subject line "Unsubscribe SMS" and the phone number you wish
                to remove.
              </p>
              <p>
                The following keywords also opt you out of all future SMS:{" "}
                <strong>STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT</strong>.
              </p>
            </section>

            <section>
              <h2 className="font-serif-display text-xl text-[#2D4A3E] mt-8 mb-3">
                Help (HELP)
              </h2>
              <p>
                For help with TheraVoca SMS, reply <strong>HELP</strong> to any
                message and we will send you a short reply with our support contact.
                You can also email{" "}
                <a href="mailto:support@theravoca.com" className="text-[#2D4A3E] underline">
                  support@theravoca.com
                </a>{" "}
                or visit{" "}
                <a href="https://theravoca.com" className="text-[#2D4A3E] underline">
                  theravoca.com
                </a>
                {" "}for support. We do not provide clinical or crisis support over
                SMS. If you are in crisis, please call or text 988 (Suicide &amp;
                Crisis Lifeline) or call 911.
              </p>
            </section>

            <section>
              <h2 className="font-serif-display text-xl text-[#2D4A3E] mt-8 mb-3">
                Supported Carriers
              </h2>
              <p>
                TheraVoca SMS is supported on all major U.S. wireless carriers
                including AT&amp;T, T-Mobile, Verizon, Sprint, US Cellular, and
                Boost. Carriers are not liable for delayed or undelivered messages.
              </p>
            </section>

            <section>
              <h2 className="font-serif-display text-xl text-[#2D4A3E] mt-8 mb-3">
                Privacy
              </h2>
              <p>
                TheraVoca handles personal information described in our{" "}
                <Link to="/privacy" className="text-[#2D4A3E] underline">
                  Privacy Notice
                </Link>
                . Mobile information collected for the SMS program is used only to
                deliver these messages and process opt-outs.{" "}
                <strong>
                  We do not sell, share, or rent mobile numbers or SMS opt-in data to
                  third parties for their own marketing purposes.
                </strong>{" "}
                We do not share SMS opt-in data with third parties or affiliates for
                marketing purposes under any circumstances.
              </p>
            </section>

            <section>
              <h2 className="font-serif-display text-xl text-[#2D4A3E] mt-8 mb-3">
                Consent
              </h2>
              <p>
                By providing your mobile number to TheraVoca and not opting out, you
                consent to receive recruiting and account-related SMS text messages
                from TheraVoca at the number provided, including messages sent
                automatically. Consent is not a condition of any purchase or service.
                You can revoke consent at any time by replying STOP. For phone
                numbers obtained from public licensing or directory sources, the
                first message we send will identify TheraVoca as the sender and
                include opt-out instructions.
              </p>
            </section>

            <section>
              <h2 className="font-serif-display text-xl text-[#2D4A3E] mt-8 mb-3">
                Contact
              </h2>
              <p>
                Questions about the TheraVoca SMS program? Email us at{" "}
                <a href="mailto:support@theravoca.com" className="text-[#2D4A3E] underline">
                  support@theravoca.com
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
