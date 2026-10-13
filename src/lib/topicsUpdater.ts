/**
 * Topics JSON Updater
 *
 * Manages synchronization of daily paint topics from server
 * Server URL: https://emojipainter.com/json/topics/
 */

import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SERVER_URL = 'https://emojipainter.com/json/topics/';
const TOPICS_STORAGE_KEY = '@topics_json_filename';
const TOPICS_DATA_KEY = '@topics_json_data';
const TOPICS_HASH_KEY = '@topics_json_hash'; // Store hash of content to detect changes
const LOCAL_TOPICS_PATH = `${FileSystem.documentDirectory}daily_paint_topics.json`;

interface DailyTopicsEntry {
  date: string;
  time_minutes?: number;
  topics: Array<{
    topic: string;
    emoji: string;
    translations?: Record<string, string>;
  }>;
}

/**
 * Simple hash function to detect content changes
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(36);
}

/**
 * Get the current topics JSON filename and data from the server
 * Looks for files matching pattern: topics_26_XXX.json (where XXX is 005, 006, 007, etc.)
 * Returns both filename and the JSON data itself
 */
async function getServerTopicsData(): Promise<{ filename: string; data: DailyTopicsEntry[] } | null> {
  try {
    console.log('[TopicsUpdater] Searching for topics_26_XXX.json files...');
    let filename: string | null = null;

    // Method 1: Try to fetch latest.json manifest file
    try {
      const manifestUrl = SERVER_URL + 'latest.json';
      const manifestResponse = await fetch(manifestUrl, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        cache: 'no-store' // Don't cache this
      });

      if (manifestResponse.ok) {
        const manifestData = await manifestResponse.json();
        if (manifestData.filename && typeof manifestData.filename === 'string') {
          console.log('[TopicsUpdater] Found filename in manifest:', manifestData.filename);
          filename = manifestData.filename;
        }
      }
    } catch (manifestError) {
      console.log('[TopicsUpdater] No manifest file, trying to find latest topics_26_XXX.json...');
    }

    // Method 2: Try to find the highest numbered topics_26_XXX.json file by trying sequential numbers
    if (!filename) {
      const basePattern = 'topics_26_';
      let testStart = 1; // Start from 001
      let testEnd = 200; // Test up to 200
      let latestData: DailyTopicsEntry[] | null = null;
      let validCount = 0;
      let invalidCount = 0;

      console.log('[TopicsUpdater] Probing for latest version (checking 1-200)...');

      // Scan to find the highest valid JSON file
      // We need to actually fetch and validate the JSON, not just check if URL returns 200
      for (let i = testStart; i <= testEnd; i++) {
        const versionNum = String(i).padStart(3, '0');
        const testFilename = `${basePattern}${versionNum}.json`;

        try {
          const testUrl = SERVER_URL + testFilename;
          const testResponse = await fetch(testUrl, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            cache: 'no-store'
          });

          if (testResponse.ok) {
            // Try to parse as JSON to validate it's actually a JSON file
            try {
              const testData = await testResponse.json();
              if (Array.isArray(testData) && testData.length > 0) {
                validCount++;
                filename = testFilename;
                latestData = testData as DailyTopicsEntry[];
                // Don't break - keep looking for higher versions
              }
            } catch (jsonError) {
              // Not valid JSON, skip this file
              invalidCount++;
            }
          }
        } catch (e) {
          // File doesn't exist or network error, continue
        }
      }

      if (filename && latestData) {
        console.log(`[TopicsUpdater] Found ${validCount} valid files, latest: ${filename}`);
        return { filename, data: latestData };
      }
    } else {
      // We have a filename from manifest, download it
      const url = SERVER_URL + filename;
      console.log('[TopicsUpdater] Downloading:', url);

      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        cache: 'no-store' // Don't cache
      });

      if (!response.ok) {
        console.log('[TopicsUpdater] Failed to download JSON');
        return null;
      }

      const data = await response.json();

      // Validate it's an array
      if (!Array.isArray(data)) {
        console.log('[TopicsUpdater] Invalid JSON format');
        return null;
      }

      return { filename, data: data as DailyTopicsEntry[] };
    }

    console.log('[TopicsUpdater] No topics JSON found on server');
    return null;
  } catch (error) {
    console.log('[TopicsUpdater] Failed to fetch server data:', error);
    return null;
  }
}


