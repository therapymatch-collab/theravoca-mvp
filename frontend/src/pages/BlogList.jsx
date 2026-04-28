/**
 * Public blog index — lists every published post, newest first. Each card
 * links to /blog/:slug for the detail view. The marketing person manages
 * posts entirely through the admin "Blog" tab.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, ArrowRight } from "lucide-react";
import { Header, Footer } from "@/components/SiteShell";
import { api } from "@/lib/api";

export default function BlogList() {
  const [posts, setPosts] = useState(null);

  useEffect(() => {
    api
      .get("/blog")
      .then((r) => setPosts(r.data?.posts || []))
      .catch(() => setPosts([]));
  }, []);

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <Header />
      <main className="flex-1 px-5 py-12 md:py-16" data-testid="blog-list-page">
        <div className="max-w-4xl mx-auto">
          <p className="text-xs uppercase tracking-[0.2em] text-[#C87965]">
            Stories & insights
          </p>
          <h1 className="font-serif-display text-4xl sm:text-5xl text-[#2D4A3E] mt-2 leading-tight">
            The TheraVoca blog
          </h1>
          <p className="text-[#6D6A65] mt-3 max-w-2xl leading-relaxed">
            Notes from our team, conversations with clinicians, and answers to
            the questions people ask us most.
          </p>

          {posts === null && (
            <div className="flex justify-center py-20">
              <Loader2 className="animate-spin text-[#2D4A3E]" />
            </div>
          )}

          {posts?.length === 0 && (
            <div
              className="mt-10 bg-white border border-[#E8E5DF] rounded-2xl p-12 text-center text-[#6D6A65]"
              data-testid="blog-empty"
            >
              No posts yet — check back soon.
            </div>
          )}

          {posts?.length > 0 && (
            <div className="mt-10 grid gap-5">
              {posts.map((p) => (
                <Link
                  key={p.id}
                  to={`/blog/${p.slug}`}
                  className="block bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden hover:-translate-y-0.5 transition"
                  data-testid={`blog-card-${p.slug}`}
                >
                  {p.hero_image_url && (
                    <div className="aspect-[16/7] bg-[#F2F4F0] overflow-hidden">
                      <img
                        src={p.hero_image_url}
                        alt={p.title}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                  <div className="p-6">
                    <div className="text-xs text-[#6D6A65]">
                      {p.published_at
                        ? new Date(p.published_at).toLocaleDateString(undefined, {
                            month: "long",
                            day: "numeric",
                            year: "numeric",
                          })
                        : ""}
                    </div>
                    <h2 className="font-serif-display text-2xl text-[#2D4A3E] mt-1.5 leading-tight">
                      {p.title}
                    </h2>
                    {p.summary && (
                      <p className="text-[#6D6A65] mt-2 leading-relaxed line-clamp-2">
                        {p.summary}
                      </p>
                    )}
                    <span className="inline-flex items-center gap-1 text-sm text-[#2D4A3E] mt-3">
                      Read post <ArrowRight size={14} />
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
