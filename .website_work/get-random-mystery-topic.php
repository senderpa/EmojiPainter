<?php
declare(strict_types=1);

/**
 * GESSER API - Get Random Mystery Topic
 *
 * Endpoint: POST /api/gesser/get-random-mystery-topic.php
 *
 * Returns a random mystery topic for painting.
 * Logic:
 * - If approved user topics >= 9: pick from user topics
 * - Else: pick from default SYSTEM topics
 *
 * Request Body:
 * {
 *   "device_id": "abc123"
 * }
 *
 * Response:
 * {
 *   "ok": true,
 *   "topic_id": 123,
 *   "topic": "Space Whale",
 *   "source": "user_generated" | "default_pool"
 * }
 */

require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/gesser-utils.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    send_error('POST required', 405);
}

try {
    $input = json_decode(file_get_contents('php://input'), true);

    if (!$input) {
        send_error('Invalid JSON');
    }

    $deviceId = trim($input['device_id'] ?? '');

    if (empty($deviceId)) {
        send_error('device_id required');
    }

    // Check if user already did mystery paint today
    if (has_done_mystery_today($deviceId)) {
        send_error('You already painted a mystery topic today. Come back tomorrow!');
    }

    // Count approved user topics (excluding SYSTEM)
    $userTopicCount = get_approved_user_topic_count();

    $source = ($userTopicCount >= 9) ? 'user_generated' : 'default_pool';

    // Select random topic based on source
    if ($source === 'user_generated') {
        // Pick from user-generated approved topics
        $result = Database::fetchOne(
            "SELECT id, topic_display
             FROM gesser_topics
             WHERE status = 'approved'
               AND submitted_by_device_id != 'SYSTEM'
             ORDER BY RAND()
             LIMIT 1"
        );
    } else {
        // Pick from default SYSTEM topics
        $result = Database::fetchOne(
            "SELECT id, topic_display
             FROM gesser_topics
             WHERE status = 'approved'
               AND submitted_by_device_id = 'SYSTEM'
             ORDER BY RAND()
             LIMIT 1"
        );
    }

    if (!$result) {
        send_error('No mystery topics available. Please try again later.');
    }

    $topicId = (int)$result['id'];
    $topic = $result['topic_display'];

    // Increment usage count
    Database::execute(
        'UPDATE gesser_topics SET times_used = times_used + 1 WHERE id = ?',
        [$topicId],
        ['i']
    );

    send_json([
        'ok' => true,
        'topic_id' => $topicId,
        'topic' => $topic,
        'source' => $source,
        'message' => $source === 'user_generated'
            ? 'Mystery topic from community pool!'
            : 'Mystery topic from default pool'
    ]);

} catch (Exception $e) {
    error_log('[Gesser] get-random-mystery-topic error: ' . $e->getMessage());
    send_error('Failed to get mystery topic', 500);
}
