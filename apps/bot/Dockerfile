FROM node:22-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@9

# Copy workspace files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY apps/bot/package.json ./apps/bot/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/shared/ ./packages/shared/
COPY packages/db/ ./packages/db/
COPY apps/bot/ ./apps/bot/

# Build
RUN pnpm build

# Run
CMD ["node", "apps/bot/dist/main.js"]
