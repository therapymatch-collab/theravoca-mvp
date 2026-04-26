import { Link } from "react-router-dom";
import { Leaf } from "lucide-react";

export function Header({ minimal = false }) {
  return (
    <header
      className="sticky top-0 z-30 border-b border-[#E8E5DF] bg-[#FDFBF7]/85 backdrop-blur-md"
      data-testid="site-header"
    >
      <div className="max-w-7xl mx-auto px-5 sm:px-8 py-4 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 group" data-testid="logo-link">
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-[#2D4A3E] text-white">
            <Leaf size={18} strokeWidth={1.6} />
          </span>
          <span className="font-serif-display text-2xl text-[#2D4A3E] leading-none">
            TheraVoca
          </span>
        </Link>
        {!minimal && (
          <nav className="hidden md:flex items-center gap-8 text-sm text-[#6D6A65]">
            <a href="/#how" className="hover:text-[#2D4A3E] transition" data-testid="nav-how">
              How it works
            </a>
            <a href="/#different" className="hover:text-[#2D4A3E] transition" data-testid="nav-diff">
              Why TheraVoca
            </a>
            <a href="/#faq" className="hover:text-[#2D4A3E] transition" data-testid="nav-faq">
              FAQs
            </a>
            <Link
              to="/therapists/join"
              className="hover:text-[#2D4A3E] transition"
              data-testid="nav-therapists"
            >
              For therapists
            </Link>
            <a
              href="/#start"
              className="tv-btn-primary !py-2 !px-5 text-sm"
              data-testid="nav-cta"
            >
              Get matched
            </a>
          </nav>
        )}
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-[#E8E5DF] py-12 mt-16" data-testid="site-footer">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 grid grid-cols-1 md:grid-cols-3 gap-8 text-sm text-[#6D6A65]">
        <div>
          <div className="font-serif-display text-2xl text-[#2D4A3E]">TheraVoca</div>
          <p className="mt-2 leading-relaxed">
            Let therapists come to you. We do the logistical work so you can focus on healing.
          </p>
        </div>
        <div>
          <div className="text-[#2B2A29] font-semibold mb-2">Crisis support</div>
          <p className="leading-relaxed">
            If you or someone you know is in crisis, please call 911 or contact the
            Suicide & Crisis Lifeline at <span className="text-[#2D4A3E] font-semibold">988</span> immediately.
          </p>
        </div>
        <div>
          <div className="text-[#2B2A29] font-semibold mb-2">Privacy</div>
          <p className="leading-relaxed">
            We never share your personal information without your consent. Therapists
            only see anonymized referrals.
          </p>
        </div>
      </div>
    </footer>
  );
}
