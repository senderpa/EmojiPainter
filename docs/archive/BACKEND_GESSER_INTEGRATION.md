# Backend Gesser Integration Guide
## Make "Spider Web" Mystery Painting Work

---

## Problem

You uploaded a mystery painting with topic "Spider Web" but it's not appearing in the guess game because the backend needs to:
1. **Store** mystery paintings properly when uploaded
2. **Return** them via the `list-mystery-images.php` endpoint
3. **Validate** guesses via the `submit-guess.php` endpoint

---

## Required Backend Endpoints

### 1. Upload Endpoint (Already Exists?)

**File**: `api/upload_daily_paint.php` or similar

**What Client Sends:**
```json
{
  "topic": "Spider Web",
  "isMysteryPaint": true,
  "mysteryTopicId": 123,
  "imageUri": "data:image/jpeg;base64,...",
  "deviceId": "YOUR_DEVICE_ID",
  "startedAtMs": 1707342000000,
  "endedAtMs": 1707342600000
}
```

**What Server MUST Return:**
```json
{
  "ok": true,
  "isMysteryPaint": true,
  "mysteryPaintingId": 456,
  "isSolved": false,
  "solverName": null,
  "totalAttempts": 0,
  "topic": "Spider Web",
  "imageUrl": "https://emojipainter.com/uploads/mystery/456.jpg"
}
```

**Database Schema Needed:**
```sql
CREATE TABLE IF NOT EXISTS gesser_mystery_paintings (
  id INT PRIMARY KEY AUTO_INCREMENT,
  gallery_entry_id INT NOT NULL,
  topic VARCHAR(100) NOT NULL,
  topic_normalized VARCHAR(100) NOT NULL,
  image_url VARCHAR(500) NOT NULL,
  width INT,
  height INT,
  is_solved BOOLEAN DEFAULT FALSE,
  solver_name VARCHAR(100) NULL,
  solved_at DATETIME NULL,
  total_attempts INT DEFAULT 0,
  painted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  mystery_topic_id INT,
  device_id VARCHAR(100) NOT NULL,

  FOREIGN KEY (gallery_entry_id) REFERENCES gallery_entries(id) ON DELETE CASCADE,
  INDEX idx_solved (is_solved),
  INDEX idx_painted (painted_at DESC)
);
```

---

### 2. List Mystery Images Endpoint (CRITICAL)

**File**: `api/gesser/list-mystery-images.php`

**Request:**
```
GET /api/gesser/list-mystery-images.php?device_id=XXX&filter=all&limit=50
```

**Response Format:**
```json
{
  "ok": true,
  "items": [
    {
      "id": 456,
      "galleryEntryId": 789,
      "imageUrl": "https://emojipainter.com/uploads/mystery/456.jpg",
      "width": 800,
      "height": 800,
      "maskedTopic": "_ p i _ _ r   _ e b",
      "isSolved": false,
      "totalAttempts": 0,
      "paintedAt": "2026-02-07T20:30:00Z",
      "userGuessed": false,
      "solverName": null,
      "solvedAt": null
    }
  ],
  "count": 1,
  "filter": "all"
}
```

**PHP Implementation Example:**
```php
<?php
// api/gesser/list-mystery-images.php

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

require_once '../db_config.php';

// Get params
$deviceId = $_GET['device_id'] ?? '';
$filter = $_GET['filter'] ?? 'all';
$limit = (int)($_GET['limit'] ?? 20);

if (empty($deviceId)) {
    echo json_encode(['ok' => false, 'error' => 'device_id required']);
    exit;
}

try {
    $db = getPDO();

    // Build query based on filter
    $whereClauses = [];
    $params = [];

    if ($filter === 'unsolved') {
        $whereClauses[] = 'is_solved = FALSE';
    } elseif ($filter === 'solved') {
        $whereClauses[] = 'is_solved = TRUE';
    }
    // 'all' = no filter

    $where = !empty($whereClauses) ? 'WHERE ' . implode(' AND ', $whereClauses) : '';

    $sql = "
        SELECT
            id,
            gallery_entry_id as galleryEntryId,
            image_url as imageUrl,
            width,
            height,
            topic,
            is_solved as isSolved,
            solver_name as solverName,
            solved_at as solvedAt,
            total_attempts as totalAttempts,
            painted_at as paintedAt,
            (SELECT COUNT(*) FROM gesser_guess_attempts WHERE mystery_painting_id = gesser_mystery_paintings.id AND device_id = :deviceId) as userGuessed
        FROM gesser_mystery_paintings
        $where
        ORDER BY painted_at DESC
        LIMIT :limit
    ";

    $stmt = $db->prepare($sql);
    $stmt->bindValue(':deviceId', $deviceId, PDO::PARAM_STR);
    $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
    $stmt->execute();

    $items = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Add masked topic to each item
    foreach ($items as &$item) {
        $item['maskedTopic'] = maskTopic($item['topic'], (int)$item['id']);
        $item['userGuessed'] = (int)$item['userGuessed'] > 0;
        $item['isSolved'] = (bool)$item['isSolved'];
        unset($item['topic']); // Don't send actual topic to client!
    }

    echo json_encode([
        'ok' => true,
        'items' => $items,
        'count' => count($items),
        'filter' => $filter
    ]);

} catch (Exception $e) {
    error_log("Gesser list-mystery-images error: " . $e->getMessage());
    echo json_encode([
        'ok' => false,
        'error' => 'Failed to load mystery images'
    ]);
}

/**
 * Mask topic showing only 2 letters (deterministic based on ID)
 */
function maskTopic(string $topic, int $id): string {
    $letters = preg_split('//u', $topic, -1, PREG_SPLIT_NO_EMPTY);
    $letterIndices = [];

    foreach ($letters as $i => $char) {
        if (preg_match('/\p{L}/u', $char)) {
            $letterIndices[] = $i;
        }
    }

    if (count($letterIndices) < 2) {
        return $topic; // Not enough letters to mask
    }

    // Deterministic random based on ID
    mt_srand($id);
    shuffle($letterIndices);
    $revealIndices = array_slice($letterIndices, 0, 2);

    // Build masked string
    $masked = '';
    foreach ($letters as $i => $char) {
        if ($char === ' ') {
            $masked .= '   '; // Keep spaces visible
        } elseif (in_array($i, $revealIndices)) {
            $masked .= $char; // Reveal this letter
        } else {
            $masked .= '_'; // Mask this letter
        }

        if ($i < count($letters) - 1 && $letters[$i] !== ' ' && $letters[$i + 1] !== ' ') {
            $masked .= ' '; // Add spacing between letters
        }
    }

    return $masked;
}
```

