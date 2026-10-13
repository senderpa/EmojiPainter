<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/util.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'POST required']);
    exit;
}

try {
    // 1. Basic field validation
    foreach (['image', 'device_id', 'started_at', 'ended_at', 'duration_sec', 'token', 'topic', 'content_license_version'] as $field) {
        if ($field === 'image') {
            if (!isset($_FILES['image']) || !is_uploaded_file($_FILES['image']['tmp_name'])) {
                throw new RuntimeException('Image upload missing');
            }
            continue;
        }
        if (!isset($_POST[$field]) || trim((string)$_POST[$field]) === '') {
            throw new RuntimeException("Missing field: {$field}");
        }
    }

    $deviceIdRaw = (string)$_POST['device_id'];
    if ((string)$_POST['content_license_version'] !== '2026-07-30-content-licence-v2') {
        throw new RuntimeException('Current public gallery content licence must be accepted');
    }
    $deviceId = normalize_device_id($deviceIdRaw);
    if (!$deviceId) {
        throw new RuntimeException('Invalid device id');
    }

    $startedAt       = (int)$_POST['started_at'];
    $endedAt         = (int)$_POST['ended_at'];
    $duration        = (int)$_POST['duration_sec'];
    $dailyTime       = isset($_POST['daily_time']) ? (int)$_POST['daily_time'] : $duration;
    $submittedToken  = trim((string)$_POST['token']);
    $topic           = trim((string)$_POST['topic']);

    // 2. Token check
    $tokenPayload  = implode('|', [$deviceIdRaw, $startedAt, $endedAt, $duration]);
    $expectedToken = hash_hmac('sha256', $tokenPayload, DAILY_PAINT_SHARED_SECRET);
    if (!hash_equals($expectedToken, $submittedToken)) {
        throw new RuntimeException('Invalid upload token');
    }

    // 3. Optional extra fields
    $challengeAt         = isset($_POST['challenge_at']) ? (int)$_POST['challenge_at'] : null;
    $passportName        = isset($_POST['passport_name']) ? trim((string)$_POST['passport_name']) : null;
    $passportPortraitRaw = isset($_POST['passport_portrait']) ? trim((string)$_POST['passport_portrait']) : null;
    $passportPortrait    = save_passport_portrait($passportPortraitRaw);

    // 4. Store uploaded file
    $upload = $_FILES['image'];
    $ext = strtolower(pathinfo($upload['name'] ?? '', PATHINFO_EXTENSION));

    // Support both images and videos
    $allowedImageExts = ['png', 'jpg', 'jpeg', 'webp'];
    $allowedVideoExts = ['mov', 'mp4'];
    $isVideo = in_array($ext, $allowedVideoExts, true);

    if (!in_array($ext, array_merge($allowedImageExts, $allowedVideoExts), true)) {
        // Default to png for unknown extensions
        $ext = 'png';
        $isVideo = false;
    }

    $datePath   = gmdate('Y/m/d');
    $targetDir  = rtrim(GALLERY_UPLOAD_DIR, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . $datePath;
    if (!is_dir($targetDir) && !mkdir($targetDir, 0775, true) && !is_dir($targetDir)) {
        throw new RuntimeException('Unable to create upload directory');
    }

    $basename  = bin2hex(random_bytes(16));
    $filename  = $basename . '.' . $ext;
    $filepath  = $targetDir . DIRECTORY_SEPARATOR . $filename;

    if (!move_uploaded_file($upload['tmp_name'], $filepath)) {
        throw new RuntimeException('Failed to store uploaded file');
    }

    // Get dimensions only for images (getimagesize doesn't work on videos)
    $width  = null;
    $height = null;
    if (!$isVideo) {
        $info   = @getimagesize($filepath);
        $width  = $info[0] ?? null;
        $height = $info[1] ?? null;
    }

    $relativePath = $datePath . '/' . $filename;
    $imageUrl     = rtrim(GALLERY_UPLOAD_BASE_URL, '/') . '/' . $relativePath;

    // NOTE: Frame upload support removed temporarily to work with current database schema
    // The database needs to be updated with: ALTER TABLE gallery_entries ADD COLUMN frame_urls TEXT NULL;
    // Once added, uncomment the frame handling code below

    /*
    // Handle frame uploads for animated entries
    $frameUrls = null;
    $frameCount = isset($_POST['frame_count']) ? (int)$_POST['frame_count'] : 0;

    if ($frameCount > 0) {
        $frameUrls = [];

        for ($i = 0; $i < $frameCount; $i++) {
            $frameKey = "frame_{$i}";

            if (!isset($_FILES[$frameKey]) || !is_uploaded_file($_FILES[$frameKey]['tmp_name'])) {
                // Frame missing, skip or error
                continue;
            }

            $frameUpload = $_FILES[$frameKey];
            $frameExt = strtolower(pathinfo($frameUpload['name'] ?? '', PATHINFO_EXTENSION));
            if (!in_array($frameExt, ['png', 'jpg', 'jpeg', 'webp'], true)) {
                $frameExt = 'png';
            }

            $frameBasename = bin2hex(random_bytes(16));
            $frameFilename = $frameBasename . '.' . $frameExt;
            $frameFilepath = $targetDir . DIRECTORY_SEPARATOR . $frameFilename;

            if (move_uploaded_file($frameUpload['tmp_name'], $frameFilepath)) {
                $frameRelativePath = $datePath . '/' . $frameFilename;
                $frameUrl = rtrim(GALLERY_UPLOAD_BASE_URL, '/') . '/' . $frameRelativePath;
                $frameUrls[] = $frameUrl;
            }
        }

        // Convert frame URLs to JSON for database storage
        $frameUrls = !empty($frameUrls) ? json_encode($frameUrls) : null;
    }
    */

    // 5. Check if device is blocked
    $isBlocked = is_device_blocked($deviceId);

    if ($isBlocked) {
        // Move file to deaddata
        $deadDir = rtrim(GALLERY_UPLOAD_DIR, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'deaddata';
        if (!is_dir($deadDir)) {
            @mkdir($deadDir, 0775, true);
        }
        $deadPath = $deadDir . DIRECTORY_SEPARATOR . $filename;
        @rename($filepath, $deadPath);

        echo json_encode([
            'ok'                => true,
            'blocked'           => true,
            'device_id'         => $deviceId,
            'topic'             => $topic,
            'challenge_at'      => $challengeAt,
            'passport_name'     => $passportName,
            'passport_portrait' => $passportPortrait ?? $passportPortraitRaw,
            'quarantined_file'  => $filename,
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        exit;
    }

    // 6. Insert into database WITHOUT frame_urls column (will be added later)
    $sql = "
        INSERT INTO gallery_entries (
            image_url, raw_url, topic, created_at, challenge_at, duration_sec,
            width, height, device_id, passport_name, passport_portrait, content_license_version, upvotes, downvotes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
    ";

    $nextId = Database::insert($sql, [
        $imageUrl,
        $imageUrl,
        $topic,
        $endedAt,
        $challengeAt,
        $dailyTime,
        $width,
        $height,
        $deviceId,
        $passportName,
        $passportPortrait,
        (string)$_POST['content_license_version']
    ], ['s', 's', 's', 'i', 'i', 'i', 'i', 'i', 's', 's', 's', 's']);

    // 7. Respond success
    $response = [
        'ok'                => true,
        'blocked'           => false,
        'image_id'          => $nextId,
        'image_url'         => $imageUrl,
        'raw_url'           => $imageUrl,
        'topic'             => $topic,
        'created_at'        => $endedAt,
        'challenge_at'      => $challengeAt,
        'device_id'         => $deviceId,
        'passport_name'     => $passportName,
        'passport_portrait' => $passportPortrait,
    ];

    echo json_encode($response, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

} catch (Throwable $error) {
    http_response_code(400);
    echo json_encode([
        'ok'    => false,
        'error' => $error->getMessage(),
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
}
