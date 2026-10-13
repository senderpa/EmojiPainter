<?php
declare(strict_types=1);

/** Shared, deliberately boring helpers for profile deletion and its retryable jobs. */

function deletion_json_body(): array
{
    $body = json_decode(file_get_contents('php://input') ?: '', true);
    return is_array($body) ? $body : $_POST;
}

function deletion_auth_token(): string
{
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (preg_match('/^Bearer\s+(.+)$/i', trim($header), $m)) return trim($m[1]);
    return trim((string)($_SERVER['HTTP_X_PROFILE_TOKEN'] ?? ''));
}

function deletion_valid_device(string $deviceId): bool
{
    return (bool)preg_match('/^[A-Za-z0-9_-]{16,128}$/', $deviceId);
}

function deletion_uuid(): string
{
    return bin2hex(random_bytes(16));
}

function deletion_storage_path(?string $url): ?string
{
    if (!$url || stripos($url, 'data:') === 0) return null;
    $path = parse_url($url, PHP_URL_PATH);
    $path = is_string($path) && $path !== '' ? $path : $url;
    $marker = '/uploads/';
    $pos = strpos($path, $marker);
    if ($pos === false) return null;
    $relative = ltrim(urldecode(substr($path, $pos + strlen($marker))), '/');
    if ($relative === '' || str_contains($relative, '..') || str_contains($relative, "\\")) return null;
    // The PHP project root is /www/emojipr on the 1blu deployment.
    return rtrim(dirname(__DIR__, 2) . '/uploads', DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . $relative;
}

function deletion_try_execute(string $sql, array $params = []): int
{
    try {
        return Database::execute($sql, $params);
    } catch (Throwable $e) {
        // Optional legacy tables are intentionally non-fatal. The migration
        // creates the canonical tables; this keeps old installs deployable.
        error_log('[ProfileDeletion] optional query skipped: ' . $e->getMessage());
        return 0;
    }
}

function deletion_execute_required(string $sql, array $params = []): int
{
    return Database::execute($sql, $params);
}

function deletion_collect_urls(string $deviceId): array
{
    $urls = [];
    $queries = [
        ['SELECT portrait_url FROM gesser_profiles WHERE device_id = ?', [$deviceId]],
        ['SELECT passport_portrait AS url FROM gallery_entries WHERE device_id = ? AND passport_portrait IS NOT NULL', [$deviceId]],
        ['SELECT image_url AS url FROM leaderboard_entries WHERE machine_id = ? AND image_url IS NOT NULL', [$deviceId]],
    ];
    foreach ($queries as [$sql, $params]) {
        try {
            foreach (Database::fetchAll($sql, $params) as $row) {
                foreach (['url', 'portrait_url'] as $key) {
                    if (!empty($row[$key])) $urls[(string)$row[$key]] = true;
                }
            }
        } catch (Throwable $e) {
            error_log('[ProfileDeletion] storage scan skipped: ' . $e->getMessage());
        }
    }
    $paths = [];
    foreach (array_keys($urls) as $url) {
        $path = deletion_storage_path($url);
        if ($path) $paths[$path] = true;
    }
    return array_keys($paths);
}

function deletion_mark_job(string $requestId, string $type, array $payload): void
{
    $payloadJson = json_encode($payload, JSON_UNESCAPED_SLASHES);
    $payloadHash = hash('sha256', (string)$payloadJson);
    Database::execute(
        'INSERT IGNORE INTO profile_deletion_jobs (request_id, job_type, payload, payload_hash, status, attempts, created_at, updated_at)
         VALUES (?, ?, ?, ?, "pending", 0, NOW(), NOW())',
        [$requestId, $type, $payloadJson, $payloadHash]
    );
}

function deletion_process_jobs(string $requestId): array
{
    $done = 0; $failed = 0;
    $jobs = Database::fetchAll('SELECT id, job_type, payload, attempts FROM profile_deletion_jobs WHERE request_id = ? AND status IN ("pending", "retry") ORDER BY id', [$requestId]);
    foreach ($jobs as $job) {
        $ok = false; $payload = json_decode((string)$job['payload'], true) ?: [];
        try {
            if ($job['job_type'] === 'storage') {
                $path = (string)($payload['path'] ?? '');
                $root = realpath(dirname(__DIR__, 2) . '/uploads') ?: dirname(__DIR__, 2) . '/uploads';
                $real = is_file($path) ? (realpath($path) ?: '') : '';
                $ok = $real !== '' && str_starts_with($real, rtrim($root, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR) && @unlink($real);
                if (!$ok && !file_exists($path)) $ok = true; // idempotent retry
            } elseif ($job['job_type'] === 'email') {
                $subject = 'Emoji Painter profile deletion ' . (string)($payload['request_id'] ?? '');
                $message = implode("\n", [
                    'Operational profile deletion notification',
                    'Request reference: ' . (string)($payload['request_id'] ?? ''),
                    'Date/time: ' . (string)($payload['completed_at'] ?? ''),
                    'App version: ' . (string)($payload['app_version'] ?? 'unknown'),
                    'Backend environment: ' . (string)($payload['environment'] ?? 'production'),
                    'Succeeded: yes',
                    'Anonymized posts: ' . (int)($payload['anonymized_posts'] ?? 0),
                    'Storage objects scheduled: ' . (int)($payload['storage_objects'] ?? 0),
                    'Partial failure: ' . (string)($payload['partial_failure'] ?? 'none'),
                ]);
                $ok = @mail('support@emojipainter.com', $subject, $message, "From: noreply@emojipainter.com\r\nContent-Type: text/plain; charset=UTF-8\r\n");
            }
        } catch (Throwable $e) {
            error_log('[ProfileDeletion] job ' . $job['id'] . ': ' . $e->getMessage());
        }
        $newStatus = $ok ? 'completed' : 'retry';
        Database::execute('UPDATE profile_deletion_jobs SET status = ?, attempts = attempts + 1, last_error = ?, updated_at = NOW(), completed_at = IF(? = "completed", NOW(), completed_at) WHERE id = ?', [$newStatus, $ok ? null : 'delivery failed; retry required', $newStatus, $job['id']]);
        $ok ? $done++ : $failed++;
    }
    return ['completed' => $done, 'failed' => $failed];
}
