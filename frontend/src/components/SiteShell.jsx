import { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Leaf, ChevronDown, Menu, X, LogOut } from "lucide-react";
import useSiteCopy from "@/lib/useSiteCopy";
import { getSession, clearSession } from "@/lib/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// React Router suppresses navigation when the target path matches the current
// location, so clicking the logo while already on `/` does nothing visible —
// the page stays at the user's current scroll position. This handler forces a
// scroll-to-top in both cases (same route or different) and strips any hash
// (`/#start`) that would otherwise re-scroll to a section.
function useScrollTopNavigate(to) {
  const location = useLocation();
  const navigate = useNavigate();
  return (e) => {
    e.preventDefault();
    if (location.pathname === to && !location.hash) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      // Strip any leftover hash from the previous URL so Landing's anchor
      // effect doesn't re-scroll into a section. ScrollManager handles
      // the actual scroll-to-top after the route swaps.
      navigate(to, { replace: false });
    }
  };
}

export function Header({ minimal = false }) {
  const t = useSiteCopy();
  const navigate = useNavigate();
  const onLogoClick = useScrollTopNavigate("/");
  const onTherapistsClick = useScrollTopNavigate("/therapists/join");
  const [mobileOpen, setMobileOpen] = useState(false);
  const session = getSession();

  const handleSignOut = () => {
    clearSession();
    navigate("/");
  };

  // Close the mobile drawer whenever the route changes so it never leaks
  // into the next page load.
  const location = useLocation();
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname, location.hash]);

  // Lock body scroll while drawer is open.
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  return (
    <header
      className="sticky top-0 z-30 border-b border-[#E8E5DF] bg-[#FDFBF7]/85 backdrop-blur-md"
      data-testid="site-header"
    >
      <div className="max-w-7xl mx-auto px-5 sm:px-8 py-4 flex items-center justify-between">
        <a
          href="/"
          onClick={onLogoClick}
          className="flex items-center gap-2 group"
          data-testid="logo-link"
        >
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-[#2D4A3E] text-white">
            <Leaf size={18} strokeWidth={1.6} />
          </span>
          <span className="font-serif-display text-2xl text-[#2D4A3E] leading-none">
            TheraVoca
          </span>
        </a>

        {!minimal && (
          <>
            {/* Desktop nav */}
            <nav
              className="hidden md:flex items-center gap-7 text-sm text-[#6D6A65]"
              data-testid="desktop-nav"
            >
              <a href="/#how" className="hover:text-[#2D4A3E] transition" data-testid="nav-how">
                {t("header.nav.how", "How it works")}
              </a>
              <a href="/#testimonials" className="hover:text-[#2D4A3E] transition" data-testid="nav-testimonials">
                {t("header.nav.testimonials", "Testimonials")}
              </a>
              <a href="/#different" className="hover:text-[#2D4A3E] transition" data-testid="nav-diff">
                {t("header.nav.different", "Why TheraVoca")}
              </a>
              <a href="/#faq" className="hover:text-[#2D4A3E] transition" data-testid="nav-faq">
                {t("header.nav.faq", "FAQs")}
              </a>
              <a
                href="/therapists/join"
                onClick={onTherapistsClick}
                className="hover:text-[#2D4A3E] transition"
                data-testid="nav-therapists"
              >
                {t("header.nav.therapists", "For therapists")}
              </a>
              {session ? (
                <button
                  onClick={handleSignOut}
                  className="inline-flex items-center gap-1.5 hover:text-[#2D4A3E] transition"
                  data-testid="nav-signout"
                >
                  <LogOut size={14} /> Sign out
                </button>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className="inline-flex items-center gap-1.5 hover:text-[#2D4A3E] transition outline-none"
                    data-testid="nav-signin-trigger"
                  >
                    {t("header.nav.signin", "Sign in")} <ChevronDown size={14} strokeWidth={2} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="bg-white border-[#E8E5DF] w-56"
                    data-testid="nav-signin-menu"
                  >
                    <DropdownMenuItem asChild>
                      <Link
                        to="/sign-in?role=patient"
                        className="cursor-pointer"
                        data-testid="signin-as-patient"
                      >
                        <div>
                          <div className="font-medium text-[#2B2A29]">Patient</div>
                          <div className="text-xs text-[#6D6A65]">Track your matches</div>
                        </div>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link
                        to="/sign-in?role=therapist"
                        className="cursor-pointer"
                        data-testid="signin-as-therapist"
                      >
                        <div>
                          <div className="font-medium text-[#2B2A29]">Therapist</div>
                          <div className="text-xs text-[#6D6A65]">View your referrals</div>
                        </div>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link
                        to="/admin"
                        className="cursor-pointer"
                        data-testid="signin-as-admin"
                      >
                        <div>
                          <div className="font-medium text-[#2B2A29]">Admin</div>
                          <div className="text-xs text-[#6D6A65]">Operations console</div>
                        </div>
                      </Link>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <a
                href="/#start"
                className="tv-btn-primary !py-2 !px-5 text-sm"
                data-testid="nav-cta"
              >
                {t("header.cta", "Get matched")}
              </a>
            </nav>

            {/* Mobile burger */}
            <button
              type="button"
              onClick={() => setMobileOpen((s) => !s)}
              className="md:hidden inline-flex items-center justify-center w-10 h-10 rounded-full text-[#2D4A3E] hover:bg-[#E8E5DF]/50 transition"
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileOpen}
              data-testid="mobile-menu-trigger"
            >
              {mobileOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </>
        )}
      </div>

      {/* Mobile drawer — slides down under the sticky header */}
      {!minimal && mobileOpen && (
        <div
          className="md:hidden border-t border-[#E8E5DF] bg-[#FDFBF7]"
          data-testid="mobile-nav"
        >
          <nav className="max-w-7xl mx-auto px-5 py-5 flex flex-col gap-1 text-base text-[#2B2A29]">
            <a
              href="/#how"
              className="py-3 px-2 rounded-lg hover:bg-[#E8E5DF]/40 transition"
              data-testid="mobile-nav-how"
            >
              How it works
            </a>
            <a
              href="/#testimonials"
              className="py-3 px-2 rounded-lg hover:bg-[#E8E5DF]/40 transition"
              data-testid="mobile-nav-testimonials"
            >
              Testimonials
            </a>
            <a
              href="/#different"
              className="py-3 px-2 rounded-lg hover:bg-[#E8E5DF]/40 transition"
              data-testid="mobile-nav-diff"
            >
              Why TheraVoca
            </a>
            <a
              href="/#faq"
              className="py-3 px-2 rounded-lg hover:bg-[#E8E5DF]/40 transition"
              data-testid="mobile-nav-faq"
            >
              FAQs
            </a>
            <a
              href="/therapists/join"
              onClick={onTherapistsClick}
              className="py-3 px-2 rounded-lg hover:bg-[#E8E5DF]/40 transition"
              data-testid="mobile-nav-therapists"
            >
              For therapists
            </a>
            <div className="border-t border-[#E8E5DF] my-2" />
            {session ? (
              <button
                onClick={handleSignOut}
                className="py-3 px-2 rounded-lg hover:bg-[#E8E5DF]/40 transition flex items-center gap-2 w-full text-left"
                data-testid="mobile-signout"
              >
                <LogOut size={14} /> Sign out
              </button>
            ) : (
              <>
                <div className="text-[10px] uppercase tracking-wider text-[#6D6A65] px-2 pt-1">
                  Sign in
                </div>
                <Link
                  to="/sign-in?role=patient"
                  className="py-3 px-2 rounded-lg hover:bg-[#E8E5DF]/40 transition flex items-baseline justify-between"
                  data-testid="mobile-signin-patient"
                >
                  <span>Patient</span>
                  <span className="text-xs text-[#6D6A65]">Track your matches</span>
                </Link>
                <Link
                  to="/sign-in?role=therapist"
                  className="py-3 px-2 rounded-lg hover:bg-[#E8E5DF]/40 transition flex items-baseline justify-between"
                  data-testid="mobile-signin-therapist"
                >
                  <span>Therapist</span>
                  <span className="text-xs text-[#6D6A65]">View referrals</span>
                </Link>
                <Link
                  to="/admin"
                  className="py-3 px-2 rounded-lg hover:bg-[#E8E5DF]/40 transition flex items-baseline justify-between"
                  data-testid="mobile-signin-admin"
                >
                  <span>Admin</span>
                  <span className="text-xs text-[#6D6A65]">Console</span>
                </Link>
              </>
            )}
            <a
              href="/#start"
              className="tv-btn-primary justify-center mt-3"
              data-testid="mobile-nav-cta"
            >
              Get matched
            </a>
          </nav>
        </div>
      )}
    </header>
  );
}

export function Footer() {
  const t = useSiteCopy();
  return (
    <footer className="border-t border-[#E8E5DF] py-12 mt-16" data-testid="site-footer">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 grid grid-cols-1 md:grid-cols-3 gap-8 text-sm text-[#6D6A65]">
        <div>
          <div className="font-serif-display text-2xl text-[#2D4A3E]">TheraVoca</div>
          <p className="mt-2 leading-relaxed">
            {t(
              "footer.tagline",
              "Let therapists come to you. We do the logistical work so you can focus on healing.",
            )}
          </p>
        </div>
        <div>
          <div className="text-[#2B2A29] font-semibold mb-2">
            {t("footer.crisis.heading", "Crisis support")}
          </div>
          <p className="leading-relaxed">
            {t(
              "footer.crisis.body",
              <>
                If you or someone you know is in crisis, please call 911 or contact the
                Suicide & Crisis Lifeline at <span className="text-[#2D4A3E] font-semibold">988</span> immediately.
              </>,
            )}
          </p>
        </div>
        <div>
          <div className="text-[#2B2A29] font-semibold mb-2">
            {t("footer.privacy.heading", "Privacy")}
          </div>
          <p className="leading-relaxed">
            {t(
              "footer.privacy.body",
              "We never share your personal information without your consent. Therapists only see anonymized referrals.",
            )}
          </p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <Link to="/terms" className="hover:text-[#2D4A3E] underline" data-testid="footer-terms">
              Terms of Use
            </Link>
            <Link to="/privacy" className="hover:text-[#2D4A3E] underline" data-testid="footer-privacy">
              Privacy Notice
            </Link>
            <Link to="/blog" className="hover:text-[#2D4A3E] underline" data-testid="footer-blog">
              Blog
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
