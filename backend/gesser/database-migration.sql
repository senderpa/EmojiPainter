-- ============================================================================
-- GESSER FEATURE - Suggestions List & Voting Database Migration
-- February 8, 2026
-- ============================================================================
--
-- This migration creates the necessary tables and indexes for the
-- Gesser suggestions list and voting feature.
--
-- ============================================================================

-- ============================================================================
-- 1. CREATE GESSER_VOTES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS `gesser_votes` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `device_id` VARCHAR(100) NOT NULL COMMENT 'User device ID who voted',
  `suggestion_id` INT NOT NULL COMMENT 'Foreign key to gesser_topics.id',
  `vote_type` ENUM('up', 'down') NOT NULL COMMENT 'Vote type: upvote or downvote',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'When vote was created',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'When vote was last updated',

  -- Unique constraint: one vote per user per suggestion
  UNIQUE KEY `unique_user_vote` (`device_id`, `suggestion_id`),

  -- Foreign key to ensure suggestion exists
  FOREIGN KEY (`suggestion_id`) REFERENCES `gesser_topics` (`id`) ON DELETE CASCADE,

  -- Indexes for fast lookups
  INDEX `idx_device` (`device_id`),
  INDEX `idx_suggestion` (`suggestion_id`),
  INDEX `idx_vote_type` (`vote_type`)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Stores user votes (upvotes/downvotes) on topic suggestions';

-- ============================================================================
-- 2. VERIFY GESSER_TOPICS TABLE
-- ============================================================================

-- Ensure gesser_topics table exists with correct structure
CREATE TABLE IF NOT EXISTS `gesser_topics` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `topic` VARCHAR(255) NOT NULL COMMENT 'The topic text',
  `topic_normalized` VARCHAR(255) NOT NULL COMMENT 'Normalized topic for duplicate detection',
  `submitted_by` VARCHAR(100) NOT NULL COMMENT 'User name who submitted',
  `submitted_by_device_id` VARCHAR(100) NOT NULL COMMENT 'Device ID of submitter',
  `submitted_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'When topic was submitted',
  `status` ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending' COMMENT 'Approval status',
  `approved_by` VARCHAR(100) NULL COMMENT 'User who approved/rejected',
  `approved_at` DATETIME NULL COMMENT 'When topic was approved/rejected',
  `word_count` INT NOT NULL DEFAULT 0 COMMENT 'Number of words in topic',
  `times_used` INT NOT NULL DEFAULT 0 COMMENT 'How many times used in mystery paint',

  INDEX `idx_status` (`status`),
  INDEX `idx_submitted_by_device` (`submitted_by_device_id`),
  INDEX `idx_submitted_at` (`submitted_at`),
  INDEX `idx_topic_normalized` (`topic_normalized`)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Stores topic suggestions submitted by users';

-- ============================================================================
-- 3. VERIFY GESSER_USERS TABLE
-- ============================================================================

-- Ensure gesser_users table exists with correct structure
CREATE TABLE IF NOT EXISTS `gesser_users` (
  `device_id` VARCHAR(100) PRIMARY KEY COMMENT 'Unique device ID',
  `name` VARCHAR(100) NOT NULL COMMENT 'User display name',
  `passport_url` VARCHAR(255) NULL COMMENT 'URL to passport image',
  `coins` INT NOT NULL DEFAULT 0 COMMENT 'Gesser coins balance',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'When user was created',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'When user was last updated',

  INDEX `idx_name` (`name`),
  INDEX `idx_coins` (`coins`)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Stores user information for Gesser feature';

-- ============================================================================
-- 4. ADD MISSING INDEXES (IF NOT EXISTS)
-- ============================================================================

-- These indexes may already exist, but we'll attempt to add them if missing

-- gesser_topics indexes
ALTER TABLE `gesser_topics` ADD INDEX IF NOT EXISTS `idx_status` (`status`);
ALTER TABLE `gesser_topics` ADD INDEX IF NOT EXISTS `idx_submitted_by_device` (`submitted_by_device_id`);
ALTER TABLE `gesser_topics` ADD INDEX IF NOT EXISTS `idx_submitted_at` (`submitted_at`);
ALTER TABLE `gesser_topics` ADD INDEX IF NOT EXISTS `idx_topic_normalized` (`topic_normalized`);

-- gesser_users indexes
ALTER TABLE `gesser_users` ADD INDEX IF NOT EXISTS `idx_name` (`name`);
ALTER TABLE `gesser_users` ADD INDEX IF NOT EXISTS `idx_coins` (`coins`);

-- ============================================================================
-- 5. SAMPLE DATA (OPTIONAL - FOR TESTING ONLY)
-- ============================================================================

-- Uncomment below to insert sample data for testing

/*
-- Sample users
INSERT IGNORE INTO gesser_users (device_id, name, passport_url, coins) VALUES
('device_alice', 'Alice', 'https://emojipainter.com/uploads/passports/alice.png', 100),
('device_bob', 'Bob', 'https://emojipainter.com/uploads/passports/bob.png', 50),
('device_charlie', 'Charlie', NULL, 75);

-- Sample topics
INSERT IGNORE INTO gesser_topics (id, topic, topic_normalized, submitted_by, submitted_by_device_id, status) VALUES
(1, 'A cat riding a skateboard', 'cat riding skateboard', 'Alice', 'device_alice', 'approved'),
(2, 'A dog in a spacesuit', 'dog in spacesuit', 'Bob', 'device_bob', 'pending'),
(3, 'A pizza delivering itself', 'pizza delivering itself', 'Charlie', 'device_charlie', 'approved');

-- Sample votes
INSERT IGNORE INTO gesser_votes (device_id, suggestion_id, vote_type) VALUES
('device_alice', 1, 'up'),
('device_bob', 1, 'up'),
('device_charlie', 1, 'up'),
('device_alice', 2, 'down'),
('device_bob', 2, 'up'),
('device_alice', 3, 'up'),
('device_charlie', 3, 'down');
*/

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

-- Verify tables were created
SELECT 'Migration complete!' AS status;
SELECT
    COUNT(*) AS total_topics
FROM gesser_topics;
SELECT
    COUNT(*) AS total_votes
FROM gesser_votes;
