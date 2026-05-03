/**
 * E2E: Therapist signup → DB record → admin approval
 *
 * Phase 1 (this file):
 *   1. Navigate to /therapists/join
 *   2. Fill all 9 signup steps
 *   3. Preview → Submit → verify DB record created
 *   4. Admin approves via API → verify pending_approval flipped
 *
 * Stripe checkout is NOT tested here — the backend uses demo mode in CI
 * (no STRIPE_SECRET_KEY set), so subscribe-checkout would return a dummy
 * URL. A separate boundary test can verify the Stripe request construction
 * without calling Stripe.
 *
 * Turnstile CAPTCHA is disabled in CI (no REACT_APP_TURNSTILE_SITE_KEY).
 */
import { test, expect } from "@playwright/test";
import { MongoClient } from "mongodb";
import path from "path";

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017";
const MONGO_DB = process.env.MONGO_DB || "theravoca_test";
const BASE_URL = process.env.BASE_URL || "http://localhost:10000";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "testadmin123";

// Deterministic test data — timestamp keeps emails unique across retries
const TEST_EMAIL = `e2e-therapist-${Date.now()}@test.theravoca.com`;
const FIXTURE_IMAGE = path.resolve(__dirname, "../fixtures/test-image.png");

let mongo: MongoClient;

test.beforeAll(async () => {
  mongo = new MongoClient(MONGO_URI);
  await mongo.connect();
});

test.afterAll(async () => {
  // Clean up test therapist data
  const db = mongo.db(MONGO_DB);
  await db
    .collection("therapists")
    .deleteMany({ email: { $regex: /^e2e-therapist-/ } });
  await mongo.close();
});

