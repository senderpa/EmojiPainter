# Gesser Backend - Suggestions List & Voting API

## Overview

Backend PHP endpoints for the Gesser suggestions list and voting feature.

**Base URL**: `https://emojipainter.com/api/gesser`

## Files in This Package

```
backend/
├── gesser/
│   ├── list-suggestions.php       # List suggestions with votes
│   ├── vote-suggestion.php        # Submit/toggle/switch votes
│   ├── database-migration.sql     # Database schema
│   └── README.md                  # This file
└── config/
    └── db.php.example             # Database config template
```

## Deployment Instructions

### 1. Upload Files via FTP

Upload these files to your server:

**FTP Host**: `ftp://webhosting76.1blu.de`
**Base Path**: `/www/emojipr/`

**File Structure**:
```
/www/emojipr/
├── api/
│   └── gesser/
│       ├── list-suggestions.php
│       ├── vote-suggestion.php
│       └── (other existing gesser files...)
└── config/
    └── db.php
```

### 2. Configure Database Connection

1. Copy `backend/config/db.php.example` to your server as `config/db.php`
2. Edit `/www/emojipr/config/db.php` with your database credentials:

```php
$db_host = 'localhost';
$db_name = 'your_actual_database';
$db_user = 'your_db_username';
$db_pass = 'your_db_password';
```

3. **IMPORTANT**: Never commit `db.php` to version control!

### 3. Run Database Migration

Execute the SQL migration file to create tables and indexes:

**Option A: Via phpMyAdmin**
1. Open phpMyAdmin
2. Select your database
3. Go to "Import" tab
4. Upload `database-migration.sql`
5. Click "Go"

**Option B: Via MySQL Command Line**
```bash
mysql -u your_username -p your_database < backend/gesser/database-migration.sql
```

**Option C: Via SSH**
```bash
ssh your_server
cd /path/to/project
mysql -u your_username -p your_database < database-migration.sql
```

### 4. Verify Installation

**Test list-suggestions.php**:
```bash
curl "https://emojipainter.com/api/gesser/list-suggestions.php?device_id=test123&filter=all&limit=10"
```

Expected response:
```json
{
  "ok": true,
  "suggestions": [...],
  "count": 0
}
```

**Test vote-suggestion.php**:
```bash
curl -X POST https://emojipainter.com/api/gesser/vote-suggestion.php \
  -H "Content-Type: application/json" \
  -d '{"device_id":"test123","suggestion_id":1,"vote":"up"}'
```

Expected response:
```json
{
  "ok": true,
  "message": "Vote recorded",
  "newScore": 1,
  "upvotes": 1,
  "downvotes": 0
}
```

### 5. Set File Permissions

Ensure PHP files have correct permissions:

```bash
chmod 644 api/gesser/*.php
chmod 644 config/db.php
```

### 6. Enable Error Logging

Add to your `php.ini` or `.htaccess`:

```ini
error_reporting = E_ALL
log_errors = On
error_log = /path/to/php-error.log
```

## API Endpoints

### 1. List Suggestions

**Endpoint**: `GET /api/gesser/list-suggestions.php`

**Parameters**:
- `device_id` (required): User's device ID
- `filter` (optional): 'all', 'pending', 'approved', 'rejected' (default: 'all')
- `limit` (optional): Max results 1-500 (default: 100)

**Example Request**:
```bash
curl "https://emojipainter.com/api/gesser/list-suggestions.php?device_id=abc123&filter=approved&limit=20"
```

**Example Response**:
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
      "submittedAt": "2026-02-08T10:30:00+00:00",
      "passportUrl": "https://emojipainter.com/uploads/passports/abc123.png",
      "upvotes": 45,
      "downvotes": 3,
      "score": 42,
      "userVote": "up"
    }
  ],
  "count": 1
}
```

### 2. Vote on Suggestion

**Endpoint**: `POST /api/gesser/vote-suggestion.php`

**Body**:
```json
{
  "device_id": "abc123",
  "suggestion_id": 123,
  "vote": "up"
}
```

**Vote Logic**:
- No existing vote → INSERT new vote
- Same vote again → DELETE vote (toggle off)
- Opposite vote → UPDATE vote (switch)

**Example Request**:
```bash
curl -X POST https://emojipainter.com/api/gesser/vote-suggestion.php \
  -H "Content-Type: application/json" \
  -d '{"device_id":"abc123","suggestion_id":123,"vote":"up"}'
```

**Example Response**:
```json
{
  "ok": true,
  "message": "Vote recorded",
  "newScore": 42,
  "upvotes": 45,
  "downvotes": 3
}
```

## Database Schema

### Table: `gesser_votes`

```sql
CREATE TABLE gesser_votes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_id VARCHAR(100) NOT NULL,
  suggestion_id INT NOT NULL,
  vote_type ENUM('up', 'down') NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_user_vote (device_id, suggestion_id),
  FOREIGN KEY (suggestion_id) REFERENCES gesser_topics (id) ON DELETE CASCADE
);
```

### Indexes

For optimal performance, ensure these indexes exist:

```sql
-- gesser_topics
ALTER TABLE gesser_topics ADD INDEX idx_status (status);
ALTER TABLE gesser_topics ADD INDEX idx_submitted_at (submitted_at);

-- gesser_votes
ALTER TABLE gesser_votes ADD INDEX idx_device (device_id);
ALTER TABLE gesser_votes ADD INDEX idx_suggestion (suggestion_id);

