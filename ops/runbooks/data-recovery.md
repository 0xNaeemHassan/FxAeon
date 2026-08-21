# Runbook: PostgreSQL recovery

Use for corruption, accidental deletion, failed migration, or disaster recovery. A successful `pg_dump` upload is not a proven recovery point until restored and checked.

## Before restoring

1. Stop or isolate application writes and in-process workers. Record the outage start and deployed image.
2. Take a forensic snapshot/dump of the current database even if it is damaged; never overwrite the only copy.
3. Select a backup by timestamp, checksum, size, PostgreSQL version, and known incident boundary. The repository workflow creates PostgreSQL 17 gzip-compressed plain SQL in the `fxbot-backups` R2 bucket and retains the newest 30 objects when configured.
4. Download through the approved backup account to an encrypted, access-controlled workspace. Never paste `DATABASE_URL` into chat or shell history.

## Restore into isolation

Create a new, empty recovery database. Do not run `pg_restore --clean` against production: the workflow's artifact is plain SQL, and destructive in-place restore makes rollback/forensics harder.

Example shape (replace placeholders through secure environment injection):

```bash
gzip -t BACKUP.sql.gz
gunzip --stdout BACKUP.sql.gz | psql '<recovery-database-url>' --set ON_ERROR_STOP=on
DATABASE_URL='<recovery-database-url>' pnpm --filter @fxaeon/db exec prisma migrate deploy
```

Use a PostgreSQL client compatible with the backup/server. The strings above are placeholders, not literal connection URLs.

## Validate the recovered database

- Prisma can query `User`, `TxRecord`, `AutomationRule`, `LimitOrder`, `BotState`, and `DepositWatcher`.
- Unique constraints and foreign keys are present; migrations match current code.
- Row counts and recent timestamps are plausible compared with backup metadata and provider snapshots.
- Telegram-to-wallet linkage, Privy wallet IDs, delegation flags, automation rules, withdrawal recipients, and limit orders are reviewed for the incident window.
- `TxRecord` rows are compared with Ethereum/Base receipts. Database rollback does not roll back chain state.
- Non-terminal routes, approvals, nonces, bridge delivery, and relay state are explicitly reconciled.

## Cut over

1. Take a final current-production snapshot and document the cutover point.
2. Switch `DATABASE_URL` atomically through the deployment secret store to the validated recovery database.
3. Start one bot replica, apply migrations if required, and verify readiness/deep health before Telegram or state-changing traffic.
4. Verify webhook state, wallet resolution, read-only portfolio state, and worker startup. Restore signing only after chain/database reconciliation.

## After recovery

- Preserve old and restored databases until incident/legal retention permits disposal.
- Document recovery point objective, recovery time, lost/replayed application writes, and all on-chain state that survived independently.
- Run a fresh encrypted backup and schedule another isolated restore exercise.
