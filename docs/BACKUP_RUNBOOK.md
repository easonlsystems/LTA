# Link2AI production backup runbook

Production uses three recovery layers:

1. Railway scheduled volume backups.
2. Railway Postgres PITR (continuous WAL + rolling base backups).
3. Offsite encrypted logical dumps in a different provider/account with S3 Object Lock **COMPLIANCE** mode.

## Offsite workflow

`.github/workflows/offsite-db-backup.yml` runs daily. Daily objects are immutable for 90 days. A second monthly copy is retained for 400 days. The workflow fails if Object Lock is not actually returned by `head-object`; it must never silently downgrade to a mutable upload.

Required GitHub Actions secrets:

- `BACKUP_DATABASE_URL` — Railway Postgres public connection URL; a read-only backup credential is preferred.
- `BACKUP_S3_BUCKET` — bucket created with Object Lock enabled and versioning on.
- `BACKUP_S3_REGION`
- `BACKUP_S3_ACCESS_KEY_ID`
- `BACKUP_S3_SECRET_ACCESS_KEY`
- `BACKUP_S3_ENDPOINT` — optional for a compatible non-AWS endpoint.
- `BACKUP_ENCRYPTION_PASSPHRASE` — long random secret stored separately from the bucket account.
- `BACKUP_HMAC_KEY` — independent long random secret used to authenticate the manifest.

Do not store backup credentials in Railway or in this repository. Keep an offline copy of the encryption passphrase and HMAC key.

## Restore drill

Download one `daily/<timestamp>/` set, verify `manifest.hmac`, verify the encrypted SHA-256, decrypt with `openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000`, then restore into a throwaway Postgres with `pg_restore`. Run this drill at least quarterly. A backup that has never been restored is not considered verified.
