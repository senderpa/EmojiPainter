<?php
declare(strict_types=1);

/**
 * GESSER FEATURE - Utility Functions
 *
 * Shared helper functions for Gesser API endpoints
 */

/**
 * Normalize topic text for duplicate detection
 * - Convert to lowercase
 * - Trim whitespace
 * - Collapse multiple spaces to single space
 * - Remove special characters except spaces
 */
function normalize_topic(string $topic): string {
    $normalized = mb_strtolower(trim($topic), 'UTF-8');
    $normalized = preg_replace('/\s+/u', ' ', $normalized);
    $normalized = preg_replace('/[^\p{L}\p{N}\s]/u', '', $normalized);
    return trim($normalized);
}

/**
 * Validate topic text
 * - Must be 1-3 words only
 * - Must be 2-50 characters
 * - Must contain at least one letter
 *
 * @return array ['valid' => bool, 'error' => string|null]
 */
function validate_topic(string $topic): array {
    $trimmed = trim($topic);

    if (strlen($trimmed) < 2) {
        return ['valid' => false, 'error' => 'Topic too short (min 2 characters)'];
    }

    if (strlen($trimmed) > 50) {
        return ['valid' => false, 'error' => 'Topic too long (max 50 characters)'];
    }

    // Count words
    $words = preg_split('/\s+/u', $trimmed);
    $wordCount = count($words);

    if ($wordCount < 1) {
        return ['valid' => false, 'error' => 'Topic must contain at least 1 word'];
    }

    if ($wordCount > 3) {
        return ['valid' => false, 'error' => 'Topic must be maximum 3 words'];
    }

    // Must contain at least one letter
    if (!preg_match('/\p{L}/u', $trimmed)) {
        return ['valid' => false, 'error' => 'Topic must contain at least one letter'];
    }

    return ['valid' => true, 'error' => null];
}

/**
 * Normalize a painter-supplied Mystery Challenge topic for persistence.
 * Manual topics are deliberately narrower than community topic suggestions:
 * English ASCII letters and spaces only, with a 20-character total limit.
 */
function normalize_custom_mystery_topic(string $topic): string {
    $normalized = preg_replace('/\s+/', ' ', trim($topic));
    return $normalized ?? '';
}

/**
 * Validate an upload's manual Mystery topic at the trust boundary.
 *
 * @return array ['valid' => bool, 'topic' => string|null, 'error' => string|null]
 */
function validate_custom_mystery_topic(string $topic): array {
    $collapsed = preg_replace('/\s+/', ' ', trim($topic));
    $collapsed = $collapsed ?? '';

    if ($collapsed === '') {
        return ['valid' => false, 'topic' => null, 'error' => 'Custom mystery topic is required'];
    }
    if (strlen($collapsed) > 20) {
        return ['valid' => false, 'topic' => null, 'error' => 'Custom mystery topic must be 20 characters or fewer'];
    }
    if (!preg_match('/^[A-Za-z ]+$/', $collapsed)) {
        return ['valid' => false, 'topic' => null, 'error' => 'Custom mystery topic may contain English letters and spaces only'];
    }

    return [
        'valid' => true,
        'topic' => normalize_custom_mystery_topic($collapsed),
        'error' => null,
    ];
}

/**
 * Check if topic already exists (case-insensitive)
 *
 * @return int|null Topic ID if exists, null otherwise
 */
function topic_exists(string $topic): ?int {
    require_once __DIR__ . '/../db.php';

    $normalized = normalize_topic($topic);

    $result = Database::fetchOne(
        'SELECT id FROM gesser_topics WHERE topic_normalized = ? LIMIT 1',
        [$normalized],
        ['s']
    );

    return $result ? (int)$result['id'] : null;
}

/**
 * Award coins to a user and log to gesser_coin_awards
 *
 * @param string $deviceId
 * @param int $amount Coin amount
 * @param string $reason Reason code (e.g., 'topic_submit', 'guess_correct')
 * @param int|null $topicId Related topic ID
 * @param int|null $mysteryPaintingId Related mystery painting ID
 * @param int|null $guessId Related guess ID
 * @return bool Success
 */
