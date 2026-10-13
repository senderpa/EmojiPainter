<?php
declare(strict_types=1);

/** Run from cron/CLI every few minutes; never expose this endpoint publicly. */
$cronSecret = (string)(getenv('DELETION_CRON_SECRET') ?: '');
$providedCronSecret = (string)($_SERVER['HTTP_X_CRON_SECRET'] ?? '');
if (PHP_SAPI !== 'cli' && ($cronSecret === '' || !hash_equals($cronSecret, $providedCronSecret))) {
    http_response_code(404); exit;
}
$dbBootstrap = __DIR__ . '/../db.php';
if (!is_file($dbBootstrap)) $dbBootstrap = __DIR__ . '/../config/db.php';
require_once $dbBootstrap;
require_once __DIR__ . '/deletion-utils.php';

$jobs = Database::fetchAll('SELECT DISTINCT request_id FROM profile_deletion_jobs WHERE status IN ("pending", "retry") AND attempts < 20 ORDER BY id LIMIT 50');
$summary = ['requests' => 0, 'completed' => 0, 'failed' => 0];
foreach ($jobs as $row) {
    $summary['requests']++;
    $result = deletion_process_jobs((string)$row['request_id']);
    $summary['completed'] += $result['completed'];
    $summary['failed'] += $result['failed'];
}
if (PHP_SAPI === 'cli') echo json_encode($summary) . PHP_EOL;
else echo json_encode(['ok' => true] + $summary);
