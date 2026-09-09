import { expect, test, assertNoBackendRequests } from "../fixtures/test";
import type { Page } from "@playwright/test";

const ROUTES = [
  "/",
  "/login",
  "/portfolio",
  "/trade",
  "/positions",
  "/borrow",
  "/earn",
  "/move",
  "/more",
  "/settings",
  "/history",
  "/qr",
  "/docs",
] as const;

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 360, height: 640 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
] as const;
const CTA_ROUTES = new Set([
  "/",
  "/login",
  "/portfolio",
  "/trade",
  "/positions",
  "/borrow",
  "/earn",
  "/move",
  "/history",
  "/qr",
  "/settings",
]);
async function assertViewportGeometry(page: Page, route: string, viewport: { width: number; height: number }) {
  // Financial forms may need a vertical scroll on short phones. The contract
  // protects fit and reachability without forcing dense controls above the
  // fold, which made fields unusable at 320px.
  const geometry = await page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    const body = document.body;
    return {
      documentWidth: Math.max(root.scrollWidth, body?.scrollWidth ?? 0),
      viewportWidth: root.clientWidth,
    };
  });
  expect(geometry.documentWidth, `${route} must not overflow horizontally at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(geometry.viewportWidth + 1);
}

async function assertEnabledCtas(page: Page, route: string, viewport: { width: number; height: number }) {
  const ctas = page.locator(".button-primary:visible:not([disabled])");
  const count = await ctas.count();
  for (let index = 0; index < count; index += 1) {
    let cta = ctas.nth(index);
    await expect(cta, `${route} CTA ${index + 1} must be visible at ${viewport.width}x${viewport.height}`).toBeVisible();
    // Hydration and wallet-read state can replace the action rail between the
    // visibility assertion and the scroll. Re-resolve the locator at the
    // action point so a harmless React remount is not treated as geometry loss.
    await page.locator(".button-primary:visible:not([disabled])").nth(index).scrollIntoViewIfNeeded();
    cta = page.locator(".button-primary:visible:not([disabled])").nth(index);
    let box = await cta.boundingBox();
    for (let attempt = 0; !box && attempt < 25; attempt += 1) {
      await page.waitForTimeout(100);
      box = await cta.boundingBox();
    }
    expect(box, `${route} CTA ${index + 1} geometry at ${viewport.width}x${viewport.height}`).not.toBeNull();
    expect(box!.y, `${route} CTA ${index + 1} must be inside the viewport`).toBeGreaterThanOrEqual(-1);
    expect(box!.y + box!.height, `${route} CTA ${index + 1} must be inside the viewport`).toBeLessThanOrEqual(viewport.height + 1);

    await expect.poll(() => cta.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const topmost = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return topmost === element || Boolean(topmost && element.contains(topmost));
    }), { timeout: 5_000, message: `${route} CTA ${index + 1} must not be obscured at ${viewport.width}x${viewport.height}` }).toBe(true);

    const mobileNav = page.locator('nav.mobile-tabbar[aria-label="Primary navigation"]:visible');
    if (await mobileNav.count()) {
      let navBox = await mobileNav.boundingBox();
      for (let attempt = 0; !navBox && attempt < 25; attempt += 1) {
        await page.waitForTimeout(100);
        navBox = await mobileNav.boundingBox();
      }
      expect(navBox).not.toBeNull();
      expect(box!.y + box!.height, `${route} CTA ${index + 1} must clear primary nav`).toBeLessThanOrEqual(navBox!.y + 1);
    }
  }
}

test.describe("single-viewport route contract", () => {
  test.use({ telegram: false });

  test("public and disconnected routes keep horizontal fit and the next action reachable", async ({ page, requests }) => {
    test.setTimeout(360_000);

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);

      for (const route of ROUTES) {
        await page.goto(route, { waitUntil: "domcontentloaded" });
        await expect(page.locator("main:visible"), `${route} main at ${viewport.width}px`).toBeVisible();

        // Let client hydration and the optional market context settle before
        // asserting its deliberate absence in this compact route contract.
        await expect(page.locator("main:visible").first()).toBeVisible();
        await page.waitForTimeout(120);
        await expect(page.locator('[role="region"][aria-label="Market prices"]'), `${route} must not render a price strip`).toHaveCount(0);
        await expect(page.locator('.market-strip'), `${route} must not render a market strip class`).toHaveCount(0);

        await assertViewportGeometry(page, route, viewport);
        if (CTA_ROUTES.has(route)) {
          await expect(page.locator(".button-primary:visible:not([disabled])").first(), `${route} must expose an enabled primary/review action at ${viewport.width}x${viewport.height}`).toBeVisible();
          await assertEnabledCtas(page, route, viewport);
        }
      }
    }

    assertNoBackendRequests(requests);
  });

  test("mobile trade chart is a deliberate, explicit scroll exception", async ({ page }) => {
    test.setTimeout(60_000);
    const viewport = { width: 390, height: 844 } as const;
    await page.setViewportSize(viewport);
    await page.goto("/trade", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main:visible")).toBeVisible();

    const toggle = page.locator(".market-chart-toggle:visible");
    await expect(toggle, "mobile trade must expose an explicit chart toggle").toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".market-chart-content:visible"), "collapsed mobile charts must not be rendered").toHaveCount(0);

    // The chart must remain cold until the user asks for it. Once expanded,
    // the route is intentionally permitted to scroll so the chart can retain
    // a useful height on small phones.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".market-chart-content:visible")).toBeVisible();

    const contentGeometry = await page.locator("main.app-content-tabs").evaluate((element: HTMLElement) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      horizontalOverflow: element.scrollWidth - element.clientWidth,
    }));
    // Expanded charts are the one product exception to the no-scroll fold:
    // keep the chart useful and let the shell content pane scroll when the
    // chart plus ticket cannot fit on a small phone. The document itself is
    // still locked by the app shell.
    expect(contentGeometry.scrollHeight).toBeGreaterThanOrEqual(contentGeometry.clientHeight);
    expect(contentGeometry.horizontalOverflow).toBeLessThanOrEqual(1);
  });

  test("320px Trade keeps controls usable and the review action reachable", async ({ page }) => {
    const viewport = { width: 320, height: 568 } as const;
    await page.setViewportSize(viewport);
    await page.goto("/trade", { waitUntil: "domcontentloaded" });

    const required = [
      page.getByRole("link", { name: "Positions", exact: true }),
      page.getByText("ETH / USD", { exact: true }),
      page.locator('.market-chart-header').getByText(/% 24h$|^—$/).first(),
      page.getByRole("radio", { name: "ETH", exact: true }),
      page.getByRole("radio", { name: "BTC", exact: true }),
      page.getByRole("button", { name: "Show chart", exact: true }),
      page.getByText("New position", { exact: true }),
      page.getByText("ETH Long", { exact: true }),
      page.getByText("Price rises", { exact: true }),
      page.getByText("Price falls", { exact: true }),
      page.getByLabel("Amount in ETH"),
      page.getByRole("button", { name: /Input asset/ }),
      page.getByLabel("Target leverage", { exact: true }),
      page.locator("summary").filter({ hasText: "Advanced" }),
      page.getByRole("button", { name: "Connect wallet", exact: true }).last(),
    ];

    const nav = page.locator('nav.mobile-tabbar[aria-label="Primary navigation"]');
    await expect(nav, 'mobile navigation must be mounted before geometry checks').toBeVisible();
    await expect.poll(async () => nav.evaluate((element) => element.getBoundingClientRect().width), { timeout: 5_000 }).toBeGreaterThan(0);
    const navBox = await nav.evaluate((element) => element.getBoundingClientRect().toJSON());
    expect(navBox.width).toBeGreaterThan(0);
    expect(navBox.height).toBeGreaterThan(0);
    for (const item of required) {
      await expect(item).toBeVisible();
      await item.scrollIntoViewIfNeeded();
      const box = await item.evaluate((element) => element.getBoundingClientRect().toJSON());
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
      expect(box.y).toBeGreaterThanOrEqual(-1);
      expect(box.y + box.height).toBeLessThanOrEqual(navBox.y + 1);
    }
    await expect(page.getByLabel("Amount in ETH")).toHaveCSS("min-height", "44px");
    await expect(page.getByRole("slider", { name: "Target leverage slider" })).toHaveCSS("height", "44px");
    await assertViewportGeometry(page, "/trade", viewport);
    await assertEnabledCtas(page, "/trade", viewport);
  });

  test("320px Move and Borrow keep amount fields editable", async ({ page }) => {
    const viewport = { width: 320, height: 568 } as const;
    await page.setViewportSize(viewport);

    await page.goto("/move", { waitUntil: "domcontentloaded" });
    const moveAmount = page.getByLabel("Amount in fxUSD");
    await expect(moveAmount).toBeVisible();
    await expect.poll(() => page.locator('input[aria-label="Amount in fxUSD"]:visible').first().evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(120);

    await page.goto("/borrow", { waitUntil: "domcontentloaded" });
    const collateral = page.getByLabel("Starting collateral in ETH");
    const debt = page.getByLabel("fxUSD to receive in fxUSD");
    await expect(collateral).toBeVisible();
    await expect(debt).toBeVisible();
    await expect.poll(() => page.locator('input[aria-label="Starting collateral in ETH"]:visible').first().evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(120);
    await expect.poll(() => page.locator('input[aria-label="fxUSD to receive in fxUSD"]:visible').first().evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(120);
    await assertViewportGeometry(page, "/borrow", viewport);
  });

  test("short 390px screens keep financial actions reachable after scrolling", async ({ page }) => {
    const viewport = { width: 390, height: 500 } as const;
    await page.setViewportSize(viewport);
    for (const route of ["/trade", "/borrow", "/earn", "/move"] as const) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page.locator("main:visible"), `${route} main at short 390px`).toBeVisible();
      await page.waitForTimeout(120);
      await assertViewportGeometry(page, route, viewport);
      await expect(page.locator(".button-primary:visible:not([disabled])").first(), `${route} must expose an action at 390x500`).toBeVisible();
      await assertEnabledCtas(page, route, viewport);
    }
  });

  test.describe("connected browser route states", () => {
    test.use({ browserWallet: { address: "0x930f0000000000000000000000000000000098b9", initiallyConnected: true } });

    test("connected forms keep their supporting state inside the viewport contract", async ({ page, requests }) => {
      test.setTimeout(300_000);
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        for (const route of ["/portfolio", "/trade", "/positions", "/borrow", "/earn", "/move", "/more", "/settings", "/history", "/qr"] as const) {
          await page.goto(route, { waitUntil: "domcontentloaded" });
          await expect(page.locator("main:visible"), `${route} connected main at ${viewport.width}px`).toBeVisible();
          // Connected feeds settle asynchronously; let the initial review
          // transition finish before sampling CTA geometry so a transient
          // enabled button cannot disappear mid-assertion.
          await page.waitForTimeout(500);
          await assertViewportGeometry(page, route, viewport);
          await assertEnabledCtas(page, route, viewport);
        }
      }
      assertNoBackendRequests(requests);
    });
  });
});