---

### 3. Submit Guess Endpoint

**File**: `api/gesser/submit-guess.php`

**Request:**
```json
POST /api/gesser/submit-guess.php
{
  "device_id": "XXX",
  "mystery_painting_id": 456,
  "guess": "Spider Web"
}
```

**Response (Correct):**
```json
{
  "ok": true,
  "correct": true,
  "message": "Correct! +5 coins",
  "actualTopic": "Spider Web",
  "coinsAwarded": 5,
  "totalAttempts": 2
}
```

**Response (Incorrect):**
```json
{
  "ok": true,
  "correct": false,
  "message": "Incorrect! Try again.",
  "totalAttempts": 1
}
```

**PHP Implementation Example:**
```php
<?php
// api/gesser/submit-guess.php

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

require_once '../db_config.php';

$input = json_decode(file_get_contents('php://input'), true);
$deviceId = $input['device_id'] ?? '';
$mysteryPaintingId = (int)($input['mystery_painting_id'] ?? 0);
$guess = trim($input['guess'] ?? '');

if (empty($deviceId) || $mysteryPaintingId <= 0 || empty($guess)) {
    echo json_encode(['ok' => false, 'error' => 'Invalid input']);
    exit;
}

try {
    $db = getPDO();

    // Get mystery painting
    $stmt = $db->prepare("
        SELECT topic, is_solved, total_attempts
        FROM gesser_mystery_paintings
        WHERE id = :id
    ");
    $stmt->execute([':id' => $mysteryPaintingId]);
    $mystery = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$mystery) {
        echo json_encode(['ok' => false, 'error' => 'Mystery painting not found']);
        exit;
    }

    // Normalize for comparison
    $actualTopic = strtolower(trim($mystery['topic']));
    $guessNormalized = strtolower(trim($guess));
    $isCorrect = $actualTopic === $guessNormalized;

    // Record attempt
    $db->prepare("
        INSERT INTO gesser_guess_attempts (mystery_painting_id, device_id, guess_text, is_correct)
        VALUES (:mid, :did, :guess, :correct)
    ")->execute([
        ':mid' => $mysteryPaintingId,
        ':did' => $deviceId,
        ':guess' => $guess,
        ':correct' => $isCorrect ? 1 : 0
    ]);

    // Update total attempts
    $newTotal = (int)$mystery['total_attempts'] + 1;
    $db->prepare("UPDATE gesser_mystery_paintings SET total_attempts = :total WHERE id = :id")
        ->execute([':total' => $newTotal, ':id' => $mysteryPaintingId]);

    $response = [
        'ok' => true,
        'correct' => $isCorrect,
        'totalAttempts' => $newTotal
    ];

    if ($isCorrect) {
        // Award coins
        $coinsAwarded = 5;
        awardCoins($db, $deviceId, $coinsAwarded, 'guess_correct', $mysteryPaintingId);

        // Mark as solved
        $userName = getUserName($db, $deviceId);
        $db->prepare("
            UPDATE gesser_mystery_paintings
            SET is_solved = TRUE, solver_name = :solver, solved_at = NOW()
            WHERE id = :id
        ")->execute([':solver' => $userName, ':id' => $mysteryPaintingId]);

        $response['message'] = "Correct! +{$coinsAwarded} coins";
        $response['actualTopic'] = $mystery['topic'];
        $response['coinsAwarded'] = $coinsAwarded;
    } else {
        $response['message'] = "Incorrect! Try again.";
    }

    echo json_encode($response);

} catch (Exception $e) {
    error_log("Gesser submit-guess error: " . $e->getMessage());
    echo json_encode(['ok' => false, 'error' => 'Failed to submit guess']);
}

function awardCoins($db, $deviceId, $amount, $reason, $mysteryId = null) {
    // TODO: Implement coin system
}

function getUserName($db, $deviceId) {
    $stmt = $db->prepare("SELECT name FROM users WHERE device_id = :did LIMIT 1");
    $stmt->execute([':did' => $deviceId]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);
    return $user['name'] ?? 'Anonymous';
}
```

