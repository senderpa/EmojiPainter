import type { Stroke } from '../../state/PaintingContext';
import {
  backgroundToPersist,
  buildPortraitTransitionFrames,
  flattenAfterUpload,
  isUsablePassport,
  normalizeStudioBrushRotation,
  resolveStudioBrushTransform,
  resolveStudioSeed,
  type StudioCanvasState,
} from '../profileStudioSession';

const stroke = (id: string): Stroke => ({ id, emoji: '🎨', size: 40, opacity: 1, spacing: 0.3, points: [{ x: 1, y: 1, t: 0 }] } as Stroke);

const PASSPORT_1 = `data:image/png;base64,${'A'.repeat(5000)}`;
const PASSPORT_2 = `data:image/png;base64,${'B'.repeat(5000)}`;
const SERVER_URL = 'https://server.example/passport/dev-1.png';

describe('studio seed resolution', () => {
  it('prefers local work in progress over everything', () => {
    const seed = resolveStudioSeed({
      localTraceUri: PASSPORT_1,
      routePortrait: PASSPORT_2,
      serverPortrait: SERVER_URL,
    });
    expect(seed.background).toBe(PASSPORT_1);
    expect(seed.source).toBe('local');
  });

  it('falls back to the portrait the profile page handed over', () => {
    // Second device / fresh reinstall: no local keys at all.
    const seed = resolveStudioSeed({ routePortrait: PASSPORT_2, serverPortrait: SERVER_URL });
    expect(seed.background).toBe(PASSPORT_2);
    expect(seed.source).toBe('route');
  });

  it('falls back to the server snapshot when nothing else exists', () => {
    const seed = resolveStudioSeed({ serverPortrait: SERVER_URL, serverName: 'Pascal' });
    expect(seed.background).toBe(SERVER_URL);
    expect(seed.source).toBe('server');
    expect(seed.name).toBe('Pascal');
  });

  it('opens blank only when there is genuinely nothing anywhere', () => {
    const seed = resolveStudioSeed({});
    expect(seed.background).toBeNull();
    expect(seed.source).toBe('none');
    expect(seed.name).toBe('');
  });

  it('never lets the Anonymous placeholder beat a real name', () => {
    expect(resolveStudioSeed({ routeName: 'Anonymous', serverName: 'Pascal' }).name).toBe('Pascal');
    expect(resolveStudioSeed({ localStudioName: 'Anonymous', localDisplayName: 'Pascal' }).name).toBe('Pascal');
  });

  it('ignores blank strings from any tier', () => {
    const seed = resolveStudioSeed({ localTraceUri: '   ', localPortrait: '', routePortrait: PASSPORT_2 });
    expect(seed.background).toBe(PASSPORT_2);
    expect(seed.source).toBe('route');
  });

  it('truncates the name to the passport limit', () => {
    expect(resolveStudioSeed({ serverName: 'x'.repeat(50) }, 19).name).toHaveLength(19);
  });
});

describe('profile brush transforms', () => {
  it('normalizes rotation and preserves both mirrors for a new stroke', () => {
    expect(resolveStudioBrushTransform({ mirrorX: true, mirrorY: true, rotation: -90 })).toEqual({
      mirrorX: true,
      mirrorY: true,
      rotation: 270,
    });
  });

  it('uses safe defaults for old saved studio payloads', () => {
    expect(resolveStudioBrushTransform()).toEqual({ mirrorX: false, mirrorY: false, rotation: 0 });
    expect(normalizeStudioBrushRotation(Number.NaN)).toBe(0);
    expect(normalizeStudioBrushRotation(450)).toBe(90);
  });
});

describe('portrait return transition', () => {
  it('deduplicates history and always makes the just-uploaded portrait newest', () => {
    expect(buildPortraitTransitionFrames(
      [PASSPORT_1, PASSPORT_1, SERVER_URL, PASSPORT_2],
      PASSPORT_2,
    )).toEqual([PASSPORT_1, SERVER_URL, PASSPORT_2]);
  });

  it('keeps only a short tail while preserving the newest portrait', () => {
    const history = Array.from({ length: 20 }, (_, index) => `image-${index}`);
    const frames = buildPortraitTransitionFrames(history, 'fresh', 4);
    expect(frames).toEqual(['image-17', 'image-18', 'image-19', 'fresh']);
  });
});

describe('upload flatten', () => {
  it('drops the strokes that are already baked into the uploaded image', () => {
    const before: StudioCanvasState = { strokes: [stroke('a'), stroke('b')], backgroundUri: PASSPORT_1, name: 'Pascal' };
    const after = flattenAfterUpload(before, PASSPORT_2);
    expect(after.strokes).toEqual([]);
    expect(after.backgroundUri).toBe(PASSPORT_2);
    expect(after.name).toBe('Pascal');
  });

  it('does not mutate the previous state', () => {
    const before: StudioCanvasState = { strokes: [stroke('a')], backgroundUri: PASSPORT_1, name: 'P' };
    flattenAfterUpload(before, PASSPORT_2);
    expect(before.strokes).toHaveLength(1);
    expect(before.backgroundUri).toBe(PASSPORT_1);
  });
});

describe('empty-passport guard', () => {
  it('rejects a blank render so it cannot overwrite a good portrait', () => {
    expect(isUsablePassport('')).toBe(false);
    expect(isUsablePassport(null)).toBe(false);
    expect(isUsablePassport('A'.repeat(200))).toBe(false);
  });

  it('accepts a real render', () => {
    expect(isUsablePassport('A'.repeat(5000))).toBe(true);
  });
});

