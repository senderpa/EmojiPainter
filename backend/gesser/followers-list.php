<?php
declare(strict_types=1);

/**
 * GESSER API - Followers List (reverse follow graph)
 *
 * Lists the users who FOLLOW the target (people whose friend edge points at it).
 *
 * URL:    https://emojipainter.com/api/gesser/followers-list.php
 * Method: GET
 * Params: target_device_id (required), device_id (viewer, optional, for is_friend)
 *
 * Returns: { ok, followers:[{device_id,name,portrait,coins,is_friend}], count }
 * Uses a LEFT JOIN onto gallery_entries so a follower with no gallery row is
 * still returned (name '' / portrait null) — never dropped.
 */

require_once __DIR__ . '/http-headers.php';
ep_prepare_json_response('private, max-age=30');

require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/gesser-utils.php';
header('Access-Control-Allow-Origin: *');

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    send_error('GET required', 405);
}

try {
    $target = trim($_GET['target_device_id'] ?? '');
    $viewer = trim($_GET['device_id'] ?? '');

    if ($target === '') {
        send_error('target_device_id required');
    }

    // People who follow the target. LEFT JOIN a per-device passport summary so a
    // follower without gallery rows still appears.
    $sql = "
        SELECT
            gf.user_device_id AS device_id,
            COALESCE(NULLIF(p.display_name, ''), ge.passport_name) AS name,
            COALESCE(NULLIF(p.portrait_url, ''), ge.passport_portrait) AS portrait,
            EXISTS(
                SELECT 1 FROM gesser_friends v
                WHERE v.user_device_id = ? AND v.friend_device_id = gf.user_device_id
            ) AS is_friend
        FROM gesser_friends gf
        LEFT JOIN (
            SELECT device_id, MAX(passport_name) AS passport_name, MAX(passport_portrait) AS passport_portrait
            FROM gallery_entries
            WHERE passport_name IS NOT NULL AND passport_name != ''
            GROUP BY device_id
        ) ge ON ge.device_id = gf.user_device_id
        LEFT JOIN gesser_profiles p ON p.device_id = gf.user_device_id
        WHERE gf.friend_device_id = ?
        ORDER BY gf.created_at DESC
    ";

    $rows = Database::fetchAll($sql, [$viewer, $target], ['s', 's']);

    $followers = [];
    foreach ($rows as $row) {
        $portrait = $row['portrait'] ?? null;
        if ($portrait && strpos($portrait, 'data:') === 0) {
            $portrait = null;
        }
        $followers[] = [
            'device_id' => $row['device_id'],
            'name'      => $row['name'] ?? '',
            'portrait'  => $portrait,
            'coins'     => 0,
            'is_friend' => (bool)$row['is_friend'],
        ];
    }

    send_json([
        'ok'        => true,
        'followers' => $followers,
        'count'     => count($followers),
    ]);

} catch (Throwable $e) {
    error_log('[Gesser] followers-list error: ' . $e->getMessage());
    send_error('Failed to list followers', 500);
}
