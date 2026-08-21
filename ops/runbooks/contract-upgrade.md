# Runbook: f(x) contract or SDK upgrade

Trigger this for an official address/implementation/ABI change, SDK release, proxy-admin event, unexplained selector/revert change, or the `fx-upgrade-monitor` workflow.

## Contain

1. Treat an unreviewed upgrade as a funds-risk event, not a routine dependency bump.
2. Disable or isolate affected state-changing routes while preserving read-only diagnostics. Keep bridge execution off if any OFT/LayerZero component changed.
3. Preserve the old SDK package, lockfile, runtime registry, generated policy, deployed bytecode/proxy state, and representative failing routes.

## Verify provenance

- Confirm announcements through at least two authoritative f(x) sources or an on-chain governance/deployment trail.
- Resolve chain ID, proxy, implementation, admin, creation transaction, bytecode, token symbol/decimals, expected selectors, and ownership.
- Compare the installed SDK's exported methods, token lists, bridge constants, and transaction shapes. Do not assume TypeScript declarations and runtime exports are identical.
- Never copy an address from chat, a search result, or an unverified fork.

## Implement and test

1. Update `packages/shared/src/addresses.ts` only for Ethereum registry changes. Base OFTs are currently pinned by SDK 1.0.5 and must be handled as an explicit SDK/policy change.
2. Update only required ABI fragments and server validators.
3. Regenerate the review artifact:

   ```bash
   node scripts/gen-signer-policy.mjs
   node scripts/gen-signer-policy.mjs --check
   ```

4. Run build, typecheck, lint, unit, Mini App E2E, address verification, and relevant funded-fork tests. A skipped fork suite is not evidence.
5. Review targets, selectors, approvals, recipients, native value, refund address, token decimals, reduction units, simulation, receipt handling, and rollback behavior method by method.

## Release and rollback

- Deploy to an isolated/staged environment, perform read-only checks, then a minimal-value canary with explicit approval.
- Re-enable only the reviewed route; do not switch signer policy to `observe` to make a new target pass.
- If behavior differs, disable the affected route/gate and redeploy the last known-good compatible code. Do not blindly roll back a database migration or SDK when on-chain contracts are no longer backward-compatible.
- Monitor policy violations, simulation failures, receipt outcomes, allowances, and user-visible quotes throughout rollout.

Close only when current source, registry/policy artifacts, tests, deployed behavior, and documentation agree on the new contract surface.
