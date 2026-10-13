<?php
declare(strict_types=1);

/**
 * GESSER API - Profile Social Stats
 *
 * Follower/following counts, is-following state, correct-guess total, and bio
 * for ANY target user (the data the ProfilePage needs).
 *
 * URL:    https://emojipainter.com/api/gesser/profile-social.php
 * Method: GET
 * Params: target_device_id (required), device_id (viewer, optional)
 *
 * Follow graph = directed gesser_friends edge (user_device_id -> friend_device_id):
 *   followers(X) = COUNT WHERE friend_device_id = X
 *   following(X) = COUNT WHERE user_device_id  = X
 *   isFollowing  = EXISTS WHERE user_device_id = viewer AND friend_device_id = target
 * bio comes from gesser_profiles (social-extra-migration.sql).
 */

require_once __DIR__ . '/http-headers.php';
ep_prepare_json_response('private, max-age=30');

require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/gesser-utils.php';
header('Access-Control-Allow-Origin: *');

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    send_error('GET required', 405);
}

try {
    $target = trim($_GET['target_device_id'] ?? '');
    $viewer = trim($_GET['device_id'] ?? '');

    if ($target === '') {
        send_error('target_device_id required');
    }

    $followerRow = Database::fetchOne(
        'SELECT COUNT(*) AS c FROM gesser_friends WHERE friend_device_id = ?',
        [$target], ['s']
    );
    $followerCount = (int)($followerRow['c'] ?? 0);

    $followingRow = Database::fetchOne(
        'SELECT COUNT(*) AS c FROM gesser_friends WHERE user_device_id = ?',
        [$target], ['s']
    );
    $followingCount = (int)($followingRow['c'] ?? 0);

    $isFollowing = false;
    if ($viewer !== '') {
        $rel = Database::fetchOne(
            'SELECT 1 AS x FROM gesser_friends WHERE user_device_id = ? AND friend_device_id = ? LIMIT 1',
            [$viewer, $target], ['s', 's']
        );
        $isFollowing = $rel !== null;
    }

    // Editable profile overrides (gesser_profiles may not exist on older installs).
    $bio = null;
    $displayName = null;
    $portraitUrl = null;
    try {
        $prof = Database::fetchOne(
            'SELECT display_name, bio, portrait_url FROM gesser_profiles WHERE device_id = ?',
            [$target], ['s']
        );
        if ($prof) {
            if (isset($prof['bio']) && trim((string)$prof['bio']) !== '') $bio = $prof['bio'];
            if (isset($prof['display_name']) && trim((string)$prof['display_name']) !== '') $displayName = $prof['display_name'];
            if (isset($prof['portrait_url']) && trim((string)$prof['portrait_url']) !== '') $portraitUrl = $prof['portrait_url'];
        }
    } catch (Throwable $e) {
        error_log('[Gesser] profile-social profile: ' . $e->getMessage());
    }

    // correct guesses (best-effort — table name varies; default 0).
    $correctGuesses = 0;
    try {
        $g = Database::fetchOne(
            'SELECT COUNT(*) AS c FROM gesser_guesses WHERE device_id = ? AND is_correct = 1',
            [$target], ['s']
        );
        $correctGuesses = (int)($g['c'] ?? 0);
    } catch (Throwable $e) {
        // table absent on this install — leave 0.
    }

    send_json([
        'ok'              => true,
        'target_device_id'=> $target,
        'follower_count'  => $followerCount,
        'following_count' => $followingCount,
        'is_following'    => $isFollowing,
        'correct_guesses' => $correctGuesses,
        'bio'             => $bio,
        'display_name'    => $displayName,
        'portrait_url'    => $portraitUrl,
    ]);

} catch (Throwable $e) {
    error_log('[Gesser] profile-social error: ' . $e->getMessage());
    send_error('Failed to load profile stats', 500);
}
