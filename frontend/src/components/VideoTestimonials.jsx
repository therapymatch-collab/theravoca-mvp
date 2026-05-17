/**
 * VideoTestimonials -- horizontal carousel of patient testimonials.
 *
 * 2026-05-17: switched from self-hosted mp4s to YouTube embeds with a
 * click-to-load wrapper pattern (a.k.a. "lite-youtube-embed"). The
 * idle state shows OUR poster image + a custom TheraVoca play
 * button -- no YouTube chrome at all until the user clicks. On
 * click, the iframe is mounted with autoplay=1 and the most
 * branding-stripped params YouTube allows.
 *
 * Why this pattern:
 *   - Original poster image == fully branded TheraVoca look,
 *     no YouTube default thumbnail or play button.
 *   - Iframe doesn't fetch from YouTube at all until clicked --
 *     so all 5 cards on the landing page don't fire 5 YouTube
 *     requests on mount (faster initial paint, fewer cookies, no
 *     YouTube tracking until consent).
 *   - When playing: YouTube's "watch on YouTube" link, the YT
 *     logo bottom-right, and the kebab menu still appear because
 *     YouTube's TOS doesn't let embedders hide those entirely.
 *     But the relentless related-videos carousel + the channel
 *     name + the title overlay are killed by rel=0 + iv_load_policy=3
 *     + the autoplay flag.
 *
 * For testimonials where the source video is 16:9 (like DA) vs
 * vertical Shorts (the rest), the player will letterbox the
 * horizontal video inside our 9:16 card during playback. That's a
 * content-format issue, not something an embed param can fix; Josh
 * would need to re-export DA as a vertical Short for it to fill
 * the card.
 */
import { useRef, useState } from "react";
import { Play, ChevronLeft, ChevronRight } from "lucide-react";
import useSiteCopy from "@/lib/useSiteCopy";
import GetMatchedCTA from "@/components/GetMatchedCTA";

// Mapping fix 2026-05-17 (Josh caught the swap):
//   DB <- Syxb4zJdyrI (was on AS slot)
//   AS <- nDzeVwuwVO0 (was on NN slot)
//   NN <- kN7mKqGyhMU (was on DB slot)
// WZ + DA unchanged.
const TESTIMONIALS = [
  {
    id: "wz",
    name: "W.Z., Age 25",
    youtubeId: "aXa8uSqMT3U",
    poster: "https://theravoca.com/wp-content/uploads/W.Z.-age-25.png",
  },
  {
    id: "da",
    name: "D.A., Age 43",
    youtubeId: "iZFO6NRYPOw",
    poster: "https://theravoca.com/wp-content/uploads/photo_2025-05-09_20-35-16.jpg",
  },
  {
    id: "db",
    name: "D.B., Age 52",
    youtubeId: "Syxb4zJdyrI",
    poster: "https://theravoca.com/wp-content/uploads/DB-2.png",
  },
  {
    id: "as",
    name: "A.S., Age 32",
    youtubeId: "nDzeVwuwVO0",
    poster:
      "https://theravoca.com/wp-content/uploads/Capture-decran-2025-05-23-014536.png",
  },
  {
    id: "nn",
    name: "N.N., Age 31",
    youtubeId: "kN7mKqGyhMU",
    poster: "https://theravoca.com/wp-content/uploads/N.N.-age-34.png",
  },
];

function buildEmbedUrl(videoId, { autoplay = false } = {}) {
  // Minimum-branding params YouTube respects:
  //   modestbranding=1   : reduce YouTube logo in player chrome
  //   rel=0              : no related-videos carousel from OTHER
  //                        channels at end of playback (only the
  //                        same channel's videos can still appear,
  //                        per YT policy change)
  //   playsinline=1      : iOS plays inline, not native fullscreen
  //   iv_load_policy=3   : hide annotations / video cards
  //   fs=1               : keep fullscreen button (most users expect it)
  //   controls=1         : keep play/pause/seek controls (UX)
  //   autoplay=1         : start playing as soon as iframe mounts
  //                        (only set when user clicked our overlay
  //                        so it counts as a user-initiated play
  //                        and browser autoplay-blockers don't fire)
  const params = new URLSearchParams({
    modestbranding: "1",
    rel: "0",
    playsinline: "1",
    iv_load_policy: "3",
    fs: "1",
    controls: "1",
  });
  if (autoplay) params.set("autoplay", "1");
  return `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`;
}

function TestimonialCard({ tt }) {
  // Local state per card: only mount the iframe once the user clicks
  // play. Until then, render OUR poster + OUR play button -- no
  // YouTube chrome on the page at all.
  const [active, setActive] = useState(false);
  return (
    <article
      className="shrink-0 w-[78%] sm:w-[44%] lg:w-[30%] snap-center bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden"
      data-testid={`testimonial-card-${tt.id}`}
    >
      <div className="aspect-[9/16] bg-[#0F1714] relative">
        {active ? (
          <iframe
            src={buildEmbedUrl(tt.youtubeId, { autoplay: true })}
            title={`Testimonial: ${tt.name}`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            className="w-full h-full"
            data-testid={`testimonial-video-${tt.id}`}
          />
        ) : (
          <button
            type="button"
            onClick={() => setActive(true)}
            aria-label={`Play testimonial from ${tt.name}`}
            className="absolute inset-0 w-full h-full group"
            data-testid={`testimonial-play-${tt.id}`}
          >
            {tt.poster && (
              <img
                src={tt.poster}
                alt=""
                aria-hidden="true"
                loading="lazy"
                className="w-full h-full object-cover"
              />
            )}
            <span
              className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/15 transition"
            >
              <span className="bg-white/95 group-hover:bg-white rounded-full w-16 h-16 flex items-center justify-center shadow-lg transition">
                <Play
                  size={28}
                  className="text-[#2D4A3E] ml-1"
                  fill="currentColor"
                />
              </span>
            </span>
          </button>
        )}
      </div>
      <div className="px-5 py-4">
        <div className="text-[#2D4A3E] font-serif-display text-lg">
          {tt.name}
        </div>
      </div>
    </article>
  );
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
              <TestimonialCard key={tt.id} tt={tt} />
            ))}
          </div>
        </div>
        <GetMatchedCTA id="testimonials-cta" copyKey="cta.testimonials" />
      </div>
    </section>
  );
}
