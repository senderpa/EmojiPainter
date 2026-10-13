<?php
declare(strict_types=1);

/**
 * Mystery topic count/list endpoint.
 * GET ?count=1   → returns total approved mystery topic count
 * GET ?list=1    → returns all approved topic texts (for client-side shuffle)
 */

require_once __DIR__ . '/config-db.php';
require_once __DIR__ . '/db.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: public, max-age=300'); // 5-min CDN cache

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'GET required']);
    exit;
}

try {
    $conn = Database::getConnection();

    if (isset($_GET['list'])) {
        // Return all approved topics for client shuffle
        $stmt = $conn->prepare(
            "SELECT id, topic FROM gesser_topics WHERE status = 'approved' ORDER BY times_used ASC, id ASC"
        );
        $stmt->execute();
        $rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
        echo json_encode([
            'ok'     => true,
            'count'  => count($rows),
            'topics' => array_map(fn($r) => ['id' => (int)$r['id'], 'topic' => $r['topic']], $rows),
        ]);
    } else {
        // Return count only (faster, smaller response)
        $stmt = $conn->prepare(
            "SELECT COUNT(*) AS total FROM gesser_topics WHERE status = 'approved'"
        );
        $stmt->execute();
        $row = $stmt->get_result()->fetch_assoc();
        echo json_encode([
            'ok'    => true,
            'count' => (int)($row['total'] ?? 0),
        ]);
    }
} catch (Exception $e) {
    error_log('[mystery-topics.php] ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Server error']);
}
