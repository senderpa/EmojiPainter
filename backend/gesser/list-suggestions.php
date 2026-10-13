<?php
/**
 * GESSER FEATURE - List Suggestions API
 *
 * Lists all topic suggestions with vote counts, submitter info, and user's vote state.
 *
 * URL: https://emojipainter.com/api/gesser/list-suggestions.php
 * Method: GET
 *
 * Parameters:
 * - device_id (required): Current user's device ID
 * - filter (optional): 'all', 'pending', 'approved', or 'rejected' (default: 'all')
 * - limit (optional): Max results 1-500 (default: 100)
 */

require_once __DIR__ . '/http-headers.php';
ep_prepare_json_response('private, max-age=30');

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET');
header('Access-Control-Allow-Headers: Content-Type');

// Database connection
require_once __DIR__ . '/../config/db.php';

// ============================================================================
// INPUT VALIDATION
// ============================================================================

// Validate device_id
if (!isset($_GET['device_id']) || empty($_GET['device_id'])) {
    http_response_code(400);
    echo json_encode([
        'ok' => false,
        'error' => 'Missing device_id parameter'
    ]);
    exit;
}

$device_id = trim($_GET['device_id']);

// Validate device_id format (alphanumeric, max 100 chars)
if (!preg_match('/^[a-zA-Z0-9_-]{1,100}$/', $device_id)) {
    http_response_code(400);
    echo json_encode([
        'ok' => false,
        'error' => 'Invalid device_id format'
    ]);
    exit;
}

// Validate filter
$filter = isset($_GET['filter']) ? strtolower(trim($_GET['filter'])) : 'all';
$allowed_filters = ['all', 'pending', 'approved', 'rejected'];
if (!in_array($filter, $allowed_filters)) {
    http_response_code(400);
    echo json_encode([
        'ok' => false,
        'error' => 'Invalid filter. Must be one of: all, pending, approved, rejected'
    ]);
    exit;
}

// Validate limit
$limit = isset($_GET['limit']) ? intval($_GET['limit']) : 100;
if ($limit < 1 || $limit > 500) {
    http_response_code(400);
    echo json_encode([
        'ok' => false,
        'error' => 'Invalid limit. Must be between 1 and 500'
    ]);
    exit;
}

// ============================================================================
// DATABASE QUERY
// ============================================================================

try {
    // Build WHERE clause based on filter
    $where_clause = '';
    $params = [$device_id];

    if ($filter !== 'all') {
        $where_clause = 'WHERE t.status = ?';
        $params[] = $filter;
    }

    // Add limit parameter
    $params[] = $limit;

    // Query with vote counts and user vote
    $sql = "
        SELECT
            t.id,
            t.topic,
            t.status,
            t.submitted_by,
            t.submitted_by_device_id,
            t.submitted_at,
            u.passport_url,
            COALESCE(SUM(CASE WHEN v.vote_type = 'up' THEN 1 ELSE 0 END), 0) AS upvotes,
            COALESCE(SUM(CASE WHEN v.vote_type = 'down' THEN 1 ELSE 0 END), 0) AS downvotes,
            COALESCE(SUM(CASE WHEN v.vote_type = 'up' THEN 1 ELSE -1 END), 0) AS score,
            uv.vote_type AS user_vote
        FROM gesser_topics t
        LEFT JOIN gesser_users u ON t.submitted_by_device_id = u.device_id
        LEFT JOIN gesser_votes v ON t.id = v.suggestion_id
        LEFT JOIN gesser_votes uv ON t.id = uv.suggestion_id AND uv.device_id = ?
        $where_clause
        GROUP BY t.id, t.topic, t.status, t.submitted_by, t.submitted_by_device_id,
                 t.submitted_at, u.passport_url, uv.vote_type
        ORDER BY score DESC, t.submitted_at DESC
        LIMIT ?
    ";

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Format results
    $suggestions = [];
    foreach ($rows as $row) {
        $suggestions[] = [
            'id' => (int)$row['id'],
            'topic' => $row['topic'],
            'status' => $row['status'],
            'submittedBy' => $row['submitted_by'],
            'submittedByDeviceId' => $row['submitted_by_device_id'],
            'submittedAt' => date('c', strtotime($row['submitted_at'])), // ISO 8601
            'passportUrl' => $row['passport_url'], // null if not set
            'upvotes' => (int)$row['upvotes'],
            'downvotes' => (int)$row['downvotes'],
            'score' => (int)$row['score'],
            'userVote' => $row['user_vote'] // 'up', 'down', or null
        ];
    }

    // Success response
    echo json_encode([
        'ok' => true,
        'suggestions' => $suggestions,
        'count' => count($suggestions)
    ]);

} catch (PDOException $e) {
    // Log error (you may want to log to a file instead)
    error_log('[list-suggestions.php] Database error: ' . $e->getMessage());

    // Return generic error (don't expose internal details)
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'error' => 'Database error occurred'
    ]);
}
?>
