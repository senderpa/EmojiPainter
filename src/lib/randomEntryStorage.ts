/**
 * Random Entry Display System
 *
 * Manages showing random user entries on the info page.
 * - Prioritizes current day entries
 * - Falls back to older entries if no current day entries
 * - Tracks shown entries to prevent repeats on same device
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DailyPaintGalleryEntry } from './dailyPaintGallery';

const SHOWN_ENTRIES_KEY = 'emojipaint/info/shownEntries';
const MAX_SHOWN_ENTRIES = 100; // Track last 100 shown entries

interface ShownEntriesStore {
  entryIds: number[]; // List of entry IDs that have been shown
  lastUpdated: string;
}

/**
 * Get local date string in YYYY-MM-DD format
 */
function getLocalDateString(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Check if an entry was created today
 */
function isFromToday(entry: DailyPaintGalleryEntry): boolean {
  const todayStr = getLocalDateString();
  const entryDate = new Date(entry.createdAt);
  const entryDateStr = getLocalDateString(entryDate);
  return entryDateStr === todayStr;
}

/**
 * Get list of shown entry IDs
 */
async function getShownEntryIds(): Promise<number[]> {
  try {
    const raw = await AsyncStorage.getItem(SHOWN_ENTRIES_KEY);
    if (!raw) {
      return [];
    }
    const store = JSON.parse(raw) as ShownEntriesStore;
    return Array.isArray(store.entryIds) ? store.entryIds : [];
  } catch (error) {
    console.error('[randomEntryStorage] Failed to load shown entries:', error);
    return [];
  }
}

/**
 * Save list of shown entry IDs
 */
async function saveShownEntryIds(entryIds: number[]): Promise<void> {
  try {
    // Keep only the last MAX_SHOWN_ENTRIES
    const trimmed = entryIds.slice(-MAX_SHOWN_ENTRIES);

    const store: ShownEntriesStore = {
      entryIds: trimmed,
      lastUpdated: new Date().toISOString()
    };

    await AsyncStorage.setItem(SHOWN_ENTRIES_KEY, JSON.stringify(store));
  } catch (error) {
    console.error('[randomEntryStorage] Failed to save shown entries:', error);
  }
}

/**
 * Mark an entry as shown
 */
export async function markEntryAsShown(entryId: number): Promise<void> {
  const shownIds = await getShownEntryIds();

  // Add to list if not already present
  if (!shownIds.includes(entryId)) {
    shownIds.push(entryId);
    await saveShownEntryIds(shownIds);
  }
}

/**
 * Get a random user entry to display on the info page
 *
 * Priority:
 * 1. Current day entries that haven't been shown
 * 2. Older entries that haven't been shown
 * 3. Current day entries (allowing repeats)
 * 4. Any entry (allowing repeats)
 *
 * @param galleryEntries - All available gallery entries
 * @returns Random entry or null if no entries available
 */
export async function getRandomInfoEntry(
  galleryEntries: DailyPaintGalleryEntry[]
): Promise<DailyPaintGalleryEntry | null> {
  if (galleryEntries.length === 0) {
    return null;
  }

  const shownIds = await getShownEntryIds();

  // Separate entries into categories
  const todayEntries = galleryEntries.filter(isFromToday);
  const olderEntries = galleryEntries.filter(e => !isFromToday(e));

  const unshownTodayEntries = todayEntries.filter(e => !shownIds.includes(e.id));
  const unshownOlderEntries = olderEntries.filter(e => !shownIds.includes(e.id));

  // Priority 1: Unshown today entries
  if (unshownTodayEntries.length > 0) {
    const randomEntry = unshownTodayEntries[Math.floor(Math.random() * unshownTodayEntries.length)];
    console.log('[randomEntryStorage] Selected unshown today entry:', randomEntry.id, randomEntry.topic);
    await markEntryAsShown(randomEntry.id);
    return randomEntry;
  }

  // Priority 2: Unshown older entries
  if (unshownOlderEntries.length > 0) {
    const randomEntry = unshownOlderEntries[Math.floor(Math.random() * unshownOlderEntries.length)];
    console.log('[randomEntryStorage] Selected unshown older entry:', randomEntry.id, randomEntry.topic);
    await markEntryAsShown(randomEntry.id);
    return randomEntry;
  }

  // Priority 3: Today entries (allowing repeats)
  if (todayEntries.length > 0) {
    const randomEntry = todayEntries[Math.floor(Math.random() * todayEntries.length)];
    console.log('[randomEntryStorage] Selected today entry (repeat):', randomEntry.id, randomEntry.topic);
    await markEntryAsShown(randomEntry.id);
    return randomEntry;
  }

  // Priority 4: Any entry (allowing repeats)
  const randomEntry = galleryEntries[Math.floor(Math.random() * galleryEntries.length)];
  console.log('[randomEntryStorage] Selected any entry (repeat):', randomEntry.id, randomEntry.topic);
  await markEntryAsShown(randomEntry.id);
  return randomEntry;
}

/**
 * Clear all shown entries (for testing or reset)
 */
export async function clearShownEntries(): Promise<void> {
  await AsyncStorage.removeItem(SHOWN_ENTRIES_KEY);
  console.log('[randomEntryStorage] Cleared all shown entries');
}
