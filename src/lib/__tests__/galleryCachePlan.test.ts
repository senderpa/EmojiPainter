import { galleryCachePlan } from '../dailyPaintGallery';

describe('gallery cache plan', () => {
  it('always hits the network when a refresh is forced', () => {
    // The regression: after uploading to the gallery the app forces a refresh,
    // but a cache filled seconds BEFORE the upload was treated as fresh, so the
    // new post stayed invisible for up to the 5 minute TTL.
    expect(galleryCachePlan(true, false)).toBe('fetch');
    expect(galleryCachePlan(true, true)).toBe('fetch');
  });

  it('serves the cache instantly and refreshes behind it when stale', () => {
    expect(galleryCachePlan(false, true)).toBe('serve-cache-and-refresh');
  });

  it('serves the cache with no network when it is still fresh', () => {
    expect(galleryCachePlan(false, false)).toBe('serve-cache');
  });
});
