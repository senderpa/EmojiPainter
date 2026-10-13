/**
 * karma — a single "good citizen" score computed from a user's public activity.
 *
 * Full formula (confirmed with the user):
 *   karma = 3·Σupvotes − Σdownvotes + 5·Σ(times others solved their mysteries)
 *           + 2·correctGuesses + 1·galleryCount
 * clamped to ≥ 0.
 *
 * All terms except `correctGuesses` come straight from the gallery entries in a
 * ServerProfileSnapshot; `correctGuesses` comes from the social endpoint.
 */
import type { ServerProfileSnapshot } from '../lib/profileSync';

export interface KarmaBreakdown {
  upvotes: number;
  downvotes: number;
  solves: number;
  correctGuesses: number;
  posts: number;
  total: number;
}

export function computeKarmaBreakdown(
  snapshot: Pick<ServerProfileSnapshot, 'galleryEntries'> | null | undefined,
  correctGuesses = 0,
): KarmaBreakdown {
  const entries = snapshot?.galleryEntries ?? [];
  let upvotes = 0;
  let downvotes = 0;
  let solves = 0;
  for (const e of entries) {
    upvotes += Math.max(0, e.upvotes ?? 0);
    downvotes += Math.max(0, e.downvotes ?? 0);
    solves += Math.max(0, e.solveCount ?? 0);
  }
  const posts = entries.length;
  const guesses = Math.max(0, correctGuesses);
  const total = Math.max(
    0,
    3 * upvotes - downvotes + 5 * solves + 2 * guesses + posts,
  );
  return { upvotes, downvotes, solves, correctGuesses: guesses, posts, total };
}

export function computeKarma(
  snapshot: Pick<ServerProfileSnapshot, 'galleryEntries'> | null | undefined,
  correctGuesses = 0,
): number {
  return computeKarmaBreakdown(snapshot, correctGuesses).total;
}
