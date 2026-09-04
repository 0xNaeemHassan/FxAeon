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
  "/docs",
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

  test("wallet entry stays on every app route", async ({ page, requests }) => {
    for (const route of OFFICIAL_ROUTES) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      const connect = page.locator(".app-topbar").getByRole("button", { name: "Connect wallet", exact: true });
      await expect(connect).toBeEnabled();
      await connect.click();
      await expect(page).toHaveURL(new RegExp(`${route.replace("/", "\\/")}(?:\\/)?$`));
      await expect(page.locator(".wallet-connect-toast")).toContainText(/No browser wallet detected/i);
    }
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

  test("a Telegram launch remains usable when its bridge never arrives", async ({ page, requests }) => {
    await page.route("**/telegram-web-app.js", (route) => route.abort("failed"));
    await page.goto("/#tgWebAppData=query_id%3Dtest&tgWebAppVersion=8.0&tgWebAppPlatform=tdesktop", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/portfolio\/?(?:#.*)?$/, { timeout: 5_000 });
    await expect(page.getByRole("heading", { name: /portfolio/i })).toBeVisible();
    await expect(page.getByText("Connect wallet", { exact: true })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/Telegram bridge unavailable/i);
    assertNoBackendRequests(requests);
  });

  test("a direct Telegram protocol route keeps an in-place wallet fallback", async ({ page, requests }) => {
    await page.route("**/telegram-web-app.js", (route) => route.abort("failed"));
    await page.goto("/portfolio#tgWebAppData=query_id%3Dtest&tgWebAppVersion=8.0&tgWebAppPlatform=tdesktop", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /portfolio/i })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/Wallet service unavailable/i);
    await expect(page.locator("body")).not.toContainText(/Telegram bridge unavailable/i);
    await page.getByText("Connect wallet", { exact: true }).click();
    await expect(page).toHaveURL(/\/portfolio(?:#.*)?$/);
    await expect(page.locator(".wallet-connect-toast")).toContainText(/No browser wallet detected/i);
    await expect(page.locator("body")).not.toContainText(/Telegram bridge unavailable/i);
    assertNoBackendRequests(requests);
  });
});

test("missing Privy configuration still offers a browser wallet entry", async ({ page, requests }) => {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /connect your wallet/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /connect browser wallet/i })).toBeVisible();
  await expect(page.getByText(/02\s*Wallet access|Connect once|A focused home for your Ethereum markets/i)).toHaveCount(0);
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
    await expect(page.getByText("Wallet balances", { exact: true })).toHaveCount(0);
    await expect(page.getByText('Ethereum reads are unavailable right now.', { exact: false })).toBeVisible();
    await expect(page.locator('.portfolio-value-metrics').getByText('—', { exact: true })).toHaveCount(3);
    await expect(page.getByText('Verified units', { exact: true })).toHaveCount(0);
    await expect(page.getByText('0 assets', { exact: true })).toHaveCount(0);
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
    await expect(profile.getByRole("link", { name: "View wallet on Etherscan" })).toHaveAttribute("href", /etherscan\.io\/address\/0x930f/i);
    await expect(profile.getByRole("link", { name: /Activity/ })).toBeVisible();
    await profile.getByRole("link", { name: /Activity/ }).click();
    await expect(page).toHaveURL(/\/activity\/?$/);
    await expect(page.getByRole("heading", { name: "Activity", level: 1 })).toBeVisible();
    assertNoBackendRequests(requests);
  });

  test("trade exposes the full official input set and bounds leverage in all four position flows", async ({ page, requests }) => {
    await page.goto("/trade", { waitUntil: "domcontentloaded" });
    // Restoring the fixture's account starts a new wallet-scoped form session.
    // Establish this connected-flow precondition before interacting with it.
    await expect(page.getByRole("button", { name: "Open wallet profile" })).toBeVisible();
    const asset = page.getByLabel("Input asset");
    await asset.click();
    const picker = page.getByRole("listbox", { name: "Input asset options" });
    await expect(picker.getByRole("option")).toHaveCount(7);
    const search = page.getByRole("searchbox", { name: "Search assets" });
    await expect(search).toBeFocused();
    await search.fill("tether");
    await expect(picker.getByRole("option")).toHaveCount(1);
    await expect(picker.getByRole("option", { name: /^USDT/i })).toBeVisible();
    await search.fill("");
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
    for (const flow of [
      { market: "ETH", side: "Long", label: "Target leverage", min: "1.1", max: "6.8" },
      { market: "ETH", side: "Short", label: "Target LSD leverage", min: "0.1", max: "6.9" },
      { market: "BTC", side: "Long", label: "Target leverage", min: "1.1", max: "6.8" },
      { market: "BTC", side: "Short", label: "Target LSD leverage", min: "0.1", max: "6.9" },
    ] as const) {
      await page.getByRole("radio", { name: flow.market, exact: true }).click();
      await page.getByRole("radio", { name: flow.side, exact: true }).click();
      const leverage = page.getByRole("spinbutton", { name: flow.label, exact: true });
      await expect(leverage).toHaveAttribute("min", flow.min);
      await expect(leverage).toHaveAttribute("max", flow.max);
      await leverage.fill("20");
      await expect(leverage).toHaveValue(flow.max);
      await leverage.fill("0.01");
      await leverage.blur();
      await expect(leverage).toHaveValue(flow.min);
    }
    assertNoBackendRequests(requests);
  });

  test("skip link stays hidden during connected Trade scrolling and remains keyboard accessible", async ({ page, requests }) => {
    await page.goto("/trade", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Open wallet profile" })).toBeVisible();
    const skipLink = page.getByRole("link", { name: "Skip to main content", exact: true });
    const brandLink = page.getByRole("link", { name: "FxAeon portfolio", exact: true });
    const main = page.locator("#main-content");
    const assertSkipLinkHidden = async () => {
      // Off-screen translation alone is insufficient: the mobile compositor
      // must have neither a painted nor pointer-interactive resting overlay.
      await expect(skipLink).not.toBeFocused();
      await expect(skipLink).toHaveCSS("opacity", "0");
      await expect(skipLink).toHaveCSS("pointer-events", "none");
    };

    await assertSkipLinkHidden();
    // The compact mobile ticket now fits leverage in the first fold. Scroll
    // explicitly to keep exercising the connected-page overlay regression.
    await page.mouse.wheel(0, 500);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await assertSkipLinkHidden();

    const asset = page.getByLabel("Input asset");
    await asset.click();
    await expect(page.getByRole("searchbox", { name: "Search assets" })).toBeFocused();
    await assertSkipLinkHidden();
    await page.getByRole("listbox", { name: "Input asset options" }).getByRole("option", { name: /^USDC/i }).click();
    await expect(asset).toContainText("USDC");
    await assertSkipLinkHidden();

    // Enter the skip link through real keyboard navigation from the next
    // focusable link, not a forced click on an otherwise invisible element.
    await brandLink.focus();
    await page.keyboard.press("Shift+Tab");
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toHaveCSS("opacity", "1");
    await expect(skipLink).toHaveCSS("pointer-events", "auto");
    await expect(skipLink).toBeInViewport();

    await page.keyboard.press("Tab");
    await expect(brandLink).toBeFocused();
    await assertSkipLinkHidden();

    await page.keyboard.press("Shift+Tab");
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toHaveAttribute("href", "#main-content");
    await page.keyboard.press("Enter");
    await expect(main).toBeFocused();
    await expect(page).toHaveURL(/\/trade\/?#main-content$/);
    await assertSkipLinkHidden();
    assertNoBackendRequests(requests);
  });

});

