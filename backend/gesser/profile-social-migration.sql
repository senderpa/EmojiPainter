-- Profile-social rework (v8.1.0) — backend support for follower counts +
-- per-user correct-guess totals. Run once against the gesser database.

-- 1) Index the solver column so correct-guess counts are fast.
--    (gesser_mystery_paintings already indexes is_solved, not the solver.)
ALTER TABLE gesser_mystery_paintings ADD INDEX idx_solved_by (solved_by_device_id);

-- No new tables: follower/following counts come from the existing directed
-- gesser_friends edge (user_device_id -> friend_device_id), which already has
-- idx_user + idx_friend. profile-social.php uses those directly.

-- 2) OPTIONAL — show a follower count on each World row without N+1 calls.
--    Patch api/gesser/users-discover.php so each user row includes a correlated
--    follower_count subquery, e.g.:
--
--    SELECT u.device_id, u.name, u.passport_url, u.coins,
--           (SELECT COUNT(*) FROM gesser_friends f
--             WHERE f.friend_device_id = u.device_id) AS follower_count,
--           EXISTS(SELECT 1 FROM gesser_friends ff
--                   WHERE ff.user_device_id = :viewer
--                     AND ff.friend_device_id = u.device_id) AS is_friend
--      FROM gesser_users u
--     WHERE (:search = '' OR u.name LIKE :searchLike)
--     ORDER BY u.coins DESC
--     LIMIT :limit OFFSET :offset;
--
--    Then add `follower_count` to the JSON each row returns. The app already
--    reads `follower_count` (snake) OR `followerCount` (camel) and degrades to
--    "no count" when absent, so deploying the endpoint first is safe.
