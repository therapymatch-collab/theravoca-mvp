# TheraVoca — Monthly Cost Breakdown

**Excludes paid-ad marketing budget.** Last updated 2026-05-18.

Three columns: where you are today (pre-launch testing), what soft-launch looks like (~100 patient intakes / month), and a growth-phase number (~1,000 patient intakes / month). Numbers are conservative — assume the higher end of each vendor's published pricing.

| Line item | Today (pre-launch) | Soft launch (~100/mo) | Growth (~1K/mo) | Notes |
|---|---|---|---|---|
| **Render web services** | $7/mo | $14/mo | $50/mo | 1 starter ($7) staging today; add prod ($7) at launch; upgrade prod to Standard ($25) when it can't sleep |
| **MongoDB Atlas** | $0 | $0–$57/mo | $57/mo | M0 free tier (512MB) is fine until you need a BAA or hit ~10K therapists; M10 ($57) is the cheapest BAA-eligible tier |
| **Anthropic Claude API** | $5–10/mo | $25–50/mo | $150–300/mo | See breakdown below — heaviest cost is research-enrichment warmup |
| **OpenAI embeddings** | ~$0 | <$1/mo | $2–5/mo | `text-embedding-3-small` @ $0.02/M tokens; T5/T2 vectors are ~500 tokens each |
| **Cloudflare Stream** | $1/mo | $1–2/mo | $5–10/mo | 5 testimonial videos stored ($5/1K min stored = ~$0.03), $1/1K min delivered |
| **Cloudflare Turnstile** | $0 | $0 | $0 | Free up to 1M challenges/mo |
| **Cloudflare DNS** | $0 | $0 | $0 | Free |
| **Resend (transactional email)** | $0 | $0 | $20/mo | Free up to 3K/mo; $20 for 50K |
| **Telnyx SMS** | $5 (pending CTIA) | $10–20/mo | $30–60/mo | $1/mo number + $4 brand + $2-15 campaign + ~$0.005/SMS US |
| **Sentry** | $0 | $0 | $26/mo | Free for 5K events; Team plan when you exceed |
| **PostHog** | $0 | $0 | $0 | Free up to 1M events; you don't capture session recording, so events stay low |
| **Stripe fees** | $0 | varies | varies | 2.9% + $0.30 per transaction — a revenue % cost, not a fixed monthly. If a therapist pays $50/mo, you net $48.25 |
| **Domain (theravoca.com)** | $1/mo | $1/mo | $1/mo | ~$12/yr at the registrar |
| **GitHub (private repo)** | $0 | $0 | $0 | Free for private repos |
| **Anthropic Console + monitoring** | $0 | $0 | $0 | Free tooling |
| **TOTAL (excl. Stripe %)** | **~$20/mo** | **~$50–145/mo** | **~$340–510/mo** | |

---

## Detailed per-vendor notes

### Render ($7–$50/mo)

- **Today**: 1 staging service on Starter ($7/mo, 512MB RAM, sleeps after 15 min of inactivity).
- **Soft launch**: stand up the prod service on Starter ($7/mo). Two services = $14/mo. The sleep behavior is OK if you accept ~30s cold-start on the first hit after a quiet window.
- **Growth**: upgrade prod to Standard ($25/mo, 2GB RAM, no sleep) once you can't afford the cold-start. Total $32/mo (staging Starter + prod Standard). Eventually a Pro plan ($85/mo) if matching gets CPU-heavy.

### MongoDB Atlas ($0–$57/mo)

- **Today**: M0 free tier (shared cluster, 512MB storage) — plenty for testing.
- **Soft launch trigger**: hit M0 storage cap (~30K request docs at current size), or you need a Business Associate Agreement.
- **M10 ($57/mo)**: dedicated cluster, 10GB storage, BAA-eligible. The cheapest tier Atlas will sign a BAA on.
- **Note**: per the attorney verdict you don't need a BAA TODAY (TheraVoca isn't a BA), but if you ever build features that move clinical data, this is the upgrade you'd make first.

### Anthropic Claude API ($5–$300/mo)

Three workloads, very different cost profiles:

1. **Research enrichment** (Sonnet 4.5, $3/M input + $15/M output). Each therapist warmup is ~30 seconds of LLM work, ~5K input + 1K output tokens × 3-4 calls = roughly **$0.08–$0.12 per therapist warmup**. Cached for 30 days, so each therapist costs about $0.10/mo. 50 therapists ≈ $5/mo, 500 ≈ $50/mo.
2. **AI bio drafter** (Haiku 4.5, $1/M input + $5/M output). Tiny prompt + tiny output, ~$0.005 per draft. Even at 100 drafts/mo = $0.50.
3. **Moderation reasoning** (Haiku 4.5). Currently embedded in intake submission; bumps a few cents per intake.

