/**
 * E2E: Therapist apply/decline flow
 *
 * Seeds a therapist + patient request in MongoDB (simulating a completed
 * match), then:
 *   1. Navigates to the apply page via signed URL
 *   2. Verifies match data loads (score, gaps, summary)
 *   3. Fills confirmations + message → submits → verifies DB record
 *   4. Navigates to a second request's apply page → declines with reason
 *      → verifies decline record in DB
 *
 * No real matching or email sending — we seed the data directly.
 */
import { test, expect } from "@playwright/test";
import { MongoClient } from "mongodb";
import * as crypto from "crypto";

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017";
const MONGO_DB = process.env.MONGO_DB || "theravoca_test";
const BASE_URL = process.env.BASE_URL || "http://localhost:10000";
const JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-for-ci";

// Deterministic IDs for seeded data
const THERAPIST_ID = `e2e-therapist-${Date.now()}`;
const REQUEST_ID_APPLY = `e2e-req-apply-${Date.now()}`;
const REQUEST_ID_DECLINE = `e2e-req-decline-${Date.now()}`;
const THERAPIST_EMAIL = `${THERAPIST_ID}@test.theravoca.com`;

let mongo: MongoClient;

/** Replicate backend's generate_action_signature (helpers.py) */
function generateSignature(
  requestId: string,
  therapistId: string,
  action: string,
  expiresIso: string,
): string {
  const msg = `${requestId}:${therapistId}:${action}:${expiresIso}`;
  return crypto
    .createHmac("sha256", JWT_SECRET)
    .update(msg)
    .digest("hex")
    .slice(0, 32);
}

/** Build a signed apply/decline URL like the email links */
function signedUrl(
  requestId: string,
  therapistId: string,
  action: "apply" | "decline" = "apply",
): string {
  const expires = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
  const sig = generateSignature(requestId, therapistId, action, expires);
  return `/therapist/${action}/${requestId}/${therapistId}?sig=${sig}&exp=${expires}`;
}

/** Minimal therapist doc sufficient for the apply page to load */
function seedTherapist() {
  return {
    id: THERAPIST_ID,
    email: THERAPIST_EMAIL,
    name: "E2E Apply Therapist, LCSW",
    credential_type: "lcsw",
    licensed_states: ["ID"],
    client_types: ["individual"],
    age_groups: ["adult"],
    primary_specialties: ["anxiety"],
    secondary_specialties: [],
    general_treats: [],
    modalities: ["CBT"],
    modality_offering: "telehealth",
    availability_windows: ["weekday_morning"],
    cash_rate: 150,
    years_experience: 5,
    style_tags: ["warm_supportive"],
    gender: "female",
    is_active: true,
    pending_approval: false,
    notify_email: true,
    notify_sms: false,
  };
}

/** Minimal patient request doc with match data pre-populated */
function seedRequest(requestId: string) {
  return {
    id: requestId,
    email: `e2e-patient-${Date.now()}@test.theravoca.com`,
    status: "matched",
    presenting_issues: ["anxiety"],
    issue_severity: { anxiety: 3 },
    client_type: "individual",
    age_group: "adult",
    modality_preference: "telehealth_only",
    availability: ["weekday_morning"],
    urgency: "within_2_3_weeks",
    payment_method: "cash",
    budget: 150,
    location_state: "ID",
    // Match tracking — therapist was "notified"
    notified_therapist_ids: [THERAPIST_ID],
    notified_scores: { [THERAPIST_ID]: 87.5 },
    notified_breakdowns: {
      [THERAPIST_ID]: {
        logistics: 25,
        issue_coverage: 20,
        style_fit: 15,
        deep_match: 12.5,
        reliability: 15,
      },
    },
    matched_at: new Date().toISOString(),
    verified: true,
    verification_token: "e2e-token",
    view_token: "e2e-view",
    created_at: new Date().toISOString(),
  };
}

test.beforeAll(async () => {
  mongo = new MongoClient(MONGO_URI);
  await mongo.connect();
  const db = mongo.db(MONGO_DB);

  // Seed therapist + two patient requests
  await db.collection("therapists").insertOne(seedTherapist());
  await db.collection("requests").insertOne(seedRequest(REQUEST_ID_APPLY));
  await db.collection("requests").insertOne(seedRequest(REQUEST_ID_DECLINE));
});

