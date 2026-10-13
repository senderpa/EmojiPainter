<?php
/**
 * GESSER FEATURE - Vote Suggestion API
 *
 * Submit, toggle, or switch a vote on a topic suggestion.
 *
 * URL: https://emojipainter.com/api/gesser/vote-suggestion.php
 * Method: POST
 *
 * Body (JSON):
 * {
 *   "device_id": "abc123",
 *   "suggestion_id": 123,
 *   "vote": "up" | "down"
 * }
 *
 * Vote Logic:
 * - No existing vote: INSERT new vote
 * - Same vote again: DELETE vote (toggle off)
 * - Opposite vote: UPDATE vote (switch)
 */

require_once __DIR__ . '/http-headers.php';
ep_prepare_json_response();

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// Handle preflight OPTIONS request
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// Only allow POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode([
        'ok' => false,
        'error' => 'Method not allowed. Use POST.'
    ]);
    exit;
}

// Database connection
require_once __DIR__ . '/../config/db.php';

// ============================================================================
// INPUT VALIDATION
// ============================================================================

// Get JSON body
$input = json_decode(file_get_contents('php://input'), true);

if (!$input) {
    http_response_code(400);
    echo json_encode([
        'ok' => false,
        'error' => 'Invalid JSON body'
    ]);
    exit;
}

// Validate device_id
if (!isset($input['device_id']) || empty($input['device_id'])) {
    http_response_code(400);
    echo json_encode([
        'ok' => false,
        'error' => 'Missing device_id parameter'
    ]);
    exit;
}

$device_id = trim($input['device_id']);

// Validate device_id format
if (!preg_match('/^[a-zA-Z0-9_-]{1,100}$/', $device_id)) {
    http_response_code(400);
    echo json_encode([
        'ok' => false,
        'error' => 'Invalid device_id format'
    ]);
    exit;
}

// Validate suggestion_id
if (!isset($input['suggestion_id']) || !is_numeric($input['suggestion_id'])) {
    http_response_code(400);
    echo json_encode([
        'ok' => false,
        'error' => 'Missing or invalid suggestion_id parameter'
    ]);
    exit;
}

$suggestion_id = (int)$input['suggestion_id'];

if ($suggestion_id <= 0) {
    http_response_code(400);
    echo json_encode([
        'ok' => false,
        'error' => 'suggestion_id must be positive'
    ]);
    exit;
}

// Validate vote
if (!isset($input['vote']) || !in_array($input['vote'], ['up', 'down'])) {
    http_response_code(400);
    echo json_encode([
        'ok' => false,
        'error' => 'Invalid vote parameter. Must be "up" or "down"'
    ]);
    exit;
}

$vote = $input['vote'];

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

try {
    // Verify suggestion exists
    $stmt = $pdo->prepare("SELECT id FROM gesser_topics WHERE id = ?");
    $stmt->execute([$suggestion_id]);
    if (!$stmt->fetch()) {
        http_response_code(404);
        echo json_encode([
            'ok' => false,
            'error' => 'Suggestion not found'
        ]);
        exit;
    }

    // Start transaction
    $pdo->beginTransaction();

    // Check if user already has a vote on this suggestion
    $stmt = $pdo->prepare("
        SELECT vote_type FROM gesser_votes
        WHERE device_id = ? AND suggestion_id = ?
    ");
    $stmt->execute([$device_id, $suggestion_id]);
    $existing = $stmt->fetch(PDO::FETCH_ASSOC);

    $message = '';

    if (!$existing) {
        // No existing vote - INSERT new vote
        $stmt = $pdo->prepare("
            INSERT INTO gesser_votes (device_id, suggestion_id, vote_type, created_at)
            VALUES (?, ?, ?, NOW())
        ");
        $stmt->execute([$device_id, $suggestion_id, $vote]);
        $message = 'Vote recorded';

    } else if ($existing['vote_type'] === $vote) {
        // Same vote - DELETE (toggle off)
        $stmt = $pdo->prepare("
            DELETE FROM gesser_votes
            WHERE device_id = ? AND suggestion_id = ?
        ");
        $stmt->execute([$device_id, $suggestion_id]);
        $message = 'Vote removed';

    } else {
        // Different vote - UPDATE (switch)
        $stmt = $pdo->prepare("
            UPDATE gesser_votes
            SET vote_type = ?, updated_at = NOW()
            WHERE device_id = ? AND suggestion_id = ?
        ");
        $stmt->execute([$vote, $device_id, $suggestion_id]);
        $message = 'Vote updated';
    }

    // Get updated vote counts
    $stmt = $pdo->prepare("
        SELECT
            COALESCE(SUM(CASE WHEN vote_type = 'up' THEN 1 ELSE 0 END), 0) AS upvotes,
            COALESCE(SUM(CASE WHEN vote_type = 'down' THEN 1 ELSE 0 END), 0) AS downvotes
        FROM gesser_votes
        WHERE suggestion_id = ?
    ");
    $stmt->execute([$suggestion_id]);
    $counts = $stmt->fetch(PDO::FETCH_ASSOC);

    // Commit transaction
    $pdo->commit();

    // Success response
    echo json_encode([
        'ok' => true,
        'message' => $message,
        'newScore' => (int)$counts['upvotes'] - (int)$counts['downvotes'],
        'upvotes' => (int)$counts['upvotes'],
        'downvotes' => (int)$counts['downvotes']
    ]);

} catch (PDOException $e) {
    // Rollback transaction on error
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }

    // Log error
    error_log('[vote-suggestion.php] Database error: ' . $e->getMessage());

    // Return generic error
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'error' => 'Failed to process vote'
    ]);
}
?>