describe('the full studio cycle, repeated', () => {
  /** Storage the studio actually round-trips through, as a fake. */
  interface Storage { studio: StudioCanvasState | null; passport: string | null; displayName: string | null }

  const openStudio = (storage: Storage, route: { portrait?: string | null; name?: string | null }, server: { portrait?: string | null; name?: string | null }) => {
    const seed = resolveStudioSeed({
      localTraceUri: storage.studio?.backgroundUri ?? null,
      localPortrait: storage.passport,
      localStudioName: storage.studio?.name ?? null,
      localDisplayName: storage.displayName,
      routePortrait: route.portrait ?? null,
      routeName: route.name ?? null,
      serverPortrait: server.portrait ?? null,
      serverName: server.name ?? null,
    });
    return {
      strokes: storage.studio?.strokes ?? [],
      backgroundUri: seed.background,
      name: seed.name,
      source: seed.source,
    };
  };

  const upload = (storage: Storage, canvas: StudioCanvasState, renderedPassport: string) => {
    if (!isUsablePassport(renderedPassport.replace(/^data:image\/png;base64,/, ''))) {
      throw new Error('empty passport refused');
    }
    const flattened = flattenAfterUpload(canvas, renderedPassport);
    storage.passport = renderedPassport;
    storage.studio = flattened;
    if (flattened.name && flattened.name !== 'Anonymous') storage.displayName = flattened.name;
    return flattened;
  };

  it('works on a fresh install and keeps working across repeated uploads', () => {
    // 1) Fresh install: nothing local, profile page fetched the server profile.
    const storage: Storage = { studio: null, passport: null, displayName: null };
    let canvas = openStudio(storage, { portrait: SERVER_URL, name: 'Pascal' }, { portrait: SERVER_URL, name: 'Pascal' });
    expect(canvas.source).toBe('route');
    expect(canvas.backgroundUri).toBe(SERVER_URL);
    expect(canvas.name).toBe('Pascal');

    // 2) Paint and upload → the render bakes background + strokes together.
    canvas = { ...canvas, strokes: [stroke('a'), stroke('b')] };
    upload(storage, canvas, PASSPORT_1);
    expect(storage.displayName).toBe('Pascal');

    // 3) Reopen: the NEW passport is the backdrop, with a clean stroke layer.
    canvas = openStudio(storage, {}, {});
    expect(canvas.backgroundUri).toBe(PASSPORT_1);
    expect(canvas.strokes).toEqual([]);
    expect(canvas.source).toBe('local');
    expect(canvas.name).toBe('Pascal');

    // 4) Again — the regression that kept coming back.
    canvas = { ...canvas, strokes: [stroke('c')] };
    upload(storage, canvas, PASSPORT_2);
    canvas = openStudio(storage, {}, {});
    expect(canvas.backgroundUri).toBe(PASSPORT_2);
    expect(canvas.strokes).toEqual([]);

    // 5) And a third time, with no route/server help at all.
    const PASSPORT_3 = `data:image/png;base64,${'C'.repeat(5000)}`;
    canvas = { ...canvas, strokes: [stroke('d')] };
    upload(storage, canvas, PASSPORT_3);
    canvas = openStudio(storage, {}, {});
    expect(canvas.backgroundUri).toBe(PASSPORT_3);
    expect(canvas.strokes).toEqual([]);
  });

  it('refuses a blank render instead of wiping the stored passport', () => {
    const storage: Storage = { studio: null, passport: PASSPORT_1, displayName: 'Pascal' };
    const canvas = openStudio(storage, {}, {});
    expect(canvas.backgroundUri).toBe(PASSPORT_1);

    expect(() => upload(storage, canvas, 'data:image/png;base64,AAAA')).toThrow('empty passport refused');
    // The good portrait survives the failed upload.
    expect(storage.passport).toBe(PASSPORT_1);
    expect(openStudio(storage, {}, {}).backgroundUri).toBe(PASSPORT_1);
  });

  it('survives a reinstall: local gone, server still has the last passport', () => {
    const storage: Storage = { studio: null, passport: null, displayName: null };
    const canvas = openStudio(storage, {}, { portrait: SERVER_URL, name: 'Pascal' });
    expect(canvas.backgroundUri).toBe(SERVER_URL);
    expect(canvas.source).toBe('server');
    expect(canvas.name).toBe('Pascal');
  });
});

describe('background fallback chain', () => {
  it('lists every source in priority order, de-duplicated', () => {
    const seed = resolveStudioSeed({
      localTraceUri: 'file:///old/container/passport.png',
      localPortrait: PASSPORT_1,
      routePortrait: PASSPORT_1,          // duplicate of the local passport
      serverPortrait: SERVER_URL,
    });
    expect(seed.candidates).toEqual(['file:///old/container/passport.png', PASSPORT_1, SERVER_URL]);
  });

  it('still offers the server URL when the stored file path is dead', () => {
    // Reinstall: the container UUID changed, so the file:// path 404s. Dropping
    // it must leave the server portrait, never an empty canvas.
    const seed = resolveStudioSeed({ localTraceUri: 'file:///dead/path.png', serverPortrait: SERVER_URL });
    const afterFailure = seed.candidates.filter((c) => c !== 'file:///dead/path.png');
    expect(afterFailure).toEqual([SERVER_URL]);
  });

  it('has no candidates only when nothing exists anywhere', () => {
    expect(resolveStudioSeed({}).candidates).toEqual([]);
  });
});

describe('never persist emptiness over a good background', () => {
  it('keeps the last known good background when the session has none', () => {
    expect(backgroundToPersist(null, PASSPORT_1)).toBe(PASSPORT_1);
  });

  it('prefers the current background when there is one', () => {
    expect(backgroundToPersist(PASSPORT_2, PASSPORT_1)).toBe(PASSPORT_2);
  });

  it('is null only when neither exists', () => {
    expect(backgroundToPersist(null, null)).toBeNull();
  });
});
