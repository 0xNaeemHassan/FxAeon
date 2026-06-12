# Runbook: Postgres >80% Disk

## Detection
- Supabase dashboard alert
- Query performance degradation

## Response

### 1. Check disk usage
```sql
SELECT pg_size_pretty(pg_database_size(current_database()));
```

### 2. Vacuum and analyze
```bash
psql $DATABASE_URL -c "VACUUM ANALYZE;"
```

### 3. Prune old audit logs
```sql
-- Keep 90 days of audit logs
DELETE FROM "AuditLog" WHERE "createdAt" < NOW() - INTERVAL '90 days';
```

### 4. Prune old tx records
```sql
DELETE FROM "TxRecord" WHERE "createdAt" < NOW() - INTERVAL '30 days';
```

### 5. Archive to R2 if needed
```bash
pg_dump --data-only --table=AuditLog $DATABASE_URL | gzip | aws s3 cp - s3://fxbot-backups/archive/$(date +%Y%m%d)_audit.sql.gz
```

### 6. If still >80%, upgrade Supabase plan or optimize schema
