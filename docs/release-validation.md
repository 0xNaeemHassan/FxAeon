# Release validation record

Use this record with the repository's release checklist. A result applies only
to the source revision named here; update every status and evidence link after
the final changes are ready. A successful typecheck alone is not a release
result.

## Revision

- Commit:
- Pull request:
- Validation date:
- Reviewer:

The results below are from the current working-tree validation. The final
commit and evidence links must be recorded before release.

## Automated gates

| Gate | Result | Evidence |
| --- | --- | --- |
| `pnpm verify` | First run exited 1 on two stale test assertions; a clean full rerun is not recorded. | Initial run log; rerun on final commit pending |
| Root `pnpm typecheck` | Pass; includes the fork TypeScript project. | Local result; attach final log |
| Unit suite | 463 passed; 4 fork-gated tests skipped. | Local test log; attach final log |
| Build and artifact checks | Pass: app build, CSP, bundle, audit, secret scan, and landing checks. | Local logs; attach final reports |
| Built-app browser suite | 155/155 passed. | Playwright report; attach final artifact |
| Isolated browser suites | Borrow 5/5; overlay refresh 13/13; state lab 4/4, with 17 snapshots reviewed. | Harness reports and snapshot review; attach final artifacts |
| Protected Anvil protocol and fxSAVE | 4/4 passed; proof manifests verified. | Redacted protocol and Earn proof manifests; attach final artifacts |
| Protected Anvil browser suite | Pending. | Run and attach redacted proof manifest |

Record failures and retries alongside the final outcome. Keep the production
browser suite, isolated harnesses, and protected fork results distinct; they
exercise different environments and do not substitute for one another. These
results do not constitute a clean final `pnpm verify` run or establish
validation of the eventual PR commit.

## Visual review

The current working-tree gallery in
`artifacts/refinement/generated/run-20260927T025408Z/` contains 55
route/theme/viewport views and 86 PNG frames; all frames were manually
reviewed. Mobile views use the exact 393×852 CSS-pixel baseline across the
official, dark, and light themes. Three official-theme desktop views cover
Portfolio, wallet profile, and Trade at 1440×1000. The built-app browser suite
passed 155/155 checks, including action clearance at the compact baseline.
Interactive targets remain at least 44px and primary actions at least 48px.

| Surface or change | Before reference | Reviewed working-tree capture | Review note |
| --- | --- | --- | --- |
| Shared surfaces, portfolio identity, and assets | Historical build4 [Portfolio](review/assets/portfolio.png) | `portfolio-{official,dark,light}-mobile-01.png` | Theme and route states reviewed; chain balances unavailable in the static fixture. |
| Trade amount control and transaction review | Historical build4 [Trade review](review/assets/trade-review.png) | `trade-eth-long-01.png`; `state-lab-{official,dark,light}-review.png` | Amount form plus generic review UI stages; no flow-specific quote or receipt. |
| Borrow tabs and heading hierarchy | — | `borrow-eth-collateral-01.png` | Editable form state; no synthetic route quote. |
| Earn withdrawal action and navigation clearance | — | `earn-withdraw-instant-01.png`; `earn-withdraw-queued-01.png` | UI states only; no claim or withdrawal was submitted. |
| Move alignment and action placement | Historical build4 [Move](review/assets/move.png) | `move-ethereum-to-base-01.png`; `move-base-to-ethereum-01.png` | Route panel is intentionally centered; no bridge quote was synthesized. |
| Wallet focus, close, and return-focus behavior | Historical build4 [Wallet profile](review/assets/wallet-profile.png) | `wallet-profile-{official,dark,light}-mobile-01.png` | Wallet remains a test shim; balance and asset reads are unavailable. |

These fixture captures document rendered UI, not healthy live balances or
protocol state. See the [visual review record](review/README.md) for route
coverage, themes, source provenance, and the limits of the evidence. Record the
final source revision and capture manifest after the final commit; the current
gallery does not establish final-commit evidence.

Concept art in `artifacts/refinement/concepts/` is not implementation evidence;
verify illustrative protocol values against the app.

## Limits

State whether any native Telegram login or wallet handoff, real bridge delivery,
or other device-only behavior was separately exercised. Do not infer those
results from browser emulation. Link the relevant [testing](testing.md),
[deployment](deployment.md), and [release checklist](launch-readiness.md).
