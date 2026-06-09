# fxBot Mini App

Telegram Mini App for f(x) Protocol DeFi trading.

## Deploy to Cloudflare Pages

### Option 1: Manual Deploy

```bash
# From project root
./deploy-mini-app.sh production
```

### Option 2: Wrangler CLI

```bash
cd apps/mini-app
pnpm install
pnpm build
npx wrangler pages deploy dist --project-name=fxbot-mini-app
```

### Option 3: GitHub Actions (Automated)

Pushes to `main` branch that touch `apps/mini-app/**` or `packages/shared/**` will auto-deploy.

Required secrets in GitHub:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `PRIVY_APP_ID`
- `TELEGRAM_BOT_USERNAME`
- `MINI_APP_URL`
- `ALCHEMY_RPC_URL`

## Environment Variables

| Variable | Description | Source |
|---|---|---|
| `NEXT_PUBLIC_PRIVY_APP_ID` | Privy app ID | `apps/mini-app/.env.local` |
| `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | Bot username | `apps/mini-app/.env.local` |
| `NEXT_PUBLIC_MINI_APP_URL` | Mini App URL | `apps/mini-app/.env.local` |
| `NEXT_PUBLIC_ALCHEMY_RPC_URL` | Ethereum RPC | `apps/mini-app/.env.local` |

## Build

```bash
cd apps/mini-app
pnpm install
pnpm build
```

Output is in `dist/` directory.

## Development

```bash
cd apps/mini-app
pnpm dev
```

Runs on `http://localhost:3000`.
