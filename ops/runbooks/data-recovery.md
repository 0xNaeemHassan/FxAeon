# Runbook: Data Recovery

## Symptoms
- Database corruption
- Accidental data deletion
- Backup restoration needed

## Steps
1. Identify last known good backup
2. Stop bot to prevent further writes: Render dashboard -> Suspend service
3. Restore from backup: `pg_restore --clean --if-exists backup.sql`
4. Verify data integrity
5. Restart bot: Render dashboard -> Resume service
6. Monitor for data consistency issues

## Prevention
- Automated daily backups
- Point-in-time recovery enabled
- Test restore quarterly
