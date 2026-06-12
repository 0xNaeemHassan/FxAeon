# Runbook: f(x) Protocol Contract Upgrade

## Symptoms
- Contract calls failing with new error codes
- ABI mismatch errors
- New contract addresses announced

## Steps
1. Check f(x) Protocol announcements
2. Verify new contract addresses on Etherscan
3. Update `packages/shared/src/contracts.ts`
4. Update ABIs in `packages/shared/src/abis.ts`
5. Run test suite: `pnpm test`
6. Deploy updated bot: merge to `main` (Render auto-deploys)
7. Monitor for 1 hour post-deploy

## Rollback
- If issues detected, revert to previous commit
- `git revert HEAD && git push` (Render auto-deploys the revert)