function award_coins(
    string $deviceId,
    int $amount,
    string $reason,
    ?int $topicId = null,
    ?int $mysteryPaintingId = null,
    ?int $guessId = null
): bool {
    require_once __DIR__ . '/../db.php';
    require_once __DIR__ . '/../util-sql.php';

    try {
        Database::beginTransaction();

        // Log coin award
        Database::insert(
            'INSERT INTO gesser_coin_awards
             (device_id, amount, reason, topic_id, mystery_painting_id, guess_id)
             VALUES (?, ?, ?, ?, ?, ?)',
            [$deviceId, $amount, $reason, $topicId, $mysteryPaintingId, $guessId],
            ['s', 'i', 's', 'i', 'i', 'i']
        );

        // Update leaderboard coin count
        update_leaderboard_coins($deviceId, $amount);

        Database::commit();
        return true;

    } catch (Exception $e) {
        Database::rollback();
        error_log('[Gesser] Failed to award coins: ' . $e->getMessage());
        return false;
    }
}

/**
 * Update leaderboard coin count (creates entry if not exists)
 */
function update_leaderboard_coins(string $deviceId, int $amount): void {
    require_once __DIR__ . '/../db.php';

    // Check if leaderboard entry exists
    $existing = Database::fetchOne(
        'SELECT coin_count FROM leaderboard_entries WHERE machine_id = ? LIMIT 1',
        [$deviceId],
        ['s']
    );

    if ($existing) {
        // Update existing
        $newTotal = max(0, (int)$existing['coin_count'] + $amount);
        Database::execute(
            'UPDATE leaderboard_entries SET coin_count = ? WHERE machine_id = ?',
            [$newTotal, $deviceId],
            ['i', 's']
        );
    } else {
        // Create new entry (passive user record)
        Database::insert(
            'INSERT INTO leaderboard_entries
             (machine_id, coin_count, name, image_url, total_strokes, total_seconds)
             VALUES (?, ?, NULL, NULL, 0, 0)',
            [$deviceId, max(0, $amount)],
            ['s', 'i']
        );
    }
}

/**
 * Get count of approved user-generated topics
 */
function get_approved_user_topic_count(): int {
    require_once __DIR__ . '/../db.php';

    $result = Database::fetchOne(
        "SELECT COUNT(*) as count
         FROM gesser_topics
         WHERE status = 'approved'
           AND submitted_by_device_id != 'SYSTEM'"
    );

    return $result ? (int)$result['count'] : 0;
}

/**
 * Check if user has done mystery paint today
 */
function has_done_mystery_today(string $deviceId): bool {
    require_once __DIR__ . '/../db.php';

    $today = date('Y-m-d');

    $result = Database::fetchOne(
        'SELECT id FROM gesser_daily_mystery_locks
         WHERE device_id = ? AND paint_date = ? LIMIT 1',
        [$deviceId, $today],
        ['s', 's']
    );

    return $result !== null;
}

/**
 * Generate a deterministic masked topic string.
 * Reveals 2 letters for topics up to 8 characters, 3 for 9-16, and a stable
 * 3 or 4 for longer topics. Text-backed topics use a hash when topic_id is 0.
 *
 * @param string $topic The topic text
 * @param int $topicId Topic ID (used as seed)
 * @return array ['masked' => string, 'revealed_positions' => array]
 */
function mask_topic(string $topic, int $topicId): array {
    $chars = preg_split('//u', $topic, -1, PREG_SPLIT_NO_EMPTY);
    $letterPositions = [];

    // Find all letter positions (not spaces or punctuation)
    foreach ($chars as $index => $char) {
        if (preg_match('/\p{L}/u', $char)) {
            $letterPositions[] = $index;
        }
    }

    $letterCount = count($letterPositions);

    if ($letterCount === 0) {
        // No letters to reveal
        return ['masked' => $topic, 'revealed_positions' => []];
    }

    $seed = $topicId !== 0 ? abs($topicId) % 4294967296 : 0;
    if ($seed === 0) {
        // FNV-1a over Unicode code points, matching the app and web gallery.
        $seed = 2166136261;
        $topicChars = preg_split('//u', $topic, -1, PREG_SPLIT_NO_EMPTY);
        foreach ($topicChars as $topicChar) {
            $codePoint = function_exists('mb_ord') ? mb_ord($topicChar, 'UTF-8') : ord($topicChar);
            $seed = (($seed ^ $codePoint) * 16777619) % 4294967296;
        }
    }

    $requestedRevealCount = $letterCount <= 8 ? 2 : ($letterCount <= 16 ? 3 : 3 + ($seed % 2));
    $revealCount = min($requestedRevealCount, $letterCount);

    $remaining = $letterPositions;
    $revealed = [];
    $state = $seed;
    while (count($revealed) < $revealCount && count($remaining) > 0) {
        $state = (($state * 1664525) + 1013904223) % 4294967296;
        $index = $state % count($remaining);
        $revealed[] = $remaining[$index];
        array_splice($remaining, $index, 1);
    }
    sort($revealed, SORT_NUMERIC);

    // Build masked string
    $masked = [];
    foreach ($chars as $index => $char) {
        if ($char === ' ') {
            // Always show spaces
            $masked[] = ' ';
        } elseif (in_array($index, $revealed, true)) {
            // Show revealed letters
            $masked[] = mb_strtolower($char, 'UTF-8');
        } elseif (preg_match('/\p{L}/u', $char)) {
            // Mask letters
            $masked[] = '_';
        } else {
            // Show other characters (punctuation)
            $masked[] = $char;
        }
    }

    return [
        'masked' => implode('', $masked),
        'revealed_positions' => $revealed
    ];
}

