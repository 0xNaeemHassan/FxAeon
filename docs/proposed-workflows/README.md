# Proposed workflow changes (manual apply needed)

Viktor's GitHub App installation does not have the `workflows` permission, so it
cannot push changes under `.github/workflows/`. Apply these manually (or grant
the permission and they will be PR'd directly):

1. **`gitleaks.yml`** (in this directory) → move to `.github/workflows/gitleaks.yml`.

2. **`smoke-test.yml`** — add the rotated secrets to the smoke-test job env
   (required after this PR, since `smoke-test.js` no longer carries hardcoded values):

   ```yaml
        env:
          TELEGRAM_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          MINI_APP_URL: ${{ secrets.MINI_APP_URL }}
          ALCHEMY_RPC_URL: ${{ secrets.ALCHEMY_RPC_URL }}
          REDIS_URL: ${{ secrets.REDIS_URL }}
          REDIS_TOKEN: ${{ secrets.REDIS_TOKEN }}
   ```
