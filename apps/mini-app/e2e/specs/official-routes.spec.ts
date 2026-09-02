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
  "/activity",
  "/qr",
] as const;

test.describe("official f(x) client routes", () => {
  for (const route of OFFICIAL_ROUTES) {
    test(`${route} loads without an FxAeon backend`, async ({ page, requests }) => {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page.locator("main:visible")).toBeVisible();
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
    await expect(page.locator("main:visible")).toBeVisible();
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
    await expect(page.locator("body")).not.toContainText("Transaction status");
    await assertNoTopOverlay(page);
    assertNoBackendRequests(requests);
  });

  test("wallet profile opens only on demand and exposes Activity", async ({ page, requests }) => {
    await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
    await assertNoTopOverlay(page);
    await page.getByRole("button", { name: "Open wallet profile" }).click();
    const profile = page.getByRole("dialog", { name: "Wallet profile" });
    await expect(profile).toBeVisible();
    await expect(profile.getByRole("link", { name: /Activity/ })).toBeVisible();
    await profile.getByRole("link", { name: /Activity/ }).click();
    await expect(page).toHaveURL(/\/activity\/?$/);
    await expect(page.getByRole("heading", { name: "Activity", level: 1 })).toBeVisible();
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
    const leverage = page.getByRole("spinbutton", { name: "Target LSD leverage", exact: true });
    await leverage.fill("20");
    await expect(leverage).toHaveValue("6.9");
    assertNoBackendRequests(requests);
  });

});

test.describe("live USD context", () => {
  test.use({
    telegram: false,
    marketPrices: true,
    browserWallet: {
      address: "0x930f0000000000000000000000000000000098b9",
      initiallyConnected: true,
    },
  });

  test("shows market prices, input USD value, token prices, and a leverage slider", async ({ page, requests }) => {
    await page.goto("/trade", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("$2,400.00", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("img", { name: /^ETH 1D USD price chart/ })).toBeVisible();
    await page.getByRole("radio", { name: "7D" }).click();
    await expect(page.getByRole("img", { name: /^ETH 7D USD price chart/ })).toBeVisible();
    await page.getByRole("radio", { name: "BTC" }).click();
    await expect(page.getByRole("img", { name: /^BTC 7D USD price chart/ })).toBeVisible();
    await page.getByRole("radio", { name: "ETH" }).click();
    await page.getByLabel("Amount in ETH").fill("2");
    await expect(page.getByText("≈ $4,800.00", { exact: true })).toBeVisible();
    await page.getByLabel("Input asset").click();
    await expect(page.getByRole("listbox", { name: "Input asset options" }).getByText("$2,400.00", { exact: true }).first()).toBeVisible();
    await page.keyboard.press("Escape");
    const slider = page.getByRole("slider", { name: "Target leverage slider" });
    await expect(slider).toBeVisible();
    await slider.fill("3");
    await expect(page.getByRole("spinbutton", { name: "Target leverage", exact: true })).toHaveValue("3");
    assertNoBackendRequests(requests);
  });

  test("keeps live USD context available across every asset workspace", async ({ page, requests }) => {
    for (const route of ["/portfolio", "/positions", "/borrow", "/earn", "/move", "/more", "/settings", "/activity", "/qr"]) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("region", { name: "Live USD prices" }).getByText("$2,400.00", { exact: true })).toBeVisible();
    }
    assertNoBackendRequests(requests);
  });

  test("keeps a recent validated snapshot visible across a hard navigation when the feed retries", async ({ page, requests }) => {
    await page.unroute("https://coins.llama.fi/**");
    let calls = 0;
    await page.route("https://coins.llama.fi/**", async (route) => {
      calls += 1;
      if (calls > 1) return route.abort("failed");
      const encodedIds = new URL(route.request().url()).pathname.split("/prices/current/")[1] ?? "";
      const ids = decodeURIComponent(encodedIds).split(",").filter(Boolean);
      const timestamp = Math.floor(Date.now() / 1000);
      const coins = Object.fromEntries(ids.map((id) => {
        const normalised = id.toLowerCase();
        const price = normalised.includes("2260fac5e5542a773aa44fbcfedf7c193bc2c599")
          ? 104_000
          : normalised.includes("c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2")
            ? 2_400
            : 1;
        return [id, { price, timestamp, confidence: 0.99 }];
      }));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ coins }) });
    });

    await page.goto("/trade", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("region", { name: "Live USD prices" }).getByText("$2,400.00", { exact: true })).toBeVisible();
    await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("region", { name: "Live USD prices" }).getByText("$2,400.00", { exact: true })).toBeVisible();
    await expect.poll(() => calls).toBeGreaterThan(1);
    await expect(page.getByRole("region", { name: "Live USD prices" })).toContainText("Last USD");
    assertNoBackendRequests(requests);
  });
});

test("Earn exposes Borrow and fxMINT as a first-class product", async ({ page, requests }) => {
  await page.goto("/earn", { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: "Borrow / fxMINT" }).click();
  await expect(page).toHaveURL(/\/borrow\/?$/);
  await expect(page.getByRole("heading", { name: "Borrow" })).toBeVisible();
  await expect(page.getByText("Borrow / fxMINT", { exact: true })).toBeVisible();
  assertNoBackendRequests(requests);
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

test.describe("official theme control", () => {
  test.use({ telegram: false });

  test("switches between the official light and dark themes and persists the choice", async ({ page, requests }) => {
    await page.goto("/more", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("radiogroup", { name: "Theme" })).toHaveCount(0);
    await page.getByRole("button", { name: "Switch to light theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("button", { name: "Switch to dark theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    assertNoBackendRequests(requests);
  });
});

test("unknown routes render the scoped FxAeon recovery screen", async ({ page, requests }) => {
  const response = await page.goto("/outside-official-scope", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(404);
  await expect(page.locator("main:visible")).toBeVisible();
  await expect(page.locator("body")).toContainText(/outside FxAeon|That page is not available/i);
  await expect(page.getByRole("link", { name: /back to portfolio/i })).toBeVisible();
  assertNoBackendRequests(requests);
});
