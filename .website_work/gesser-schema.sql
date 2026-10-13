-- ============================================================================
-- GESSER FEATURE - DATABASE SCHEMA
-- EmojiPainter MySQL Database Migration
-- ============================================================================
-- This migration creates all tables needed for the Gesser feature:
-- - User-generated topics with approval system
-- - Mystery painting guessing game
-- - Friends/social features
--
-- SAFETY: All tables use 'gesser_' prefix to avoid conflicts
-- ROLLBACK: See gesser-schema-rollback.sql
-- ============================================================================

-- Set UTF-8 for emoji support
SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;

-- ============================================================================
-- TABLE: gesser_topics
-- Stores user-generated topic suggestions
-- ============================================================================
CREATE TABLE IF NOT EXISTS gesser_topics (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

  -- Topic content (normalized and display versions)
  topic_normalized VARCHAR(100) NOT NULL COMMENT 'Lowercase, trimmed, no extra spaces',
  topic_display VARCHAR(100) NOT NULL COMMENT 'Original user input with proper capitalization',

  -- Submission info
  submitted_by_device_id VARCHAR(255) NOT NULL COMMENT 'Device ID of submitter',
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Status workflow: pending -> approved/rejected
  status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',

  -- Approval tracking
  approved_by_device_id VARCHAR(255) NULL COMMENT 'Device ID of approver',
  approved_at TIMESTAMP NULL,

  -- Metadata
  word_count TINYINT UNSIGNED NOT NULL DEFAULT 2 COMMENT '1 to 3 words allowed',
  times_used INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'How many times picked for mystery paint',

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- Indexes for performance
  INDEX idx_status (status),
  INDEX idx_submitted_by (submitted_by_device_id),
  INDEX idx_normalized (topic_normalized),
  INDEX idx_approved_at (approved_at),

  -- Ensure unique topics (case-insensitive)
  UNIQUE KEY unique_topic (topic_normalized)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='User-generated topic suggestions with approval workflow';


-- ============================================================================
-- TABLE: gesser_approvals
-- Tracks who approved/rejected which topics (audit trail)
-- ============================================================================
CREATE TABLE IF NOT EXISTS gesser_approvals (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

  topic_id INT UNSIGNED NOT NULL,
  device_id VARCHAR(255) NOT NULL COMMENT 'Device ID of reviewer',

  -- Approval decision
  action ENUM('approve', 'reject') NOT NULL,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Foreign key
  FOREIGN KEY (topic_id) REFERENCES gesser_topics(id) ON DELETE CASCADE,

  -- Indexes
  INDEX idx_topic (topic_id),
  INDEX idx_device (device_id),

  -- Prevent duplicate reviews
  UNIQUE KEY unique_review (topic_id, device_id)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Audit trail for topic approvals/rejections';


-- ============================================================================
-- TABLE: gesser_mystery_paintings
-- Tracks mystery topic paintings (separate from gallery_entries)
-- ============================================================================
CREATE TABLE IF NOT EXISTS gesser_mystery_paintings (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

  -- Link to main gallery entry
  gallery_entry_id INT UNSIGNED NOT NULL COMMENT 'FK to gallery_entries.id',

  -- Secret topic (not visible to users until solved)
  topic_id INT UNSIGNED NULL COMMENT 'FK to gesser_topics.id if user-generated',
  topic_text VARCHAR(100) NOT NULL COMMENT 'The actual topic text (hidden from users)',
  topic_source ENUM('user_generated', 'default_pool') NOT NULL COMMENT 'Where topic came from',

  -- Painter info
  painter_device_id VARCHAR(255) NOT NULL,
  painted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Solving status
  is_solved BOOLEAN NOT NULL DEFAULT FALSE,
  solved_by_device_id VARCHAR(255) NULL,
  solved_at TIMESTAMP NULL,
  total_attempts INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Total guess attempts by all users',

  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- Indexes
  INDEX idx_gallery_entry (gallery_entry_id),
  INDEX idx_solved (is_solved),
  INDEX idx_painter (painter_device_id),
  INDEX idx_topic_id (topic_id),

  -- Ensure one mystery painting per gallery entry
  UNIQUE KEY unique_gallery_entry (gallery_entry_id),

  -- Foreign keys
  FOREIGN KEY (topic_id) REFERENCES gesser_topics(id) ON DELETE SET NULL

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Mystery paintings for guessing game';


-- ============================================================================
-- TABLE: gesser_guesses
-- Tracks all guess attempts (one per user per image)
-- ============================================================================
CREATE TABLE IF NOT EXISTS gesser_guesses (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

  mystery_painting_id INT UNSIGNED NOT NULL,
  device_id VARCHAR(255) NOT NULL COMMENT 'Device ID of guesser',

  -- Guess details
  guess_text VARCHAR(100) NOT NULL COMMENT 'What user guessed',
  is_correct BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Indexes
  INDEX idx_mystery_painting (mystery_painting_id),
  INDEX idx_device (device_id),
  INDEX idx_correct (is_correct),

  -- Enforce: ONE guess per user per image
  UNIQUE KEY unique_user_guess (mystery_painting_id, device_id),

  -- Foreign key
  FOREIGN KEY (mystery_painting_id) REFERENCES gesser_mystery_paintings(id) ON DELETE CASCADE

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='User guess attempts for mystery paintings';


-- ============================================================================
-- TABLE: gesser_friends
-- Friend relationships between users
-- ============================================================================
CREATE TABLE IF NOT EXISTS gesser_friends (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

  -- Friend relationship (bidirectional: A adds B, both are friends)
  user_device_id VARCHAR(255) NOT NULL COMMENT 'User who initiated friendship',
  friend_device_id VARCHAR(255) NOT NULL COMMENT 'Friend device ID',

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Indexes
  INDEX idx_user (user_device_id),
  INDEX idx_friend (friend_device_id),

  -- Prevent duplicates and self-friending
  UNIQUE KEY unique_friendship (user_device_id, friend_device_id),

  CHECK (user_device_id != friend_device_id)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='User friend relationships';


-- ============================================================================
-- TABLE: gesser_daily_mystery_locks
-- Tracks which users have done mystery paint today (1 per day limit)
-- ============================================================================
CREATE TABLE IF NOT EXISTS gesser_daily_mystery_locks (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

  device_id VARCHAR(255) NOT NULL,
  paint_date DATE NOT NULL COMMENT 'Date user did mystery paint (YYYY-MM-DD)',
  mystery_painting_id INT UNSIGNED NULL COMMENT 'Link to their mystery painting',

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Indexes
  INDEX idx_device_date (device_id, paint_date),

  -- Enforce: one mystery paint per user per day
  UNIQUE KEY unique_daily_mystery (device_id, paint_date),

  -- Foreign key
  FOREIGN KEY (mystery_painting_id) REFERENCES gesser_mystery_paintings(id) ON DELETE SET NULL

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Daily mystery paint limit enforcement';


-- ============================================================================
-- TABLE: gesser_coin_awards
-- Audit log for all coin awards from Gesser features
-- ============================================================================
CREATE TABLE IF NOT EXISTS gesser_coin_awards (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

  device_id VARCHAR(255) NOT NULL,
  amount INT NOT NULL COMMENT 'Coin amount (can be negative for penalties)',

  -- Award reason
  reason ENUM(
    'topic_submit',       -- +10: Submitted topic
    'topic_approved',     -- +20: Topic got approved by someone
    'topic_review',       -- +5: Reviewed someone's topic
    'guess_correct',      -- +50: Correct guess
    'mystery_paint',      -- +15: Painted mystery topic
    'referral_bonus',     -- Future: referral rewards
    'other'
  ) NOT NULL,

  -- Link to related records
  topic_id INT UNSIGNED NULL,
  mystery_painting_id INT UNSIGNED NULL,
  guess_id INT UNSIGNED NULL,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Indexes
  INDEX idx_device (device_id),
  INDEX idx_reason (reason),
  INDEX idx_created (created_at),

  -- Foreign keys (nullable for flexibility)
  FOREIGN KEY (topic_id) REFERENCES gesser_topics(id) ON DELETE SET NULL,
  FOREIGN KEY (mystery_painting_id) REFERENCES gesser_mystery_paintings(id) ON DELETE SET NULL,
  FOREIGN KEY (guess_id) REFERENCES gesser_guesses(id) ON DELETE SET NULL

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Audit log for Gesser coin awards';


-- ============================================================================
-- TABLE: gesser_users
-- Stores user profile data (name, passport, coins)
-- ============================================================================
CREATE TABLE IF NOT EXISTS gesser_users (
  device_id VARCHAR(255) PRIMARY KEY COMMENT 'Unique device ID',

  -- User profile
  name VARCHAR(100) NOT NULL DEFAULT 'Anonymous' COMMENT 'Display name',
  passport_url VARCHAR(255) NULL COMMENT 'URL to passport image',

  -- Gesser coins
  coins INT NOT NULL DEFAULT 0 COMMENT 'Total coins earned from Gesser features',

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- Indexes
  INDEX idx_name (name),
  INDEX idx_coins (coins)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='User profile data for Gesser features';


-- ============================================================================
-- TABLE: gesser_votes
-- Stores votes (upvotes/downvotes) on topic suggestions
-- ============================================================================
CREATE TABLE IF NOT EXISTS gesser_votes (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

  device_id VARCHAR(255) NOT NULL COMMENT 'Device ID of voter',
  suggestion_id INT UNSIGNED NOT NULL COMMENT 'FK to gesser_topics.id',

  -- Vote type
  vote_type ENUM('up', 'down') NOT NULL COMMENT 'Upvote or downvote',

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- Unique constraint: one vote per user per suggestion
  UNIQUE KEY unique_user_vote (device_id, suggestion_id),

  -- Foreign key
  FOREIGN KEY (suggestion_id) REFERENCES gesser_topics(id) ON DELETE CASCADE,

  -- Indexes for fast lookups
  INDEX idx_device (device_id),
  INDEX idx_suggestion (suggestion_id),
  INDEX idx_vote_type (vote_type)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='User votes on topic suggestions';


-- ============================================================================
-- ALTER EXISTING TABLES (Additive only - no breaking changes)
-- ============================================================================

-- Add mystery flag to gallery_entries (compatible with MySQL 5.7+)
ALTER TABLE gallery_entries
  ADD COLUMN is_mystery_paint BOOLEAN NOT NULL DEFAULT FALSE
  COMMENT 'True if this is a mystery topic painting (topic hidden until solved)';

-- Add index for mystery filtering
CREATE INDEX idx_mystery
  ON gallery_entries(is_mystery_paint);


-- ============================================================================
-- SEED DATA: Default fallback topics for mystery paint
-- (Used when approved user topics < 9)
-- ============================================================================

INSERT IGNORE INTO gesser_topics
  (topic_normalized, topic_display, status, submitted_by_device_id, word_count, approved_at)
VALUES
  -- Preapproved default topics (2 words each)
  ('galactic garden', 'Galactic Garden', 'approved', 'SYSTEM', 2, NOW()),
  ('retro robot', 'Retro Robot', 'approved', 'SYSTEM', 2, NOW()),
  ('underwater myth', 'Underwater Myth', 'approved', 'SYSTEM', 2, NOW()),
  ('neon dragon', 'Neon Dragon', 'approved', 'SYSTEM', 2, NOW()),
  ('cosmic cat', 'Cosmic Cat', 'approved', 'SYSTEM', 2, NOW()),
  ('pixel wizard', 'Pixel Wizard', 'approved', 'SYSTEM', 2, NOW()),
  ('clockwork lantern', 'Clockwork Lantern', 'approved', 'SYSTEM', 2, NOW()),
  ('floating palace', 'Floating Palace', 'approved', 'SYSTEM', 2, NOW()),
  ('crystal forest', 'Crystal Forest', 'approved', 'SYSTEM', 2, NOW()),
  ('rainbow bridge', 'Rainbow Bridge', 'approved', 'SYSTEM', 2, NOW()),
  ('space whale', 'Space Whale', 'approved', 'SYSTEM', 2, NOW()),
  ('magic mushroom', 'Magic Mushroom', 'approved', 'SYSTEM', 2, NOW()),
  ('steampunk owl', 'Steampunk Owl', 'approved', 'SYSTEM', 2, NOW()),
  ('glowing jellyfish', 'Glowing Jellyfish', 'approved', 'SYSTEM', 2, NOW()),
  ('ancient temple', 'Ancient Temple', 'approved', 'SYSTEM', 2, NOW())
ON DUPLICATE KEY UPDATE topic_display = VALUES(topic_display);


-- ============================================================================
-- VERIFICATION QUERIES (Run after migration)
-- ============================================================================

-- Check all tables exist
-- SELECT
--   TABLE_NAME,
--   TABLE_ROWS,
--   CREATE_TIME
-- FROM information_schema.TABLES
-- WHERE TABLE_SCHEMA = DATABASE()
--   AND TABLE_NAME LIKE 'gesser_%'
-- ORDER BY TABLE_NAME;

-- Check default topics
-- SELECT COUNT(*) as default_topic_count
-- FROM gesser_topics
-- WHERE submitted_by_device_id = 'SYSTEM'
--   AND status = 'approved';

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
-- Next Steps:
-- 1. Run this SQL file on your MySQL database
-- 2. Verify with verification queries above
-- 3. Proceed to M1.2: Create PHP API endpoints
-- ============================================================================
