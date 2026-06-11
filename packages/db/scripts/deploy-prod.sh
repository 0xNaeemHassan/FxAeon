#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# One-time baseline (fixes P3009): the production DB predates the migrations
# directory — it was created via `prisma db push`, so when migrate deploy first
# ran, `20260610_init` failed on already-existing tables and was recorded as a
# failed migration, blocking all subsequent migrations.
#
# The init migration's schema already exists in prod, so we mark it as applied.
# `|| true` makes this idempotent: once resolved (or on a fresh DB where init
# genuinely applied), the resolve is a no-op failure and we continue.
npx prisma migrate resolve --applied 20260610_init || true

# Apply pending migrations (additive-only per docs/PLAN.md policy).
npx prisma migrate deploy

# Drift visibility: if the live DB schema disagrees with schema.prisma, print
# the diff loudly but do not fail the deploy — drift is investigated, not
# auto-"fixed", in a production database.
npx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --exit-code || echo "::warning::schema drift detected between DB and schema.prisma (see diff above)"
