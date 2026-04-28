import { Link } from "react-router-dom";
import { ArrowRight, Briefcase, HeartHandshake } from "lucide-react";

/**
 * DualCTA — drop-in two-card CTA used across landing-page sections so
 * patients always have a "Get matched" button and therapists always
 * have a "Join the network" button within thumb's reach.
 *
 * Use `tone="light"` (default) on white backgrounds and `tone="warm"`
 * on the cream `#F4EFE7` sections so the cards still feel layered.
 */
export default function DualCTA({ tone = "light", id }) {
  const bg = tone === "warm" ? "bg-[#FDFBF7]" : "bg-[#F4EFE7]";
  return (
    <div
      className="max-w-5xl mx-auto px-5 sm:px-8 py-12"
      data-testid={id || "dual-cta"}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <article
          className={`${bg} border border-[#E8E5DF] rounded-3xl p-7 sm:p-8 flex flex-col`}
          data-testid="dual-cta-patient"
        >
          <div className="w-11 h-11 rounded-full bg-[#2D4A3E] text-white flex items-center justify-center">
            <HeartHandshake size={20} strokeWidth={1.6} />
          </div>
          <h3 className="font-serif-display text-2xl text-[#2D4A3E] mt-4">
            Looking for a therapist?
          </h3>
          <p className="text-sm text-[#6D6A65] mt-2 leading-relaxed">
            Tell us what you need in 2 minutes. We deliver 3+ matched
            therapists within 24 hours — free.
          </p>
          <a
            href="/#start"
            className="tv-btn-primary mt-5 self-start"
            data-testid="dual-cta-patient-btn"
          >
            Get matched <ArrowRight size={16} className="ml-1.5 inline" />
          </a>
        </article>
        <article
          className={`${bg} border border-[#E8E5DF] rounded-3xl p-7 sm:p-8 flex flex-col`}
          data-testid="dual-cta-therapist"
        >
          <div className="w-11 h-11 rounded-full bg-[#C87965] text-white flex items-center justify-center">
            <Briefcase size={20} strokeWidth={1.6} />
          </div>
          <h3 className="font-serif-display text-2xl text-[#2D4A3E] mt-4">
            Therapists — join our network
          </h3>
          <p className="text-sm text-[#6D6A65] mt-2 leading-relaxed">
            Get pre-qualified, anonymous referrals that match your
            practice. 30-day free trial. No insurance forms.
          </p>
          <Link
            to="/therapists/join"
            className="tv-btn-secondary mt-5 self-start"
            data-testid="dual-cta-therapist-btn"
          >
            Join the network{" "}
            <ArrowRight size={16} className="ml-1.5 inline" />
          </Link>
        </article>
      </div>
    </div>
  );
}
