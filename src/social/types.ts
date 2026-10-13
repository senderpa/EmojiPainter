/**
 * Social view-model types — what the Profile + World screens render. These are
 * camelCase, UI-ready shapes derived from the server snapshots/responses.
 */
import type { DailyPaintGalleryEntry } from '../lib/dailyPaintGallery';
import type { GesserTimelineEvent, GesserTimelineEventType } from '../gesser/types';

export type TimelineEvent = GesserTimelineEvent;
export type TimelineEventType = GesserTimelineEventType;

export interface ProfileViewModel {
  deviceId: string;
  name: string;
  bio: string | null;
  isSelf: boolean;
  portrait: string | null;
  portraitHistory: string[];
  // Core stats
  elapsedMs: number;
  strokeCount: number;
  coinCount: number;
  rank: number | null;
  // Social
  followerCount: number | null;
  followingCount: number | null;
  isFollowing: boolean;
  correctGuesses: number | null;
  karma: number;
  // Gallery
  galleryEntries: DailyPaintGalleryEntry[];
  galleryCount: number;
  // Server availability (false = server returned 504 or was unreachable)
  serverAvailable: boolean;
}

export interface WorldUser {
  deviceId: string;
  name: string;
  portrait: string | null;
  coins: number;
  rank: number;
  isSelf: boolean;
  isFollowing: boolean;
  followerCount: number | null;
  followingCount: number | null;
  uploadCount: number | null;
  lastActivityAt: number | null; // unix seconds, if available
}

export type FollowList = 'followers' | 'following';
