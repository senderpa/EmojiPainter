/**
 * GESSER FEATURE - TypeScript Type Definitions
 *
 * All types and interfaces for the Gesser feature module.
 */

// ============================================================================
// TOPIC TYPES
// ============================================================================

export interface GesserTopic {
  id: number;
  topic: string;
  topicNormalized?: string;
  submittedBy?: string;
  submittedAt?: string;
  status: 'pending' | 'approved' | 'rejected';
  approvedBy?: string | null;
  approvedAt?: string | null;
  wordCount?: number;
  timesUsed?: number;
}

export interface GesserTopicSuggestion {
  topicId: number;
  topic: string;
  status: 'pending' | 'approved' | 'rejected';
  message: string;
  coinsAwarded?: number;
}

export interface GesserPendingTopic {
  id: number;
  topic: string;
  submittedAt: string;
}

export interface GesserTopicApproval {
  ok: boolean;
  status: 'approved' | 'rejected';
  topicId: number;
  message: string;
  coinsAwarded?: number;
}

// ============================================================================
// MYSTERY PAINTING TYPES
// ============================================================================

export interface GesserMysteryPainting {
  id: number;
  galleryEntryId: number;
  imageUrl: string;
  width?: number | null;
  height?: number | null;
  maskedTopic: string;
  isSolved: boolean;
  totalAttempts: number;
  paintedAt: string;
  userGuessed: boolean;
  solverName?: string | null;
  solvedAt?: string | null;
}

export interface GesserMysteryTopic {
  topicId: number;
  topic: string;
  source: 'user_generated' | 'default_pool';
  message: string;
}

// ============================================================================
// GUESS TYPES
// ============================================================================

export interface GesserGuessAttempt {
  id?: number;
  mysteryPaintingId: number;
  deviceId: string;
  guessText: string;
  isCorrect: boolean;
  createdAt?: string;
}

export interface GesserGuessResult {
  ok: boolean;
  correct: boolean;
  message: string;
  actualTopic?: string;
  coinsAwarded?: number;
  totalAttempts: number;
}

// ============================================================================
// FRIEND/SOCIAL TYPES
// ============================================================================

export interface GesserFriend {
  deviceId: string;
  name: string;
  portrait?: string | null;
  coins: number;
  rank: number;
  addedAt: string;
}

export interface GesserUser {
  deviceId: string;
  name: string;
  portrait?: string | null;
  coins: number;
  rank: number;
  isFriend: boolean;
  followerCount?: number;
}

/** Social stats for a profile page (followers/following/guesses for ANY user). */
export interface GesserProfileSocialResponse {
  ok: boolean;
  targetDeviceId: string;
  followerCount: number;
  followingCount: number;
  isFollowing: boolean;
  correctGuesses: number;
  bio: string | null;
  /** Owner-edited overrides (gesser_profiles); prefer these over gallery-derived values. */
  displayName: string | null;
  portraitUrl: string | null;
}

/** A single follower row (people who follow the target). */
export interface GesserFollowerRow {
  deviceId: string;
  name: string;
  portrait: string | null;
  coins: number;
  isFriend: boolean;
}

export interface GesserFollowersListResponse {
  ok: boolean;
  followers: GesserFollowerRow[];
  count: number;
}

/** A timeline/diary event for the profile diary feed. */
export type GesserTimelineEventType = 'diary' | 'profile_change' | 'gallery_upload';

export interface GesserTimelineEvent {
  id: string;
  type: GesserTimelineEventType;
  text: string;
  imageUrl: string | null;
  createdAt: number; // unix seconds
}

export interface GesserTimelineListResponse {
  ok: boolean;
  events: GesserTimelineEvent[];
  count: number;
  isOwner: boolean;
  hasMore: boolean;
}

export interface GesserProfileUpdateResponse {
  ok: boolean;
  updated: string[];
  deviceId: string;
  error?: string;
}

