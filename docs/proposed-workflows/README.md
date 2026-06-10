# Proposed workflow changes (manual apply needed)

Viktor's GitHub App installation does not have the `workflows` permission, so
it cannot push changes under `.github/workflows/`. Copy these files over the
existing ones:

| File here | Replaces | What changed |
|---|---|---|
| `ci.yml` | `.github/workflows/ci.yml` | `--frozen-lockfile` installs; new `verify-addresses` job (mainnet `eth_getCode` check of the address registry) |
| `smoke-test.yml` | `.github/workflows/smoke-test.yml` | adds `ALCHEMY_RPC_URL`, `REDIS_URL`, `REDIS_TOKEN` env (required since W-01 removed hardcoded values from `smoke-test.js`) |

`gitleaks.yml` was already applied by the owner (commit 090e758). ✅
