<?php
declare(strict_types=1);

/**
 * GESSER API - User Discovery ("World")
 *
 * Lists EVERY user (including the viewer + users who have NEVER posted) with
 * follower / following / upload counts + last activity.
 *
 * URL:    https://emojipainter.com/api/gesser/users-discover.php
 * Method: GET
 * Params: device_id (viewer, required), search?, limit (def 50, max 100), offset
 *
 * The user set is a UNION of every place a user can exist:
 *   gallery_entries (posters) ∪ leaderboard_entries (passport/profile users) ∪
 *   gesser_friends (follow graph, both directions) ∪ gesser_profiles (edited bio).
 * Name/portrait fall back: profile override → leaderboard → latest gallery passport.
 * No INNER JOIN can drop a user; users with nothing still appear (Anonymous / 👤).
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
function ud_to_unix($raw): ?int {
    if ($raw === null || $raw === '') return null;
    if (is_numeric($raw)) return (int)$raw;
    $ts = strtotime((string)$raw);
    return $ts === false ? null : $ts;
}

// Distinct user device_ids from every source.
const UD_UNION = "
    SELECT device_id FROM (
        SELECT device_id FROM gallery_entries WHERE device_id IS NOT NULL AND device_id <> ''
        UNION SELECT machine_id FROM leaderboard_entries WHERE machine_id IS NOT NULL AND machine_id <> ''
        UNION SELECT user_device_id FROM gesser_friends WHERE user_device_id IS NOT NULL AND user_device_id <> ''
        UNION SELECT friend_device_id FROM gesser_friends WHERE friend_device_id IS NOT NULL AND friend_device_id <> ''
        UNION SELECT device_id FROM gesser_profiles WHERE device_id IS NOT NULL AND device_id <> ''
    ) allu GROUP BY device_id
";

// Per-device gallery aggregate (upload count, last activity, latest passport name/portrait).
const UD_GALLERY_AGG = "
    SELECT device_id, COUNT(*) AS upload_count, MAX(created_at) AS last_activity_raw,
           MAX(passport_name) AS passport_name, MAX(passport_portrait) AS passport_portrait
    FROM gallery_entries GROUP BY device_id
";

try {
    $deviceId = trim($_GET['device_id'] ?? '');
    $search   = trim($_GET['search'] ?? '');
    $limit    = min(100, max(1, (int)($_GET['limit'] ?? 50)));
    $offset   = max(0, (int)($_GET['offset'] ?? 0));

    if ($deviceId === '') {
        send_error('device_id required');
    }

    $whereSearch = $search !== '' ? 'WHERE x.name LIKE ?' : '';

    // --- total distinct users (search-aware) ---
    $countSql = "
        SELECT COUNT(*) AS total FROM (
            SELECT
                COALESCE(NULLIF(p.display_name,''), NULLIF(le.name,''), ge.passport_name) AS name
            FROM ( " . UD_UNION . " ) du
            LEFT JOIN gesser_profiles p ON p.device_id = du.device_id
            LEFT JOIN leaderboard_entries le ON le.machine_id = du.device_id
            LEFT JOIN ( " . UD_GALLERY_AGG . " ) ge ON ge.device_id = du.device_id
        ) x $whereSearch
    ";
    $total = 0;
    try {
        $countRow = Database::fetchOne(
            $countSql,
            $search !== '' ? ['%' . $search . '%'] : [],
            $search !== '' ? ['s'] : []
        );
        $total = (int)($countRow['total'] ?? 0);
    } catch (Throwable $e) {
        error_log('[Gesser] users-discover count: ' . $e->getMessage());
    }

    // --- page of users with social counts ---
    $sql = "
        SELECT x.* FROM (
            SELECT
                du.device_id AS device_id,
                COALESCE(NULLIF(p.display_name,''), NULLIF(le.name,''), ge.passport_name) AS name,
                COALESCE(NULLIF(p.portrait_url,''), NULLIF(le.image_url,''), ge.passport_portrait) AS portrait,
                p.bio AS bio,
                COALESCE(le.coin_count, 0) AS coins,
                COALESCE(ge.upload_count, 0) AS upload_count,
                ge.last_activity_raw AS last_activity_raw,
                (SELECT COUNT(*) FROM gesser_friends f WHERE f.friend_device_id = du.device_id) AS follower_count,
                (SELECT COUNT(*) FROM gesser_friends g WHERE g.user_device_id  = du.device_id) AS following_count,
                EXISTS(
                    SELECT 1 FROM gesser_friends v
                    WHERE v.user_device_id = ? AND v.friend_device_id = du.device_id
                ) AS is_friend
            FROM ( " . UD_UNION . " ) du
            LEFT JOIN gesser_profiles p ON p.device_id = du.device_id
            LEFT JOIN leaderboard_entries le ON le.machine_id = du.device_id
            LEFT JOIN ( " . UD_GALLERY_AGG . " ) ge ON ge.device_id = du.device_id
        ) x
        $whereSearch
        ORDER BY x.upload_count DESC, (x.name IS NULL), x.name ASC
        LIMIT ? OFFSET ?
    ";
    $params = array_merge([$deviceId], $search !== '' ? ['%' . $search . '%'] : [], [$limit, $offset]);
    $types  = array_merge(['s'], $search !== '' ? ['s'] : [], ['i', 'i']);
    $rows   = Database::fetchAll($sql, $params, $types);

    $users = [];
    foreach ($rows as $row) {
        $portrait = $row['portrait'] ?? null;
        if ($portrait && strpos($portrait, 'data:') === 0) {
            $portrait = null; // never serve base64 portraits
        }
        $users[] = [
            'device_id'       => $row['device_id'],
            'name'            => $row['name'] ?? '',
            'portrait'        => $portrait,
            'bio'             => $row['bio'] ?? null,
            'coins'           => (int)($row['coins'] ?? 0),
            'rank'            => 0,
            'upload_count'    => (int)$row['upload_count'],
            'last_activity'   => ud_to_unix($row['last_activity_raw'] ?? null),
            'follower_count'  => (int)$row['follower_count'],
            'following_count' => (int)$row['following_count'],
            'is_friend'       => (bool)$row['is_friend'],
        ];
    }

    $hasMore = ($offset + count($users)) < $total;

    send_json([
        'ok'       => true,
        'users'    => $users,
        'count'    => count($users),
        'total'    => $total,
        'hasMore'  => $hasMore,   // TS client reads camelCase
        'has_more' => $hasMore,
        'search'   => $search,
    ]);

} catch (Throwable $e) {
    error_log('[Gesser] users-discover error: ' . $e->getMessage());
    send_error('Failed to discover users', 500);
}
