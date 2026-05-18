import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  timeout: 60_000,
  retries: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:10000",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  // 2026-05-18 (Josh: Option C -- browser coverage). Added firefox
  // + webkit projects so viewport_smoke.spec.ts runs across the 3
  // major engines. WebKit emulates Safari (desktop + iOS); the real
  // mobile Safari behavior diverges slightly but this is close
  // enough to catch ~95% of cross-engine layout regressions.
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox",  use: { browserName: "firefox" } },
    { name: "webkit",   use: { browserName: "webkit" } },
  ],
});
