import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Th } from "./_shared";

export default function BlogAdminPanel({ client }) {
  const [posts, setPosts] = useState(null);
  const [editing, setEditing] = useState(null); // null | "new" | post
  const [form, setForm] = useState({
    title: "",
    slug: "",
    summary: "",
    body_markdown: "",
    hero_image_url: "",
    published: false,
  });
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await client.get("/admin/blog");
        if (alive) setPosts(r.data.posts || []);
      } catch (e) {
        toast.error(
          e?.response?.data?.detail || e.message || "Failed to load posts",
        );
        if (alive) setPosts([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [client, reload]);

  const startNew = () => {
    setEditing("new");
    setForm({
      title: "",
      slug: "",
      summary: "",
      body_markdown: "",
      hero_image_url: "",
      published: false,
    });
  };

  const startEdit = (p) => {
    setEditing(p);
    setForm({
      title: p.title || "",
      slug: p.slug || "",
      summary: p.summary || "",
      body_markdown: p.body_markdown || "",
      hero_image_url: p.hero_image_url || "",
      published: !!p.published,
    });
  };

  const cancel = () => setEditing(null);

  const save = async () => {
    if (!form.title.trim()) {
      toast.error("Title is required");
      return;
    }
    setSaving(true);
    try {
      if (editing === "new") {
        await client.post("/admin/blog", form);
        toast.success("Post created");
      } else {
        await client.put(`/admin/blog/${editing.id}`, form);
        toast.success("Post updated");
      }
      setEditing(null);
      setReload((n) => n + 1);
    } catch (e) {
      toast.error(
        e?.response?.data?.detail || e.message || "Save failed",
      );
    } finally {
      setSaving(false);
    }
  };

  const togglePublish = async (p) => {
    try {
      await client.put(`/admin/blog/${p.id}`, { published: !p.published });
      toast.success(p.published ? "Unpublished" : "Published");
      setReload((n) => n + 1);
    } catch (e) {
      toast.error(e?.response?.data?.detail || e.message || "Update failed");
    }
  };

  const remove = async (p) => {
    if (!window.confirm(`Delete "${p.title}"? This cannot be undone.`)) return;
    try {
      await client.delete(`/admin/blog/${p.id}`);
      toast.success("Post deleted");
      setReload((n) => n + 1);
    } catch (e) {
      toast.error(e?.response?.data?.detail || e.message || "Delete failed");
    }
  };

  return (
    <div className="mt-6 space-y-4" data-testid="blog-admin-panel">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-serif-display text-2xl text-[#2D4A3E]">
            Blog posts
          </h3>
          <p className="text-sm text-[#6D6A65]">
            Markdown-based posts that appear at <code>/blog</code>.
          </p>
        </div>
        <button
          type="button"
          className="tv-btn-primary !py-2 !px-4 text-sm"
          onClick={startNew}
          data-testid="blog-new-btn"
        >
          + New post
        </button>
      </div>

      {editing && (
        <div
          className="bg-white border border-[#E8E5DF] rounded-2xl p-6 space-y-3"
          data-testid="blog-editor"
        >
          <div className="text-xs uppercase tracking-wider text-[#C87965]">
            {editing === "new" ? "New post" : `Editing — ${editing.title}`}
          </div>
          <div>
            <label className="text-xs text-[#6D6A65]">Title *</label>
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              data-testid="blog-title-input"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[#6D6A65]">
                Slug{" "}
                <span className="text-[#9A938A]">(auto-generated if blank)</span>
              </label>
              <Input
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                placeholder="auto-from-title"
                data-testid="blog-slug-input"
              />
            </div>
            <div>
              <label className="text-xs text-[#6D6A65]">Hero image URL</label>
              <Input
                value={form.hero_image_url}
                onChange={(e) =>
                  setForm({ ...form, hero_image_url: e.target.value })
                }
                placeholder="https://…"
                data-testid="blog-hero-input"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-[#6D6A65]">Summary</label>
            <Textarea
              rows={2}
              value={form.summary}
              onChange={(e) => setForm({ ...form, summary: e.target.value })}
              placeholder="One-sentence teaser shown on the listing page"
              data-testid="blog-summary-input"
            />
          </div>
          <div>
            <label className="text-xs text-[#6D6A65]">Body (Markdown)</label>
            <Textarea
              rows={14}
              value={form.body_markdown}
              onChange={(e) =>
                setForm({ ...form, body_markdown: e.target.value })
              }
              placeholder="Write the post body using Markdown…"
              className="font-mono text-sm"
              data-testid="blog-body-input"
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="blog-published"
              checked={form.published}
              onCheckedChange={(c) =>
                setForm({ ...form, published: c === true })
              }
              data-testid="blog-publish-checkbox"
            />
            <label
              htmlFor="blog-published"
              className="text-sm text-[#2B2A29] cursor-pointer"
            >
              Published (visible at <code>/blog</code>)
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-[#E8E5DF]">
            <button
              type="button"
              className="tv-btn-secondary !py-2 !px-4 text-sm"
              onClick={cancel}
              disabled={saving}
              data-testid="blog-cancel-btn"
            >
              Cancel
            </button>
            <button
              type="button"
              className="tv-btn-primary !py-2 !px-4 text-sm disabled:opacity-50"
              onClick={save}
              disabled={saving || !form.title.trim()}
              data-testid="blog-save-btn"
            >
              {saving ? (
                <Loader2 size={14} className="inline mr-1.5 animate-spin" />
              ) : null}
              {editing === "new" ? "Create post" : "Save changes"}
            </button>
          </div>
        </div>
      )}

      {posts == null ? (
        <div className="bg-white border border-[#E8E5DF] rounded-2xl p-12 text-center text-[#6D6A65]">
          <Loader2 className="animate-spin mx-auto mb-3 text-[#2D4A3E]" />
          Loading posts…
        </div>
      ) : posts.length === 0 ? (
        <div className="bg-white border border-[#E8E5DF] rounded-2xl p-12 text-center text-[#6D6A65]">
          No posts yet. Click <strong>+ New post</strong> to get started.
        </div>
      ) : (
        <div className="bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#FDFBF7] text-[#6D6A65] border-b border-[#E8E5DF]">
              <tr>
                <Th>Title</Th>
                <Th>Slug</Th>
                <Th>Status</Th>
                <Th>Updated</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {posts.map((p) => (
                <tr
                  key={p.id}
                  className="border-b border-[#E8E5DF] last:border-0"
                  data-testid={`blog-row-${p.slug}`}
                >
                  <td className="p-4 text-[#2B2A29]">{p.title}</td>
                  <td className="p-4 text-[#6D6A65]">
                    <code>/blog/{p.slug}</code>
                  </td>
                  <td className="p-4">
                    {p.published ? (
                      <span className="text-xs bg-[#2D4A3E] text-white rounded-full px-2 py-1">
                        Published
                      </span>
                    ) : (
                      <span className="text-xs bg-[#E8E5DF] text-[#6D6A65] rounded-full px-2 py-1">
                        Draft
                      </span>
                    )}
                  </td>
                  <td className="p-4 text-[#6D6A65] text-xs">
                    {p.updated_at ? new Date(p.updated_at).toLocaleString() : "—"}
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => startEdit(p)}
                        className="text-[#2D4A3E] hover:underline text-sm inline-flex items-center gap-1"
                        data-testid={`blog-edit-${p.slug}`}
                      >
                        <Pencil size={12} /> Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => togglePublish(p)}
                        className="text-[#2D4A3E] hover:underline text-sm"
                        data-testid={`blog-toggle-${p.slug}`}
                      >
                        {p.published ? "Unpublish" : "Publish"}
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(p)}
                        className="text-[#D45D5D] hover:underline text-sm inline-flex items-center gap-1"
                        data-testid={`blog-delete-${p.slug}`}
                      >
                        <Trash2 size={12} /> Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
