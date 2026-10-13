<?php
declare(strict_types=1);

/**
 * Authenticated, durable EmojiPainter profile recovery state.
 *
 * POST /api/gesser/profile-state.php
 * Authorization: Bearer <profile capability token>
 *
 * Read:  { action: "read", device_id }
 * Write: { action: "sync", device_id, name, total_time_ms, total_strokes,
 *          portrait_url? }
 *
 * Time and strokes are monotonic. Coins deliberately remain owned by the
 * existing leaderboard/award system because a spendable balance may decrease.
 */

require_once __DIR__ . '/http-headers.php';
ep_prepare_json_response();
$dbBootstrap = __DIR__ . '/../db.php';
if (!is_file($dbBootstrap)) $dbBootstrap = __DIR__ . '/../config/db.php';
require_once $dbBootstrap;

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'POST required']);
    exit;
}

function ps_fail(string $message, int $status = 400): void {
    http_response_code($status);
    echo json_encode(['ok' => false, 'error' => $message]);
    exit;
}

function ps_bearer_token(): string {
    $header = (string)($_SERVER['HTTP_AUTHORIZATION'] ?? '');
    if (preg_match('/^Bearer\s+(.+)$/i', trim($header), $match)) {
        return trim((string)$match[1]);
    }
    return '';
}

function ps_int($value): int {
    if (!is_numeric($value)) return 0;
    return max(0, (int)$value);
}

