<?php
declare(strict_types=1);

/**
 * GESSER API - Timeline List (diary feed)
 *
 * URL:    https://emojipainter.com/api/gesser/timeline-list.php
 * Method: GET
 * Params: target_device_id (required), device_id (viewer, optional),
 *         limit (def 50, max 100), offset
 *
 * Public gallery uploads (gallery_entries) are shown to everyone. Private diary
 * + profile_change events (gesser_timeline) are shown ONLY when the viewer is the
 * owner (device_id === target_device_id). Events are merged, sorted newest-first,
 * then paginated in PHP.
 *
 * Returns: { ok, events:[{id,type,text,image_url,created_at(unix)}],
 *            count, is_owner, has_more }
 */

require_once __DIR__ . '/http-headers.php';
ep_prepare_json_response('private, max-age=30');

require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/gesser-utils.php';
header('Access-Control-Allow-Origin: *');

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    send_error('GET required', 405);
}

/** Normalize a created_at column (DATETIME string OR unix int) to unix seconds. */
function tl_to_unix($raw): int {
    if ($raw === null || $raw === '') return 0;
    if (is_numeric($raw)) return (int)$raw;
    $ts = strtotime((string)$raw);
    return $ts === false ? 0 : $ts;
}

try {
    $target = trim($_GET['target_device_id'] ?? '');
    $viewer = trim($_GET['device_id'] ?? '');
    $limit  = min(100, max(1, (int)($_GET['limit'] ?? 50)));
    $offset = max(0, (int)($_GET['offset'] ?? 0));

    if ($target === '') {
        send_error('target_device_id required');
    }

    $isOwner = ($viewer !== '' && $viewer === $target);
    $events = [];

    // --- public: gallery uploads (wrapped: column names vary by install) ---
    try {
        $rows = Database::fetchAll(
            "SELECT id, topic, image_url, created_at
             FROM gallery_entries
             WHERE device_id = ?
             ORDER BY created_at DESC
             LIMIT 200",
            [$target], ['s']
        );
        foreach ($rows as $r) {
            $img = $r['image_url'] ?? null;
            if ($img && strpos($img, 'data:') === 0) $img = null;
            $events[] = [
                'id'         => 'g' . (string)($r['id'] ?? ''),
                'type'       => 'gallery_upload',
                'text'       => (string)($r['topic'] ?? ''),
                'image_url'  => $img,
                'created_at' => tl_to_unix($r['created_at'] ?? null),
            ];
        }
    } catch (Throwable $e) {
        error_log('[Gesser] timeline gallery: ' . $e->getMessage());
    }

    // --- private: diary + profile_change (owner only) ---
    if ($isOwner) {
        try {
            $rows = Database::fetchAll(
                "SELECT id, type, text, created_at
                 FROM gesser_timeline
                 WHERE device_id = ?
                 ORDER BY created_at DESC
                 LIMIT 200",
                [$target], ['s']
            );
            foreach ($rows as $r) {
                $events[] = [
                    'id'         => 't' . (string)($r['id'] ?? ''),
                    'type'       => (string)($r['type'] ?? 'diary'),
                    'text'       => (string)($r['text'] ?? ''),
                    'image_url'  => null,
                    'created_at' => tl_to_unix($r['created_at'] ?? null),
                ];
            }
        } catch (Throwable $e) {
            error_log('[Gesser] timeline diary: ' . $e->getMessage());
        }
    }

    // Merge: newest first.
    usort($events, function ($a, $b) {
        return $b['created_at'] <=> $a['created_at'];
    });

    $totalMerged = count($events);
    $page = array_slice($events, $offset, $limit);
    $hasMore = ($offset + count($page)) < $totalMerged;

    send_json([
        'ok'       => true,
        'events'   => $page,
        'count'    => count($page),
        'is_owner' => $isOwner,
        'has_more' => $hasMore,
    ]);

} catch (Throwable $e) {
    error_log('[Gesser] timeline-list error: ' . $e->getMessage());
    send_error('Failed to load timeline', 500);
}
