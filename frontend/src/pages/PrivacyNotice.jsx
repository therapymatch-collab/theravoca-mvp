/**
 * Privacy Notice — embeds theravoca.com/privacy-notice as the canonical source.
 */
import { Header, Footer } from "@/components/SiteShell";

export default function PrivacyNotice() {
  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <Header />
      <main className="flex-1 px-5 py-12 md:py-16" data-testid="privacy-page">
        <div className="max-w-4xl mx-auto">
          <p className="text-xs uppercase tracking-[0.2em] text-[#C87965]">Legal</p>
          <h1 className="font-serif-display text-4xl sm:text-5xl text-[#2D4A3E] mt-2 leading-tight">
            Privacy Notice
          </h1>
          <p className="text-sm text-[#6D6A65] mt-3 leading-relaxed">
            The latest Privacy Notice is maintained on our marketing site.
            View the full version at{" "}
            <a
              href="https://theravoca.com/privacy-notice/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#2D4A3E] underline"
              data-testid="privacy-canonical-link"
            >
              theravoca.com/privacy-notice
            </a>
            .
          </p>
          <div
            className="mt-8 bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden"
            data-testid="privacy-iframe-wrap"
          >
            <iframe
              src="https://theravoca.com/privacy-notice/"
              title="TheraVoca Privacy Notice"
              className="w-full"
              style={{ minHeight: "120vh", border: 0 }}
            />
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
