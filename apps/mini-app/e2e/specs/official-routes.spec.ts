import { expect, test, assertNoBackendRequests } from "../fixtures/test";
import type { Page } from "@playwright/test";

async function assertNoTopOverlay(page: Page) {
  const overlays = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>("*"), (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (element.classList.contains("skip-link") || style.position !== "fixed" || rect.height === 0 || rect.width === 0) return null;
    if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0 || style.pointerEvents === "none") return null;
    return rect.top < 80 ? { tag: element.tagName, role: element.getAttribute("role"), className: element.className } : null;
  }).filter(Boolean));
  expect(overlays, "wallet connection must not leave an app-owned overlay under the host chrome").toEqual([]);
}

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
    await expect(page.getByRole("heading", { name: /Telegram bridge unavailable/i })).toBeVisible({ timeout: 12_000 });
    await expect(page.getByRole("button", { name: /Reload FxAeon/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Continue in browser/i })).toBeVisible();
    assertNoBackendRequests(requests);
  });

  test("a direct Telegram protocol route also fails visibly when its bridge never arrives", async ({ page, requests }) => {
    await page.route("**/telegram-web-app.js", (route) => route.abort("failed"));
    await page.goto("/portfolio#tgWebAppData=query_id%3Dtest&tgWebAppVersion=8.0&tgWebAppPlatform=tdesktop", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Telegram bridge unavailable/i })).toBeVisible({ timeout: 12_000 });
    await expect(page.locator("body")).not.toContainText(/Wallet service unavailable/i);
    await expect(page.getByRole("button", { name: /Reload FxAeon/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Continue in browser/i })).toBeVisible();
    assertNoBackendRequests(requests);
  });
});

test("missing Privy configuration still offers a browser wallet entry", async ({ page, requests }) => {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /connect your wallet/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /connect browser wallet/i })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/wallet setup unavailable|wallet service unavailable|wallet controls are unavailable/i);
  await expect(page.locator("body")).not.toContainText(/private key|session signer|delegat(?:ed|ion)/i);
  assertNoBackendRequests(requests);
});

test.describe("connected browser wallet flows", () => {
  test.use({
    telegram: false,
    browserWallet: {
      address: "0x930f0000000000000000000000000000000098b9",
      initiallyConnected: true,
    },
  });

  test("portfolio shows the selected account and honest balance state", async ({ page, requests }) => {
    await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /portfolio/i })).toBeVisible();
    await expect(page.getByText(/0x930f/i).first()).toBeVisible();
    await expect(page.getByText("Wallet balances", { exact: true })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/\$\s*\d/);
    await assertNoTopOverlay(page);
    assertNoBackendRequests(requests);
  });

  test("trade exposes the full official input set and clamps an over-limit target", async ({ page, requests }) => {
    await page.goto("/trade", { waitUntil: "domcontentloaded" });
    const asset = page.getByLabel("Input asset");
    await asset.click();
    const picker = page.getByRole("listbox", { name: "Input asset options" });
    await expect(picker.getByRole("option")).toHaveCount(7);
    for (const option of ["ETH", "WETH", "stETH", "wstETH", "USDC", "USDT", "fxUSD"]) {
      await expect(picker.getByRole("option", { name: new RegExp(`^${option}`) })).toBeVisible();
    }
    await picker.getByRole("option", { name: /^ETH selected/i }).click();
    await page.getByRole("radio", { name: "BTC" }).click();
    await asset.click();
    const btcPicker = page.getByRole("listbox", { name: "Input asset options" });
    await expect(btcPicker.getByRole("option")).toHaveCount(4);
    await expect(btcPicker.getByRole("option", { name: /^WBTC selected/i })).toBeVisible();
    await btcPicker.getByRole("option", { name: /^WBTC selected/i }).click();
    await page.getByRole("radio", { name: "ETH" }).click();
    await page.getByRole("radio", { name: "Short" }).click();
    await asset.click();
    await expect(page.getByRole("listbox", { name: "Input asset options" }).getByRole("option", { name: /^stETH/i })).toBeVisible();
    await page.getByRole("listbox", { name: "Input asset options" }).getByRole("option", { name: /^ETH selected/i }).click();
    const leverage = page.getByLabel("Target LSD leverage");
    await leverage.fill("20");
    await expect(leverage).toHaveValue("6.9");
    assertNoBackendRequests(requests);
  });

});

test.describe("browser wallet connection", () => {
  test.use({
    telegram: false,
    browserWallet: {
      address: "0x930f0000000000000000000000000000000098b9",
      initiallyConnected: false,
    },
  });

  test("browser users can connect an injected wallet without Telegram", async ({ page, requests }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /connect browser wallet/i }).click();
    await expect(page.getByText("0x930f0000000000000000000000000000000098b9", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /continue to fxaeon/i })).toBeVisible();
    await assertNoTopOverlay(page);
    assertNoBackendRequests(requests);
  });
});

test.describe("More theme controls", () => {
  test.use({ telegram: false });

  test("offers official, black, and light themes with persisted selection", async ({ page, requests }) => {
    await page.goto("/more", { waitUntil: "domcontentloaded" });
    const themes = page.getByRole("radiogroup", { name: "Theme" });
    await expect(themes.getByRole("radio")).toHaveCount(3);
    await themes.getByRole("radio", { name: "Black theme" }).click();
    await expect(themes.getByRole("radio", { name: "Black theme" })).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "black");
    await themes.getByRole("radio", { name: "Light theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await themes.getByRole("radio", { name: "Official theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "violet");
    assertNoBackendRequests(requests);
  });
});

test("unknown routes render the scoped FxAeon recovery screen", async ({ page, requests }) => {
  const response = await page.goto("/outside-official-scope", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(404);
  await expect(page.locator("main")).toBeVisible();
  await expect(page.locator("body")).toContainText(/outside FxAeon|That page is not available/i);
  await expect(page.getByRole("link", { name: /back to portfolio/i })).toBeVisible();
  assertNoBackendRequests(requests);
});
