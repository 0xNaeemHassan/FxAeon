import { expect, test, assertNoBackendRequests } from "../fixtures/test";

type Box = { x: number; y: number; width: number; height: number };

function overlaps(first: Box, second: Box): boolean {
  return first.x < second.x + second.width
    && first.x + first.width > second.x
    && first.y < second.y + second.height
    && first.y + first.height > second.y;
}

test.describe("protocol form help and picker keyboard behavior", () => {
  test.use({ telegram: false });

  test("slippage help supports hover, focus, touch toggle, Escape, and compact geometry", async ({ page, requests }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto("/trade", { waitUntil: "domcontentloaded" });

    // Trade keeps slippage collapsed under the compact Settings disclosure.
    // The aria-hidden arrow is part of summary textContent, so match its label.
    const settings = page.locator(".trade-ticket summary").filter({ hasText: /^Settings/ }).first();
    await expect(settings).toBeVisible();
    await settings.click();
    const settingsPanel = settings.locator("xpath=..");
    const disclosureGeometry = await settingsPanel.evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      ticketWidth: element.closest(".trade-ticket")?.getBoundingClientRect().width ?? 0,
    }));
    expect(disclosureGeometry.width, "expanded Trade settings must use the ticket width on mobile")
      .toBeGreaterThan(disclosureGeometry.ticketWidth - 32);
    await expect(page.getByRole("button", { name: "About slippage tolerance", exact: true })).toBeVisible();

    const helpButton = page.getByRole("button", { name: "About slippage tolerance", exact: true });
    const tooltip = page.getByRole("tooltip");
    const slippageInput = page.getByRole("textbox", { name: "Slippage tolerance percentage", exact: true });
    const slippageLabel = page.locator(`label[for="${await slippageInput.getAttribute("id")}"]`);

    await expect(helpButton).toHaveAttribute("aria-expanded", "false");
    await expect(tooltip).toHaveCount(0);

    // Mouse hover opens the contextual explanation and moving away dismisses it.
    await helpButton.hover();
    await expect(tooltip).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(tooltip).toBeHidden();

    await page.mouse.move(2, 2);
    await helpButton.hover();
    await expect(tooltip).toBeVisible();
    await page.mouse.move(2, 2);
    await expect(tooltip).toBeHidden();

    // Keyboard focus opens the same disclosure and Escape closes it without
    // moving focus away from the compact help control.
    await helpButton.focus();
    await expect(tooltip).toBeVisible();
    await expect(helpButton).toHaveAttribute("aria-describedby", /-help$/);
    await page.keyboard.press("Escape");
    await expect(tooltip).toBeHidden();
    await expect(helpButton).toBeFocused();
    await expect(helpButton).toHaveAttribute("aria-expanded", "false");

    const buttonBox = await helpButton.boundingBox();
    expect(buttonBox).not.toBeNull();
    expect(buttonBox!.width).toBeGreaterThanOrEqual(44);
    expect(buttonBox!.height).toBeGreaterThanOrEqual(44);

    // Exercise a real touch pointerdown/click sequence. A second tap must
    // toggle the disclosure closed rather than being swallowed by focus-open.
    await helpButton.tap();
    await expect(tooltip).toBeVisible();
    await helpButton.tap();
    await expect(tooltip).toBeHidden();

    // At the narrowest supported viewport the popup must not obscure either
    // the field label or the value input it explains.
    await page.mouse.move(2, 2);
    await page.mouse.click(2, 2);
    await helpButton.focus();
    await expect(tooltip).toBeVisible();
    const tooltipBox = await tooltip.boundingBox();
    const labelBox = await slippageLabel.boundingBox();
    const inputBox = await slippageInput.boundingBox();
    expect(tooltipBox).not.toBeNull();
    expect(labelBox).not.toBeNull();
    expect(inputBox).not.toBeNull();
    expect(overlaps(tooltipBox!, labelBox!)).toBe(false);
    expect(overlaps(tooltipBox!, inputBox!)).toBe(false);

    assertNoBackendRequests(requests);
  });

  test("filtered token options keep a tabbable sequence and ArrowDown enters it", async ({ page, requests }) => {
    await page.goto("/trade", { waitUntil: "domcontentloaded" });

    const assetTrigger = page.getByLabel("Input asset");
    await assetTrigger.click();
    const search = page.getByRole("searchbox", { name: "Search assets", exact: true });
    const listbox = page.getByRole("listbox", { name: "Input asset options", exact: true });
    const options = listbox.getByRole("option");
    await expect(search).toBeFocused();

    const selectedInitial = listbox.getByRole("option", { name: / selected$/i });
    const selectedLabel = await selectedInitial.getAttribute("aria-label");
    const selectedSymbol = selectedLabel?.match(/^([^\s]+)/)?.[1] ?? "";
    expect(selectedSymbol).not.toBe("");
    // USDC is part of the rendered ETH-market input allow-list. Confirm it is
    // actually present before using it as the filtered result below.
    await expect(listbox.getByRole("option", { name: /^USDC\b/i })).toBeVisible();

    // The active value is absent from this filtered result. The first result
    // becomes the sole sequentially tabbable option.
    await search.fill("USDC");
    await expect(options).toHaveCount(1);
    await expect(options.first()).toHaveAccessibleName(/^USDC\b/i);
    await expect(listbox.getByRole("option", { name: / selected$/i })).toHaveCount(0);
    await expect(search).toBeFocused();
    expect(await options.evaluateAll((elements) => elements.map((element) => element.tabIndex))).toEqual([0]);
    await search.press("ArrowDown");
    await expect(options.first()).toBeFocused();

    // When the selected value is present, it retains tab stop priority while
    // the other filtered rows stay reachable through roving arrow focus.
    await search.fill(selectedSymbol);
    await expect(search).toBeFocused();
    const selected = listbox.getByRole("option", { name: / selected$/i });
    await expect(selected).toHaveCount(1);
    await expect(selected).toHaveAttribute("tabindex", "0");
    const tabIndexes = await options.evaluateAll((elements) => elements.map((element) => element.tabIndex));
    expect(tabIndexes.filter((tabIndex) => tabIndex === 0)).toHaveLength(1);
    expect(tabIndexes.filter((tabIndex) => tabIndex === -1)).toHaveLength(tabIndexes.length - 1);
    await search.press("ArrowDown");
    await expect(selected).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(search).toBeHidden();
    assertNoBackendRequests(requests);
  });
});
