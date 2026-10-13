import type { ProfileViewModel } from './types';

/**
 * A just-uploaded portrait can beat the server's copy of it — on a first upload
 * the server snapshot has no `latestPortrait` yet, and `buildProfileViewModel`
 * resolves `portrait` to null. A refresh must never replace a portrait we
 * already know with nothing, or the avatar snaps back to the default right
 * after the user uploaded it (the "first time it stays default" bug).
 *
 * Once the server does have a portrait it wins, so later edits still propagate.
 */
export function mergeRefreshedProfile(
  fetched: ProfileViewModel,
  knownPortrait: string | null | undefined
): ProfileViewModel {
  if (typeof fetched.portrait === 'string' && fetched.portrait.trim().length > 0) return fetched;
  const known = typeof knownPortrait === 'string' && knownPortrait.trim().length > 0 ? knownPortrait : null;
  return known ? { ...fetched, portrait: known } : fetched;
}
