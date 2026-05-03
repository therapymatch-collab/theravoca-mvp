/**
 * E2E: Patient intake flow
 *
 * Exercises the full happy-path:
 *   1. Navigate to home → click "Get matched"
 *   2. Fill all 7 intake steps (standard match, no deep-match)
 *   3. Submit → land on /verify/pending
 *   4. Pull verification_token from MongoDB (no email dependency)
 *   5. Hit GET /api/requests/verify/{token} to verify
 *   6. Admin-release results (bypass 24h hold)
 *   7. Navigate to results page and assert it loads
 */
import { test, expect } from "@playwright/test";
import { MongoClient } from "mongodb";

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017";
const MONGO_DB = process.env.MONGO_DB || "theravoca_test";
const BASE_URL = process.env.BASE_URL || "http://localhost:10000";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "testadmin123";

// Deterministic test data
const TEST_EMAIL = `e2e-intake-${Date.now()}@test.theravoca.com`;

let mongo: MongoClient;

test.beforeAll(async () => {
  mongo = new MongoClient(MONGO_URI);
  await mongo.connect();
});

test.afterAll(async () => {
  // Clean up test data
  const db = mongo.db(MONGO_DB);
  await db.collection("requests").deleteMany({ email: { $regex: /^e2e-intake-/ } });
  await mongo.close();
});

