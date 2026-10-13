# Backend Suggestions List & Voting API Specification
## February 8, 2026

---

## Overview

This document specifies the backend PHP endpoints needed to support the Gesser Suggestions List feature with voting functionality.

**Base URL**: `https://emojipainter.com/api/gesser`

**New Endpoints**:
1. `list-suggestions.php` - List all topic suggestions with vote data
2. `vote-suggestion.php` - Submit/toggle vote on a suggestion

---

## Database Schema

### Table: `gesser_topics`

Existing table for topic suggestions. Ensure these columns exist:

```sql
CREATE TABLE IF NOT EXISTS `gesser_topics` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `topic` VARCHAR(255) NOT NULL,
  `topic_normalized` VARCHAR(255) NOT NULL,
  `submitted_by` VARCHAR(100) NOT NULL,
  `submitted_by_device_id` VARCHAR(100) NOT NULL,
  `submitted_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `status` ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  `approved_by` VARCHAR(100) NULL,
  `approved_at` DATETIME NULL,
  `word_count` INT NOT NULL DEFAULT 0,
  `times_used` INT NOT NULL DEFAULT 0,
  INDEX `idx_status` (`status`),
  INDEX `idx_submitted_by_device` (`submitted_by_device_id`),
  INDEX `idx_submitted_at` (`submitted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### Table: `gesser_votes` (NEW)

Stores user votes on suggestions:

```sql
CREATE TABLE IF NOT EXISTS `gesser_votes` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `device_id` VARCHAR(100) NOT NULL,
  `suggestion_id` INT NOT NULL,
  `vote_type` ENUM('up', 'down') NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `unique_user_vote` (`device_id`, `suggestion_id`),
  FOREIGN KEY (`suggestion_id`) REFERENCES `gesser_topics` (`id`) ON DELETE CASCADE,
  INDEX `idx_device` (`device_id`),
  INDEX `idx_suggestion` (`suggestion_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### Table: `gesser_users`

Existing table that stores user names and passport URLs. Ensure these columns exist:

```sql
CREATE TABLE IF NOT EXISTS `gesser_users` (
  `device_id` VARCHAR(100) PRIMARY KEY,
  `name` VARCHAR(100) NOT NULL,
  `passport_url` VARCHAR(255) NULL,
  `coins` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

---

## Endpoint 1: `list-suggestions.php`

### Purpose

List all topic suggestions with vote counts, submitter info, and user's vote state.

### Request

**Method**: GET

**Parameters**:
- `device_id` (string, required): Current user's device ID
- `filter` (string, optional): Filter by status ('all', 'pending', 'approved', 'rejected')
  - Default: 'all'
- `limit` (int, optional): Max number of results
  - Default: 100
  - Max: 500

**Example Request**:
```
GET https://emojipainter.com/api/gesser/list-suggestions.php?device_id=abc123&filter=all&limit=100
```

### Database Query

```sql
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
WHERE
  (? = 'all' OR t.status = ?)
GROUP BY t.id, t.topic, t.status, t.submitted_by, t.submitted_by_device_id,
         t.submitted_at, u.passport_url, uv.vote_type
ORDER BY score DESC, t.submitted_at DESC
LIMIT ?
```

**Parameters**:
1. Current user's device_id (for user_vote lookup)
2. Filter value
3. Filter value (again, for WHERE clause)
4. Limit

### Response

**Success (200)**:
```json
{
  "ok": true,
  "suggestions": [
    {
      "id": 123,
      "topic": "A cat riding a skateboard",
      "status": "approved",
      "submittedBy": "Alice",
      "submittedByDeviceId": "device123",
      "submittedAt": "2026-02-08T10:30:00Z",
      "passportUrl": "https://emojipainter.com/uploads/passports/abc123.png",
      "upvotes": 45,
      "downvotes": 3,
      "score": 42,
      "userVote": "up"
    },
    {
      "id": 124,
      "topic": "A dog in a spacesuit",
      "status": "pending",
      "submittedBy": "Bob",
      "submittedByDeviceId": "device456",
      "submittedAt": "2026-02-08T11:00:00Z",
      "passportUrl": null,
      "upvotes": 12,
      "downvotes": 5,
      "score": 7,
      "userVote": null
    }
  ],
  "count": 2
}
```

**Error (400/500)**:
```json
{
  "ok": false,
  "error": "Missing device_id parameter"
}
```

### PHP Implementation Notes

1. Validate `device_id` parameter (required)
2. Validate `filter` parameter (must be 'all', 'pending', 'approved', or 'rejected')
3. Validate `limit` parameter (1-500)
4. Use prepared statements to prevent SQL injection
5. Return ISO 8601 timestamps for `submittedAt`
6. Handle missing passport URLs (return null)
7. Set `Content-Type: application/json` header
8. Log errors but don't expose internal details in response

---

## Endpoint 2: `vote-suggestion.php`

### Purpose

Submit, toggle, or switch a vote on a suggestion.

**Vote Logic**:
- If user has NO vote: Add vote (INSERT)
- If user votes SAME button again: Remove vote (DELETE)
- If user votes OPPOSITE button: Switch vote (UPDATE)

### Request

**Method**: POST

**Content-Type**: `application/json`

**Body**:
```json
{
  "device_id": "abc123",
  "suggestion_id": 123,
  "vote": "up"
}
```

**Parameters**:
- `device_id` (string, required): User's device ID
- `suggestion_id` (int, required): Topic suggestion ID
- `vote` (string, required): Vote type ('up' or 'down')

### Database Logic

```sql
-- Step 1: Check if user already has a vote on this suggestion
SELECT vote_type FROM gesser_votes
WHERE device_id = ? AND suggestion_id = ?

-- Step 2A: If no existing vote - INSERT new vote
INSERT INTO gesser_votes (device_id, suggestion_id, vote_type, created_at)
VALUES (?, ?, ?, NOW())

-- Step 2B: If existing vote is SAME as new vote - DELETE (toggle off)
DELETE FROM gesser_votes
WHERE device_id = ? AND suggestion_id = ?

-- Step 2C: If existing vote is DIFFERENT - UPDATE (switch)
UPDATE gesser_votes
SET vote_type = ?, updated_at = NOW()
WHERE device_id = ? AND suggestion_id = ?

-- Step 3: Get updated vote counts
SELECT
  COALESCE(SUM(CASE WHEN vote_type = 'up' THEN 1 ELSE 0 END), 0) AS upvotes,
  COALESCE(SUM(CASE WHEN vote_type = 'down' THEN 1 ELSE 0 END), 0) AS downvotes,
  COALESCE(SUM(CASE WHEN vote_type = 'up' THEN 1 ELSE -1 END), 0) AS score
FROM gesser_votes
WHERE suggestion_id = ?
```

### Response

**Success (200)**:
```json
{
  "ok": true,
  "message": "Vote recorded",
  "newScore": 42,
  "upvotes": 45,
  "downvotes": 3
}
```

**Success - Vote Removed (200)**:
```json
{
  "ok": true,
  "message": "Vote removed",
  "newScore": 41,
  "upvotes": 44,
  "downvotes": 3
}
```

**Success - Vote Switched (200)**:
```json
{
  "ok": true,
  "message": "Vote updated",
  "newScore": 40,
  "upvotes": 43,
  "downvotes": 4
}
```

**Error (400)**:
```json
{
  "ok": false,
  "error": "Invalid suggestion_id"
}
```

**Error (404)**:
```json
{
  "ok": false,
  "error": "Suggestion not found"
}
```

### PHP Implementation Notes

1. Validate all parameters (device_id, suggestion_id, vote)
2. Verify suggestion exists before processing vote
3. Use transaction for vote updates (BEGIN, COMMIT, ROLLBACK)
4. Check existing vote to determine action (INSERT/UPDATE/DELETE)
5. Return updated vote counts after operation
6. Use prepared statements to prevent SQL injection
7. Set `Content-Type: application/json` header
8. Log errors but don't expose internal details

### Example PHP Transaction

```php
<?php
// Start transaction
$pdo->beginTransaction();

try {
    // Check existing vote
    $stmt = $pdo->prepare("SELECT vote_type FROM gesser_votes WHERE device_id = ? AND suggestion_id = ?");
    $stmt->execute([$device_id, $suggestion_id]);
    $existing = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$existing) {
        // No vote - INSERT
        $stmt = $pdo->prepare("INSERT INTO gesser_votes (device_id, suggestion_id, vote_type) VALUES (?, ?, ?)");
        $stmt->execute([$device_id, $suggestion_id, $vote]);
        $message = "Vote recorded";
    } else if ($existing['vote_type'] === $vote) {
        // Same vote - DELETE (toggle off)
        $stmt = $pdo->prepare("DELETE FROM gesser_votes WHERE device_id = ? AND suggestion_id = ?");
        $stmt->execute([$device_id, $suggestion_id]);
        $message = "Vote removed";
    } else {
        // Different vote - UPDATE (switch)
        $stmt = $pdo->prepare("UPDATE gesser_votes SET vote_type = ?, updated_at = NOW() WHERE device_id = ? AND suggestion_id = ?");
        $stmt->execute([$vote, $device_id, $suggestion_id]);
        $message = "Vote updated";
    }

    // Get updated counts
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

    // Return success response
    echo json_encode([
        'ok' => true,
        'message' => $message,
        'newScore' => $counts['upvotes'] - $counts['downvotes'],
        'upvotes' => $counts['upvotes'],
        'downvotes' => $counts['downvotes']
    ]);

} catch (Exception $e) {
    // Rollback on error
    $pdo->rollBack();
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'error' => 'Failed to process vote'
    ]);
}
?>
```

---

## Performance Considerations

### Indexing

Ensure these indexes exist for fast queries:

```sql
-- gesser_topics indexes
ALTER TABLE gesser_topics ADD INDEX idx_status (status);
ALTER TABLE gesser_topics ADD INDEX idx_submitted_by_device (submitted_by_device_id);
ALTER TABLE gesser_topics ADD INDEX idx_submitted_at (submitted_at);

-- gesser_votes indexes
ALTER TABLE gesser_votes ADD UNIQUE KEY unique_user_vote (device_id, suggestion_id);
ALTER TABLE gesser_votes ADD INDEX idx_device (device_id);
ALTER TABLE gesser_votes ADD INDEX idx_suggestion (suggestion_id);

-- gesser_users indexes
ALTER TABLE gesser_users ADD INDEX idx_name (name);
```

### Caching

Consider caching vote counts for popular suggestions:

1. Use Redis/Memcached for vote count cache
2. Cache key: `gesser:votes:{suggestion_id}`
3. TTL: 60 seconds
4. Invalidate on vote change

### Query Optimization

1. Use `LEFT JOIN` for optional data (passport_url, user_vote)
2. Use `COALESCE` to provide default values (0 for vote counts)
3. Limit results to prevent large responses
4. Consider pagination for large datasets (add `offset` parameter)

---

## Security Considerations

### Input Validation

1. Validate `device_id` format (alphanumeric, max 100 chars)
2. Validate `suggestion_id` is positive integer
3. Validate `vote` is exactly 'up' or 'down'
4. Validate `filter` is one of allowed values
5. Validate `limit` is within bounds (1-500)

### SQL Injection Prevention

1. ALWAYS use prepared statements
2. NEVER concatenate user input into SQL queries
3. Bind parameters for ALL user inputs

### Rate Limiting

Consider implementing rate limiting:

1. Max 10 votes per device per minute
2. Max 100 list requests per device per minute
3. Store rate limit data in Redis/Memcached

### CORS Headers

If accessed from web clients:

```php
header('Access-Control-Allow-Origin: https://emojipainter.com');
header('Access-Control-Allow-Methods: GET, POST');
header('Access-Control-Allow-Headers: Content-Type');
```

---

## Testing Checklist

### list-suggestions.php

- [ ] Returns all suggestions when filter='all'
- [ ] Returns only pending suggestions when filter='pending'
- [ ] Returns only approved suggestions when filter='approved'
- [ ] Returns only rejected suggestions when filter='rejected'
- [ ] Includes correct vote counts (upvotes, downvotes, score)
- [ ] Includes user's vote state (up/down/null)
- [ ] Handles missing passport URLs gracefully
- [ ] Respects limit parameter
- [ ] Returns suggestions sorted by score (highest first)
- [ ] Returns error when device_id missing
- [ ] Returns error when invalid filter value
- [ ] Returns empty array when no suggestions match

### vote-suggestion.php

- [ ] Adds new vote when user has no existing vote
- [ ] Removes vote when user clicks same button again (toggle off)
- [ ] Switches vote when user clicks opposite button
- [ ] Returns updated vote counts after operation
- [ ] Uses transaction for atomic updates
- [ ] Returns error when device_id missing
- [ ] Returns error when suggestion_id invalid
- [ ] Returns error when vote value invalid
- [ ] Returns error when suggestion doesn't exist
- [ ] Prevents SQL injection attacks
- [ ] Handles concurrent vote updates correctly

---

## Deployment

### File Locations

Upload to server via FTP:

```
ftp://webhosting76.1blu.de/www/emojipr/api/gesser/
```

**Files**:
- `list-suggestions.php`
- `vote-suggestion.php`

### Database Migration

Run SQL migration to create `gesser_votes` table and add indexes:

```bash
mysql -u [username] -p [database] < gesser_votes_migration.sql
```

### Post-Deployment Testing

1. Test list-suggestions.php with various filters
2. Test vote-suggestion.php with new votes
3. Test vote toggle (click same button twice)
4. Test vote switching (click opposite button)
5. Verify vote counts match database
6. Check error handling (invalid parameters)
7. Monitor server logs for errors

---

## Summary

**New Endpoints**:
1. `GET /api/gesser/list-suggestions.php` - List suggestions with votes
2. `POST /api/gesser/vote-suggestion.php` - Submit/toggle/switch vote

**New Database Table**:
- `gesser_votes` - Stores user votes on suggestions

**Client Integration**:
- Client-side code already implemented in:
  - `src/gesser/api/gesserClient.ts`
  - `src/gesser/screens/SuggestionsListScreen.tsx`
- Client uses optimistic UI updates for instant feedback
- Client expects exact response format specified above

**Status**: Ready for backend implementation ✅

---

**Specification Complete**: February 8, 2026
**Client Version**: v1.0 (Production Ready)
