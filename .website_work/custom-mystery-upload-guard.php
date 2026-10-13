<?php
declare(strict_types=1);

/**
 * Upload-boundary guard for manual Mystery Challenge topics.
 *
 * Deployment target: /www/emojipr/api/gesser/custom-mystery-upload-guard.php
 * Include this from storage-sql.php after parsing multipart fields and before
 * any gallery or gesser_mystery_paintings INSERT.
 */

require_once __DIR__ . '/gesser-utils.php';

/**
 * @return array{is_custom: bool, topic_id: int|null, topic_text: string|null}
 */
function guard_custom_mystery_upload(array $post): array {
    $isMystery = isset($post['is_mystery_paint'])
        && in_array(strtolower(trim((string)$post['is_mystery_paint'])), ['1', 'true', 'yes'], true);
    $source = strtolower(trim((string)($post['mystery_topic_source'] ?? '')));

    if ($source !== 'custom') {
        return [
            'is_custom' => false,
            'topic_id' => isset($post['mystery_topic_id']) ? (int)$post['mystery_topic_id'] : null,
            'topic_text' => isset($post['mystery_topic_text']) ? trim((string)$post['mystery_topic_text']) : null,
        ];
    }

    if (!$isMystery) {
        throw new RuntimeException('Custom mystery topics require is_mystery_paint=1');
    }
    if (isset($post['mystery_topic_id']) && (int)$post['mystery_topic_id'] !== 0) {
        throw new RuntimeException('Custom mystery topics must use topic_id 0');
    }

    $validated = validate_custom_mystery_topic((string)($post['mystery_topic_text'] ?? ''));
    if (!$validated['valid']) {
        throw new RuntimeException((string)$validated['error']);
    }

    return [
        'is_custom' => true,
        // Persist as NULL in gesser_mystery_paintings; list.php already exposes
        // NULL text-backed topics as mystery_topic_id=0 to app/web clients.
        'topic_id' => null,
        'topic_text' => (string)$validated['topic'],
    ];
}