---

## Quick Test: Manually Insert "Spider Web" Mystery

To test the flow RIGHT NOW, manually insert your "Spider Web" painting into the database:

```sql
-- Find your latest gallery entry
SELECT id, topic, image_url FROM gallery_entries
WHERE topic = 'Spider Web'
ORDER BY created_at DESC LIMIT 1;

-- Insert it as a mystery painting
INSERT INTO gesser_mystery_paintings
  (gallery_entry_id, topic, topic_normalized, image_url, width, height, is_solved, total_attempts, mystery_topic_id, device_id)
VALUES
  (123, 'Spider Web', 'spider web', 'https://emojipainter.com/uploads/123.jpg', 800, 800, FALSE, 0, 456, 'YOUR_DEVICE_ID');

-- Verify it was inserted
SELECT * FROM gesser_mystery_paintings ORDER BY id DESC LIMIT 1;
```

Replace:
- `123` with your actual gallery_entry_id
- `'https://emojipainter.com/uploads/123.jpg'` with your actual image URL
- `'YOUR_DEVICE_ID'` with your device ID

---

## Testing the Complete Flow

### Step 1: Test List Endpoint
```bash
curl "https://emojipainter.com/api/gesser/list-mystery-images.php?device_id=YOUR_DEVICE_ID&filter=all&limit=10"
```

**Expected Response:**
```json
{
  "ok": true,
  "items": [
    {
      "id": 456,
      "imageUrl": "https://...",
      "maskedTopic": "_ p i _ _ r   _ e b",
      "isSolved": false,
      "totalAttempts": 0
    }
  ],
  "count": 1
}
```

### Step 2: Test in App
1. Open app
2. Click "🔍 Guess Topic" button
3. Should see your "Spider Web" image with censored topic
4. Console should log: `[GuessGameScreen] ✅ Received response: { count: 1, filter: "all" }`

### Step 3: Test Guessing
1. Type "spider web" in guess field
2. Click Submit
3. Should see: "✅ Correct! +5 coins"
4. Mystery marked as solved in database

---

## Database Schema Summary

```sql
-- Mystery paintings table
CREATE TABLE gesser_mystery_paintings (
  id INT PRIMARY KEY AUTO_INCREMENT,
  gallery_entry_id INT NOT NULL,
  topic VARCHAR(100) NOT NULL,
  topic_normalized VARCHAR(100) NOT NULL,
  image_url VARCHAR(500) NOT NULL,
  width INT,
  height INT,
  is_solved BOOLEAN DEFAULT FALSE,
  solver_name VARCHAR(100) NULL,
  solved_at DATETIME NULL,
  total_attempts INT DEFAULT 0,
  painted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  mystery_topic_id INT,
  device_id VARCHAR(100) NOT NULL
);

-- Guess attempts table
CREATE TABLE gesser_guess_attempts (
  id INT PRIMARY KEY AUTO_INCREMENT,
  mystery_painting_id INT NOT NULL,
  device_id VARCHAR(100) NOT NULL,
  guess_text VARCHAR(100) NOT NULL,
  is_correct BOOLEAN DEFAULT FALSE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (mystery_painting_id) REFERENCES gesser_mystery_paintings(id) ON DELETE CASCADE
);
```

---

## Client-Side Logging (Already Implemented)

When you click "🔍 Guess Topic", check console for:

```
[GuessGameScreen] Loading mystery images with filter: all
[GuessGameScreen] ✅ Received response: { count: 1, filter: "all" }
```

If count is 0, backend has no mystery paintings to return!

---

## Summary: What You Need

1. ✅ **Client code** - Already done!
2. ❌ **Backend `list-mystery-images.php`** - Need to create this
3. ❌ **Backend `submit-guess.php`** - Need to create this
4. ❌ **Database tables** - Need to create these
5. ❌ **Modify upload endpoint** - Need to store mystery flag

**Quick Win**: Manually insert your "Spider Web" painting using the SQL above, then test!

---

## Next Steps

1. Create database tables (SQL above)
2. Manually insert "Spider Web" mystery painting
3. Create `list-mystery-images.php` endpoint
4. Test in app - should see image with censored topic
5. Create `submit-guess.php` endpoint
6. Test guessing flow

All client-side code is ready and waiting! 🎉
