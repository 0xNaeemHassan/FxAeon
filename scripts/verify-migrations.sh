#!/bin/bash
set -e

# FxAeon Database Migration Verification
# Usage: ./scripts/verify-migrations.sh

echo "=== FxAeon Database Migration Verification ==="
echo ""

# Check database connection
if [ -z "$DATABASE_URL" ]; then
    echo "Error: DATABASE_URL not set"
    echo "Load from .env: export $(cat .env | grep DATABASE_URL | xargs)"
    exit 1
fi

echo "Checking database connection..."
if ! psql "$DATABASE_URL" -c "SELECT 1" > /dev/null 2>&1; then
    echo "Error: Cannot connect to database"
    echo "Check DATABASE_URL and ensure database is running"
    exit 1
fi

echo "✓ Database connection successful"
echo ""

# Check if migrations table exists
echo "Checking migrations table..."
MIGRATIONS_TABLE=$(psql "$DATABASE_URL" -t -c "
    SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = '_prisma_migrations'
    );
" 2>/dev/null | xargs)

if [ "$MIGRATIONS_TABLE" = "t" ] || [ "$MIGRATIONS_TABLE" = "true" ]; then
    echo "✓ Prisma migrations table exists"
    
    echo ""
    echo "Applied migrations:"
    psql "$DATABASE_URL" -c "
        SELECT migration_name, finished_at 
        FROM _prisma_migrations 
        WHERE rolled_back_at IS NULL 
        ORDER BY finished_at DESC 
        LIMIT 10;
    " 2>/dev/null || echo "Could not list migrations"
else
    echo "⚠ Migrations table not found - database may be uninitialized"
    echo "Run: cd packages/db && pnpm db:migrate"
fi

echo ""

# Check required tables
echo "Checking required tables..."
REQUIRED_TABLES=("users" "wallets" "transactions" "positions" "settings")
for table in "${REQUIRED_TABLES[@]}"; do
    EXISTS=$(psql "$DATABASE_URL" -t -c "
        SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = '$table'
        );
    " 2>/dev/null | xargs)
    
    if [ "$EXISTS" = "t" ] || [ "$EXISTS" = "true" ]; then
        echo "  ✓ Table '$table' exists"
    else
        echo "  ✗ Table '$table' missing"
    fi
done

echo ""
echo "=== Verification Complete ==="
