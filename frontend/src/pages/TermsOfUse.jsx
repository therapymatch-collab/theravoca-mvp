/**
 * Terms of Use — embeds theravoca.com/terms-of-use as the canonical source so
 * the legal copy stays in sync with the marketing site without us having to
 * duplicate (and risk drifting from) it.
 */
import { Header, Footer } from "@/components/SiteShell";

export default function TermsOfUse() {
  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <Header />
      <main className="flex-1 px-5 py-12 md:py-16" data-testid="terms-page">
        <div className="max-w-4xl mx-auto">
          <p className="text-xs uppercase tracking-[0.2em] text-[#C87965]">Legal</p>
          <h1 className="font-serif-display text-4xl sm:text-5xl text-[#2D4A3E] mt-2 leading-tight">
            Terms of Use
          </h1>
          <p className="text-sm text-[#6D6A65] mt-3 leading-relaxed">
            The latest Terms of Use are maintained on our marketing site.
            View the full version at{" "}
            <a
              href="https://theravoca.com/terms-of-use/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#2D4A3E] underline"
              data-testid="terms-canonical-link"
            >
              theravoca.com/terms-of-use
            </a>
            .
          </p>
          <div
            className="mt-8 bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden"
            data-testid="terms-iframe-wrap"
          >
            <iframe
              src="https://theravoca.com/terms-of-use/"
              title="TheraVoca Terms of Use"
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
