-- Emoji Painter production profile deletion/licence support.
-- Run after a database backup. All statements are additive except the
-- gallery device_id nullability change, which is required for anonymous posts.

CREATE TABLE IF NOT EXISTS profile_auth_tokens (
  device_id_hash CHAR(64) NOT NULL PRIMARY KEY,
  token_hash CHAR(64) NOT NULL,
  created_at DATETIME NOT NULL,
  last_seen_at DATETIME NOT NULL,
  INDEX idx_profile_auth_last_seen (last_seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS profile_deletion_requests (
  request_id VARCHAR(80) NOT NULL PRIMARY KEY,
  device_id_hash CHAR(64) NOT NULL UNIQUE,
  status ENUM('processing','completed') NOT NULL DEFAULT 'processing',
  anonymized_posts INT UNSIGNED NOT NULL DEFAULT 0,
  storage_objects INT UNSIGNED NOT NULL DEFAULT 0,
  app_version VARCHAR(32) DEFAULT NULL,
  created_at DATETIME NOT NULL,
  completed_at DATETIME DEFAULT NULL,
  INDEX idx_profile_deletion_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS profile_deletion_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_id VARCHAR(80) NOT NULL,
  job_type ENUM('storage','email') NOT NULL,
  payload JSON NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  status ENUM('pending','retry','completed') NOT NULL DEFAULT 'pending',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  last_error VARCHAR(255) DEFAULT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  completed_at DATETIME DEFAULT NULL,
  UNIQUE KEY uq_profile_deletion_job (request_id, job_type, payload_hash),
  INDEX idx_profile_deletion_jobs_status (status, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Existing public submissions survive deletion as anonymous gallery entries.
ALTER TABLE gallery_entries MODIFY device_id VARCHAR(100) NULL;
ALTER TABLE gallery_entries ADD INDEX idx_gallery_anonymous (device_id, created_at);
ALTER TABLE gallery_entries ADD COLUMN content_license_version VARCHAR(64) NULL;

-- Ensure optional auth/leaderboard columns can be nulled by the endpoint.
ALTER TABLE gesser_topics MODIFY submitted_by_device_id VARCHAR(100) NULL;
ALTER TABLE gesser_topics MODIFY submitted_by VARCHAR(255) NULL;
ALTER TABLE gesser_mystery_paintings MODIFY solved_by_device_id VARCHAR(100) NULL;

-- If the deployment has a leaderboard cache table, add a cache version marker.
CREATE TABLE IF NOT EXISTS leaderboard_cache_invalidation (
  cache_key VARCHAR(120) NOT NULL PRIMARY KEY,
  invalidated_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
