#!/bin/bash
set -e

# FxAeon Mini App - Cloudflare Pages deployment (manual fallback; CI deploys on push to main)
# Usage: ./deploy-mini-app.sh [environment]
#   environment: preview (default) | production

ENVIRONMENT="${1:-preview}"
PROJECT_NAME="${CF_PAGES_PROJECT:-fxbot-mini-app}"

echo "=== FxAeon Mini App - Cloudflare Pages Deploy ==="
echo "Environment: $ENVIRONMENT"
echo "Project: $PROJECT_NAME"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

check_prereq() {
    if ! command -v $1 &> /dev/null; then
        echo -e "${RED}Error: $1 is required but not installed.${NC}"
        exit 1
    fi
}

echo "Checking prerequisites..."
check_prereq node
check_prereq pnpm
check_prereq npx

if ! npx wrangler whoami &> /dev/null; then
    echo -e "${YELLOW}Warning: Not logged into Cloudflare. Run: npx wrangler login${NC}"
    exit 1
fi

cd apps/mini-app

echo ""
echo "Installing dependencies..."
pnpm install

echo ""
echo "Building for $ENVIRONMENT..."
NODE_ENV=production pnpm build
BUILD_DIR="dist"

if [ ! -d "$BUILD_DIR" ]; then
    echo -e "${RED}Error: Build directory $BUILD_DIR not found.${NC}"
    exit 1
fi

if [ ! -f "$BUILD_DIR/index.html" ]; then
    echo -e "${RED}Error: index.html not found in build output.${NC}"
    exit 1
fi

echo -e "${GREEN}Build successful!${NC}"
echo "Build directory: $(pwd)/$BUILD_DIR"
echo "Files: $(find $BUILD_DIR -type f | wc -l)"
echo "Size: $(du -sh $BUILD_DIR | cut -f1)"

echo ""
echo "Deploying to Cloudflare Pages..."

if [ "$ENVIRONMENT" = "production" ]; then
    npx wrangler pages deploy $BUILD_DIR --project-name=$PROJECT_NAME --branch=main
    DEPLOY_URL="https://$PROJECT_NAME.pages.dev"
else
    npx wrangler pages deploy $BUILD_DIR --project-name=$PROJECT_NAME --branch=preview
    DEPLOY_URL="https://preview.$PROJECT_NAME.pages.dev"
fi

echo ""
echo -e "${GREEN}=== Deployment Complete ===${NC}"
echo "Environment: $ENVIRONMENT"
echo "URL: $DEPLOY_URL"
echo ""
echo "Next steps:"
echo "  1. Update MINI_APP_URL in bot env if URL changed"
echo "  2. Test the Mini App in Telegram: @FxAeonBot"
echo "  3. Verify Privy login works"
echo ""
