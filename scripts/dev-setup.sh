#!/bin/bash
set -e

# FxAeon Local Development Setup
# Usage: ./scripts/dev-setup.sh

echo "=== FxAeon Development Setup ==="
echo ""

# Check prerequisites
echo "Checking prerequisites..."

command -v node >/dev/null 2>&1 || { echo "Node.js required. Install from https://nodejs.org"; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "pnpm required. Install: npm install -g pnpm"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "Docker recommended for local database/Redis"; }

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo "Warning: Node.js 20+ recommended (found $(node -v))"
fi

echo ""
echo "Installing dependencies..."
pnpm install

echo ""
echo "Setting up environment..."

if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo "Created .env from template. Please edit with your credentials."
    else
        echo "Warning: No .env.example found"
    fi
fi

if [ ! -f "apps/bot/.env.production" ]; then
    if [ -f "apps/bot/.env.example" ]; then
        cp apps/bot/.env.example apps/bot/.env.production
        echo "Created apps/bot/.env.production from template."
    fi
fi

if [ ! -f "apps/mini-app/.env.local" ]; then
    if [ -f "apps/mini-app/.env.example" ]; then
        cp apps/mini-app/.env.example apps/mini-app/.env.local
        echo "Created apps/mini-app/.env.local from template."
    fi
fi

echo ""
echo "Building packages..."
pnpm run build

echo ""
echo "Running type checks..."
pnpm run typecheck || echo "Type check issues found (non-blocking)"

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "  1. Edit .env files with your credentials"
echo "  2. Start database: docker-compose up -d postgres redis"
echo "  3. Run migrations: cd packages/db && pnpm db:migrate"
echo "  4. Start bot: cd apps/bot && pnpm dev"
echo "  5. Start mini-app: cd apps/mini-app && pnpm dev"
echo ""
echo "  Or start everything: pnpm run dev"
