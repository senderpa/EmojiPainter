/**
 * useTimeline — loads a user's diary/timeline feed (gallery uploads for everyone;
 * diary + profile changes only when the viewer is the owner) and exposes an
 * optimistic add-diary action that prepends the new entry.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { addDiary, loadTimeline } from './socialApi';
import type { TimelineEvent } from './types';

export function useTimeline(deviceId: string) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await loadTimeline(deviceId);
      if (!mounted.current) return;
      setEvents(res.events);
      setIsOwner(res.isOwner);
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : 'Failed to load timeline');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [deviceId]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; };
  }, [refresh]);

  const postDiary = useCallback(async (text: string): Promise<TimelineEvent | null> => {
    const created = await addDiary(text);
    const nowSec = Math.floor(Date.now() / 1000);
    const entry: TimelineEvent = created ?? {
      id: `local-${nowSec}`,
      type: 'diary',
      text: text.trim(),
      imageUrl: null,
      createdAt: nowSec,
    };
    if (mounted.current) setEvents((prev) => [entry, ...prev]);
    return entry;
  }, []);

  return { events, isOwner, loading, error, refresh, postDiary };
}
