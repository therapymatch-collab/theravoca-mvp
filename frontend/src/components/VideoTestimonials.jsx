/**
 * VideoTestimonials -- horizontal carousel of patient testimonials.
 *
 * 2026-05-18: switched from YouTube embeds to Cloudflare Stream.
 * Why the switch:
 *   - YouTube's anti-bot challenge ("Sign in to confirm you're not a
 *     bot") started blocking 2-3 of our 5 embedded Shorts at random,
 *     leaving black cards with a sign-in wall. Per YouTube's TOS we
 *     can't override or work around that challenge.
 *   - Cloudflare Stream gives us a clean iframe player with minimal
 *     branding, no anti-bot wall, and the auto-generated thumbnail
 *     replaces the WordPress-hosted poster images that were
 *     occasionally going black when wp content was slow.
 *   - One vendor (already using Cloudflare for CDN + Turnstile);
 *     Stream egress is included in the Cloudflare pricing.
 *
 * The click-to-load lite-embed pattern is unchanged:
 *   - Idle state: Stream's auto-generated thumbnail + custom TheraVoca
 *     play button overlay. Zero Cloudflare chrome on the page.
 *   - On click: mount the Stream iframe with autoplay=true. Because
 *     the iframe doesn't load on mount, all 5 cards on the landing
 *     page don't fire 5 video requests on initial paint.
 *
 * For the per-video iframe params Stream accepts, see:
 *   https://developers.cloudflare.com/stream/viewing-videos/using-the-stream-player/#player-parameters
 */
import { useEffect, useRef, useState } from "react";
import { Play, ChevronLeft, ChevronRight } from "lucide-react";
import useSiteCopy from "@/lib/useSiteCopy";
import GetMatchedCTA from "@/components/GetMatchedCTA";

// Cloudflare Stream customer subdomain -- same prefix for all 5
// videos in the account. If we ever rotate accounts this is the one
// thing to change.
const STREAM_SUBDOMAIN = "customer-ziboiiyelaua3xib.cloudflarestream.com";

// 2026-05-18 mapping (Josh's Cloudflare Stream IDs):
//   WZ -> 03866c4d063e357c24c02c35b5997fd0
//   DA -> 597bf8c80ef66d601d2dcda7c7fa17b7
//   DB -> 0ddf39bf5d745b5c057410321ba751d0
//   AS -> f46be38d78ef9d695bbd533997f5d2e1
//   NN -> d4ff1eaa1d9c4c1190584e965410403d
const TESTIMONIALS = [
  {
    id: "wz",
    name: "W.Z., Age 25",
    streamId: "03866c4d063e357c24c02c35b5997fd0",
  },
  {
    id: "da",
    name: "D.A., Age 43",
    streamId: "597bf8c80ef66d601d2dcda7c7fa17b7",
  },
  {
    id: "db",
    name: "D.B., Age 52",
    streamId: "0ddf39bf5d745b5c057410321ba751d0",
  },
  {
    id: "as",
    name: "A.S., Age 32",
    streamId: "f46be38d78ef9d695bbd533997f5d2e1",
  },
  {
    id: "nn",
    name: "N.N., Age 31",
    streamId: "d4ff1eaa1d9c4c1190584e965410403d",
  },
];

function buildEmbedUrl(streamId, { autoplay = false } = {}) {
  // Stream player params -- see Cloudflare docs link in module
  // header for the full list.
  //
  // 2026-05-18 (Josh: "make volume default on not silent") --
  // DELIBERATE NO-AUTOPLAY DESIGN. Mobile browsers (iOS Safari +
  // mobile Chrome) physically block unmuted autoplay -- no
  // workaround exists per their autoplay-restrictions policy. The
  // only way to guarantee audio-from-second-zero on every platform
  // is to skip autoplay entirely and let the user tap Cloudflare's
  // play button inside the iframe. That tap is a fresh user gesture
  // INSIDE the iframe origin, so the browser grants unmuted playback
  // and audio plays from the start on all devices.
  //
  // Cost: one extra tap on desktop too (our overlay tap loads the
  // iframe; the Cloudflare play button inside the iframe starts
  // playback). The trade is intentional -- consistent audio
  // experience beats a smoother single-tap with broken mobile
  // unmute.
  //
  // The `autoplay` arg is kept on the function signature so a
  // future change can flip back to autoplay-muted easily, but
  // today all callers pass false (or omit it).
  //
  //   muted=false       : default unmuted; the user's play tap
  //                       inside the iframe is a fresh gesture,
  //                       so the browser allows unmuted playback.
  //   preload=metadata  : only fetch the manifest until the user
  //                       hits play (lite-embed pattern handles the
  //                       page-mount case already; this controls
  //                       in-iframe behavior).
  //   poster=...        : Stream's own thumbnail URL so the player's
  //                       loading frame matches the lite-embed's
  //                       poster (no jarring color change at click).
  const params = new URLSearchParams({
    muted: "false",
    preload: "metadata",
    poster: thumbnailUrl(streamId),
  });
  if (autoplay) {
    // Reserved for future use -- mobile browsers block this combo,
    // so callers should leave autoplay false unless they're prepared
    // to layer on the autoplay-muted + tap-to-unmute UI path.
    params.set("autoplay", "true");
  }
  return `https://${STREAM_SUBDOMAIN}/${streamId}/iframe?${params.toString()}`;
}

