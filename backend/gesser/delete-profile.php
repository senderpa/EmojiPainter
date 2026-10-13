<?php
declare(strict_types=1);

/**
 * Authenticated, idempotent profile deletion.
 *
 * POST /api/gesser/delete-profile.php
 * Authorization: Bearer <per-installation profile token>
 * { device_id, request_id?, app_version? }
 *
 * Public gallery artwork is retained but detached and anonymized. All
 * identity-bearing rows are removed inside one transaction. Storage/email are
 * committed as retryable jobs and attempted after commit.
 */

require_once __DIR__ . '/http-headers.php';
ep_prepare_json_response('no-store');
$dbBootstrap = __DIR__ . '/../db.php';
if (!is_file($dbBootstrap)) $dbBootstrap = __DIR__ . '/../config/db.php';
require_once $dbBootstrap;
require_once __DIR__ . '/deletion-utils.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'POST required']);
    exit;
}

$body = deletion_json_body();
$deviceId = trim((string)($body['device_id'] ?? ''));
$token = deletion_auth_token();
$requestId = trim((string)($body['request_id'] ?? ''));
$requestId = preg_match('/^[A-Za-z0-9_-]{16,80}$/', $requestId) ? $requestId : deletion_uuid();
$deviceHash = hash('sha256', $deviceId);

if (!deletion_valid_device($deviceId) || strlen($token) < 32) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Authenticated device credentials required']);
    exit;
}

try {
    // A completed tombstone is deliberately checked before token validation:
    // retrying a request after local cleanup has removed the token remains safe.
    $existing = Database::fetchOne('SELECT request_id, status, anonymized_posts, storage_objects FROM profile_deletion_requests WHERE device_id_hash = ? LIMIT 1', [$deviceHash]);
    if ($existing && $existing['status'] === 'completed') {
        echo json_encode([
            'ok' => true, 'idempotent' => true, 'request_id' => $existing['request_id'],
            'anonymized_posts' => (int)$existing['anonymized_posts'],
            'storage_objects' => (int)$existing['storage_objects'],
        ]);
        exit;
    }

    $auth = Database::fetchOne('SELECT token_hash FROM profile_auth_tokens WHERE device_id_hash = ? LIMIT 1', [$deviceHash]);
    if (!$auth || !hash_equals((string)$auth['token_hash'], hash('sha256', $token))) {
        http_response_code(401);
        echo json_encode(['ok' => false, 'error' => 'Profile authentication failed']);
        exit;
    }

    Database::beginTransaction();
    $storagePaths = deletion_collect_urls($deviceId);

    // Retain the artwork itself, but remove every profile association and make
    // the row eligible for the gallery's neutral Anonymous Painter label.
    $posts = deletion_execute_required('UPDATE gallery_entries SET device_id = NULL, passport_name = NULL, passport_portrait = NULL WHERE device_id = ?', [$deviceId]);

    // Active and historical leaderboard rows must not remain navigable.
    deletion_try_execute('DELETE FROM leaderboard_entries WHERE machine_id = ?', [$deviceId]);
    deletion_try_execute('DELETE FROM leaderboard_cache WHERE machine_id = ?', [$deviceId]);
    deletion_try_execute('DELETE FROM gesser_profiles WHERE device_id = ?', [$deviceId]);
    deletion_try_execute('DELETE FROM gesser_timeline WHERE device_id = ?', [$deviceId]);
    deletion_try_execute('DELETE FROM gesser_friends WHERE user_device_id = ? OR friend_device_id = ?', [$deviceId, $deviceId]);
    deletion_try_execute('DELETE FROM gesser_votes WHERE device_id = ?', [$deviceId]);
    deletion_try_execute('DELETE FROM gesser_guesses WHERE device_id = ?', [$deviceId]);
    deletion_try_execute('UPDATE gesser_topics SET submitted_by_device_id = NULL, submitted_by = NULL WHERE submitted_by_device_id = ?', [$deviceId]);
    deletion_try_execute('UPDATE gesser_mystery_paintings SET solved_by_device_id = NULL WHERE solved_by_device_id = ?', [$deviceId]);
    deletion_try_execute('DELETE FROM gesser_users WHERE device_id = ?', [$deviceId]);
    deletion_try_execute('DELETE FROM profile_cache WHERE device_id = ?', [$deviceId]);
    deletion_try_execute('DELETE FROM profile_preferences WHERE device_id = ?', [$deviceId]);
    deletion_try_execute('DELETE FROM auth_sessions WHERE device_id = ?', [$deviceId]);
    deletion_try_execute('DELETE FROM sessions WHERE device_id = ?', [$deviceId]);
    deletion_try_execute('DELETE FROM push_tokens WHERE device_id = ?', [$deviceId]);
    deletion_try_execute('DELETE FROM notification_tokens WHERE device_id = ?', [$deviceId]);
    deletion_execute_required('DELETE FROM profile_auth_tokens WHERE device_id_hash = ?', [$deviceHash]);

    Database::execute(
        'INSERT INTO profile_deletion_requests (request_id, device_id_hash, status, anonymized_posts, storage_objects, app_version, created_at, completed_at)
         VALUES (?, ?, "completed", ?, ?, ?, NOW(), NOW())',
        [$requestId, $deviceHash, $posts, count($storagePaths), mb_substr(trim((string)($body['app_version'] ?? 'unknown')), 0, 32)]
    );

    foreach ($storagePaths as $path) deletion_mark_job($requestId, 'storage', ['path' => $path]);
    deletion_mark_job($requestId, 'email', [
        'request_id' => $requestId,
        'completed_at' => gmdate('c'),
        'app_version' => mb_substr(trim((string)($body['app_version'] ?? 'unknown')), 0, 32),
        'environment' => getenv('APP_ENV') ?: 'production',
        'anonymized_posts' => $posts,
        'storage_objects' => count($storagePaths),
        'partial_failure' => 'none',
    ]);
    Database::commit();

    $jobResult = deletion_process_jobs($requestId);
    echo json_encode([
        'ok' => true, 'idempotent' => false, 'request_id' => $requestId,
        'anonymized_posts' => $posts, 'storage_objects' => count($storagePaths),
        'jobs' => $jobResult,
    ]);
} catch (Throwable $e) {
    try { Database::rollback(); } catch (Throwable $rollbackError) { /* no active transaction */ }
    error_log('[ProfileDeletion] failed: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Profile deletion could not be completed; nothing was committed']);
}
