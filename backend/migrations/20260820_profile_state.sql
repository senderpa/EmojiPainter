-- Durable, authenticated profile recovery state.
-- Keeps identity and monotonic lifetime totals independent from passport image uploads.

CREATE TABLE IF NOT EXISTS profile_state (
  device_id VARCHAR(128) NOT NULL,
  display_name VARCHAR(40) NOT NULL,
  total_time_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
  total_strokes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  portrait_url VARCHAR(2000) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (device_id),
  KEY idx_profile_state_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