test("therapist signup → DB record → admin approval", async ({ page }) => {
  // Helper: wait for Next to become enabled, click it, and verify
  // we advanced to the expected step by waiting for a step-specific element.
  async function clickNextAndVerify(
    stepName: string,
    nextStepLocator: string,
    timeout = 10_000,
  ) {
    const nextBtn = page.getByTestId("signup-next-btn");

    // Wait for the Next button to become enabled (React state may need a tick)
    try {
      await expect(nextBtn).toBeEnabled({ timeout });
    } catch {
      // Still disabled — capture diagnostic info before failing
      const blockReason = await page
        .getByTestId("signup-step-error")
        .textContent()
        .catch(() => "(no error message visible)");
      console.error(
        `[DIAG] Next disabled at ${stepName}. Reason: ${blockReason}`,
      );
      throw new Error(
        `Next button disabled at ${stepName}: ${blockReason}`,
      );
    }

    await nextBtn.click();
    // Wait for the next step's content to render
    await page.waitForSelector(`[data-testid="${nextStepLocator}"]`, {
      timeout,
    });
    // Let the smooth scroll animation finish before interacting with the
    // new step's content — scrollFormIntoView uses behavior:"smooth" which
    // takes ~300ms and makes elements "unstable" for Playwright clicks.
    await page.waitForTimeout(400);
  }

  // ── Navigate to signup page ──────────────────────────────────────
  await page.goto("/therapists/join");
  await page.waitForSelector('[data-testid="signup-next-btn"]', {
    timeout: 15_000,
  });

  // ── Step 1: Basics ───────────────────────────────────────────────
  // Profile photo (optional but exercising the upload path)
  const photoInput = page.locator('[data-testid="signup-photo-input"]');
  await photoInput.setInputFiles(FIXTURE_IMAGE);

  // Wait for the image to be processed (converted to data URL)
  await expect(page.getByTestId("signup-photo-preview")).toBeVisible({
    timeout: 5_000,
  });

  // Name — must include credential suffix
  await page.getByTestId("signup-name").fill("E2E Test Therapist, LCSW");

  // Email
  await page.getByTestId("signup-email").fill(TEST_EMAIL);

  // Credential type — native <select>
  await page.getByTestId("signup-credential-type").selectOption("lcsw");

  // Website — leave blank to skip reachability check
  // (websiteIsValid returns true for empty string)

  // Phone numbers
  await page.getByTestId("signup-phone-alert").fill("2085559999");
  await page.getByTestId("signup-office-phone").fill("2085550001");

  // Gender
  await page.getByTestId("signup-gender-female").click();

  await clickNextAndVerify("Step 1 → 2", "signup-license-state");

  // ── Step 2: License ──────────────────────────────────────────────
  // State defaults to Idaho — leave it
  await expect(page.getByTestId("signup-license-state")).toHaveValue("ID");

  // License number
  await page.getByTestId("signup-license-number").fill("LIC-E2E-12345");

  // License expiry — must be a future date
  await page.getByTestId("signup-license-expires").fill("2028-12-31");

  // License photo upload
  const licenseInput = page.locator('[data-testid="signup-license-input"]');
  await licenseInput.setInputFiles(FIXTURE_IMAGE);

  // Wait for license image to be processed
  await expect(page.getByTestId("signup-license-preview")).toBeVisible({
    timeout: 5_000,
  });

  await clickNextAndVerify("Step 2 → 3", "signup-client-type-individual");

  // ── Step 3: Who You See ──────────────────────────────────────────
  // Client types — pick individual
  const clientPill = page.getByTestId("signup-client-type-individual");
  await clientPill.scrollIntoViewIfNeeded();
  await clientPill.click();
  // Verify the pill toggled — active pills get the green background class
  await expect(clientPill).toHaveClass(/bg-\[#2D4A3E\]/, { timeout: 3_000 });

  // Age groups — pick adult
  const agePill = page.getByTestId("signup-age-group-adult");
  await agePill.scrollIntoViewIfNeeded();
  await agePill.click();
  await expect(agePill).toHaveClass(/bg-\[#2D4A3E\]/, { timeout: 3_000 });

  await clickNextAndVerify("Step 3 → 4", "signup-issue-anxiety-primary");

  // ── Step 4: Specialties ──────────────────────────────────────────
  // Click "anxiety" row, then set it as primary
  await page.getByTestId("signup-issue-anxiety-primary").click();

  await clickNextAndVerify("Step 4 → 5", "signup-modality-offering-telehealth");

  // ── Step 5: Format & Logistics ───────────────────────────────────
  // Modality: pick CBT
  await page.getByTestId("signup-modality-CBT").click();

  // Modality offering: telehealth only (avoids office address requirement)
  await page.getByTestId("signup-modality-offering-telehealth").click();

  // Availability: weekday mornings
  await page.getByTestId("signup-availability-weekday_morning").click();

  await clickNextAndVerify("Step 5 → 6", "signup-cash-rate");

  // ── Step 6: Insurance & Rates ────────────────────────────────────
  // Cash rate (required, > 0)
  await page.getByTestId("signup-cash-rate").fill("150");

  // Years experience (required, >= 0)
  await page.getByTestId("signup-years").fill("5");

  await clickNextAndVerify("Step 6 → 7", "signup-style-warm_supportive");

  // ── Step 7: Style ────────────────────────────────────────────────
  // Pick at least one style tag
  await page.getByTestId("signup-style-warm_supportive").click();

  await clickNextAndVerify("Step 7 → 8", "signup-t4-direct");

  // ── Step 8: Deep Match ───────────────────────────────────────────
  // T4: hard truth approach
  await page.getByTestId("signup-t4-direct").click();

  // T5: lived experience (min 30 chars)
  await page
    .getByTestId("signup-t5")
    .fill(
      "I have extensive experience working with anxiety and depression in adults over five years."
    );

  // T6: session expectations (pick 1)
  await page.getByTestId("signup-t6-listen_heard").click();

  // T6b: early sessions description (min 30 chars)
  await page
    .getByTestId("signup-t6b")
    .fill(
      "In our first sessions, I focus on understanding your story and building a safe therapeutic relationship."
    );

  await clickNextAndVerify("Step 8 → 9", "signup-preview");

  // ── Step 9: Notifications ────────────────────────────────────────
  // Defaults are fine (both on) — just proceed to preview

  // Click "Preview profile" button (last step shows preview instead of next)
  await page.getByTestId("signup-preview").click();

  // ── Preview modal → Submit ───────────────────────────────────────
  await expect(page.getByTestId("signup-preview-modal")).toBeVisible({
    timeout: 5_000,
  });

  // Click "Looks good — submit"
  await page.getByTestId("signup-preview-confirm").click();

  // ── Verify post-submit state ─────────────────────────────────────
  // After successful submit, the page shows a "Profile received" screen
  // with a checkout button. We just need to confirm submission succeeded.
  // Wait for the checkout button OR the skip button to appear —
  // either confirms the signup POST returned successfully.
  const postSubmit = page
    .getByTestId("signup-checkout-btn")
    .or(page.getByTestId("signup-skip-payment-btn"));
  await expect(postSubmit.first()).toBeVisible({ timeout: 15_000 });

  // ── Pull therapist record from MongoDB ───────────────────────────
  const db = mongo.db(MONGO_DB);
  let therapist: any = null;
  for (let i = 0; i < 10; i++) {
    therapist = await db
      .collection("therapists")
      .findOne({ email: TEST_EMAIL });
    if (therapist) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  expect(therapist).toBeTruthy();
  expect(therapist.name).toBe("E2E Test Therapist, LCSW");
  expect(therapist.email).toBe(TEST_EMAIL);
  expect(therapist.pending_approval).toBe(true);
  expect(therapist.credential_type).toBe("lcsw");
  expect(therapist.licensed_states).toContain("ID");

  const therapistId = therapist.id || therapist._id.toString();

  // ── Admin approval via API ──────────────────────────────────────
  const approveRes = await page.request.post(
    `${BASE_URL}/api/admin/therapists/${therapistId}/approve`,
    {
      headers: {
        "Content-Type": "application/json",
        "x-admin-password": ADMIN_PASSWORD,
      },
    }
  );
  expect(approveRes.ok()).toBe(true);

  // Verify the approval stuck in the DB
  const updated = await db
    .collection("therapists")
    .findOne({ email: TEST_EMAIL });
  expect(updated).toBeTruthy();
  expect(updated!.pending_approval).toBe(false);
});