-- gesser_users
ALTER TABLE gesser_users ADD INDEX idx_name (name);
```

## Security

### Input Validation

Both endpoints validate:
- Device ID format (alphanumeric, max 100 chars)
- Suggestion ID (positive integer)
- Vote type ('up' or 'down')
- Filter values (enum)
- Limit bounds (1-500)

### SQL Injection Prevention

- All queries use prepared statements
- Parameters are bound, never concatenated
- PDO::PARAM_* types used where appropriate

### CORS Headers

Both endpoints include CORS headers:
```php
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST');
header('Access-Control-Allow-Headers: Content-Type');
```

### Error Handling

- Database errors are logged but not exposed to clients
- Generic error messages returned to users
- Proper HTTP status codes (400, 404, 500)

## Performance

### Query Optimization

- Uses LEFT JOIN for optional data
- Uses COALESCE for default values
- Includes proper indexes for fast lookups
- Limits result sets to prevent large responses

### Transaction Usage

`vote-suggestion.php` uses transactions:
```php
$pdo->beginTransaction();
// ... vote operations ...
$pdo->commit();
```

Ensures atomic updates even under concurrent load.

## Troubleshooting

### "Database connection failed"

**Problem**: Cannot connect to database

**Solutions**:
1. Verify `config/db.php` credentials
2. Check database server is running
3. Verify database name exists
4. Check user has proper permissions

### "Table doesn't exist"

**Problem**: `gesser_votes` table not found

**Solution**: Run `database-migration.sql` to create tables

### "Vote not working"

**Problem**: Vote endpoint returns error

**Checklist**:
1. Verify suggestion_id exists in gesser_topics
2. Check foreign key constraint is valid
3. Ensure vote_type is 'up' or 'down'
4. Check database transaction support (InnoDB)

### "Passport images not showing"

**Problem**: passportUrl is null

**Solution**: Ensure gesser_users table has passport_url populated

### "Slow queries"

**Problem**: API responses are slow

**Solutions**:
1. Run `ANALYZE TABLE gesser_votes;`
2. Verify indexes exist: `SHOW INDEX FROM gesser_votes;`
3. Check query execution: `EXPLAIN SELECT ... ;`
4. Consider adding more indexes or caching

## Testing Checklist

### list-suggestions.php

- [ ] Returns all suggestions when filter='all'
- [ ] Returns only pending suggestions when filter='pending'
- [ ] Returns only approved suggestions when filter='approved'
- [ ] Returns only rejected suggestions when filter='rejected'
- [ ] Includes correct vote counts
- [ ] Includes user's vote state
- [ ] Handles missing passport URLs
- [ ] Respects limit parameter
- [ ] Returns error when device_id missing
- [ ] Returns error when invalid filter

### vote-suggestion.php

- [ ] Adds new vote successfully
- [ ] Toggles vote off when clicking same button
- [ ] Switches vote when clicking opposite button
- [ ] Returns updated vote counts
- [ ] Returns error when device_id missing
- [ ] Returns error when suggestion_id invalid
- [ ] Returns error when vote invalid
- [ ] Returns error when suggestion doesn't exist
- [ ] Handles concurrent votes correctly

## Monitoring

### Log Files

Monitor these logs for errors:
- PHP error log: `/var/log/php-error.log`
- MySQL slow query log: `/var/log/mysql/slow-query.log`
- Apache/Nginx access log: `/var/log/apache2/access.log`

### Common Error Patterns

Search logs for:
```bash
grep "list-suggestions.php" /var/log/php-error.log
grep "vote-suggestion.php" /var/log/php-error.log
grep "Database error" /var/log/php-error.log
```

## Maintenance

### Database Cleanup

Periodically clean up old data:

```sql
-- Delete votes on deleted suggestions (should be automatic with CASCADE)
DELETE FROM gesser_votes
WHERE suggestion_id NOT IN (SELECT id FROM gesser_topics);

-- Find suggestions with no votes
SELECT t.id, t.topic, COUNT(v.id) as vote_count
FROM gesser_topics t
LEFT JOIN gesser_votes v ON t.id = v.suggestion_id
GROUP BY t.id
HAVING vote_count = 0;
```

### Performance Analysis

```sql
-- Top voted suggestions
SELECT
    t.topic,
    COUNT(CASE WHEN v.vote_type = 'up' THEN 1 END) as upvotes,
    COUNT(CASE WHEN v.vote_type = 'down' THEN 1 END) as downvotes
FROM gesser_topics t
LEFT JOIN gesser_votes v ON t.id = v.suggestion_id
GROUP BY t.id, t.topic
ORDER BY upvotes - downvotes DESC
LIMIT 10;

-- Most active voters
SELECT
    device_id,
    COUNT(*) as total_votes,
    COUNT(CASE WHEN vote_type = 'up' THEN 1 END) as upvotes,
    COUNT(CASE WHEN vote_type = 'down' THEN 1 END) as downvotes
FROM gesser_votes
GROUP BY device_id
ORDER BY total_votes DESC
LIMIT 10;
```

## Support

For issues or questions:
- Check error logs first
- Review this README
- Verify client-side implementation in `src/gesser/api/gesserClient.ts`
- Check API specification in `BACKEND_SUGGESTIONS_LIST_SPEC.md`

## Version

**Version**: 1.0
**Date**: February 8, 2026
**Status**: Production Ready ✅

---

**Deployment Complete**: Upload files, configure database, run migration, test endpoints.