export interface GesserDiaryAddResponse {
  ok: boolean;
  entry?: GesserTimelineEvent;
  error?: string;
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

export interface GesserApiResponse<T = unknown> {
  ok: boolean;
  error?: string;
  data?: T;
}

export interface GesserTopicSubmitResponse {
  ok: boolean;
  status: 'pending' | 'approved';
  topicId: number;
  topic: string;
  message: string;
  coinsAwarded: number;
}

export interface GesserPendingTopicResponse {
  ok: boolean;
  hasPending: boolean;
  topic?: GesserPendingTopic;
  message?: string;
}

export interface GesserApproveTopicResponse {
  ok: boolean;
  status: 'approved' | 'rejected';
  topicId: number;
  message: string;
  coinsAwarded: number;
}

export interface GesserSuggestionsListResponse {
  ok: boolean;
  suggestions: Array<{
    id: number;
    topic: string;
    status: 'pending' | 'approved' | 'rejected';
    submittedBy: string; // User name
    submittedByDeviceId: string;
    submittedAt: string; // ISO timestamp
    passportUrl?: string | null;
    upvotes: number;
    downvotes: number;
    score: number; // upvotes - downvotes
    userVote?: 'up' | 'down' | null; // User's vote on this suggestion
  }>;
  count: number;
  myPassportUrl?: string | null; // Current user's passport URL
}

export interface GesserVoteSuggestionResponse {
  ok: boolean;
  message: string;
  newScore: number;
  upvotes: number;
  downvotes: number;
}

export interface GesserMysteryTopicResponse {
  ok: boolean;
  topicId: number;
  topic: string;
  source: 'user_generated' | 'default_pool';
  message: string;
}

export interface GesserMysteryListResponse {
  ok: boolean;
  items: GesserMysteryPainting[];
  count: number;
  filter: 'unsolved' | 'solved' | 'all';
}

export interface GesserGuessSubmitResponse {
  ok: boolean;
  correct: boolean;
  message: string;
  actualTopic?: string;
  coinsAwarded?: number;
  totalAttempts: number;
}

export interface GesserFriendsListResponse {
  ok: boolean;
  friends: GesserFriend[];
  count: number;
}

export interface GesserUsersDiscoverResponse {
  ok: boolean;
  users: GesserUser[];
  count: number;
  total: number;
  search?: string;
  hasMore: boolean; // Whether more users are available
}

export interface GesserFriendActionResponse {
  ok: boolean;
  message: string;
}

// ============================================================================
// LOCAL STORAGE TYPES
// ============================================================================

export interface GesserLocalState {
  lastMysteryPaintDate?: string; // YYYY-MM-DD
  pendingTopicReviews?: number[]; // Topic IDs
  lastTopicSuggestTime?: number; // Timestamp
  guessedMysteryIds?: number[]; // Mystery painting IDs already guessed
  cachedMysteryImages?: GesserMysteryPainting[]; // Cached for offline
  lastCacheUpdate?: number; // Timestamp
}

// ============================================================================
// COIN REWARD TYPES
// ============================================================================

export type GesserCoinReason =
  | 'topic_submit'
  | 'topic_approved'
  | 'topic_review'
  | 'guess_correct'
  | 'mystery_paint'
  | 'referral_bonus'
  | 'other';

export interface GesserCoinAward {
  deviceId: string;
  amount: number;
  reason: GesserCoinReason;
  topicId?: number | null;
  mysteryPaintingId?: number | null;
  guessId?: number | null;
  createdAt?: string;
}

// ============================================================================
// UI STATE TYPES
// ============================================================================

export interface GesserUIState {
  isLoading: boolean;
  error: string | null;
  successMessage: string | null;
}

export interface GesserTopicFormState {
  topic: string;
  submitting: boolean;
  needsReview: boolean;
  pendingTopic: GesserPendingTopic | null;
}

export interface GesserGuessGameState {
  currentImage: GesserMysteryPainting | null;
  guess: string;
  submitting: boolean;
  result: GesserGuessResult | null;
  allImages: GesserMysteryPainting[];
  currentIndex: number;
}

// ============================================================================
// MASKING TYPES
// ============================================================================

export interface GesserMaskResult {
  masked: string;
  revealedPositions: number[];
}

// ============================================================================
// FEATURE FLAG
// ============================================================================

export interface GesserFeatureFlags {
  enabled: boolean;
  topicSuggestions: boolean;
  mysteryPaint: boolean;
  guessGame: boolean;
  socialFeatures: boolean;
}
