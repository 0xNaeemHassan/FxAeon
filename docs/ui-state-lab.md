# UI state lab

The permanent UI state lab lives under `apps/mini-app/e2e`. It bundles its entry in memory and runs on a small local fixture server. The dedicated Playwright config starts only that server; it never invokes the Next.js export, production E2E server, wallet, or chain. It uses the real global theme and product-shell styles, component CSS modules, Lucide icons, vendored token artwork, and the app’s Inter font asset with its OFL license. The amount editor is the real `AmountFieldView`. Transaction status uses `buildStatusPresentation`, the same pure model used by `ActionReview`, while final result notices use `ReviewProgress.StatusNotice` and `executionResult.resultPresentation`. The receipt fixtures call the real `buildReceiptPresentation` model to display a known USDC movement, a Base execution-fee caveat, and unknown token details. No signing or network calls are connected.

Run the catalog and its behavioral checks from the repository root:

```sh
pnpm --dir apps/mini-app test:e2e:state-lab
```

Open the interactive catalog in a browser without running tests:

```sh
pnpm --dir apps/mini-app dev:state-lab
```

Then visit `http://127.0.0.1:4322`. Stop the process with Ctrl+C when finished.

It covers loading, verified zero, positive, partial, stale, and unavailable data; eight transaction stages; long values and labels; official, dark, and light themes; keyboard focus; reduced motion; and narrow phone, short phone, tablet, and desktop viewports. Focused screenshots cover four AmountField states, a long amount, official/light themes, a narrow layout, the real consequence-summary component, six transaction progress/result presentations, and both receipt examples. The amount formatting, token metadata, receipt facts, and consequence rendering use production pure helpers/components; only price and haptic providers are stubbed. The existing `action-review-harness.spec.ts` separately exercises the real `ActionReview` controller through planning, review, wallet request, submission, confirmation, interruption, and uncertain/failure paths.

Each run attaches focused images to the Playwright report. To save local review
images under `apps/mini-app/e2e/state-lab/captures/`, set `UI_STATE_CAPTURE=1`
when running the lab. On Windows, normal runs compare against the 17 approved
references in `state-lab-snapshots/`; other platforms run behavior checks and
attach images without comparing Windows pixels.

To intentionally create or update all references after reviewing the images,
run this approval command on the pinned Windows Playwright environment from the
repository root:

```powershell
$env:UI_STATE_APPROVE_BASELINES = '1'
pnpm --dir apps/mini-app exec playwright test --config playwright.state-lab.config.ts --update-snapshots
```

The approval command fails on non-Windows platforms. A missing or incomplete
reference set fails the normal Windows gate. Use the pinned Playwright
Chromium build, scale factor 1, `en-US` locale, and UTC timezone. The default
viewport is 390×844 and the narrow capture is 320×568. Review generated image
changes before approving an updated baseline.
