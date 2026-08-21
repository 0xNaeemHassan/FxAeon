FROM node:22-alpine

WORKDIR /app

# Build tools for native modules (@sentry/profiling-node, keccak, etc.)
# plus openssl for Prisma engine
RUN apk add --no-cache python3 make g++ openssl

# Install pnpm
RUN npm install -g pnpm@11.16.0

# Copy workspace config + per-package manifests (cache-friendly layer)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY apps/bot/package.json ./apps/bot/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source (includes i18n JSON locale files needed at runtime)
COPY packages/shared/ ./packages/shared/
COPY packages/db/ ./packages/db/
COPY apps/bot/ ./apps/bot/

# Build all workspaces (turbo: shared → db → bot)
RUN pnpm build

ENV NODE_ENV=production

EXPOSE 8080

# The service never needs root after its build artifacts are created.
USER node

CMD ["node", "apps/bot/dist/main.js"]
