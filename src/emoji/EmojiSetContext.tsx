/**
 * EmojiSetContext — the app-wide selected emoji set + the list of available sets (Apple, Material, and
 * any imported sets). Persisted in AsyncStorage; changing it re-renders all <AppText>/<AppEmoji>.
 */
import React, { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { EmojiResolver } from './customEmoji';
import {
  BUILTIN_SETS, APPLE_SET, loadAllSets, importSetFromZip, deleteImportedSet, type EmojiSetMeta
} from './emojiSets';

const STORAGE_KEY = 'app.emojiSet.v1';

interface EmojiSetValue {
  sets: EmojiSetMeta[];
  activeSetId: string;
  activeSet: EmojiSetMeta;
  setActiveSet: (id: string) => void;
  resolve: EmojiResolver;
  maxKeyLen: number;
  importSet: (onProgress?: (d: number, t: number) => void) => Promise<{ ok: boolean; error?: string }>;
  deleteSet: (id: string) => Promise<void>;
  ready: boolean;
  // back-compat aliases (older call sites used a binary apple/material toggle)
  emojiSet: string;
  setEmojiSet: (id: string) => void;
}

const Ctx = createContext<EmojiSetValue>({
  sets: BUILTIN_SETS, activeSetId: 'apple', activeSet: APPLE_SET, setActiveSet: () => {},
  resolve: () => null, maxKeyLen: 1, importSet: async () => ({ ok: false }), deleteSet: async () => {},
  ready: false, emojiSet: 'apple', setEmojiSet: () => {}
});

export const EmojiSetProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [sets, setSets] = useState<EmojiSetMeta[]>(BUILTIN_SETS);
  const [activeSetId, setActiveSetId] = useState<string>('apple');
  const [ready, setReady] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    (async () => {
      const [saved, all] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY).catch(() => null),
        loadAllSets().catch(() => BUILTIN_SETS)
      ]);
      if (!mounted.current) return;
      setSets(all);
      if (saved && all.some((s) => s.id === saved)) setActiveSetId(saved);
      setReady(true);
    })();
    return () => { mounted.current = false; };
  }, []);

  const setActiveSet = useCallback((id: string) => {
    setActiveSetId(id);
    AsyncStorage.setItem(STORAGE_KEY, id).catch(() => {});
  }, []);

  const importSet = useCallback(async (onProgress?: (d: number, t: number) => void) => {
    try {
      const id = await importSetFromZip(onProgress);
      if (!id) return { ok: false }; // user cancelled
      const all = await loadAllSets();
      if (mounted.current) { setSets(all); setActiveSet(id); }
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Import failed' };
    }
  }, [setActiveSet]);

  const deleteSet = useCallback(async (id: string) => {
    await deleteImportedSet(id);
    const all = await loadAllSets();
    if (mounted.current) {
      setSets(all);
      setActiveSetId((cur) => (cur === id ? 'apple' : cur));
    }
  }, []);

  const activeSet = useMemo(() => sets.find((s) => s.id === activeSetId) || APPLE_SET, [sets, activeSetId]);

  const value = useMemo<EmojiSetValue>(() => ({
    sets, activeSetId, activeSet, setActiveSet,
    resolve: activeSet.resolve, maxKeyLen: activeSet.maxKeyLen,
    importSet, deleteSet, ready,
    emojiSet: activeSetId, setEmojiSet: setActiveSet
  }), [sets, activeSetId, activeSet, setActiveSet, importSet, deleteSet, ready]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export const useEmojiSet = (): EmojiSetValue => useContext(Ctx);
export type EmojiSetId = string;