/**
 * Check if two topics match (case-insensitive, normalized)
 */
function topics_match(string $guess, string $actual): bool {
    return normalize_topic($guess) === normalize_topic($actual);
}

/**
 * Rate limit check for user actions
 *
 * @param string $deviceId
 * @param string $action Action type (e.g., 'topic_submit', 'guess_attempt')
 * @param int $maxPerHour Maximum actions per hour
 * @return bool True if allowed, false if rate limited
 */
function check_rate_limit(string $deviceId, string $action, int $maxPerHour): bool {
    // Simple file-based rate limiting
    $cacheDir = __DIR__ . '/../../cache';
    if (!is_dir($cacheDir)) {
        @mkdir($cacheDir, 0755, true);
    }

    $rateLimitFile = $cacheDir . '/ratelimit_' . md5($deviceId . '_' . $action) . '.json';

    $now = time();
    $oneHourAgo = $now - 3600;

    $attempts = [];

    if (file_exists($rateLimitFile)) {
        $data = @file_get_contents($rateLimitFile);
        if ($data !== false) {
            $attempts = json_decode($data, true) ?? [];
        }
    }

    // Filter out attempts older than 1 hour
    $attempts = array_filter($attempts, function($timestamp) use ($oneHourAgo) {
        return $timestamp > $oneHourAgo;
    });

    // Check limit
    if (count($attempts) >= $maxPerHour) {
        return false;
    }

    // Add current attempt
    $attempts[] = $now;

    // Save
    @file_put_contents($rateLimitFile, json_encode($attempts));

    return true;
}

/**
 * Send JSON response and exit
 */
function send_json(array $data, int $httpCode = 200): void {
    http_response_code($httpCode);
    header('Content-Type: application/json; charset=utf-8');
    header('Access-Control-Allow-Origin: *');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/**
 * Sync user data from leaderboard
 * Creates or updates gesser_users entry with name and passport from leaderboard
 *
 * @param string $deviceId
 * @return void
 */
function sync_user_from_leaderboard(string $deviceId): void {
    require_once __DIR__ . '/../db.php';

    // Fetch user data from leaderboard_entries table
    $leaderboardUser = Database::fetchOne(
        "SELECT name, image_url FROM leaderboard_entries WHERE machine_id = ?",
        [$deviceId],
        ['s']
    );

    $name = $leaderboardUser && !empty($leaderboardUser['name'])
        ? $leaderboardUser['name']
        : 'Passport Traveler';

    $passportUrl = $leaderboardUser && !empty($leaderboardUser['image_url'])
        ? $leaderboardUser['image_url']
        : null;

    // Check if user already exists in gesser_users
    $existing = Database::fetchOne(
        "SELECT id FROM gesser_users WHERE device_id = ?",
        [$deviceId],
        ['s']
    );

    if ($existing) {
        // Update existing user
        Database::execute(
            "UPDATE gesser_users SET name = ?, passport_url = ?, updated_at = NOW() WHERE device_id = ?",
            [$name, $passportUrl, $deviceId],
            ['s', 's', 's']
        );
    } else {
        // Insert new user
        Database::execute(
            "INSERT INTO gesser_users (device_id, name, passport_url, created_at, updated_at)
             VALUES (?, ?, ?, NOW(), NOW())",
            [$deviceId, $name, $passportUrl],
            ['s', 's', 's']
        );
    }
}

/**
 * Send error response and exit
 */
function send_error(string $message, int $httpCode = 400): void {
    send_json(['ok' => false, 'error' => $message], $httpCode);
}
