<?php
declare(strict_types=1);

/**
 * GESSER API - Diary Add (owner appends a manual diary entry)
 *
 * URL:    https://emojipainter.com/api/gesser/diary-add.php
 * Method: POST (JSON body; falls back to form POST)
 * Body:   device_id (required, the owner), text (required, non-empty, <=2000)
 * Returns: { ok, entry:{ id, type, text, created_at(unix) } }
 *
 * Inserts a 'diary' row into gesser_timeline. device_id IS the identity — a
 * caller can only write its own diary.
 */

require_once __DIR__ . '/http-headers.php';
ep_prepare_json_response();

require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/gesser-utils.php';
header('Access-Control-Allow-Origin: *');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    send_error('POST required', 405);
}

try {
    $raw  = file_get_contents('php://input');
    $body = json_decode($raw ?: '', true);
    if (!is_array($body)) {
        $body = $_POST;
    }

    $deviceId = trim((string)($body['device_id'] ?? ''));
    if ($deviceId === '') {
        send_error('device_id required');
    }

    // Keep newlines/tabs, strip other control chars.
    $text = (string)($body['text'] ?? '');
    $text = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $text);
    $text = trim($text);

    if ($text === '') {
        send_error('Diary entry cannot be empty');
    }
    $text = mb_substr($text, 0, 2000);

    $id = Database::insert(
        'INSERT INTO gesser_timeline (device_id, type, text, created_at) VALUES (?, ?, ?, NOW())',
        [$deviceId, 'diary', $text],
        ['s', 's', 's']
    );

    send_json([
        'ok' => true,
        'entry' => [
            'id'         => (int)$id,
            'type'       => 'diary',
            'text'       => $text,
            'created_at' => time(),
        ],
    ]);

} catch (Throwable $e) {
    error_log('[Gesser] diary-add error: ' . $e->getMessage());
    send_error('Failed to add diary entry', 500);
}