test.describe("market price context", () => {
  test.use({
    telegram: false,
    marketPrices: true,
    browserWallet: {
      address: "0x930f0000000000000000000000000000000098b9",
      initiallyConnected: true,
    },
  });

  test("shows market prices and input USD without confusing token prices with owned balances", async ({ page, requests }) => {
    await page.goto("/trade", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("$2,400.00", { exact: true }).first()).toBeVisible();
    const chartContent = page.locator(".market-chart-content");
    const showChart = page.getByRole("button", { name: "Show chart", exact: true });
    await expect(showChart).toHaveAttribute("aria-expanded", "false");
    await expect(chartContent).toBeHidden();
    await expect(showChart).toHaveAttribute("aria-controls", (await chartContent.getAttribute("id"))!);
    expect((await showChart.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await showChart.click();
    await expect(page.getByRole("button", { name: "Hide chart", exact: true })).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("img", { name: /^ETH 1D USD price chart/ })).toBeVisible();
    await expect.poll(async () => page.locator(".market-chart-frame").evaluate((element) => element.getBoundingClientRect().height)).toBeLessThanOrEqual(170);
    const oneDay = page.getByRole("radio", { name: "1D" });
    await oneDay.focus();
    await oneDay.press("ArrowRight");
    await expect(page.getByRole("radio", { name: "7D" })).toBeFocused();
    await expect(page.getByRole("img", { name: /^ETH 7D USD price chart/ })).toBeVisible();
    await page.getByRole("radio", { name: "BTC" }).click();
    await expect(page.getByRole("img", { name: /^BTC 7D USD price chart/ })).toBeVisible();
    await page.getByRole("radio", { name: "ETH" }).click();
    await page.getByRole("button", { name: "Hide chart", exact: true }).click();
    await expect(chartContent).toBeHidden();
    await expect(showChart).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByLabel("Input asset")).toBeVisible();
    await page.getByLabel("Amount in ETH").fill("2");
    await expect(page.getByText("≈ $4,800.00", { exact: true })).toBeVisible();
    await page.getByLabel("Input asset").click();
    const ethOption = page.getByRole("listbox", { name: "Input asset options" }).getByRole("option", { name: /^ETH selected$/ });
    // This build has no RPC configured: a known token price is not evidence
    // of an owned balance, and must not appear as the wallet's USD worth.
    await expect(ethOption).toContainText("Balance unavailable");
    await expect(ethOption).not.toContainText("USD unavailable");
    await expect(ethOption.getByText("$2,400.00", { exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    const slider = page.getByRole("slider", { name: "Target leverage slider" });
    await expect(slider).toBeVisible();
    await slider.fill("3");
    await expect(page.getByRole("spinbutton", { name: "Target leverage", exact: true })).toHaveValue("3");
    assertNoBackendRequests(requests);
  });

  test("shows the desktop chart by default and keeps its disclosure state correct across resizing", async ({ page, requests }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/trade", { waitUntil: "domcontentloaded" });
    const chartContent = page.locator(".market-chart-content");
    const toggle = page.locator(".market-chart-toggle");
    await expect(page.getByRole("img", { name: /^ETH 1D USD price chart/ })).toBeVisible();
    await expect(toggle).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    await page.setViewportSize({ width: 640, height: 844 });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveText("Show chart");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(chartContent).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(chartContent).toBeVisible();

    await page.setViewportSize({ width: 641, height: 844 });
    await expect(chartContent).toBeVisible();
    await expect(toggle).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(toggle).toHaveText("Hide chart");
    await toggle.click();
    await expect(chartContent).toBeHidden();
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(chartContent).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(chartContent).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    assertNoBackendRequests(requests);
  });

  test("keeps compact market context available across every asset workspace", async ({ page, requests }) => {
    for (const route of ["/portfolio", "/positions", "/borrow", "/earn", "/move", "/more", "/settings", "/activity", "/qr"]) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      const strip = page.getByRole("region", { name: "Market prices" });
      await expect(strip.getByText("$2,400.00", { exact: true })).toBeVisible();
      await expect(strip.locator(".market-strip-item").filter({ hasText: "FXN" })).toContainText("$26.00");
      const geometry = await strip.evaluate((element) => {
        const frame = element.getBoundingClientRect();
        const items = [...element.querySelectorAll<HTMLElement>(".market-strip-item")]
          .map((item) => item.getBoundingClientRect());
        return {
          frameCenter: frame.left + frame.width / 2,
          contentCenter: (items[0].left + items[items.length - 1].right) / 2,
          overflows: items[0].left < frame.left || items[items.length - 1].right > frame.right,
        };
      });
      expect(geometry.overflows).toBe(false);
      expect(Math.abs(geometry.contentCenter - geometry.frameCenter)).toBeLessThanOrEqual(2);
      await expect(strip).not.toContainText("Live USD");
    }
    assertNoBackendRequests(requests);
  });

  test("desktop portfolio sparklines stay inside their compact card frames", async ({ page, requests }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/portfolio', { waitUntil: 'domcontentloaded' });
    const charts = page.locator('.portfolio-market-card .market-chart-compact');
    await expect(charts).toHaveCount(2);
    for (const chart of await charts.all()) {
      await expect(chart.getByRole('img')).toBeVisible();
      const geometry = await chart.evaluate((element) => ({
        chart: element.getBoundingClientRect().height,
        frame: element.parentElement!.getBoundingClientRect().height,
      }));
      expect(geometry.chart).toBeLessThanOrEqual(54);
      expect(geometry.chart).toBeLessThanOrEqual(geometry.frame);
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
    await expect(page.getByRole("region", { name: "Market prices" }).getByText("$2,400.00", { exact: true })).toBeVisible();
    await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
    const strip = page.getByRole("region", { name: "Market prices" });
    await expect(strip.getByText("$2,400.00", { exact: true })).toBeVisible();
    await expect.poll(() => calls).toBeGreaterThan(1);
    await expect(strip).not.toContainText("Last USD");
    assertNoBackendRequests(requests);
  });
});

test("Earn links to borrowing without presenting positions as savings", async ({ page, requests }) => {
  await page.goto("/earn", { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: "Borrow fxUSD" }).click();
  await expect(page).toHaveURL(/\/borrow\/?$/);
  await expect(page.getByRole("heading", { name: "Borrow" })).toBeVisible();
  await expect(page.getByText("Borrow fxUSD", { exact: true })).toBeVisible();
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
    await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
    await page.getByRole("main").getByRole("button", { name: "Connect wallet", exact: true }).click();
    await expect(page).toHaveURL(/\/portfolio\/?$/);
    await expect(page.getByRole("button", { name: "Open wallet profile", exact: true })).toBeVisible();
    await expect(page.getByText("0x930f0000000000000000000000000000000098b9", { exact: true })).toHaveCount(0);
    await assertNoTopOverlay(page);
    assertNoBackendRequests(requests);
  });

  test("Move recipient connects the wallet without leaving the route", async ({ page, requests }) => {
    await page.goto("/move", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Connect wallet for recipient", exact: true }).click();
    await expect(page).toHaveURL(/\/move\/?$/);
    await expect(page.getByText("Connected wallet", { exact: true })).toBeVisible();
    await expect(page.getByText("0x930f…98b9", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect wallet for recipient", exact: true })).toHaveCount(0);
    await assertNoTopOverlay(page);
    assertNoBackendRequests(requests);
  });
});

test.describe("theme control", () => {
  test.use({ telegram: false });

  test("switches among official, dark, and light themes, supports radio-key navigation, and persists the choice", async ({ page, requests }) => {
    await page.goto("/more", { waitUntil: "domcontentloaded" });
    const appearance = page.getByRole("radiogroup", { name: "Appearance theme", exact: true });
    await expect(appearance.getByRole("radio")).toHaveCount(3);
    const officialTheme = appearance.getByRole("radio", { name: /^Official/ });
    await expect(officialTheme).toHaveAttribute("aria-checked", "true");
    await officialTheme.focus();
    await officialTheme.press("ArrowRight");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(appearance.getByRole("radio", { name: /^Dark/ })).toHaveAttribute("aria-checked", "true");
    await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Switch to light theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.getByRole("main").getByRole("button", { name: "Connect wallet", exact: true })).toHaveCSS("color", "rgb(255, 255, 255)");
    await page.goto("/more", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Switch to official theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "official");
    await page.evaluate(() => {
      window.localStorage.removeItem("fxaeon_theme_id_v2");
      window.localStorage.setItem("fxaeon_theme_id", "dark");
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "official");
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
