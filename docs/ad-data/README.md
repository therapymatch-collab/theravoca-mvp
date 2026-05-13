# Ad Data Drop Zone

Drop your CSV exports from Google Ads, Meta, and TikTok in the
respective subfolders. Naming convention: anything goes; I'll figure
it out from the file content. Helpful to put the date range in the
filename when you can (e.g., `google-campaigns-2025-08-to-2025-10.csv`).

This folder is gitignored (the data may contain audience targeting,
ad spend, and other sensitive specifics). Files here stay on your
laptop unless you choose to commit them.

---

## What to export from each platform

### Google Ads (`google/`)

Sign in -> top right, click **Reports** -> **Predefined reports**.
Set the date range to cover the full campaign period. For each report
below, click the report, then top-right **Download** -> **CSV (.csv)**.

Required:

1. **Campaigns** -> "Campaign performance"
   - Filename suggestion: `campaigns.csv`
2. **Performance** -> "Ad performance"
   - Filename suggestion: `ads.csv`
3. **Search terms** -> "Search terms" (this shows the actual phrases
   people typed, not the keywords you bid on -- huge for finding what
   intent converted)
   - Filename suggestion: `search-terms.csv`

Nice-to-have if you have the time:

4. **Predefined reports** -> "Time" -> "Day" (campaign x day grid for
   trend analysis)
   - Filename suggestion: `daily.csv`
5. **Predefined reports** -> "Geographic" -> "User locations"
   - Filename suggestion: `geo.csv`

### Meta / Facebook Ads (`meta/`)

Ads Manager (business.facebook.com/adsmanager). Top right calendar ->
set the full campaign date range. Then:

1. Click **Reports** -> **Create custom report** (or "Export table data")
2. Breakdown by: **Campaign**, then **Ad set**, then **Ad** (export each
   as a separate file)
3. Columns to include (paste these in if the column picker asks):
   - Spend
   - Impressions
   - Reach
   - Frequency
   - CPM
   - Clicks (link clicks)
   - CTR (link click-through rate)
   - CPC (cost per link click)
   - Results (whatever the conversion event was -- intake submit)
   - Cost per result
   - Conversion rate

Filenames:
- `campaigns.csv`
- `adsets.csv`
- `ads.csv`

Nice-to-have:
- Demographic breakdown (Age + Gender)
- Geographic breakdown (Region / DMA)
- Time breakdown (by day)

### TikTok Ads (`tiktok/`)

TikTok Ads Manager (ads.tiktok.com). Top right calendar -> full
campaign date range. Then:

1. **Campaign** view -> top right **Export** -> CSV
   - Filename: `campaigns.csv`
2. **Ad Group** view -> Export -> CSV
   - Filename: `adgroups.csv`
3. **Ad** view -> Export -> CSV (include creative names where possible)
   - Filename: `ads.csv`

Columns wanted (same logic as Meta): Spend, Impressions, CPM, Clicks,
CTR, CPC, Conversions (intake completes), CPA / Cost per conversion.

---

## What I'll do with this data

Once you say the folder is populated, I'll:

1. Read every CSV and normalize them into a single comparable shape.
2. Compute per-platform totals: spend, impressions, clicks, intakes,
   blended CPA.
3. Rank campaigns + ad sets + ads within each platform by CPA.
4. Look for creative themes that won (where ad names / copy are in
   the export).
5. Surface time-trend patterns (did things improve as the algorithm
   learned, or fatigue in?).
6. Write a short analysis doc with: what worked, what didn't, and
   3-5 concrete iteration recommendations tied to the current Idaho-
   only launch plan.

Output goes to `docs/AD-ANALYSIS-{date}.md`.

---

## Sensitive content warning

CSV exports from ad platforms may contain:

- Spend figures (financial)
- Audience targeting definitions
- Ad creative copy
- Conversion volumes
- In some cases, hashed customer-match audience identifiers

This folder is gitignored. If you commit these by accident, the data
becomes part of git history and is hard to fully remove. Double-check
`git status` before any commit while these files are present.
