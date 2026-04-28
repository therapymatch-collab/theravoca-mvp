/**
 * VideoTestimonials — auto-renders a horizontal carousel of native HTML5
 * <video> players. We host the source MP4s on theravoca.com (the user's
 * own WordPress site) and embed them directly so they play inline on the
 * page rather than opening a new tab.
 *
 * Each card is a self-contained controlled <video>: clicking play on one
 * card pauses any other card that is currently playing so two voices
 * never overlap.
 */
import { useRef, useState, useEffect } from "react";
import { Play } from "lucide-react";

// Source URLs come from the user's own theravoca.com WordPress media library.
const TESTIMONIALS = [
  {
    id: "wz",
    name: "W.Z., Age 25",
    src: "https://theravoca.com/wp-content/uploads/W.Z..mp4",
    poster: "https://theravoca.com/wp-content/uploads/W.Z.-age-25.png",
  },
  {
    id: "da",
    name: "D.A., Age 43",
    src: "https://theravoca.com/wp-content/uploads/D.A..mp4",
    poster: "https://theravoca.com/wp-content/uploads/photo_2025-05-09_20-35-16.jpg",
  },
  {
    id: "db",
    name: "D.B., Age 52",
    src: "https://theravoca.com/wp-content/uploads/Referral_4_Cuts_GolorGrading_AudioEnhancement_Version-1.mp4",
    poster: "https://theravoca.com/wp-content/uploads/DB-2.png",
  },
  {
    id: "as",
    name: "A.S., Age 32",
    src: "https://theravoca.com/wp-content/uploads/Reerral_4-1.mp4",
    poster:
      "https://theravoca.com/wp-content/uploads/Capture-decran-2025-05-23-014536.png",
  },
  {
    id: "nn",
    name: "N.N., Age 31",
    src: "https://theravoca.com/wp-content/uploads/N.N..mp4",
    poster: "https://theravoca.com/wp-content/uploads/N.N.-age-34.png",
  },
];

export default function VideoTestimonials() {
  const refs = useRef({});
  // Track whichever video is currently playing so we can pause it when
  // another card starts.
  const [playingId, setPlayingId] = useState(null);

  useEffect(() => {
    if (!playingId) return undefined;
    Object.entries(refs.current).forEach(([id, el]) => {
      if (id !== playingId && el && !el.paused) {
        el.pause();
      }
    });
    return undefined;
  }, [playingId]);

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
        <div
          className="mt-12 -mx-5 sm:mx-0 flex sm:grid sm:grid-cols-2 lg:grid-cols-3 gap-5 overflow-x-auto sm:overflow-visible snap-x snap-mandatory pb-5 px-5 sm:px-0"
          data-testid="testimonials-track"
        >
          {TESTIMONIALS.map((t) => (
            <article
              key={t.id}
              className="shrink-0 w-[78%] sm:w-auto snap-center bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden"
              data-testid={`testimonial-card-${t.id}`}
            >
              <div className="aspect-[9/16] bg-[#0F1714] relative">
                <video
                  ref={(el) => (refs.current[t.id] = el)}
                  src={t.src}
                  poster={t.poster}
                  controls
                  preload="metadata"
                  playsInline
                  onPlay={() => setPlayingId(t.id)}
                  onPause={() => {
                    if (playingId === t.id) setPlayingId(null);
                  }}
                  className="w-full h-full object-cover"
                  data-testid={`testimonial-video-${t.id}`}
                >
                  Your browser does not support the video tag.
                </video>
                {playingId !== t.id && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="bg-white/90 rounded-full w-14 h-14 flex items-center justify-center shadow-lg">
                      <Play size={24} className="text-[#2D4A3E] ml-1" fill="currentColor" />
                    </div>
                  </div>
                )}
              </div>
              <div className="px-5 py-4">
                <div className="text-[#2D4A3E] font-serif-display text-lg">
                  {t.name}
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