**Today** is mostly the research warmup running ad-hoc when you click the admin button. **Growth** assumes ~500 active therapists with fresh research caches refreshing on a 30-day cycle, plus a few thousand bio drafts and moderation runs.

### OpenAI embeddings (~$0–$5/mo)

`text-embedding-3-small` at $0.02 per million tokens. Each therapist's T5+T2 embedding is ~1K tokens = $0.00002. Each patient's intake open-text is ~500 tokens = $0.00001. Even at 10K therapists and 10K patients/mo, total spend is under $1.

### Cloudflare Stream ($1–$10/mo)

- **Storage**: 5 testimonial videos × ~1 min each = 5 min stored × $5/1000 min = $0.03/mo. Trivial.
- **Delivery**: $1 per 1,000 minutes of video served. 1K landing-page visitors × 1 min watched = 1K min = $1. At 10K visitors/mo = $10.

### Resend (email)

- Free: 100/day, 3K/mo, 1 domain. Pre-launch and soft-launch fit easily.
- $20/mo: 50K emails/mo + 10 domains. Probably your bill at the "growth" tier (3 patients × 3 therapist emails per match round + admin notifications + therapist signup confirmations + drip campaigns).

### Telnyx SMS ($5–$60/mo)

- **One-time** (already paid): A2P 10DLC Brand registration ~$4.
- **Monthly fixed**: number rental ~$1, brand fee ~$2, campaign vetting fee $1.50–$15 depending on tier (Standard tier is $10/mo).
- **Per-message**: ~$0.005 US outbound SMS.
- **Today**: pending CTIA approval — you're paying the brand + number fees but nothing flowing.
- **Soft launch**: assume 2-3 SMS per patient match round (therapist alerts) + therapist confirmations. 100 patients × ~5 SMS each = 500 SMS = $2.50, plus fixed = ~$15-20.
- **Growth**: 1K patients × ~5 SMS = 5K SMS = $25, plus fixed = ~$35-50.

### Sentry

- Free: 5K errors/mo + 10K spans + 1 user. Generous; pre-launch and soft-launch fit.
- Team $26/mo: 50K events + 5 users. Hit this when you have real traffic + a real team.

### PostHog

- Free: 1M events/mo, 1M session recordings/mo. You explicitly **disable session recording** per the HIPAA scope-out, so your events are just pageviews + custom events. Free tier indefinitely unless you ship analytics-heavy admin instrumentation.

### Stripe

- **2.9% + $0.30 per successful charge** (US cards). This is a **percentage cost on revenue, not a fixed monthly bill**.
- Example: 50 therapists × $50/mo subscription = $2,500 gross → ~$87.50 in Stripe fees + $15 in transaction-count fees = ~$102/mo. So at growth-phase revenue, Stripe takes ~4% off the top.
- **Not in the table above** because it scales with revenue, not infrastructure.

### Domain

- `theravoca.com` at your registrar — ~$12/yr ≈ $1/mo amortized.

### GitHub

- Private repo on Free tier — fine. Only upgrade if you need org SSO or build minutes for CI beyond the free quota.

---

## Sanity checks

- **The big mover from soft-launch → growth is Render + Claude**, not bandwidth or storage. If you stay on M0 + don't trigger weekly research-cache refreshes, growth-phase totals can stay under $200/mo.
- **Telnyx is the most "weird" cost line** because of the fixed brand/campaign fees that exist before any SMS flows. Once CTIA approves, the per-message cost is negligible compared to the fixed monthly.
- **Anthropic cost discipline**: the research-enrichment warmup is the only place where a single click can spend $5–$20. Everything else is per-request and small.
- **You're not paying for**: a CDN (Render serves the static build directly), a queue (in-process asyncio is fine at this scale), a search index (Mongo aggregations handle matching), or any vendor BAA today.

## When to revisit

- When you sign your first BAA (triggers MongoDB M10 minimum).
- When research-enrichment spend exceeds $100/mo (worth caching more aggressively or downgrading some workloads to Haiku).
- When Render cold-start latency becomes a complaint (upgrade prod to Standard).
- When you cross 50 paying therapists (revisit Resend pricing tier + Telnyx campaign tier).
