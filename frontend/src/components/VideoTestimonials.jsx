/**
 * VideoTestimonials -- horizontal carousel of YouTube-hosted patient
 * testimonials.
 *
 * 2026-05-17: switched from self-hosted mp4s to YouTube embeds.
 *
 * Why YouTube:
 *   - Adaptive bitrate handled by YouTube (mobile gets low-bandwidth
 *     variant, desktop gets HD) -- no manual encoding.
 *   - No git bloat from raw mp4s in the repo.
 *   - Works on both theravoca.com (old WP site) and the new React app
 *     -- just embed the same iframe.
 *
 * Privacy: using `youtube-nocookie.com` domain (the "Enhanced privacy
 * mode" variant) so YouTube doesn't drop tracking cookies until the
 * user actually clicks play. Better GDPR / HIPAA-adjacent hygiene
 * for a healthcare site.
 *
 * Lazy-loading: iframes use `loading="lazy"` so they don't fire
 * network requests until scrolled into view -- otherwise rendering
 * 5 iframes on landing-page mount would balloon the initial page
 * payload.
 *
 * Pause-others logic from the old <video>-based version is dropped:
 * the YouTube iframe API would let us programmatically pause other
 * players, but it adds the iframe-API JS to the page just to handle
 * the rare case of two videos playing at once. Acceptable to let
 * the user manually pause one before starting another.
 */
import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import useSiteCopy from "@/lib/useSiteCopy";
import GetMatchedCTA from "@/components/GetMatchedCTA";

// Each entry's `youtubeId` is the 11-char video ID from the share URL.
// Shorts URLs (`https://youtube.com/shorts/{id}`) and standard URLs
// (`https://youtu.be/{id}` or `https://youtube.com/watch?v={id}`) all
// use the same embed pattern.
const TESTIMONIALS = [
  { id: "wz", name: "W.Z., Age 25", youtubeId: "aXa8uSqMT3U" },
  { id: "da", name: "D.A., Age 43", youtubeId: "iZFO6NRYPOw" },
  { id: "db", name: "D.B., Age 52", youtubeId: "kN7mKqGyhMU" },
  { id: "as", name: "A.S., Age 32", youtubeId: "Syxb4zJdyrI" },
  { id: "nn", name: "N.N., Age 31", youtubeId: "nDzeVwuwVO0" },
];

function buildEmbedUrl(videoId) {
  // modestbranding=1 reduces (but no longer fully removes) the YouTube
  // logo in the player chrome. rel=0 prevents related videos from other
  // channels showing at end of playback. playsinline=1 plays inline on
  // iOS Safari instead of forcing the native full-screen player.
  const params = new URLSearchParams({
    modestbranding: "1",
    rel: "0",
    playsinline: "1",
  });
  return `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`;
}

export default function VideoTestimonials() {
  // useSiteCopy hook left in even though no copy keys are currently
  // wired -- pattern is consistent with other landing-page sections
  // and admins can later swap the section headline via the copy editor.
  // eslint-disable-next-line no-unused-vars
  const t = useSiteCopy();
  const trackRef = useRef(null);

  // Step the carousel by exactly one card so the arrows feel natural
  // even when fractional cards are visible (mobile).
  const step = (dir) => {
    const el = trackRef.current;
    if (!el) return;
    const cardWidth = el.firstElementChild?.getBoundingClientRect().width || 320;
    el.scrollBy({ left: dir * (cardWidth + 20), behavior: "smooth" });
  };

  return (
    <section
      className="py-20 md:py-28 bg-[#F7F4ED]"
      id="testimonials"
      data-testid="video-testimonials-section"
    >
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <p className="text-xs uppercase tracking-[0.25em] text-[#C87965] text-center">
          From the people we've matched
        </p>
        <h2 className="font-serif-display text-4xl sm:text-5xl text-[#2D4A3E] leading-tight text-center mt-3">
          Real referrals, real relief
        </h2>
        <p className="text-[#6D6A65] mt-4 max-w-2xl mx-auto leading-relaxed text-center">
          Patients who tried TheraVoca speak for themselves.
        </p>
        <div className="relative mt-12">
          {/* Arrow controls -- visible only on screens wide enough for them
              to feel useful (>= sm). On mobile the user just swipes. */}
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label="Previous testimonial"
            className="hidden sm:flex absolute left-0 top-1/2 -translate-y-1/2 -translate-x-3 z-10 w-11 h-11 rounded-full bg-white border border-[#E8E5DF] shadow-md text-[#2D4A3E] items-center justify-center hover:bg-[#FDFBF7] transition"
            data-testid="testimonials-prev"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label="Next testimonial"
            className="hidden sm:flex absolute right-0 top-1/2 -translate-y-1/2 translate-x-3 z-10 w-11 h-11 rounded-full bg-white border border-[#E8E5DF] shadow-md text-[#2D4A3E] items-center justify-center hover:bg-[#FDFBF7] transition"
            data-testid="testimonials-next"
          >
            <ChevronRight size={20} />
          </button>
          <div
            ref={trackRef}
            className="-mx-5 sm:-mx-8 lg:-mx-0 flex gap-5 overflow-x-auto snap-x snap-mandatory pb-5 px-5 sm:px-8 lg:px-0 tv-no-scrollbar scroll-smooth"
            data-testid="testimonials-track"
          >
          {TESTIMONIALS.map((tt) => (
            <article
              key={tt.id}
              className="shrink-0 w-[78%] sm:w-[44%] lg:w-[30%] snap-center bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden"
              data-testid={`testimonial-card-${tt.id}`}
            >
              <div className="aspect-[9/16] bg-[#0F1714] relative">
                <iframe
                  src={buildEmbedUrl(tt.youtubeId)}
                  title={`Testimonial: ${tt.name}`}
                  loading="lazy"
                  allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  className="w-full h-full"
                  data-testid={`testimonial-video-${tt.id}`}
                />
              </div>
              <div className="px-5 py-4">
                <div className="text-[#2D4A3E] font-serif-display text-lg">
                  {tt.name}
                </div>
              </div>
            </article>
          ))}
          </div>
        </div>
        <GetMatchedCTA id="testimonials-cta" copyKey="cta.testimonials" />
      </div>
    </section>
  );
}
