import { expect, test, assertNoBackendRequests } from "../fixtures/test";

const OFFICIAL_ROUTES = [
  "/portfolio",
  "/trade",
  "/positions",
  "/borrow",
  "/earn",
  "/move",
  "/more",
  "/settings",
  "/qr",
] as const;

test.describe("official f(x) client routes", () => {
  for (const route of OFFICIAL_ROUTES) {
    test(`${route} loads without an FxAeon backend`, async ({ page, requests }) => {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page.locator("main")).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${route.replace("/", "\\/")}(?:\\/)?$`));
      assertNoBackendRequests(requests);

      // With RPC and Privy deliberately omitted from this build, a route may
      // render an empty/unavailable state, but it must never invent market or
      // wallet numbers to make the screen look loaded.
      await expect(page.locator("body")).not.toContainText(/\$\s*\d/);
      await expect(page.locator("body")).not.toContainText(/5,240\.75|3,500(?:\.42)?|104,500/);
      await expect(page.locator("canvas")).toHaveCount(0);

      const registrations = await page.evaluate(async () =>
        "serviceWorker" in navigator ? (await navigator.serviceWorker.getRegistrations()).length : 0,
      );
      expect(registrations, "financial state must not be served from a service worker").toBe(0);
    });
  }
});

test.describe("browser entry", () => {
  test.use({ telegram: false });

  test("landing page describes the official scope and remains backend-free", async ({ page, requests }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toBeVisible();
    await expect(page.locator("body")).toContainText(/f\(x\)|FxAeon/i);
    await expect(page.getByRole("link", { name: /launch web app/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /open in telegram/i })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/DCA|take[- ]?profit|stop[- ]?loss|whale|arbitrage|copy trading/i);
    assertNoBackendRequests(requests);
  });

  test("plain browser users can enter the app without Telegram", async ({ page, requests }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByRole("link", { name: /launch web app/i }).click();
    await expect(page).toHaveURL(/\/portfolio\/?$/);
    await expect(page.getByRole("heading", { name: /portfolio/i })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/runs inside Telegram|open the .*Mini App from Telegram to continue/i);
    assertNoBackendRequests(requests);
  });
});

test.describe("Telegram bridge availability", () => {
  test.use({ telegram: false });

  test("a failed Telegram script cannot block the plain browser landing", async ({ page, requests }) => {
    await page.route("**/telegram-web-app.js", (route) => route.abort("failed"));
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("link", { name: /open.*telegram/i })).toBeVisible({ timeout: 3_000 });
    await expect(page.getByRole("link", { name: /launch web app/i })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/Loading live protocol state/i);
    assertNoBackendRequests(requests);
  });

  test("a Telegram launch fails visibly when its bridge never arrives", async ({ page, requests }) => {
    await page.route("**/telegram-web-app.js", (route) => route.abort("failed"));
    await page.goto("/#tgWebAppData=query_id%3Dtest&tgWebAppVersion=8.0&tgWebAppPlatform=tdesktop", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Telegram bridge unavailable/i })).toBeVisible({ timeout: 7_000 });
    await expect(page.getByRole("button", { name: /Reload FxAeon/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Continue in browser/i })).toBeVisible();
    assertNoBackendRequests(requests);
  });

  test("a direct Telegram protocol route also fails visibly when its bridge never arrives", async ({ page, requests }) => {
    await page.route("**/telegram-web-app.js", (route) => route.abort("failed"));
    await page.goto("/portfolio#tgWebAppData=query_id%3Dtest&tgWebAppVersion=8.0&tgWebAppPlatform=tdesktop", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Telegram bridge unavailable/i })).toBeVisible({ timeout: 7_000 });
    await expect(page.locator("body")).not.toContainText(/Wallet service unavailable/i);
    await expect(page.getByRole("button", { name: /Reload FxAeon/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Continue in browser/i })).toBeVisible();
    assertNoBackendRequests(requests);
  });
});

test("missing wallet configuration is an honest unavailable state", async ({ page, requests }) => {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect(page.locator("body")).toContainText(/unavailable|not configured|connect|Telegram/i);
  await expect(page.locator("body")).not.toContainText(/private key|session signer|delegat(?:ed|ion)/i);
  assertNoBackendRequests(requests);
});

test("unknown routes render the scoped FxAeon recovery screen", async ({ page, requests }) => {
  const response = await page.goto("/outside-official-scope", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(404);
  await expect(page.locator("main")).toBeVisible();
  await expect(page.locator("body")).toContainText(/outside FxAeon|That page is not available/i);
  await expect(page.getByRole("link", { name: /back to portfolio/i })).toBeVisible();
  assertNoBackendRequests(requests);
});
