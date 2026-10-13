<?php
declare(strict_types=1);

/**
 * Register/verify the per-installation profile capability used by destructive
 * account operations. The token is never stored in plaintext.
 *
 * POST /api/gesser/profile-auth.php
 * { device_id, profile_token }
 */

require_once __DIR__ . '/http-headers.php';
ep_prepare_json_response();
$dbBootstrap = __DIR__ . '/../db.php';
if (!is_file($dbBootstrap)) $dbBootstrap = __DIR__ . '/../config/db.php';
require_once $dbBootstrap;

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'POST required']);
    exit;
}

$body = json_decode(file_get_contents('php://input') ?: '', true);
$body = is_array($body) ? $body : $_POST;
$deviceId = trim((string)($body['device_id'] ?? ''));
$token = trim((string)($body['profile_token'] ?? ''));

if (!preg_match('/^[A-Za-z0-9_-]{16,128}$/', $deviceId) || strlen($token) < 32 || strlen($token) > 512) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Invalid profile credentials']);
    exit;
}

$deviceHash = hash('sha256', $deviceId);
$tokenHash = hash('sha256', $token);

try {
    $existing = Database::fetchOne('SELECT token_hash FROM profile_auth_tokens WHERE device_id_hash = ? LIMIT 1', [$deviceHash]);

    if ($existing) {
        if (!hash_equals((string)$existing['token_hash'], $tokenHash)) {
            http_response_code(401);
            echo json_encode(['ok' => false, 'error' => 'Profile authentication failed']);
            exit;
        }
    } else {
        Database::execute(
            'INSERT INTO profile_auth_tokens (device_id_hash, token_hash, created_at, last_seen_at) VALUES (?, ?, NOW(), NOW())',
            [$deviceHash, $tokenHash]
        );
    }

    Database::execute('UPDATE profile_auth_tokens SET last_seen_at = NOW() WHERE device_id_hash = ?', [$deviceHash]);
    echo json_encode(['ok' => true]);
} catch (Throwable $e) {
    error_log('[ProfileAuth] ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Profile authentication unavailable']);
}
