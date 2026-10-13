-- ============================================================================
-- GESSER FEATURE - Social Extra Migration (editable profile + diary/timeline)
-- ============================================================================
-- Non-destructive: only CREATE TABLE IF NOT EXISTS. No existing table is
-- altered or dropped, so users / uploads / followers / passports are untouched.
--
-- On this server, user identity/profile data lives in gallery_entries
-- (passport_name / passport_portrait) and leaderboard_entries — there is no
-- universally-populated gesser_users row, so editable bio / display-name /
-- portrait overrides get their own table (gesser_profiles) keyed by device_id.
--
-- Used by: profile-update.php, profile-social.php, users-discover.php,
--          followers-list.php, diary-add.php, timeline-list.php
-- Run once: php _migrate-social.php  (temporary runner, deleted after)  OR import
-- this file in phpMyAdmin.
-- ============================================================================

-- Editable profile overrides (bio / display name / portrait), keyed by device.
CREATE TABLE IF NOT EXISTS gesser_profiles (
    device_id    VARCHAR(100) NOT NULL PRIMARY KEY,
    display_name VARCHAR(60)  DEFAULT NULL,
    bio          VARCHAR(500) DEFAULT NULL,
    portrait_url VARCHAR(2000) DEFAULT NULL,
    updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Diary + profile-change timeline events (gallery uploads are NOT stored here —
-- they are read live from gallery_entries by timeline-list.php).
CREATE TABLE IF NOT EXISTS gesser_timeline (
    id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    device_id  VARCHAR(100) NOT NULL,
    type       VARCHAR(32)  NOT NULL,           -- 'diary' | 'profile_change'
    text       TEXT NOT NULL,
    meta       TEXT DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_timeline_device_created (device_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