function ps_ensure_schema(): void {
    Database::execute(
        'CREATE TABLE IF NOT EXISTS profile_state (
          device_id VARCHAR(128) NOT NULL,
          display_name VARCHAR(40) NOT NULL,
          total_time_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
          total_strokes BIGINT UNSIGNED NOT NULL DEFAULT 0,
          portrait_url VARCHAR(2000) NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          coin_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
          streak_days INT UNSIGNED NOT NULL DEFAULT 0,
          streak_last_date VARCHAR(10) NULL,
          correct_guesses BIGINT UNSIGNED NOT NULL DEFAULT 0,
          multipaint_strokes BIGINT UNSIGNED NOT NULL DEFAULT 0,
          ar_scenes BIGINT UNSIGNED NOT NULL DEFAULT 0,
          achievements TEXT NULL,
          PRIMARY KEY (device_id),
          KEY idx_profile_state_updated (updated_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );

    // Tables created before the level columns existed need them added. Each ALTER is
    // wrapped individually so a column that is already present cannot abort the rest.
    foreach ([
        'coin_count BIGINT UNSIGNED NOT NULL DEFAULT 0',
        'streak_days INT UNSIGNED NOT NULL DEFAULT 0',
        'streak_last_date VARCHAR(10) NULL',
        'correct_guesses BIGINT UNSIGNED NOT NULL DEFAULT 0',
        'multipaint_strokes BIGINT UNSIGNED NOT NULL DEFAULT 0',
        'ar_scenes BIGINT UNSIGNED NOT NULL DEFAULT 0',
        'achievements TEXT NULL',
    ] as $definition) {
        try { Database::execute('ALTER TABLE profile_state ADD COLUMN ' . $definition); }
        catch (Throwable $e) { /* already present */ }
    }
}

function ps_profile(string $deviceId): array {
    $state = null;
    $leaderboard = null;
    $social = null;

    try {
        $state = Database::fetchOne(
            'SELECT display_name, total_time_ms, total_strokes, portrait_url, updated_at, coin_count, streak_days, streak_last_date, correct_guesses, multipaint_strokes, ar_scenes, achievements FROM profile_state WHERE device_id = ? LIMIT 1',
            [$deviceId]
        );
    } catch (Throwable $e) {
        // The deployment is allowed to roll the endpoint out just before its
        // migration. Report a useful server error rather than silently losing a write.
        throw new RuntimeException('Profile-state migration is not installed', 0, $e);
    }

    try {
        $leaderboard = Database::fetchOne(
            'SELECT name, image_url, total_strokes, total_seconds, coin_count FROM leaderboard_entries WHERE machine_id = ? LIMIT 1',
            [$deviceId]
        );
    } catch (Throwable $e) {
        error_log('[ProfileState] leaderboard fallback: ' . $e->getMessage());
    }

    try {
        $social = Database::fetchOne(
            'SELECT display_name, portrait_url FROM gesser_profiles WHERE device_id = ? LIMIT 1',
            [$deviceId]
        );
    } catch (Throwable $e) {
        error_log('[ProfileState] social fallback: ' . $e->getMessage());
    }

    $name = trim((string)($state['display_name'] ?? $social['display_name'] ?? $leaderboard['name'] ?? ''));
    $portrait = trim((string)($state['portrait_url'] ?? $social['portrait_url'] ?? $leaderboard['image_url'] ?? ''));
    $stateTime = ps_int($state['total_time_ms'] ?? 0);
    $leaderboardTime = ps_int($leaderboard['total_seconds'] ?? 0) * 1000;
    $stateStrokes = ps_int($state['total_strokes'] ?? 0);
    $leaderboardStrokes = ps_int($leaderboard['total_strokes'] ?? 0);

    return [
        'found' => $state !== null || $leaderboard !== null || $social !== null,
        'device_id' => $deviceId,
        'name' => $name,
        'total_time_ms' => max($stateTime, $leaderboardTime),
        'total_strokes' => max($stateStrokes, $leaderboardStrokes),
        // Coins are now durable too: take whichever source is higher. In the Lite build
        // they cannot be spent, so the balance only ever grows and a max is safe.
        'coin_count' => max(ps_int($state['coin_count'] ?? 0), ps_int($leaderboard['coin_count'] ?? 0)),
        // Streak is NOT max-merged — it can legitimately reset — so the stored value and its
        // date are returned verbatim and the client decides by date.
        'streak_days' => ps_int($state['streak_days'] ?? 0),
        'streak_last_date' => $state['streak_last_date'] ?? null,
        'correct_guesses' => ps_int($state['correct_guesses'] ?? 0),
        'multipaint_strokes' => ps_int($state['multipaint_strokes'] ?? 0),
        'ar_scenes' => ps_int($state['ar_scenes'] ?? 0),
        'achievements' => $state['achievements'] ?? null,
        'portrait_url' => $portrait !== '' ? $portrait : null,
        'updated_at' => $state['updated_at'] ?? null,
    ];
}

try {
    // The canonical migration remains in backend/migrations, while this
    // idempotent guard makes FTP-only shared-hosting deployments self-healing.
    ps_ensure_schema();
    $body = json_decode(file_get_contents('php://input') ?: '', true);
    $body = is_array($body) ? $body : $_POST;
    $deviceId = trim((string)($body['device_id'] ?? ''));
    $action = trim((string)($body['action'] ?? 'read'));
    $token = ps_bearer_token();

    if (!preg_match('/^[A-Za-z0-9_-]{16,128}$/', $deviceId) || strlen($token) < 32 || strlen($token) > 512) {
        ps_fail('Invalid profile credentials');
    }

    $auth = Database::fetchOne(
        'SELECT token_hash FROM profile_auth_tokens WHERE device_id_hash = ? LIMIT 1',
        [hash('sha256', $deviceId)]
    );
    if (!$auth || !hash_equals((string)$auth['token_hash'], hash('sha256', $token))) {
        ps_fail('Profile authentication failed', 401);
    }

    if ($action === 'sync') {
        $name = mb_substr(trim((string)($body['name'] ?? '')), 0, 40);
        if ($name === '') ps_fail('Name required');
        $timeMs = ps_int($body['total_time_ms'] ?? 0);
        $strokes = ps_int($body['total_strokes'] ?? 0);
        // Level inputs. Absent keys must NOT wipe a stored value, so each is passed through
        // as NULL and the UPDATE below uses COALESCE to keep whatever is already there.
        $coins      = array_key_exists('coin_count', $body) ? ps_int($body['coin_count']) : null;
        $streakDays = array_key_exists('streak_days', $body) ? ps_int($body['streak_days']) : null;
        $streakDate = array_key_exists('streak_last_date', $body)
            ? mb_substr(trim((string)$body['streak_last_date']), 0, 10) : null;
        if ($streakDate !== null && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $streakDate)) $streakDate = null;
        $guesses    = array_key_exists('correct_guesses', $body) ? ps_int($body['correct_guesses']) : null;
        $mpStrokes  = array_key_exists('multipaint_strokes', $body) ? ps_int($body['multipaint_strokes']) : null;
        $arScenes   = array_key_exists('ar_scenes', $body) ? ps_int($body['ar_scenes']) : null;
        $achieve    = array_key_exists('achievements', $body) ? (string)$body['achievements'] : null;
        if ($achieve !== null) {
            $decoded = json_decode($achieve, true);
            // Store only a validated JSON array of short ids — never arbitrary client text.
            if (is_array($decoded)) {
                // Classic closure, not an arrow fn: nothing else in this backend uses PHP 7.4+
                // syntax and a parse error here would take the whole endpoint down.
                $clean = array_filter($decoded, function ($v) {
                    return is_string($v) && $v !== '' && mb_strlen($v) <= 64;
                });
                $achieve = json_encode(array_values($clean));
            } else {
                $achieve = null;
            }
        }
        $portrait = array_key_exists('portrait_url', $body)
            ? trim((string)$body['portrait_url'])
            : null;
        if ($portrait !== null && $portrait !== '' && !preg_match('#^https://#i', $portrait)) {
            $portrait = null; // Never persist a base64 image or non-TLS URL here.
        }
        if ($portrait !== null) $portrait = mb_substr($portrait, 0, 2000);

        Database::execute(
            'INSERT INTO profile_state (device_id, display_name, total_time_ms, total_strokes, portrait_url,
               coin_count, streak_days, streak_last_date, correct_guesses, multipaint_strokes, ar_scenes, achievements,
               created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, COALESCE(?,0), COALESCE(?,0), ?, COALESCE(?,0), COALESCE(?,0), COALESCE(?,0), ?, NOW(), NOW())
             ON DUPLICATE KEY UPDATE
               display_name = VALUES(display_name),
               total_time_ms = GREATEST(total_time_ms, VALUES(total_time_ms)),
               total_strokes = GREATEST(total_strokes, VALUES(total_strokes)),
               portrait_url = COALESCE(VALUES(portrait_url), portrait_url),
               -- Monotonic counters: GREATEST so a device that is behind can never lower them.
               coin_count = GREATEST(coin_count, COALESCE(VALUES(coin_count), 0)),
               correct_guesses = GREATEST(correct_guesses, COALESCE(VALUES(correct_guesses), 0)),
               multipaint_strokes = GREATEST(multipaint_strokes, COALESCE(VALUES(multipaint_strokes), 0)),
               ar_scenes = GREATEST(ar_scenes, COALESCE(VALUES(ar_scenes), 0)),
               -- Streak is LAST-WRITE-WINS BY DATE: a genuine reset must be allowed through,
               -- so it only moves when the incoming date is newer than the stored one.
               streak_days = IF(VALUES(streak_last_date) IS NULL, streak_days,
                             IF(streak_last_date IS NULL OR VALUES(streak_last_date) >= streak_last_date,
                                VALUES(streak_days), streak_days)),
               streak_last_date = IF(VALUES(streak_last_date) IS NULL, streak_last_date,
                                  IF(streak_last_date IS NULL OR VALUES(streak_last_date) >= streak_last_date,
                                     VALUES(streak_last_date), streak_last_date)),
               -- Achievements: server wins on READ, so the newest push simply replaces the set.
               achievements = COALESCE(VALUES(achievements), achievements),
               updated_at = NOW()',
            [$deviceId, $name, $timeMs, $strokes, $portrait,
             $coins, $streakDays, $streakDate, $guesses, $mpStrokes, $arScenes, $achieve]
        );

        // Keep the editable social profile name in the same state. This is
        // best-effort for older servers where gesser_profiles is not installed.
        try {
            Database::execute(
                'INSERT INTO gesser_profiles (device_id, display_name, updated_at)
                 VALUES (?, ?, NOW())
                 ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), updated_at = NOW()',
                [$deviceId, $name]
            );
        } catch (Throwable $e) {
            error_log('[ProfileState] social name mirror: ' . $e->getMessage());
        }
    } elseif ($action !== 'read') {
        ps_fail('Unknown action');
    }

    echo json_encode(['ok' => true, 'profile' => ps_profile($deviceId)]);
} catch (RuntimeException $e) {
    error_log('[ProfileState] ' . $e->getMessage());
    ps_fail($e->getMessage(), 503);
} catch (Throwable $e) {
    error_log('[ProfileState] ' . $e->getMessage());
    ps_fail('Profile state unavailable', 500);
}
