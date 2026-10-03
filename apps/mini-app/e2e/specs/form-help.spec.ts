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

    const settings = page.getByRole("button", { name: /^Transaction settings,/ });
    await expect(settings).toBeVisible();
    await settings.click();
    const settingsPanel = page.getByRole("dialog", { name: "Transaction settings" });
    await expect(settingsPanel).toBeVisible();
    const ticketWidth = await page.locator(".trade-ticket").evaluate((element) => element.getBoundingClientRect().width);
    const disclosureGeometry = await settingsPanel.evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      left: element.getBoundingClientRect().left,
      right: element.getBoundingClientRect().right,
    }));
    expect(disclosureGeometry.width, "expanded Trade settings must use the ticket width on mobile")
      .toBeGreaterThan(ticketWidth - 32);
    expect(disclosureGeometry.left).toBeGreaterThanOrEqual(0);
    expect(disclosureGeometry.right).toBeLessThanOrEqual(320);
    await expect(page.getByRole("button", { name: "About slippage tolerance", exact: true })).toBeVisible();

    const helpButton = page.getByRole("button", { name: "About slippage tolerance", exact: true });
    const tooltip = page.getByRole("tooltip");
    const slippageInput = page.getByRole("textbox", { name: "Slippage tolerance percentage", exact: true });

    await expect(helpButton).toHaveAttribute("aria-expanded", "false");
    await expect(tooltip).toHaveCount(0);

    // Mouse hover opens the contextual explanation and moving away dismisses it.
    await helpButton.hover();
    await expect(tooltip).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(tooltip).toBeHidden();
    await expect(settingsPanel).toBeHidden();
    await expect(settings).toBeFocused();

    // Reopen the modal to verify hover, keyboard focus, and touch behavior
    // inside the live settings surface.
    await settings.click();
    await expect(settingsPanel).toBeVisible();

    await page.mouse.move(2, 2);
    await helpButton.hover();
    await expect(tooltip).toBeVisible();
    await page.mouse.move(2, 2);
    await expect(tooltip).toBeHidden();

    // Keyboard focus opens the contextual explanation. Escape closes the
    // settings dialog and returns focus to its trigger.
    await helpButton.focus();
    await expect(tooltip).toBeVisible();
    await expect(helpButton).toHaveAttribute("aria-describedby", /-help$/);
    await page.keyboard.press("Escape");
    await expect(tooltip).toBeHidden();
    await expect(settingsPanel).toBeHidden();
    await expect(settings).toBeFocused();

    await settings.click();
    await expect(settingsPanel).toBeVisible();
    const reopenedHelpButton = page.getByRole("button", { name: "About slippage tolerance", exact: true });
    const reopenedTooltip = page.getByRole("tooltip");

    const buttonBox = await reopenedHelpButton.boundingBox();
    expect(buttonBox).not.toBeNull();
    expect(buttonBox!.width).toBeGreaterThanOrEqual(44);
    expect(buttonBox!.height).toBeGreaterThanOrEqual(44);

    // Exercise a real touch pointerdown/click sequence. A second tap must
    // toggle the disclosure closed rather than being swallowed by focus-open.
    await reopenedHelpButton.tap();
    await expect(reopenedTooltip).toBeVisible();
    // The dialog remounts after its exit animation, generating a new input ID.
    const slippageLabel = page.locator(`label[for="${await slippageInput.getAttribute("id")}"]`);
    await reopenedHelpButton.tap();
    await expect(reopenedTooltip).toBeHidden();

    // At the narrowest supported viewport the popup must not obscure either
    // the field label or the value input it explains.
    await page.mouse.move(2, 2);
    await slippageInput.focus();
    await reopenedHelpButton.focus();
    await expect(reopenedTooltip).toBeVisible();
    const tooltipBox = await reopenedTooltip.boundingBox();
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
