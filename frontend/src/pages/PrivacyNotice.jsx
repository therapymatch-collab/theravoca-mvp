/**
 * Privacy Notice -- locally hosted legal content.
 * Content sourced from theravoca.com/privacy-notice/ (effective April 23, 2025).
 */
import { Header, Footer } from "@/components/SiteShell";

export default function PrivacyNotice() {
  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <Header />
      <main className="flex-1 px-5 py-12 md:py-16" data-testid="privacy-page">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs uppercase tracking-[0.2em] text-[#C87965]">Legal</p>
          <h1 className="font-serif-display text-4xl sm:text-5xl text-[#2D4A3E] mt-2 leading-tight">
            TheraVoca Privacy Notice
          </h1>
          <p className="text-sm text-[#6D6A65] mt-3">
            Effective Date: April 23, 2025
          </p>

          <div className="mt-8 prose prose-sm max-w-none text-[#2B2A29] leading-relaxed space-y-6">

            {/* ── Intro ── */}
            <p>
              This Privacy Notice describes how TheraVoca, LLC ("<strong>we</strong>," "<strong>us,</strong>" or "<strong>TheraVoca</strong>") handles personal information in connection with the TheraVoca service (the "<strong>Service</strong>"), which includes TheraVoca.com.
            </p>
            <p>
              TheraVoca helps users find Therapists. Therapists handle personal information pursuant to their own privacy policies and practices, not this Privacy Notice. However, as explained below, we don't intentionally share the identity of Patients or Searchers with Therapists.
            </p>

            {/* ── KEY PRIVACY POINTS ── */}
            <section>
              <h2 className="font-serif-display text-xl text-[#2D4A3E] mt-8 mb-3">
                KEY PRIVACY POINTS
              </h2>
              <p>We hope you read this entire Privacy Notice for full detail, but here are some key points:</p>
              <p>This Privacy Notice discusses three kinds of people:</p>
              <ul className="list-disc pl-5 mt-2 space-y-1">
                <li>"<strong>Therapist</strong>": A mental or behavioral health professional.</li>
                <li>"<strong>Patient</strong>": The person who may become the therapist's patient or client.</li>
                <li>"<strong>Searcher</strong>": The user who is using our Service to find a Therapist for the Patient. <strong>If you're using the Service to find a Therapist for yourself, then you are both the Searcher and the Patient</strong>. However, a Searcher can instead use the Service to find a Therapist for a friend or family member, in which case that friend or family member is the Patient.</li>
              </ul>

              <p className="mt-4">The Service works like this:</p>

              <p className="mt-3"><em>Step 1: Creating the Search Request</em></p>
              <ul className="list-disc pl-5 mt-2 space-y-1">
                <li>The Searcher starts creating a search request ("<strong>Search Request</strong>") that we will later share with prospective Therapists. To do this, the Searcher provides us with:
                  <ul className="list-disc pl-5 mt-1 space-y-1">
                    <li>basic information about the Patient (but not their identity); and</li>
                    <li>their preferences for a Therapist.</li>
                  </ul>
                </li>
                <li>For example, they may indicate that the Patient is a young adult female in need of a psychiatrist in Boise, Idaho who can treat depression.</li>
                <li>The Searcher is responsible for ensuring that <strong>the Search Request does not contain the Searcher's or Patient's name, contact details, or other information that would allow somebody to identify the Searcher or the Patient</strong>.</li>
                <li>The Search Request is finalized.</li>
                <li>The Searcher gives us the Searcher's email address so that we can later send them the results.</li>
              </ul>

              <p className="mt-3"><em>Step 2: The Search</em></p>
              <ul className="list-disc pl-5 mt-2 space-y-1">
                <li>We share the Search Request broadly with a very large number of prospective Therapists. We may publish the Search Request in online locations accessible to the public, which is why the Searcher should not include identifying information in the Search Request.</li>
                <li>Therapists who meet the Search Request criteria respond to us, providing their contact details, information about their professional license and practice, and other details.</li>
                <li>TheraVoca analyzes these responses and generates a list of potential matches.</li>
              </ul>

              <p className="mt-3"><em>Step 3: Delivering Results</em></p>
              <ul className="list-disc pl-5 mt-2 space-y-1">
                <li>We email the Searcher to invite them to return to TheraVoca.com to review the results from the search.</li>
                <li>These matches will include the Therapists' contact information and practice details.</li>
              </ul>

              <p className="mt-3">
                That's it! The Patient (or their parent or guardian) can then independently contact recommended Therapists to schedule an initial meeting. This contact and all communication between the Patient and any Therapist (including all treatment) happens outside the Service.
              </p>
              <p>TheraVoca also will allow Therapists to create an account.</p>
              <p>
                If you have any questions or concerns about this policy, email us at{" "}
                <a href="mailto:privacy@theravoca.com" className="text-[#2D4A3E] underline">privacy@theravoca.com</a>.
              </p>
            </section>

            {/* ── TABLE OF CONTENTS ── */}
            <section>
              <h2 className="font-serif-display text-xl text-[#2D4A3E] mt-8 mb-3">
                TABLE OF CONTENTS
              </h2>
              <ol className="list-decimal pl-5 mt-2 space-y-1">
                <li>Information We Collect</li>
                <li>Use of Information</li>
                <li>Disclosure of Information</li>
                <li>Your Data Requests</li>
                <li>Protection of Information</li>
                <li>Children</li>
                <li>Updates and Changes to This Policy</li>
                <li>Contacting Us</li>
              </ol>
            </section>

            {/* ── 1. INFORMATION WE COLLECT ── */}
            <section>
              <h2 className="font-serif-display text-xl text-[#2D4A3E] mt-8 mb-3">
                1. INFORMATION WE COLLECT
              </h2>

              <p className="font-medium">a. Information You Provide to Us:</p>
              <p>Searchers provide:</p>
              <ul className="list-disc pl-5 mt-2 space-y-1">
                <li>Their own email address;</li>
                <li>Basic information about the Patient (but not Patient identity);</li>
                <li>Details about the sorts of Therapists they would like (for example, location, type of therapist, etc.)</li>
              </ul>

              <p className="mt-3">Therapists provide:</p>
              <ul className="list-disc pl-5 mt-2 space-y-1">
                <li>Name</li>
                <li>Contact details</li>
                <li>Professional details (for example, license details and rate/insurance information)</li>
              </ul>

              <p className="mt-3">
                Our third-party payment processor will provide us with the transaction details about user payments (but not full payment card information).
              </p>
              <p>
                Our website and service providers use cookies and similar technology, which collect additional information from any visitors or users of our Service, as described below.
              </p>

              <p className="font-medium mt-4">b. Cookies and Other Technology</p>
              <p>
                Through our online properties and emails, we and third parties may collect information from your computer or other device by automated means such as cookies, web beacons, local storage, JavaScript, mobile-device functionality and other computer code. This information may include unique browser identifiers, IP address, browser and operating system information, device identifiers, other device information, Internet connection information, as well as details about your interactions with the relevant website, email or other online property (for example, the URL of the third-party website from which you came, the pages on our website that you visit, and the links you click on in a website). In some cases (such as cookies), the tools described here involve storing unique identifiers or other information on your device for later use.
              </p>

              <p className="font-medium mt-4">c. Information From Third Parties</p>
              <p>
                We may also receive personal information from third parties, including our service providers, other users of the Service, and publicly available sources, such as professional social media websites and government records of professional licensure.
              </p>
            </section>

            {/* ── 2. USE OF INFORMATION ── */}
            <section>
              <h2 className="font-serif-display text-xl text-[#2D4A3E] mt-8 mb-3">
                2. USE OF INFORMATION
              </h2>
              <p>We may use the information described above for the following purposes:</p>
              <ol className="list-decimal pl-5 mt-2 space-y-1">
                <li>Managing and improving the Services generally, such as by:
                  <ol className="list-decimal pl-5 mt-1 space-y-1">
                    <li>Conducting business operations like auditing, security, fraud prevention, invoicing and accounting, analytics, and research and development;</li>
                    <li>Protecting against, identifying, investigating, and responding to misuse of the Services or other unlawful behavior; and</li>
                    <li>Creating aggregated or de-identified information;</li>
                  </ol>
                </li>
                <li>Establishing, exercising, or defending our legal rights; and</li>
                <li>Addressing legal requirements.</li>
              </ol>
              <p className="mt-3">
                We also may use information about a Searcher to market our own services to that Searcher (such as to follow up with the Searcher to see if they'd like to complete a search). We may use information about Therapists to market our services to Therapists. We may also use information about prospective users of our Service to market to them.
              </p>
            </section>

            {/* ── 3. DISCLOSURE OF INFORMATION ── */}
            <section>
              <h2 className="font-serif-display text-xl text-[#2D4A3E] mt-8 mb-3">
                3. DISCLOSURE OF INFORMATION
              </h2>
              <p>We may disclose your information as follows:</p>
              <ul className="list-disc pl-5 mt-2 space-y-2">
                <li><strong>To our vendors and service providers:</strong> We disclose information to companies that provide services to us, such as providers that analyze data or provide customer service, data storage, security, or fraud prevention. We may engage a third party to host or operate any aspect of the Services or operations, including any mechanism through which we send or receive communications, such as our email systems, our online forms, and any part of TheraVoca.com.</li>
                <li><strong>To affiliates:</strong> We may disclose information to current or future parents, subsidiaries, affiliates, and other companies under common control or ownership with TheraVoca.</li>
                <li><strong>In connection with legal matters:</strong> We may disclose information when we believe disclosure is appropriate due to a subpoena or similar investigative demand, a court order, or other request from a law enforcement or government agency; or as otherwise required by law.</li>
                <li><strong>For the protection of TheraVoca and others:</strong> We may disclose information when we believe disclosure is appropriate in connection with efforts to investigate, prevent, or take other action regarding illegal activity, suspected fraud or other wrongdoing; to protect and defend the rights, property or safety of our company, our employees, our customers, or others; and to enforce our contracts.</li>
                <li><strong>In connection with corporate transactions:</strong> We may disclose your information as part of, or to take steps in anticipation of, a sale of all or a portion of our business, a divestiture, merger, consolidation, asset sale, bankruptcy, or other significant corporate event.</li>
                <li><strong>In other situations:</strong> We may also disclose your information in other situations where legally permitted.</li>
              </ul>
              <p className="mt-3">
                We of course also disclose details about participating Therapists to Searchers. We may use and disclose appropriately aggregated or de-identified information for any purpose.
              </p>
            </section>

            {/* ── 4. YOUR DATA REQUESTS ── */}
            <section>
              <h2 className="font-serif-display text-xl text-[#2D4A3E] mt-8 mb-3">
                4. YOUR DATA REQUESTS
              </h2>
              <p className="font-medium">a. Marketing Communications</p>
              <p>
                You can unsubscribe from TheraVoca marketing emails by clicking the unsubscribe link in a marketing email or contacting us at{" "}
                <a href="mailto:privacy@theravoca.com" className="text-[#2D4A3E] underline">privacy@theravoca.com</a>.
              </p>
              <p className="font-medium mt-4">b. Data Deletion</p>
              <p>
                You can request deletion of your data by emailing us at{" "}
                <a href="mailto:privacy@theravoca.com" className="text-[#2D4A3E] underline">privacy@theravoca.com</a>.
                {" "}Unless we have an important legal or business need to keep it, we will delete it.
              </p>
            </section>

            {/* ── 5. PROTECTION OF INFORMATION ── */}
            <section>
              <h2 className="font-serif-display text-xl text-[#2D4A3E] mt-8 mb-3">
                5. PROTECTION OF INFORMATION
              </h2>
              <p>
                To help protect personal information, we have put in place certain physical, technical, and administrative safeguards. However, we cannot assure you that data that we collect under this Privacy Notice will never be used or disclosed in a manner that is inconsistent with this Privacy Notice.
              </p>
            </section>

            {/* ── 6. CHILDREN ── */}
            <section>
              <h2 className="font-serif-display text-xl text-[#2D4A3E] mt-8 mb-3">
                6. CHILDREN
              </h2>
              <p>
                TheraVoca is for use only by adults, though they are welcome to use the Service to find Therapists for children. If you are a parent or legal guardian and think your child under 18 has given us personal information, please contact us at{" "}
                <a href="mailto:privacy@theravoca.com" className="text-[#2D4A3E] underline">privacy@theravoca.com</a>
                {" "}so that we can delete it.
              </p>
            </section>

            {/* ── 7. UPDATES AND CHANGES TO THIS POLICY ── */}
            <section>
              <h2 className="font-serif-display text-xl text-[#2D4A3E] mt-8 mb-3">
                7. UPDATES AND CHANGES TO THIS POLICY
              </h2>
              <p>
                We may update this Privacy Notice from time to time, such as to reflect changes in our practices or for legal reasons. We will post those changes here or on a similarly accessible page.
              </p>
            </section>

            {/* ── 8. CONTACTING US ── */}
            <section>
              <h2 className="font-serif-display text-xl text-[#2D4A3E] mt-8 mb-3">
                8. CONTACTING US
              </h2>
              <p>
                If you have any questions or comments regarding our Privacy Notice and practices, or to submit a request or complaint, please email our privacy team at{" "}
                <a href="mailto:privacy@theravoca.com" className="text-[#2D4A3E] underline">privacy@theravoca.com</a>.
              </p>
            </section>

          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
