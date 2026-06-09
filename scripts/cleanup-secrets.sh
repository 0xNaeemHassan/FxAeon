#!/bin/bash
# fxBot Secret Cleanup Script
# Run this before committing to git

echo "=== fxBot Secret Cleanup ==="
echo ""

# Files that should NEVER be in git
SENSITIVE_FILES=(
    ".env"
    "apps/bot/.env.production"
    "apps/mini-app/.env.local"
    ".encryption_key"
    "CREDENTIALS.md"
)

for file in "${SENSITIVE_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "Removing from git tracking: $file"
        git rm --cached "$file" 2>/dev/null || true
    fi
done

echo ""
echo "✓ Sensitive files removed from git tracking"
echo "They remain in your local filesystem but won't be committed"
echo ""
echo "Make sure .env.example files are committed as templates"
