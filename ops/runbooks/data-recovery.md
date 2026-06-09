# Runbook: Data Recovery

## Symptoms
- Database corruption
- Accidental data deletion
- Backup restoration needed

## Steps
1. Identify last known good backup
2. Stop bot to prevent further writes: `fly scale count 0 --app fxbot`
3. Restore from backup: `pg_restore --clean --if-exists backup.sql`
4. Verify data integrity
5. Restart bot: `fly scale count 1 --app fxbot`
6. Monitor for data consistency issues

## Prevention
- Automated daily backups
- Point-in-time recovery enabled
- Test restore quarterly
