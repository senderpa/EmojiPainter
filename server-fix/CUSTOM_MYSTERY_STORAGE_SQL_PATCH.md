# Custom Mystery upload guard

The live upload endpoint is `/www/emojipr/api/storage-sql.php`. The tracked
`server-fix/storage.php` is an older compatibility copy and must not replace it.

Merge these lines into the current live `storage-sql.php` after its multipart
fields are parsed and before either the `gallery_entries` or
`gesser_mystery_paintings` insert:

```php
require_once __DIR__ . '/gesser/custom-mystery-upload-guard.php';

$customMystery = guard_custom_mystery_upload($_POST);
if ($customMystery['is_custom']) {
    $mysteryTopicId = $customMystery['topic_id'];       // NULL in MySQL, 0 in list responses
    $mysteryTopicText = $customMystery['topic_text'];   // normalized, validated answer
}
```

Keep the live endpoint's existing transaction, media handling, daily lock,
coin award, and Mystery insert logic. The client sends
`mystery_topic_source=custom`, `is_mystery_paint=1`, no positive topic ID, and
the answer in `mystery_topic_text`.

Deploy together:

- `.website_work/gesser-utils.php` → `/www/emojipr/api/gesser/gesser-utils.php`
- `.website_work/custom-mystery-upload-guard.php` → `/www/emojipr/api/gesser/custom-mystery-upload-guard.php`
- the small merge above → `/www/emojipr/api/storage-sql.php`

No schema migration is required: production already persists text-backed
Mystery paintings with a nullable topic FK and exposes them as
`mystery_topic_id: 0` plus `mystery_topic_text`.
