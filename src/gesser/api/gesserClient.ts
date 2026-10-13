/**
 * GESSER FEATURE - API Client
 *
 * Network client for all Gesser API endpoints.
 * Handles requests, errors, and response parsing.
 */

import type {
  GesserTopicSubmitResponse,
  GesserPendingTopicResponse,
  GesserApproveTopicResponse,
  GesserSuggestionsListResponse,
  GesserVoteSuggestionResponse,
  GesserMysteryTopicResponse,
  GesserMysteryListResponse,
  GesserGuessSubmitResponse,
  GesserFriendsListResponse,
  GesserUsersDiscoverResponse,
  GesserFriendActionResponse,
  GesserProfileSocialResponse,
  GesserFollowersListResponse,
  GesserFollowerRow,
  GesserTimelineEvent,
  GesserTimelineEventType,
  GesserTimelineListResponse,
  GesserProfileUpdateResponse,
  GesserDiaryAddResponse
} from '../types';

const GESSER_API_BASE = 'https://emojipainter.com/api/gesser';

const nowMs = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const estimateBodySize = (body: RequestInit['body']): number | null => {
  if (typeof body === 'string') {
    return body.length;
  }
  if (body instanceof URLSearchParams) {
    return body.toString().length;
  }
  return null;
};

const logGesserNetwork = (details: {
  endpoint: string;
  method: string;
  requestSize: number | null;
  responseSize: number;
  compressed: string;
  status: number;
  roundTripMs: number;
  decodeMs: number;
}): void => {
  if (!__DEV__) return;
  console.log('[Gesser API debug]', {
    endpoint: details.endpoint,
    method: details.method,
    requestSize: details.requestSize == null ? 'unknown' : `${details.requestSize}B`,
    responseSize: `${details.responseSize}B`,
    compressed: details.compressed,
    status: details.status,
    roundTripMs: Math.round(details.roundTripMs),
    decodeMs: Math.round(details.decodeMs * 10) / 10,
  });
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generic fetch wrapper with error handling
 */
async function gesserFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${GESSER_API_BASE}/${endpoint}`;
  const method = options.method ?? 'GET';
  const requestSize = estimateBodySize(options.body);

  // 15s timeout so a stalled connection can't hang a screen's spinner forever.
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), 15000);
  try {
    const networkStart = nowMs();
    const response = await fetch(url, {
      ...options,
      signal: options.signal ?? timeoutController.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    const networkEnd = nowMs();
    const contentEncoding = response.headers.get('content-encoding') ?? 'identity';

    // Check if response is JSON
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      // Backend is returning HTML or other non-JSON content
      const text = await response.text();
      console.error('[Gesser API]', endpoint, 'returned non-JSON:', text.substring(0, 200));

      if (!response.ok) {
        throw new Error(`Backend API not available (HTTP ${response.status}). Please ensure the backend files are uploaded to the server.`);
      }

      throw new Error('Backend API returned invalid response. Please check server configuration.');
    }

    const text = await response.text();
    const decodeStart = nowMs();
    const data = text ? JSON.parse(text) : {};
    const decodeEnd = nowMs();

    logGesserNetwork({
      endpoint,
      method,
      requestSize,
      responseSize: text.length,
      compressed: contentEncoding,
      status: response.status,
      roundTripMs: networkEnd - networkStart,
      decodeMs: decodeEnd - decodeStart,
    });

    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    return data as T;
  } catch (error: any) {
    console.error('[Gesser API]', endpoint, 'error:', error);

    // Provide user-friendly error messages
    if (error.message?.includes('JSON')) {
      throw new Error('Backend API not configured. Please upload the backend PHP files to the server.');
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * POST request helper
 */
async function post<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  return gesserFetch<T>(endpoint, {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

/**
 * GET request helper
 */
async function get<T>(endpoint: string, params?: Record<string, string | number>): Promise<T> {
  let url = endpoint;

  if (params) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      searchParams.append(key, String(value));
    });
    url += `?${searchParams.toString()}`;
  }

  return gesserFetch<T>(url, { method: 'GET' });
}

// ============================================================================
// TOPIC ENDPOINTS
// ============================================================================

/**
 * Submit a new topic suggestion
 */
export async function submitTopicSuggestion(
  deviceId: string,
  topic: string
): Promise<GesserTopicSubmitResponse> {
  return post<GesserTopicSubmitResponse>('suggest-topic.php', {
    device_id: deviceId,
    topic
  });
}

/**
 * Get a pending topic to review
 */
export async function getPendingTopic(
  deviceId: string
): Promise<GesserPendingTopicResponse> {
  return get<GesserPendingTopicResponse>('get-pending-topic.php', {
    device_id: deviceId
  });
}

/**
 * Approve or reject a topic
 */
export async function approveTopic(
  deviceId: string,
  topicId: number,
  action: 'approve' | 'reject'
): Promise<GesserApproveTopicResponse> {
  return post<GesserApproveTopicResponse>('approve-topic.php', {
    device_id: deviceId,
    topic_id: topicId,
    action
  });
}

/**
 * List all topic suggestions (for suggestions list screen)
 */
export async function listAllSuggestions(
  deviceId: string,
  filter: 'all' | 'pending' | 'approved' | 'rejected' = 'all',
  limit: number = 100
): Promise<GesserSuggestionsListResponse> {
  return get<GesserSuggestionsListResponse>('list-suggestions.php', {
    device_id: deviceId,
    filter,
    limit
  });
}

/**
 * Vote on a suggestion (upvote or downvote)
 */
export async function voteSuggestion(
  deviceId: string,
  suggestionId: number,
  vote: 'up' | 'down'
): Promise<GesserVoteSuggestionResponse> {
  return post<GesserVoteSuggestionResponse>('vote-suggestion.php', {
    device_id: deviceId,
    suggestion_id: suggestionId,
    vote
  });
}

// ============================================================================
// MYSTERY PAINT ENDPOINTS
// ============================================================================

/**
 * Get a random mystery topic for painting
 */
export async function getRandomMysteryTopic(
  deviceId: string
): Promise<GesserMysteryTopicResponse> {
  const raw = await post<any>('get-random-mystery-topic.php', { device_id: deviceId });
  // Server returns snake_case topic_id — normalise to camelCase
  return {
    ok: raw.ok,
    topicId: raw.topicId ?? raw.topic_id,
    topic: raw.topic,
    source: raw.source,
    message: raw.message,
  };
}

/**
 * List mystery images for guessing
 */
export async function listMysteryImages(
  deviceId: string,
  filter: 'unsolved' | 'solved' | 'all' = 'unsolved',
  limit: number = 20
): Promise<GesserMysteryListResponse> {
  return get<GesserMysteryListResponse>('list-mystery-images.php', {
    device_id: deviceId,
    filter,
    limit
  });
}

/**
 * Submit a guess for a mystery painting
 */
export async function submitGuess(
  deviceId: string,
  mysteryPaintingId: number,
  guess: string
): Promise<GesserGuessSubmitResponse> {
  return post<GesserGuessSubmitResponse>('submit-guess.php', {
    device_id: deviceId,
    mystery_painting_id: mysteryPaintingId,
    guess
  });
}

// ============================================================================
// FRIENDS/SOCIAL ENDPOINTS
// ============================================================================

/**
 * Add a friend
 */
export async function addFriend(
  deviceId: string,
  friendDeviceId: string
): Promise<GesserFriendActionResponse> {
  return post<GesserFriendActionResponse>('friends-add.php', {
    device_id: deviceId,
    friend_device_id: friendDeviceId
  });
}

/**
 * Remove a friend
 */
export async function removeFriend(
  deviceId: string,
  friendDeviceId: string
): Promise<GesserFriendActionResponse> {
  return post<GesserFriendActionResponse>('friends-remove.php', {
    device_id: deviceId,
    friend_device_id: friendDeviceId
  });
}

/**
 * List all friends
 */
export async function listFriends(
  deviceId: string
): Promise<GesserFriendsListResponse> {
  const raw = await get<any>('friends-list.php', { device_id: deviceId });
  // Server returns snake_case — normalize to camelCase
  const friends = (raw.friends ?? []).map((f: any) => ({
    deviceId: f.device_id ?? f.deviceId ?? '',
    name: f.name ?? '',
    portrait: f.portrait ?? null,
    coins: f.coins ?? 0,
    rank: f.rank ?? 0,
    addedAt: f.added_at ?? f.addedAt ?? '',
  }));
  return { ok: raw.ok, friends, count: raw.count ?? friends.length };
}

/**
 * Discover users (world list)
 */
export async function discoverUsers(
  deviceId: string,
  search?: string,
  limit: number = 50,
  offset: number = 0
): Promise<GesserUsersDiscoverResponse> {
  const params: Record<string, string | number> = {
    device_id: deviceId,
    limit,
    offset
  };

  if (search) {
    params.search = search;
  }

  return get<GesserUsersDiscoverResponse>('users-discover.php', params);
}

/**
 * Social stats for a profile page (follower/following/is-following/correct
 * guesses) for ANY target user. Degrades gracefully (zeros) if the backend
 * endpoint isn't deployed yet.
 */
export async function getProfileSocial(
  viewerDeviceId: string,
  targetDeviceId: string
): Promise<GesserProfileSocialResponse> {
  const fallback: GesserProfileSocialResponse = {
    ok: false,
    targetDeviceId,
    followerCount: 0,
    followingCount: 0,
    isFollowing: false,
    correctGuesses: 0,
    bio: null,
    displayName: null,
    portraitUrl: null,
  };
  try {
    const raw = await get<any>('profile-social.php', {
      device_id: viewerDeviceId,
      target_device_id: targetDeviceId,
    });
    const str = (v: any): string | null =>
      typeof v === 'string' && v.trim().length > 0 ? v : null;
    return {
      ok: !!raw.ok,
      targetDeviceId,
      followerCount: Number(raw.follower_count ?? raw.followerCount ?? 0) || 0,
      followingCount: Number(raw.following_count ?? raw.followingCount ?? 0) || 0,
      isFollowing: !!(raw.is_following ?? raw.isFollowing),
      correctGuesses: Number(raw.correct_guesses ?? raw.correctGuesses ?? 0) || 0,
      bio: str(raw.bio ?? raw.biography),
      displayName: str(raw.display_name ?? raw.displayName),
      portraitUrl: str(raw.portrait_url ?? raw.portraitUrl),
    };
  } catch {
    return fallback;
  }
}

/** Normalize a server timeline event (snake OR camel) into a GesserTimelineEvent. */
function toTimelineEvent(e: any): GesserTimelineEvent {
  const created = e.created_at ?? e.createdAt ?? 0;
  let createdAt = Number(created);
  if (!Number.isFinite(createdAt) || createdAt <= 0) {
    const parsed = Date.parse(String(created));
    createdAt = Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
  }
  const t = String(e.type ?? 'diary');
  const type: GesserTimelineEventType =
    t === 'gallery_upload' || t === 'profile_change' ? t : 'diary';
  return {
    id: String(e.id ?? `${type}-${createdAt}`),
    type,
    text: String(e.text ?? ''),
    imageUrl: e.image_url ?? e.imageUrl ?? null,
    createdAt,
  };
}

/**
 * List who FOLLOWS a target user (the reverse follow query). Degrades to an
 * empty list if the backend endpoint isn't deployed yet.
 */
export async function getFollowers(
  targetDeviceId: string,
  viewerDeviceId?: string
): Promise<GesserFollowersListResponse> {
  try {
    const params: Record<string, string> = { target_device_id: targetDeviceId };
    if (viewerDeviceId) params.device_id = viewerDeviceId;
    const raw = await get<any>('followers-list.php', params);
    const followers: GesserFollowerRow[] = (raw.followers ?? []).map((f: any) => ({
      deviceId: f.device_id ?? f.deviceId ?? '',
      name: f.name ?? '',
      portrait: f.portrait ?? f.passport_url ?? null,
      coins: Number(f.coins ?? 0) || 0,
      isFriend: !!(f.is_friend ?? f.isFriend),
    })).filter((f: GesserFollowerRow) => !!f.deviceId);
    return { ok: !!raw.ok, followers, count: Number(raw.count ?? followers.length) || followers.length };
  } catch {
    return { ok: false, followers: [], count: 0 };
  }
}

/** Update the owner's own profile (name / bio / portrait). Logs a profile_change event server-side. */
export async function updateProfile(
  deviceId: string,
  patch: { name?: string; bio?: string; portraitUrl?: string }
): Promise<GesserProfileUpdateResponse> {
  const body: Record<string, unknown> = { device_id: deviceId };
  if (patch.name !== undefined) body.name = patch.name;
  if (patch.bio !== undefined) body.bio = patch.bio;
  if (patch.portraitUrl !== undefined) body.portrait_url = patch.portraitUrl;
  const raw = await post<any>('profile-update.php', body);
  if (!raw.ok) throw new Error(raw.error || 'Profile update failed');
  return { ok: true, updated: raw.updated ?? [], deviceId };
}

/** Append a manual diary entry to the owner's private timeline. */
export async function addDiaryEntry(
  deviceId: string,
  text: string
): Promise<GesserDiaryAddResponse> {
  const raw = await post<any>('diary-add.php', { device_id: deviceId, text });
  if (!raw.ok) throw new Error(raw.error || 'Could not add diary entry');
  return { ok: true, entry: raw.entry ? toTimelineEvent(raw.entry) : undefined };
}

/**
 * List a user's timeline (gallery uploads for everyone; diary + profile changes
 * only when the viewer is the owner). Degrades to an empty feed on error.
 */
export async function listTimeline(
  targetDeviceId: string,
  viewerDeviceId?: string,
  limit: number = 50,
  offset: number = 0
): Promise<GesserTimelineListResponse> {
  try {
    const params: Record<string, string | number> = {
      target_device_id: targetDeviceId,
      limit,
      offset,
    };
    if (viewerDeviceId) params.device_id = viewerDeviceId;
    const raw = await get<any>('timeline-list.php', params);
    const events = (raw.events ?? []).map(toTimelineEvent);
    return {
      ok: !!raw.ok,
      events,
      count: Number(raw.count ?? events.length) || events.length,
      isOwner: !!(raw.is_owner ?? raw.isOwner),
      hasMore: !!(raw.has_more ?? raw.hasMore),
    };
  } catch {
    return { ok: false, events: [], count: 0, isOwner: false, hasMore: false };
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export const GesserApi = {
  // Topics
  submitTopicSuggestion,
  getPendingTopic,
  approveTopic,
  listAllSuggestions,
  voteSuggestion,

  // Mystery Paint
  getRandomMysteryTopic,
  listMysteryImages,
  submitGuess,

  // Friends
  addFriend,
  removeFriend,
  listFriends,
  discoverUsers,
  getProfileSocial,

  // Profile + diary/timeline
  getFollowers,
  updateProfile,
  addDiaryEntry,
  listTimeline
};

export default GesserApi;
