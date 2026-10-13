/**
 * useWorldUsers — debounced search + paginated discover + optimistic follow for
 * the World page.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadWorldUsers } from './socialApi';
import type { WorldUser } from './types';

const PAGE = 40;

export function useWorldUsers() {
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState<WorldUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const offsetRef = useRef(0);
  const reqIdRef = useRef(0);

  const fetchPage = useCallback(async (term: string, reset: boolean) => {
    const myReq = ++reqIdRef.current;
    if (reset) { setLoading(true); offsetRef.current = 0; } else { setLoading(true); }
    setError(null);
    try {
      const { users: page, hasMore: more, total: nextTotal } = await loadWorldUsers(term, PAGE, offsetRef.current);
      if (myReq !== reqIdRef.current) return;
      offsetRef.current += page.length;
      setHasMore(more);
      setTotal(nextTotal);
      setUsers((prev) => (reset ? page : [...prev, ...page]));
    } catch (e) {
      if (myReq === reqIdRef.current) setError(e instanceof Error ? e.message : 'Failed to load players');
    } finally {
      if (myReq === reqIdRef.current) { setLoading(false); setRefreshing(false); }
    }
  }, []);

  // Debounced search.
  useEffect(() => {
    const id = setTimeout(() => { void fetchPage(search.trim(), true); }, 280);
    return () => clearTimeout(id);
  }, [search, fetchPage]);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) void fetchPage(search.trim(), false);
  }, [loading, hasMore, search, fetchPage]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void fetchPage(search.trim(), true);
  }, [search, fetchPage]);

  // LOCAL-ONLY: FollowButton owns the single network call (+ its own rollback). This just mirrors the
  // resulting state into the list so the row + follower count stay in sync — no second API request.
  const setFollowLocal = useCallback((deviceId: string, following: boolean) => {
    setUsers((prev) => prev.map((u) => (u.deviceId === deviceId
      ? {
          ...u,
          isFollowing: following,
          followerCount: u.followerCount == null
            ? u.followerCount
            : Math.max(0, u.followerCount + (following ? 1 : -1)),
        }
      : u)));
  }, []);

  return { search, setSearch, users, loading, refreshing, hasMore, total, error, loadMore, refresh, setFollowLocal };
}
