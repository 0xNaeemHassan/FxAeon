# Launch readiness

Local source review, 20 September 2026. This is an implementation checklist, not a claim that production settings or legal requirements have been verified.

The owner has deferred the full legal policy and Terms until official support is established. The current contact route is [@FxAeonxyz on X](https://x.com/FxAeonxyz). Telegram groups and Discord are planned, not published contact channels.

| Item | State and evidence |
| --- | --- |
| Privacy | Added `/privacy.html` to the app with factual device, wallet, provider, and session-storage disclosures. Linked from Docs; the landing links to the same canonical disclosure. Official X is the current contact. The owner has deferred a full policy until support is established; operator identity, hosting-log retention and applicable legal rights remain unspecified. This is not presented as a complete legal privacy policy. |
| Terms | Deferred by the owner until support is established. No entity name, jurisdiction, eligibility restrictions, or enforceable agreement has been invented. Product risk documentation is not a substitute for terms. |
| Frontend secrets | `scripts/verify_frontend_secrets.mjs` checks source or built assets for recognizable Privy secrets, Telegram tokens, private-key blocks/literals, and server credential assignments. The latest source scan covered 153 files with 0 findings; launch/privacy/scanner tests passed 4/4. It prints paths and credential types only. Public Privy app IDs and browser RPC project keys are deliberately distinct; provider restrictions remain a dashboard responsibility. This pattern scan is not a guarantee against every possible secret format. |
| Cloudflare projects | The authenticated dashboard confirms `fxaeon.com` and `www.fxaeon.com` on the `fxaeon` Pages project, and the `fxaeon-landing` project configured from `apps/landing` with `node build.mjs` to `dist`, watching `apps/landing/*`. `fxaeon.xyz` shows Active SSL; a live browser check shows the updated landing and app links reaching `fxaeon.com`. The first merged-main release gate failed in its redirect-URL parser; PR `#195` contains a fix, but the full release gate and Telegram menu synchronization remain pending. |
| HTTPS | App already supplies HSTS, CSP and security headers. Landing now supplies HSTS, a restricted CSP, permissions policy and insecure-request upgrades. HTTP-to-HTTPS redirects and production response headers still need explicit verification on both domains. |
| Cookie consent | No marketing analytics or advertising trackers were found in app or landing source. The landing stores the selected appearance in local storage; this is a preference, not tracking. No consent banner was added merely to satisfy a checklist. Authentication/session storage is documented; provider behavior and any future optional tracking must be reviewed before release. |
| Titles/descriptions | Root app metadata and standalone landing metadata exist; metadata and route-title browser coverage remain part of the ordinary verification suite. |
| Social preview | Supplied official banner is used for social metadata. Visible landing identity uses the app's SVG mark, not the X profile image or banner. |
| Favicon | App has an SVG favicon; landing uses `assets/fxaeon-mark.svg`, copied from the app's logo geometry. |
| Sitemap/robots | Added canonical crawl files for both domains. App sitemap excludes compatibility aliases, login, and personal utility views. Robots rules are crawler guidance, not access control. |
| Image alt text | Landing contract checks every image declares `alt`; empty alternatives are reserved for decorative images or repeated text. |
| Image compression | The new logo-derived landing sculpture is delivered as 1280 × 1280 WebP, 112,582 bytes. The generic ribbon asset and X profile copy are absent from the landing assets. The official social banner remains metadata artwork. |
| Page speed | The ordinary verification bundle gate passed raw/gzip totals, largest chunk, source-map and telemetry checks. These are size guards, not field performance scores. Current landing file measurements are below; no Lighthouse or Core Web Vitals score is claimed. |
| Contrast | The final landing verifier passed computed-color checks across both themes and seven widths, plus rendered text-over-art glyph-mask checks at 390px. The final full-hero wash retained the same contrast minima across 14 theme/width states and passed visual review. Final minimum hero ratios are 5.94:1 large text / 6.64:1 small text in dark mode and 3.97:1 large text / 4.71:1 small text in light mode. The composite measurements below account for the hero artwork and scrim; they are not a blanket accessibility certification. |
| Mobile | Current landing checks passed seven widths in both themes, short desktop CTA reachability, menu keyboard recovery, image loading/aspect ratio, theme persistence and reduced motion. The final full-hero wash also passed all 14 theme/width states. The separate app capture report covers 180 route/state/viewport combinations with no measured horizontal overflow or unreachable/clipped primary CTA. Native Telegram keyboard/wallet handoff remains separate from browser emulation. |
| Custom 404 | App already has a branded error page. Added a branded standalone landing `404.html` with a home action and `noindex`; local preview now serves it with status 404. |
| Broken links | Landing contracts check local referenced resources; app sitemap tests resolve every listed path. The live landing's app links were observed reaching `fxaeon.com`; complete hosted link-map verification remains outstanding. External policy links use official provider domains. |
| Form validation | Amount parsing, address validation, chain checks and transaction policy checks remain in place. Ordinary source/browser tests and the separate funded fork gates passed; their scope and limits are recorded below. |
| Spam protection | No public contact/newsletter submission form exists. No extra CAPTCHA was added to transaction forms. Privy owns authentication controls; the narrow gas endpoint and provider quotas are separate service-abuse concerns. |
| Analytics | Not added. There is no defined measurement requirement, and adding tracking would create another privacy, payload and consent dependency. |
| Clear CTA | Root owns landing hierarchy and CTA design. App buttons continue to reflect connection, network and action state. |

## Checks for these changes

- `node --test scripts/verify_frontend_secrets.test.mjs scripts/launch_readiness.test.mjs`
- `node scripts/verify_frontend_secrets.mjs`
- `node scripts/verify_frontend_secrets.mjs --built` after both final builds
- `node apps/landing/build.mjs` and `node --test apps/landing/test/static.test.mjs`
- Local landing requests: home, robots, sitemap, document CSS and icon return 200; a missing path returns the custom 404; preview includes CSP.

Final verification passed on PR `#193` head
`064229b6fb6640f9d16087ab48da13e85b05f356`: all six CI checks passed, including
Client CI's full `pnpm verify` with exit code `0` and built-browser E2E. After
test-only hardening of stale-preview scheduling, the focused harness passed 3/3
and the full browser suite passed 109/109 in 5.8 minutes; see
`%TEMP%/fxaeon-final-109-e2e-identity.log`. Full and production dependency
audits report zero known vulnerabilities. Two pre-existing high-severity
development-dependency findings were resolved by updating `js-yaml` to 4.3.2
and Miniflare's nested `sharp` to 0.35.4. Final lint passed with zero warnings.
These are source and browser verification results; they do not complete the
pending deployment-release gate described in the Cloudflare row above.
The follow-up source secret scan covered 153 files with zero findings, and
launch/privacy/scanner tests passed 4/4. The final landing theme/motion
iteration passed eight static tests and all 14 theme/width browser states,
including the independent final composite contrast review.
Current landing captures are
`artifacts/landing/landing-390.png`, `landing-1440.png`,
`landing-light-390.png`, `landing-light-1440.png`, and the two
`landing-hero-390-{dark,light}.png` crops.
The nine standard app documentation screenshots were refreshed with live
external display data and verified zero runtime, fallback, or discovery errors;
their routes, viewports, and hashes are in
[`standard-screenshot-manifest.json`](fixtures/standard-screenshot-manifest.json).
They are rendered UI documentation, separate from the funded browser-fork proof.

`artifacts/current-polish/full-report.json` records 180 app captures across 15
routes, six viewport sizes, and disconnected/connected wallet states. There were
zero horizontal-overflow findings and zero CTA clipping/reachability failures.
Fourteen primary actions started below the fold and were reachable after
scrolling. Connected mode used the existing deterministic browser-wallet shim;
public display-price requests were not intercepted, and no transaction methods
were called. The report describes its captured build, not later source edits,
native login, production deployment, or financial transaction proof.

The separate funded browser gate passed at pinned Ethereum block `25965421`.
`artifacts/anvil/browser-proof.json` records four coexisting ETH/BTC long/short
opens and all four closes, verified ownership and nonzero position accounting,
direct discovery despite indexer lag, an externally created position without a
local journal, account/ownership isolation, confirmation/reload recovery, borrowing
fxUSD against the existing long with wallet proceeds received, and balance refresh
after closing. Its `snapshotRevertedAfterProof` assertion is true. The transactions
used a disposable local fork and test wallet adapter, not real funds or native
wallet handoffs.

`%TEMP%/fxaeon-final-all-fork.log` separately records four of four passing tests,
zero failures and zero skips: the protocol proof, fxSAVE lifecycle and both stress
campaigns. The current manifests are `artifacts/anvil/protocol-all-proof.json`
and `artifacts/anvil/earn-proof.json`. These local gates do not establish production
Cloudflare deployment, native Telegram/Privy sign-in, or real bridge delivery.

## Bounded source review

The landing requests a local 748-byte SVG mark and a 112,582-byte hero image.
Current HTML, CSS, and script measure 10,850, 26,608, and 5,242 bytes raw, and
2,926, 5,864, and 1,792 bytes with local gzip level 9. The SVG mark is 435 bytes
with local gzip level 9. These are local file measurements, not transferred
bytes, Core Web Vitals, or a Lighthouse score.
The social banner is referenced in metadata and is not rendered in the page.
`apps/landing/assets/portfolio-preview.png` and
`apps/landing/assets/portfolio-mobile.png` are exact copies of
`docs/assets/fxaeon-positions.png` and
`docs/assets/fxaeon-positions-mobile.png`, respectively, as recorded with
SHA-256 hashes in the position screenshot manifest. The desktop and mobile
captures are 172,400 and 69,521 bytes and both are lazy-loaded. Landing-local
ETH, WBTC, fxUSD, USDC, fxSAVE and Ethereum/Base marks are exact copies of the
corresponding app token and chain assets. The 1280 × 1280 hero WebP is eager
with high fetch priority. File totals are not evidence that every asset is
requested during initial page load.

WCAG relative-luminance calculations for the current opaque source colors:

| Foreground / background | Ratio | Use |
| --- | --- | --- |
| `#fbf9ff` / `#0d0b14` | 18.69:1 | Dark-section text |
| `#b9b1c4` / `#0d0b14` | 9.44:1 | Secondary text |
| `#b89cf8` / `#0d0b14` | 8.51:1 | Dark-section accent |
| `#191225` / `#b89cf8` | 7.92:1 | Primary button |
| `#554a64` / `#e8def7` | 6.36:1 | Hero supporting text |
| `#191225` / `#e8def7` | 14.05:1 | Hero heading |
| `#8060d6` / `#e8def7` | 3.56:1 | Closing large display heading |
| `#6848b7` / `#e8def7` | 5.07:1 | Light hero large display heading, opaque base only |
| `#675d72` / `#f4effb` | 5.49:1 | Light product supporting text |
| `#6848b7` / `#f4effb` | 5.81:1 | Light product link/accent |
| `#8060d6` / `#171321` | 3.96:1 | Dark showcase large heading |

The final post-redesign 390px glyph-mask probe measures the background directly
behind rendered hero text, including the sculpture and scrim. These captured
composite values supersede the earlier opaque-base-only assessment for that
mobile hero:

| Theme / text | Minimum measured ratio | Threshold |
| --- | --- | --- |
| Dark white headline | 13.34:1 | 3:1 |
| Dark lavender headline | 5.94:1 | 3:1 |
| Dark supporting text | 6.64:1 | 4.5:1 |
| Dark small SDK/network line | 7.61:1 | 4.5:1 |
| Light dark headline | 11.20:1 | 3:1 |
| Light violet headline | 3.97:1 | 3:1 |
| Light supporting text | 4.71:1 | 4.5:1 |
| Light small SDK/network line | 4.72:1 | 4.5:1 |

Evidence: `artifacts/landing/landing-hero-390-dark.png` and
`artifacts/landing/landing-hero-390-light.png`, produced by the final
`scripts/verify_landing_browser.mjs` run. Light small text has a modest margin
above the threshold; changes to artwork, scrim, typography or colors require
rerunning the composite check.

Motion includes finite entrance/reveal, hover feedback and small pointer-driven hero movement. The browser checks confirm one-iteration entrances settle within 700 ms, reduced-motion mode suppresses entrances, and changing that preference cancels motion and disables pointer movement. Content remains visible without JavaScript. The selected light/dark theme is restored from local storage before the stylesheet loads.

Privy can store sessions in local storage or configured cookies. DNS records alone do not prove production cookie activation; the Privy domain verification and configuration must be checked. See [Privy's cookie configuration](https://docs.privy.io/recipes/react/cookies) and [privacy policy](https://www.privy.io/privacy-policy).
