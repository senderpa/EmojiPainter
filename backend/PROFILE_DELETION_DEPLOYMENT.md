# Profile deletion deployment

1. Back up the production database.
2. Run `backend/migrations/20260730_profile_deletion.sql` once in the production MySQL database.
3. Confirm that the `gallery_entries.device_id` column is nullable and that `content_license_version` exists before releasing the app.
4. Set a non-empty `DELETION_CRON_SECRET` in the PHP environment and schedule `process-deletion-jobs.php` every few minutes. The worker accepts `X-Cron-Secret` only when it matches that secret; CLI execution is also supported.
5. Ensure PHP can write the deployed `uploads/` tree and that the server mail transport can send from `noreply@emojipainter.com` to `support@emojipainter.com`.

The live 1blu deployment uses `/www/emojipr/api/db.php` and its MySQLi `Database` singleton. The deletion endpoints use that existing bootstrap and are deployed under `/www/emojipr/api/gesser/`:

- `profile-auth.php`
- `delete-profile.php`
- `process-deletion-jobs.php`
- `deletion-utils.php`
- `http-headers.php`

The public upload endpoint is `/www/emojipr/api/storage-sql.php`; it now requires and records `content_license_version`.

Storage deletion and notification email are post-commit jobs. A failed job is marked `retry`, logged without identity data, and can be safely rerun. A completed deletion is represented by a tombstone in `profile_deletion_requests`, making repeated client requests idempotent.