test("patient intake → verify → results", async ({ page }) => {
  // ── Navigate to home and start intake ──────────────────────────
  await page.goto("/");
  // Click the "Get matched" CTA — it's an anchor to /#start
  const cta = page.getByTestId("get-matched-btn").or(page.locator('a[href="/#start"]')).first();
  await cta.click();
  // Wait for the intake form to appear
  await page.waitForSelector('[data-testid="intake-section"]', { timeout: 10_000 });

  // ── Step 1: Who ────────────────────────────────────────────────
  await expect(page.getByTestId("step-label")).toContainText("Step 1");

  // State defaults to Idaho — leave it
  await expect(page.getByTestId("state-select")).toHaveValue("ID");

  // Select client type: individual
  await page.getByTestId("client-type-individual").click();
  // Select age group: adult
  await page.getByTestId("age-group-adult").click();

  await page.getByTestId("intake-next-btn").click();

  // ── Step 2: Issues ─────────────────────────────────────────────
  await expect(page.getByTestId("step-label")).toContainText("Step 2");

  // Pick 2 issues: anxiety (primary) + depression
  await page.getByTestId("issue-anxiety").click();
  await page.getByTestId("issue-depression").click();

  // Set severity for each (3 = moderate)
  await page.getByTestId("severity-anxiety-3").click();
  await page.getByTestId("severity-depression-2").click();

  await page.getByTestId("intake-next-btn").click();

  // ── Step 3: Expectations ───────────────────────────────────────
  await expect(page.getByTestId("step-label")).toContainText("Step 3");

  // Pick 1 expectation
  await page.getByTestId("expectations-tools_fast").click();

  await page.getByTestId("intake-next-btn").click();

  // ── Deep-match opt-in banner (skip it) ─────────────────────────
  // The banner appears between steps 3 and 4 on first encounter.
  // Click "Skip" to stay on the standard 7-step flow.
  const skipDeep = page.getByTestId("deep-match-skip");
  if (await skipDeep.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await skipDeep.click();
  }

  // ── Step 4: Format & logistics ─────────────────────────────────
  await expect(page.getByTestId("step-label")).toContainText("Step 4");

  // Modality: telehealth only (no city/zip required)
  await page.getByTestId("modality-telehealth_only").click();

  // Availability: flexible
  await page.getByTestId("availability-flexible").click();

  // Urgency: within 2-3 weeks
  await page.getByTestId("urgency-within_2_3_weeks").click();

  // Prior therapy: no
  await page.getByTestId("prior-therapy-no").click();

  await page.getByTestId("intake-next-btn").click();

  // ── Step 5: Payment ────────────────────────────────────────────
  await expect(page.getByTestId("step-label")).toContainText("Step 5");

  // Payment type: cash
  await page.getByTestId("payment-cash").click();

  // Budget — fill the number input
  await page.getByTestId("budget-input").fill("150");

  await page.getByTestId("intake-next-btn").click();

  // ── Step 6: Preferences (all optional) ─────────────────────────
  await expect(page.getByTestId("step-label")).toContainText("Step 6");

  // Leave defaults (no_pref for everything) — just continue
  await page.getByTestId("intake-next-btn").click();

  // ── Step 7: Contact ────────────────────────────────────────────
  await expect(page.getByTestId("step-label")).toContainText("Step 7");

  // Email
  await page.getByTestId("email-input").fill(TEST_EMAIL);

  // Phone (optional but let's fill it)
  await page.getByTestId("phone-input").fill("2085551234");

  // Referral source — optional field, admin-managed options loaded from API.
  // In CI the DB starts empty so there are no options to select. Skip it.

  // Checkboxes
  await page.getByTestId("agree-terms").click();
  await page.getByTestId("confirm-adult").click();
  await page.getByTestId("confirm-emergency").click();

  // ── Submit via review modal ────────────────────────────────────
  await page.getByTestId("intake-submit-btn").click();

  // Review modal should appear
  await expect(page.getByTestId("intake-preview-modal")).toBeVisible({ timeout: 5_000 });

  // Click "Confirm & find my matches"
  await page.getByTestId("intake-preview-submit").click();

  // ── Should land on /verify/pending ─────────────────────────────
  await page.waitForURL(/\/verify\/pending/, { timeout: 15_000 });
  const url = new URL(page.url());
  const requestId = url.searchParams.get("id");
  expect(requestId).toBeTruthy();

  // ── Pull verification token from MongoDB ───────────────────────
  const db = mongo.db(MONGO_DB);
  // The request was just created — give the DB a moment
  let request: any = null;
  for (let i = 0; i < 10; i++) {
    request = await db.collection("requests").findOne({ email: TEST_EMAIL });
    if (request?.verification_token) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  expect(request).toBeTruthy();
  expect(request.verification_token).toBeTruthy();

  const verificationToken = request.verification_token;
  const viewToken = request.view_token;

  // ── Verify the request via API ─────────────────────────────────
  const verifyRes = await page.request.get(
    `${BASE_URL}/api/requests/verify/${verificationToken}`
  );
  expect(verifyRes.ok()).toBe(true);
  const verifyBody = await verifyRes.json();
  expect(verifyBody.verified).toBe(true);

  // ── Admin-release results (bypass 24h hold) ────────────────────
  const releaseRes = await page.request.post(
    `${BASE_URL}/api/admin/requests/${requestId}/release-results`,
    {
      headers: {
        "Content-Type": "application/json",
        "x-admin-password": ADMIN_PASSWORD,
      },
    }
  );
  // Release may 200 or 404 if no results yet — either is acceptable
  // The important thing is verification worked
  expect([200, 404]).toContain(releaseRes.status());

  // ── Navigate to results page ───────────────────────────────────
  await page.goto(`/results/${requestId}?t=${viewToken}`);

  // The results page should load without error.
  // It shows either matched therapists or a "matching in progress" state.
  // We assert the page doesn't show a hard error / 404.
  await page.waitForLoadState("networkidle", { timeout: 15_000 });

  // Check we're still on the results page (not redirected to error)
  expect(page.url()).toContain(`/results/${requestId}`);

  // The page should have some meaningful content — not a blank error
  const bodyText = await page.textContent("body");
  expect(bodyText).toBeTruthy();
  // Should NOT contain common error indicators
  expect(bodyText!.toLowerCase()).not.toContain("page not found");
  expect(bodyText!.toLowerCase()).not.toContain("something went wrong");
});
