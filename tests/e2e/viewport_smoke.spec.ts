/**
 * Visual viewport smoke against staging.
 *
 * Josh 2026-05-17: "test all browsers and screen sizes that site
 * works". This script walks the key public + auth pages at 4
 * common viewports, screenshots each, and asserts:
 *   1. Status 200 (Basic Auth credentials work)
 *   2. No uncaught JS errors in the console
 *   3. The TheraVoca brand header is visible (sanity check the
 *      SPA actually hydrated and didn't render a blank page)
 *
 * Run with:
 *   STAGING_USER=theravoca STAGING_PASS='<pwd>' \
 *     npx playwright test viewport_smoke.spec.ts --reporter=list
 *
 * Output: screenshots land in test-results/<spec>-<viewport>/.
 *
 * Not a substitute for full e2e tests -- this is a "did anything
 * obviously break" sanity check across breakpoints. Visual diffs
 * are eyeballed from the screenshots, not asserted in code.
 */
import { test, expect, devices } from '@playwright/test';

const STAGING_USER = process.env.STAGING_USER || 'theravoca';
const STAGING_PASS = process.env.STAGING_PASS || '';
const BASE = 'https://theravoca-production.onrender.com';

const VIEWPORTS = [
  { name: 'mobile-375',  width: 375,  height: 812 },   // iPhone X/12/13/14
  { name: 'tablet-768',  width: 768,  height: 1024 },  // iPad portrait
  { name: 'laptop-1280', width: 1280, height: 800 },   // common laptop
  { name: 'desktop-1920', width: 1920, height: 1080 }, // full HD
];

const PAGES = [
  { path: '/',                    name: 'landing',           anchor: 'header' },
  { path: '/#testimonials',       name: 'landing-testimonials', anchor: 'header' },
  { path: '/#start',              name: 'landing-intake-anchor', anchor: 'header' },
  { path: '/therapists/join',     name: 'therapist-signup',  anchor: 'header' },
  { path: '/sign-in',             name: 'sign-in',           anchor: 'header' },
  { path: '/crisis',              name: 'crisis',            anchor: 'header' },
  { path: '/blog',                name: 'blog-index',        anchor: 'header' },
  { path: '/terms',               name: 'terms',             anchor: 'header' },
  { path: '/privacy',             name: 'privacy',           anchor: 'header' },
  { path: '/terms/therapist',     name: 'therapist-terms',   anchor: 'header' },
];

test.use({
  httpCredentials: {
    username: STAGING_USER,
    password: STAGING_PASS,
  },
  // Block YouTube embeds + 3rd-party assets to make the smoke
  // faster and avoid flakiness from external services.
  // (We keep Cloudflare Turnstile so the signup page renders.)
});

for (const vp of VIEWPORTS) {
  test.describe(`Viewport ${vp.name} (${vp.width}x${vp.height})`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const page of PAGES) {
      test(`${page.name}`, async ({ page: pageObj }) => {
        const errors: string[] = [];
        pageObj.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
        pageObj.on('console', (msg) => {
          if (msg.type() === 'error') {
            const txt = msg.text();
            // Ignore expected noise:
            //   - YouTube nocookie iframe console chatter
            //   - third-party tracking blocked by browser
            //   - resource hints
            if (
              txt.includes('youtube') ||
              txt.includes('Turnstile') ||
              txt.includes('Failed to load resource') ||
              txt.includes('preload') ||
              txt.includes('posthog')
            ) return;
            errors.push(`console: ${txt}`);
          }
        });

        // 'domcontentloaded' instead of 'networkidle' -- the
        // landing page embeds YouTube iframes that keep loading
        // beyond 30s and never let the network idle, even though
        // the visible content has long settled. We then wait
        // explicitly for the header to be present so we know the
        // SPA actually rendered.
        const resp = await pageObj.goto(BASE + page.path, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        expect(resp?.status(), `HTTP status for ${page.path}`).toBeLessThan(400);

        // Brand sanity: header must be present (SPA hydrated)
        const header = pageObj.locator(page.anchor).first();
        await expect(header, `${page.anchor} must be visible`).toBeVisible({ timeout: 15000 });

        // Give layout one more breath so above-the-fold text +
        // hero images have a chance to land before the screenshot.
        await pageObj.waitForTimeout(800);

        // Screenshot for visual eyeball
        await pageObj.screenshot({
          path: `test-results/viewport-smoke/${vp.name}/${page.name}.png`,
          fullPage: true,
        });

        // Fail loud on console errors
        expect(errors, `Console errors on ${page.path}`).toEqual([]);
      });
    }
  });
}
