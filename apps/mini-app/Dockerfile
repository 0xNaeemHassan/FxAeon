FROM node:22-alpine AS deps

WORKDIR /app
RUN npm install -g pnpm@11.16.0

# Copy only dependency manifests first so this expensive layer stays cached.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/mini-app/package.json ./apps/mini-app/
RUN pnpm install --frozen-lockfile --filter @fxaeon/mini-app...

FROM node:22-alpine AS builder

WORKDIR /app
RUN npm install -g pnpm@11.16.0
COPY --from=deps /app/ ./
COPY tsconfig.json turbo.json ./
COPY packages/shared/ ./packages/shared/
COPY apps/mini-app/ ./apps/mini-app/

# NEXT_PUBLIC values are embedded at build time in a static Next.js export.
ARG NEXT_PUBLIC_BOT_API_URL
ARG NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=FxAeonBot
ARG NEXT_PUBLIC_PRIVY_APP_ID
ARG NEXT_PUBLIC_PRIVY_SIGNER_ID
ENV NEXT_PUBLIC_BOT_API_URL=$NEXT_PUBLIC_BOT_API_URL \
    NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=$NEXT_PUBLIC_TELEGRAM_BOT_USERNAME \
    NEXT_PUBLIC_PRIVY_APP_ID=$NEXT_PUBLIC_PRIVY_APP_ID \
    NEXT_PUBLIC_PRIVY_SIGNER_ID=$NEXT_PUBLIC_PRIVY_SIGNER_ID

RUN pnpm --filter @fxaeon/shared build \
    && pnpm --filter @fxaeon/mini-app build

FROM nginx:1.29-alpine AS runner

COPY apps/mini-app/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/mini-app/dist/ /usr/share/nginx/html/

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:3000/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