/**
 * Check and update topics from server if needed
 * Uses content hash to detect changes regardless of filename
 * Returns true if topics were updated
 */
export async function checkAndUpdateTopics(): Promise<boolean> {
  try {
    console.log('[TopicsUpdater] Checking for updates...');

    // Get current stored hash and filename
    const storedHash = await AsyncStorage.getItem(TOPICS_HASH_KEY);
    const storedFilename = await AsyncStorage.getItem(TOPICS_STORAGE_KEY);
    console.log('[TopicsUpdater] Current filename:', storedFilename || 'none');
    console.log('[TopicsUpdater] Current hash:', storedHash || 'none');

    // Fetch server data (filename + content)
    const serverData = await getServerTopicsData();

    if (!serverData) {
      console.log('[TopicsUpdater] Server check failed, using local data');
      return false;
    }

    console.log('[TopicsUpdater] Server filename:', serverData.filename);

    // Calculate hash of server data to detect content changes
    const serverDataStr = JSON.stringify(serverData.data);
    const serverHash = simpleHash(serverDataStr);
    console.log('[TopicsUpdater] Server hash:', serverHash);

    // Compare hash - if same content, no update needed (even if filename changed)
    if (storedHash === serverHash) {
      console.log('[TopicsUpdater] ✅ Topics content is up to date');

      // Update filename in storage if it changed (but content is same)
      if (storedFilename !== serverData.filename) {
        console.log('[TopicsUpdater] Updating stored filename:', serverData.filename);
        await AsyncStorage.setItem(TOPICS_STORAGE_KEY, serverData.filename);
      }

      return false;
    }

    // Content has changed - update everything
    console.log('[TopicsUpdater] 🔄 New topics content detected, updating...');

    // Store new data
    await AsyncStorage.setItem(TOPICS_STORAGE_KEY, serverData.filename);
    await AsyncStorage.setItem(TOPICS_DATA_KEY, serverDataStr);
    await AsyncStorage.setItem(TOPICS_HASH_KEY, serverHash);

    // Also save to file system for backup
    try {
      await FileSystem.writeAsStringAsync(
        LOCAL_TOPICS_PATH,
        JSON.stringify(serverData.data, null, 2)
      );
    } catch (fsError) {
      console.log('[TopicsUpdater] Failed to write to file system:', fsError);
    }

    console.log('[TopicsUpdater] ✅ Topics updated successfully!');
    console.log('[TopicsUpdater]   - New filename:', serverData.filename);
    console.log('[TopicsUpdater]   - New hash:', serverHash);
    console.log('[TopicsUpdater]   - Topics count:', serverData.data.length);
    return true;
  } catch (error) {
    console.log('[TopicsUpdater] Update check failed:', error);
    return false;
  }
}

/**
 * Get current topics data (from storage or default)
 */
export async function getCurrentTopics(): Promise<DailyTopicsEntry[]> {
  try {
    // Try to get from AsyncStorage first
    const storedData = await AsyncStorage.getItem(TOPICS_DATA_KEY);

    if (storedData) {
      return JSON.parse(storedData);
    }

    // Fall back to bundled default
    const defaultTopics = require('../../assets/daily_paint_topics_2025time.json');
    return defaultTopics;
  } catch (error) {
    console.log('[TopicsUpdater] Error loading topics:', error);
    // Return bundled default as last resort
    const defaultTopics = require('../../assets/daily_paint_topics_2025time.json');
    return defaultTopics;
  }
}

/**
 * Get current stored topics filename
 */
export async function getCurrentTopicsFilename(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(TOPICS_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Validate that local topics match server
 * Uses content hash comparison regardless of filename
 * Returns true if they match, false if update needed
 */
export async function validateTopicsSync(): Promise<boolean> {
  try {
    const storedHash = await AsyncStorage.getItem(TOPICS_HASH_KEY);

    // Fetch server data
    const serverData = await getServerTopicsData();

    if (!serverData) {
      // Server not available, assume valid
      return true;
    }

    if (!storedHash) {
      // No stored hash, needs update
      return false;
    }

    // Calculate server hash and compare
    const serverHash = simpleHash(JSON.stringify(serverData.data));
    return storedHash === serverHash;
  } catch {
    // On error, assume valid to not block user
    return true;
  }
}