test.afterAll(async () => {
  const db = mongo.db(MONGO_DB);
  await db.collection("therapists").deleteMany({ id: THERAPIST_ID });
  await db
    .collection("requests")
    .deleteMany({ id: { $in: [REQUEST_ID_APPLY, REQUEST_ID_DECLINE] } });
  await db
    .collection("applications")
    .deleteMany({ therapist_id: THERAPIST_ID });
  await db
    .collection("declines")
    .deleteMany({ therapist_id: THERAPIST_ID });
  await mongo.close();
});

test("therapist apply → DB record", async ({ page }) => {
  // ── Navigate to apply page via signed URL ───────────────────────
  const url = signedUrl(REQUEST_ID_APPLY, THERAPIST_ID, "apply");
  await page.goto(url);
  await page.waitForSelector('[data-testid="therapist-apply-page"]', {
    timeout: 15_000,
  });

  // ── Verify match data loaded ────────────────────────────────────
  // The page should show the match score (87.5 rounds to 88%)
  const pageText = await page.textContent("body");
  expect(pageText).toContain("88%");

  // ── Fill the message ────────────────────────────────────────────
  await page.getByTestId("therapist-message").fill(
    "I would love to work with this patient. I have extensive experience with anxiety.",
  );

  // ── Check all three confirmation boxes ──────────────────────────
  await page.getByTestId("confirm-availability").click();
  await page.getByTestId("confirm-urgency").click();
  await page.getByTestId("confirm-payment").click();

  // ── Submit interest ─────────────────────────────────────────────
  const submitBtn = page.getByTestId("apply-submit-btn");
  await expect(submitBtn).toBeEnabled({ timeout: 3_000 });
  await submitBtn.click();

  // ── Verify success state ────────────────────────────────────────
  await expect(page.getByTestId("apply-success")).toBeVisible({
    timeout: 10_000,
  });

  // ── Verify DB record ────────────────────────────────────────────
  const db = mongo.db(MONGO_DB);
  let application: any = null;
  for (let i = 0; i < 10; i++) {
    application = await db.collection("applications").findOne({
      request_id: REQUEST_ID_APPLY,
      therapist_id: THERAPIST_ID,
    });
    if (application) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  expect(application).toBeTruthy();
  expect(application.therapist_name).toBe("E2E Apply Therapist, LCSW");
  expect(application.match_score).toBe(87.5);
  expect(application.confirms_availability).toBe(true);
  expect(application.confirms_urgency).toBe(true);
  expect(application.confirms_payment).toBe(true);
  expect(application.all_confirmed).toBe(true);
  expect(application.message).toContain("extensive experience with anxiety");
});

test("therapist decline → DB record", async ({ page }) => {
  // ── Navigate to apply page (decline starts from same page) ──────
  const url = signedUrl(REQUEST_ID_DECLINE, THERAPIST_ID, "apply");
  await page.goto(url);
  await page.waitForSelector('[data-testid="therapist-apply-page"]', {
    timeout: 15_000,
  });

  // ── Click "Not interested" ──────────────────────────────────────
  await page.getByTestId("not-interested-btn").click();

  // ── Decline dialog should appear ────────────────────────────────
  await expect(page.getByTestId("decline-dialog")).toBeVisible({
    timeout: 5_000,
  });

  // ── Select a decline reason ─────────────────────────────────────
  await page.getByTestId("decline-reason-caseload_full").click();

  // ── Add optional notes ──────────────────────────────────────────
  await page.getByTestId("decline-notes").fill("Full caseload right now.");

  // ── Submit decline ──────────────────────────────────────────────
  await page.getByTestId("decline-submit").click();

  // ── Verify decline success state ────────────────────────────────
  await expect(page.getByTestId("decline-success")).toBeVisible({
    timeout: 10_000,
  });

  // ── Verify DB record ────────────────────────────────────────────
  const db = mongo.db(MONGO_DB);
  let decline: any = null;
  for (let i = 0; i < 10; i++) {
    decline = await db.collection("declines").findOne({
      request_id: REQUEST_ID_DECLINE,
      therapist_id: THERAPIST_ID,
    });
    if (decline) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  expect(decline).toBeTruthy();
  expect(decline.reason_codes).toContain("caseload_full");
  expect(decline.notes).toBe("Full caseload right now.");
  expect(decline.match_score).toBe(87.5);
});
