import { mergeRefreshedProfile } from '../profileMerge';
import type { ProfileViewModel } from '../types';

const vm = (portrait: string | null): ProfileViewModel => ({
  deviceId: 'dev-1',
  name: 'Tester',
  bio: null,
  isSelf: true,
  portrait,
  portraitHistory: [],
  elapsedMs: 0,
  strokeCount: 0,
  coinCount: 0,
  rank: null,
  followerCount: null,
  followingCount: null,
  isFollowing: false,
  correctGuesses: null,
  karma: 0,
  galleryEntries: [],
  galleryCount: 0,
  serverAvailable: true,
});

describe('mergeRefreshedProfile', () => {
  it('keeps a just-uploaded portrait when the server has none yet', () => {
    // The first-upload case: studio saved the portrait locally and popped back,
    // but the server snapshot has not caught up.
    const merged = mergeRefreshedProfile(vm(null), 'data:image/png;base64,AAA');
    expect(merged.portrait).toBe('data:image/png;base64,AAA');
  });

  it('lets the server portrait win once it exists', () => {
    const merged = mergeRefreshedProfile(vm('https://server/new.png'), 'data:image/png;base64,OLD');
    expect(merged.portrait).toBe('https://server/new.png');
  });

  it('treats blank server portraits as missing', () => {
    expect(mergeRefreshedProfile(vm('   '), 'data:image/png;base64,AAA').portrait).toBe('data:image/png;base64,AAA');
  });

  it('stays null when neither side has a portrait', () => {
    expect(mergeRefreshedProfile(vm(null), null).portrait).toBeNull();
    expect(mergeRefreshedProfile(vm(null), '  ').portrait).toBeNull();
  });

  it('does not otherwise alter the fetched profile', () => {
    const fetched = { ...vm(null), followerCount: 7, galleryCount: 3 };
    const merged = mergeRefreshedProfile(fetched, 'data:image/png;base64,AAA');
    expect(merged.followerCount).toBe(7);
    expect(merged.galleryCount).toBe(3);
    expect(merged.name).toBe('Tester');
  });
});
