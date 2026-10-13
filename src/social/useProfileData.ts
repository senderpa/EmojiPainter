/**
 * useProfileData — loads + caches a ProfileViewModel for a deviceId. Re-entry to
 * a recently-viewed profile is instant (module-level cache); a background
 * refresh keeps it fresh.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadProfile } from './socialApi';
import { mergeRefreshedProfile } from './profileMerge';
import type { ProfileViewModel } from './types';

const cache = new Map<string, ProfileViewModel>();

interface Seed { name?: string; portrait?: string | null; rank?: number }

export function useProfileData(deviceId: string, seed?: Seed) {
  const [profile, setProfile] = useState<ProfileViewModel | null>(() => cache.get(deviceId) ?? null);
  const [loading, setLoading] = useState(!cache.has(deviceId));
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  // `run` is deliberately keyed on deviceId alone, so it would otherwise close
  // over the seed from the render that created it. Returning from the portrait
  // studio updates the seed via route params without changing deviceId, so the
  // refresh has to read the current one.
  const seedRef = useRef(seed);
  seedRef.current = seed;
  const profileRef = useRef(profile);
  profileRef.current = profile;

  const run = useCallback(async () => {
    setError(null);
    if (!cache.has(deviceId)) setLoading(true);
    try {
      console.log('[ProfileData] Fetching profile from server for:', deviceId);
      const currentSeed = seedRef.current;
      const vm = mergeRefreshedProfile(
        await loadProfile(deviceId, currentSeed),
        currentSeed?.portrait ?? profileRef.current?.portrait ?? cache.get(deviceId)?.portrait ?? null
      );
      cache.set(deviceId, vm);
      console.log('[ProfileData] Profile loaded — galleryCount:', vm.galleryEntries?.length ?? 0, 'rank:', vm.rank, 'followers:', vm.followerCount, 'portrait:', Boolean(vm.portrait));
      if (mounted.current) setProfile(vm);
    } catch (e) {
      console.warn('[ProfileData] Profile fetch failed:', e instanceof Error ? e.message : String(e));
      if (mounted.current) setError(e instanceof Error ? e.message : 'Failed to load profile');
    } finally {
      if (mounted.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  useEffect(() => {
    mounted.current = true;
    void run();
    return () => { mounted.current = false; };
  }, [run]);

  return { profile, loading, error, refresh: run, setProfile };
}

/** Optimistically patch a cached profile (e.g. after follow/unfollow). */
export function patchProfileCache(deviceId: string, patch: Partial<ProfileViewModel>): void {
  const cur = cache.get(deviceId);
  if (cur) cache.set(deviceId, { ...cur, ...patch });
}
