# Admin Console Declutter Proposal

**Date:** 2026-05-13
**Status:** Draft proposal — needs your UX judgment before I execute
**Backlog ref:** BACKLOG.md NEW (Admin console UI re-org / declutter)

The 2026-05-12 reorg got the admin console most of the way there:
5 primary tabs (Inbox / Directory / Outcomes / Content / Operations)
+ Master Query in a modal + Test buttons consolidated in Testing.
This doc proposes the **remaining** declutter moves, ordered low-risk
to high-risk so you can pick what's worth my time.

---

## Current state inventory

8 primary tabs (1 dev-only). 32 sub-tabs total.

| Primary tab | Subs | Status |
|---|---|---|
| **Requests** | Active, Analytics | 2 — clean |
| **Directory** | Pending therapists, All providers, Profile completion, Patients (by email), Coverage gaps, Opt-outs | 6 — fine |
| **Recruiting** | Per request, General gap-fill, All outreach, How recruiting works | 4 — "How recruiting works" is reference content masquerading as a tab |
| **Outbound** | Recent | 1 — single-pill primary, sub-row already hidden as of today |
| **Outcomes** | Overview | 1 — single-pill primary, sub-row hidden |
| **Content** | Blog, FAQs, Site copy, How it works, Email templates | 5 — "How it works" is reference content masquerading as a tab |
| **Operations** | Team, Settings, Matching, Invites, Referral sources, Waitlist, Audit log, Scrape sources | **8 — the busiest cluster** |
| **Testing** (dev-only) | Test actions, Profile audit, Matching simulator, Feedback test tools, Scraper test, SMS status | 6 — dev-only, low priority |

---

## Already shipped this session (no decision needed)

- ✅ **Single-sub primary tabs hide their sub-pill row.** Was hardcoded
  for Outcomes; now generalized so Outbound (and any future single-sub
  primary) gets the same treatment.

---

## Tier 1 — Low risk, high signal (do whenever)

### 1a. Move "How recruiting works" out of sub-tab row
- **Why:** It's static reference content explaining the recruiting
  flow. Doesn't share state with the other sub-tabs. Steals visual
  weight.
- **How:** Replace with a small "(?)" icon next to the "Recruiting"
  primary-tab label that opens the same content in a Sheet/Drawer.
  Or: move to a help page at `/admin/help/recruiting` reachable via
  Operations -> Settings.
- **Effort:** 45 min
- **Files:** AdminDashboard.jsx (TAB_TREE definition), RecruitingPanel.jsx

### 1b. Move "How it works" out of Content sub-tabs
- **Why:** Same reasoning as 1a. It's how-the-system-works docs, not
  content management.
- **How:** Same options as 1a, or merge into a single "Help" overlay
  reachable from anywhere in the admin shell.
- **Effort:** 30 min
- **Files:** AdminDashboard.jsx, HowItWorksPanel.jsx

### 1c. Visually group Operations sub-pills
- **Why:** 8 sub-pills in one row is overwhelming. Splitting them by
  function helps scanning.
- **How:** Within the Operations sub-pill row, render two visual
  clusters separated by a divider: "Ops" (Team, Settings, Matching)
  and "Analytics" (Invites, Referral sources, Waitlist, Audit log,
  Scrape sources). No new state, just a styled separator.
- **Effort:** 30 min
- **Files:** AdminDashboard.jsx

### 1d. Move "Scrape sources" out of Operations
- **Why:** It's explicitly noted as not in the approved mockup. It's
  a developer tool; lives more naturally under Testing.
- **How:** Move it from the Operations sub-tabs to Testing sub-tabs.
- **Effort:** 5 min
- **Files:** AdminDashboard.jsx

**Total Tier 1: ~2 hours, low risk, ships cleanly without UX
decisions on your part.**

---

## Tier 2 — Medium risk, needs your input

### 2a. Consolidate row actions on AllProvidersPanel + RequestsPanel into a "..." overflow menu
- **Why:** Each row in these panels has 4-8 action buttons (Edit,
  Preview, Archive, Delete, Deep research, Test survey, Fire test
  survey, etc.). Most rows surface most actions all the time. A "..."
  overflow menu would keep the 1-2 primary actions inline and tuck
  the rest behind a click.
- **What I need from you:** which actions are "primary" (always
  visible) vs. "secondary" (in the overflow). My guess: Edit + Preview
  primary; everything else overflow. But I don't use the admin daily,
  you do — call it.
- **Effort:** 2-3 hours once the policy is decided
- **Files:** AllProvidersPanel.jsx, RequestsPanel.jsx, ProviderPreviewCard.jsx, components/ui/dropdown-menu.jsx

### 2b. Split Operations into "Operations" + "Analytics" primary tabs
- **Why:** 8 sub-tabs in one primary is too many. Functionally split:
  - Operations: Team, Settings, Matching
  - Analytics: Invites, Referral sources, Waitlist, Audit log
- **What I need from you:** is this split actually useful? If you
  almost never go into Audit log / Referral sources, hiding them
  behind a separate primary is good. If you bounce between Settings
  and Audit log, the split adds friction.
- **Effort:** 1 hour
- **Files:** AdminDashboard.jsx

### 2c. Convert modal-heavy flows to inline panels
- **Why:** A modal for every action breaks flow. Some current modals
  (e.g., the per-request matching detail) could be slide-over panels
  that don't block the underlying view.
- **What I need from you:** which modals feel disruptive? Without
  knowing your workflow, I'd be guessing.
- **Effort:** Open-ended — depends on which modals
- **Files:** TBD

---

## Tier 3 — High risk, save for after-launch focused session

### 3a. Full row-action audit across all panels
- Inventory every row-level button across all 20+ panels and apply
  consistent overflow rules. Big design pass. Best done with a
  whiteboard + you in the same session.

### 3b. Consolidate "panels" directory naming
- 40 files under `frontend/src/pages/admin/panels/`. Some are panels,
  some are row sub-components, some are shared utilities. A naming
  convention pass (panels/, rows/, shared/) would help future you.

### 3c. Keyboard navigation
- No keyboard shortcuts in the admin today. Power-user feature.

---

## Recommended path

1. **Now (no decision needed):** ship Tier 1 in a single commit.
2. **Pick one Tier 2 item** with your input on the trade-off question.
3. **Tier 3 stays in this doc** for the post-launch focused session
   the original backlog item called for.

Say "Tier 1 ship" if you want me to do the four Tier 1 moves as one
commit right now. Tier 2 needs your input on the question in each
item before I touch it.
