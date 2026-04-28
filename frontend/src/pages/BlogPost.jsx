/**
 * Public blog post detail. Renders the markdown body via a small in-house
 * renderer so we don't pull in a heavy dependency. Supports headings,
 * bold/italic, links, lists, blockquotes, and paragraph spacing — enough
 * for the marketing person without overwhelming them with markup choices.
 */
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Loader2, ArrowLeft } from "lucide-react";
import { Header, Footer } from "@/components/SiteShell";
import { api } from "@/lib/api";

export default function BlogPost() {
  const { slug } = useParams();
  const [post, setPost] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api
      .get(`/blog/${slug}`)
      .then((r) => setPost(r.data))
      .catch(() => setError(true));
  }, [slug]);

  if (error) {
    return (
      <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
        <Header />
        <main className="flex-1 px-5 py-16 max-w-3xl mx-auto text-center">
          <h1 className="font-serif-display text-4xl text-[#2D4A3E]">Post not found</h1>
          <p className="text-[#6D6A65] mt-3">It may have been unpublished or moved.</p>
          <Link to="/blog" className="tv-btn-primary mt-6 inline-flex">
            Back to blog
          </Link>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex flex-col">
      <Header />
      <main className="flex-1 px-5 py-12 md:py-16" data-testid="blog-post-page">
        <div className="max-w-3xl mx-auto">
          <Link
            to="/blog"
            className="text-sm text-[#6D6A65] hover:text-[#2D4A3E] inline-flex items-center gap-1.5"
            data-testid="back-to-blog"
          >
            <ArrowLeft size={14} /> All posts
          </Link>

          {!post && (
            <div className="flex justify-center py-20">
              <Loader2 className="animate-spin text-[#2D4A3E]" />
            </div>
          )}

          {post && (
            <article className="mt-6">
              {post.hero_image_url && (
                <div className="aspect-[16/7] bg-[#F2F4F0] rounded-2xl overflow-hidden mb-8">
                  <img
                    src={post.hero_image_url}
                    alt={post.title}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              <p className="text-xs uppercase tracking-[0.2em] text-[#C87965]">
                {post.published_at
                  ? new Date(post.published_at).toLocaleDateString(undefined, {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })
                  : ""}
              </p>
              <h1 className="font-serif-display text-4xl sm:text-5xl text-[#2D4A3E] mt-2 leading-tight">
                {post.title}
              </h1>
              {post.summary && (
                <p className="text-lg text-[#6D6A65] mt-4 leading-relaxed">
                  {post.summary}
                </p>
              )}
              <div
                className="mt-10 prose prose-tv max-w-none"
                data-testid="blog-body"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(post.body_markdown || "") }}
              />
            </article>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}

// Tiny safe markdown renderer. Escapes HTML first so admin authors can't
// accidentally inject markup, then converts the small markdown subset we
// actually support.
function renderMarkdown(src) {
  if (!src) return "";
  const escape = (s) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  let html = escape(src);
  // links
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-[#2D4A3E] underline">$1</a>',
  );
  // bold/italic
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  // headings
  html = html.replace(/^###\s+(.+)$/gm, '<h3 class="font-serif-display text-xl text-[#2D4A3E] mt-8 mb-3">$1</h3>');
  html = html.replace(/^##\s+(.+)$/gm, '<h2 class="font-serif-display text-2xl text-[#2D4A3E] mt-10 mb-4">$1</h2>');
  html = html.replace(/^#\s+(.+)$/gm, '<h1 class="font-serif-display text-3xl text-[#2D4A3E] mt-10 mb-4">$1</h1>');
  // blockquote
  html = html.replace(
    /^&gt;\s+(.+)$/gm,
    '<blockquote class="border-l-4 border-[#C87965] pl-4 italic text-[#6D6A65] my-4">$1</blockquote>',
  );
  // unordered lists
  html = html.replace(/(?:^[-*]\s+.+(?:\n|$))+?/gm, (block) => {
    const items = block
      .trim()
      .split(/\n/)
      .map((l) => l.replace(/^[-*]\s+/, "").trim())
      .filter(Boolean)
      .map((l) => `<li>${l}</li>`)
      .join("");
    return `<ul class="list-disc pl-6 my-4 space-y-1.5 text-[#2B2A29]">${items}</ul>`;
  });
  // paragraphs (collapse runs of remaining text separated by blank lines)
  html = html
    .split(/\n{2,}/)
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      if (
        trimmed.startsWith("<h") ||
        trimmed.startsWith("<ul") ||
        trimmed.startsWith("<blockquote")
      ) {
        return trimmed;
      }
      return `<p class="text-[#2B2A29] leading-relaxed my-4">${trimmed.replace(/\n/g, "<br/>")}</p>`;
    })
    .join("\n");
  return html;
}
