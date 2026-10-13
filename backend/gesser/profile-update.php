<?php
declare(strict_types=1);

/**
 * GESSER API - Profile Update (owner edits their own profile)
 *
 * URL:    https://emojipainter.com/api/gesser/profile-update.php
 * Method: POST (JSON body; falls back to form POST)
 * Body:   device_id (required, the owner), and any of:
 *           name (<=40), bio (<=500), portrait_url (<=2000)
 * Returns: { ok, updated:[fields], device_id }
 *
 * Upserts gesser_profiles (display_name/bio/portrait_url) and appends a
 * 'profile_change' row to gesser_timeline. device_id IS the identity (no token,
 * matching the rest of the gesser API) — a caller can only edit its own row.
 */

require_once __DIR__ . '/http-headers.php';
ep_prepare_json_response();

require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/gesser-utils.php';
header('Access-Control-Allow-Origin: *');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    send_error('POST required', 405);
}

/** Strip control chars (keep normal text). */
function pu_clean(string $s): string {
    $s = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $s);
    return trim($s ?? '');
}

try {
    $raw  = file_get_contents('php://input');
    $body = json_decode($raw ?: '', true);
    if (!is_array($body)) {
        $body = $_POST;
    }

    $deviceId = pu_clean((string)($body['device_id'] ?? ''));
    if ($deviceId === '') {
        send_error('device_id required');
    }

    $hasName     = array_key_exists('name', $body);
    $hasBio      = array_key_exists('bio', $body);
    $hasPortrait = array_key_exists('portrait_url', $body);

    if (!$hasName && !$hasBio && !$hasPortrait) {
        send_error('Nothing to update');
    }

    $name     = $hasName     ? mb_substr(pu_clean((string)$body['name']), 0, 40) : null;
    $bio      = $hasBio      ? mb_substr(pu_clean((string)$body['bio']), 0, 500) : null;
    $portrait = $hasPortrait ? mb_substr(trim((string)$body['portrait_url']), 0, 2000) : null;

    if ($hasName && $name === '') {
        send_error('Name cannot be empty');
    }

    // Upsert into gesser_profiles. COALESCE keeps existing values for fields not
    // supplied in this request.
    $sql = "
        INSERT INTO gesser_profiles (device_id, display_name, bio, portrait_url, updated_at)
        VALUES (?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
            display_name = COALESCE(VALUES(display_name), display_name),
            bio          = COALESCE(VALUES(bio), bio),
            portrait_url = COALESCE(VALUES(portrait_url), portrait_url),
            updated_at   = NOW()
    ";
    Database::execute(
        $sql,
        [$deviceId, $hasName ? $name : null, $hasBio ? $bio : null, $hasPortrait ? $portrait : null],
        ['s', 's', 's', 's']
    );

    $updated = [];
    if ($hasName) $updated[] = 'name';
    if ($hasBio) $updated[] = 'bio';
    if ($hasPortrait) $updated[] = 'portrait';

    // Log a timeline event (non-fatal).
    try {
        $summary = 'Updated ' . implode(', ', $updated);
        Database::insert(
            'INSERT INTO gesser_timeline (device_id, type, text, created_at) VALUES (?, ?, ?, NOW())',
            [$deviceId, 'profile_change', $summary],
            ['s', 's', 's']
        );
    } catch (Throwable $e) {
        error_log('[Gesser] profile-update timeline: ' . $e->getMessage());
    }

    send_json(['ok' => true, 'updated' => $updated, 'device_id' => $deviceId]);

} catch (Throwable $e) {
    error_log('[Gesser] profile-update error: ' . $e->getMessage());
    send_error('Failed to update profile', 500);
}