function thumbnailUrl(streamId) {
  // Stream auto-generates a thumbnail per video; this URL is stable
  // and CDN-cached. ?time=2s nudges past the first frame so a video
  // that opens on a black-frame intro doesn't show a black poster.
  return `https://${STREAM_SUBDOMAIN}/${streamId}/thumbnails/thumbnail.jpg?time=2s`;
}

function TestimonialCard({ tt, isActive, onActivate }) {
  // 2026-05-18 (Josh: "can you control video play so only 1 video
  // plays at a time?"). `active` state lifted from per-card local
  // state to the parent <VideoTestimonials>. When the user clicks
  // card B's play overlay, the parent sets activeId="B", which
  // sets ALL OTHER cards' isActive back to false -- their iframes
  // unmount, tearing down playback. Only card B's iframe remains.
  //
  // Trade-off: clicking a different card LOSES playback position
  // on the prior one (iframe gets torn down). For 30-second
  // testimonials people don't typically resume mid-clip, so the
  // simplicity beats the polish cost of postMessage-based pause.
  return (
    <article
      className="shrink-0 w-[78%] sm:w-[44%] lg:w-[30%] snap-center bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden"
      data-testid={`testimonial-card-${tt.id}`}
    >
      <div className="aspect-[9/16] bg-[#0F1714] relative">
        {isActive ? (
          /* No autoplay -- the user taps Cloudflare's play button
             inside the iframe to start playback, which counts as a
             fresh user gesture inside the iframe origin and lets
             audio play from second 0 on every platform. See
             buildEmbedUrl() for the long-form rationale. */
          <iframe
            src={buildEmbedUrl(tt.streamId, { autoplay: false })}
            title={`Testimonial: ${tt.name}`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            className="w-full h-full"
            data-testid={`testimonial-video-${tt.id}`}
          />
        ) : (
          <button
            type="button"
            onClick={onActivate}
            aria-label={`Play testimonial from ${tt.name}`}
            className="absolute inset-0 w-full h-full group"
            data-testid={`testimonial-play-${tt.id}`}
          >
            <img
              src={thumbnailUrl(tt.streamId)}
              alt=""
              aria-hidden="true"
              loading="lazy"
              className="w-full h-full object-cover"
            />
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
  const t = useSiteCopy();
  const trackRef = useRef(null);
  // 2026-05-18: parent-level "which card is playing" state so only
  // one iframe is mounted at a time. Clicking a different card
  // unmounts the previous one, stopping its playback. null = no
  // card active (initial state -- all cards show poster + play
  // overlay).
  const [activeId, setActiveId] = useState(null);
  // Carousel arrow visibility tracks the scroll position so we don't
  // show a left chevron at scroll=0 (no videos to the left -- the
  // chevron implied content that didn't exist) or a right chevron
  // when we've reached the end. 2026-05-17: Josh caught the left
  // arrow showing on initial paint.
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return undefined;
    const update = () => {
      // 2px slop accounts for sub-pixel scroll rounding (the track can
      // sit at scrollLeft=0.4 after a smooth scroll, which would
      // otherwise still register as "can scroll left").
      const atLeftEdge = el.scrollLeft <= 2;
      const atRightEdge = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
      setCanScrollLeft(!atLeftEdge);
      setCanScrollRight(!atRightEdge);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

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
          {t("landing.testimonials.heading", "Real referrals, real relief")}
        </h2>
        <p className="text-[#6D6A65] mt-4 max-w-2xl mx-auto leading-relaxed text-center">
          {t("landing.testimonials.subhead", "Patients who tried TheraVoca speak for themselves.")}
        </p>
        <div className="relative mt-12">
          {/* Arrows hide at the edges they can't move to. Initial
              state on mount = at the LEFT edge, so the left chevron
              starts hidden -- the user shouldn't see a "scroll left"
              affordance when there's nothing to the left. As they
              scroll right, left chevron fades in; when they hit the
              right edge, right chevron fades out. */}
          {canScrollLeft && (
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label="Previous testimonial"
              className="hidden sm:flex absolute left-0 top-1/2 -translate-y-1/2 -translate-x-3 z-10 w-11 h-11 rounded-full bg-white border border-[#E8E5DF] shadow-md text-[#2D4A3E] items-center justify-center hover:bg-[#FDFBF7] transition"
              data-testid="testimonials-prev"
            >
              <ChevronLeft size={20} />
            </button>
          )}
          {canScrollRight && (
            <button
              type="button"
              onClick={() => step(1)}
              aria-label="Next testimonial"
              className="hidden sm:flex absolute right-0 top-1/2 -translate-y-1/2 translate-x-3 z-10 w-11 h-11 rounded-full bg-white border border-[#E8E5DF] shadow-md text-[#2D4A3E] items-center justify-center hover:bg-[#FDFBF7] transition"
              data-testid="testimonials-next"
            >
              <ChevronRight size={20} />
            </button>
          )}
          <div
            ref={trackRef}
            className="-mx-5 sm:-mx-8 lg:-mx-0 flex gap-5 overflow-x-auto snap-x snap-mandatory pb-5 px-5 sm:px-8 lg:px-0 tv-no-scrollbar scroll-smooth"
            data-testid="testimonials-track"
          >
            {TESTIMONIALS.map((tt) => (
              <TestimonialCard
                key={tt.id}
                tt={tt}
                isActive={activeId === tt.id}
                onActivate={() => setActiveId(tt.id)}
              />
            ))}
          </div>
        </div>
        <GetMatchedCTA id="testimonials-cta" copyKey="cta.testimonials" />
      </div>
    </section>
  );
}
