# Runbook: PostgreSQL storage pressure

Use when provider storage, WAL, connection, or query alerts indicate the database is approaching its limit. This procedure is provider-neutral.

## Detect and scope

Record provider metrics, free space, WAL growth, connection count, replication/backup health, and the largest relations. Start with read-only queries:

```sql
SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size;

SELECT
  schemaname,
  relname,
  pg_size_pretty(pg_total_relation_size(format('%I.%I', schemaname, relname))) AS total_size
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(format('%I.%I', schemaname, relname)) DESC
LIMIT 25;
```

Inspect dead tuples, long-running transactions, locks, and provider backup retention. Do not assume table growth is reclaimable space.

## Contain

1. Preserve a current backup/snapshot and verify that the backup destination has capacity.
2. If write failure is imminent, isolate state-changing application traffic and workers. Keep only diagnostics that do not increase pressure.
3. Increase provider storage/capacity first when available; it is safer than emergency deletion.
4. Do not delete `TxRecord`, `AuditLog`, user linkage, automation, order, or incident-window data during an active event. Transaction history is required for chain reconciliation and security forensics.

## Remediate

- End only clearly abandoned long transactions after identifying the owner/impact.
- Run ordinary `VACUUM (ANALYZE)` on specific bloated tables during a reviewed window if the provider does not manage it. It helps reusable space but generally does not shrink the physical file.
- Do not run `VACUUM FULL`, `REINDEX`, mass `DELETE`, or retention scripts without a backup, capacity/lock estimate, tested procedure, and explicit approval; these can require extra disk and long exclusive locks.
- Archive or delete data only under a documented retention/privacy policy with referential-integrity tests and a proven restore path. The repository does not ship a safe pruning job.
- Investigate unbounded application writes, stale indexes, WAL/replica lag, and backup failures as the durable fix.

## Validate and close

- Database readiness and normal Prisma model queries succeed.
- Free space/growth projections meet the deployment threshold.
- Migrations, constraints, and backups remain valid.
- Non-terminal transactions and worker cursors were not lost.
- An isolated restore of the post-incident backup succeeds.
