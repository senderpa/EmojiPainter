<?php
declare(strict_types=1);

/**
 * Shared HTTP headers for GESSER JSON endpoints.
 */

if (!function_exists('ep_prepare_json_response')) {
    function ep_prepare_json_response(string $cacheControl = 'no-store'): void
    {
        header('Content-Type: application/json; charset=utf-8');
        header('Access-Control-Allow-Origin: *');
        header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
        header('Cache-Control: ' . $cacheControl);
        header('Vary: Origin');

        if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
            http_response_code(204);
            exit;
        }
    }
}
