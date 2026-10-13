// Global, ref-counted suppression of the full-screen "app came back" chrome
// (IconBurstOverlay's logo frame + burst animation).
//
// Why: iOS raises `inactive` for things that are NOT a real backgrounding — the
// ReplayKit screen-capture permission alert, the low-battery warning, a
// low-memory alert. The overlay used to paint the logo over the whole screen for
// those, which lands straight in a screen recording (Vector fly-through export).
// Recording code claims a suppression token for the whole capture window.

type Listener = (suppressed: boolean) => void;

let suppressionCount = 0;
const listeners = new Set<Listener>();

const notify = () => {
  const suppressed = suppressionCount > 0;
  listeners.forEach((listener) => {
    try {
      listener(suppressed);
    } catch {
      // A broken listener must never break the caller's recording flow.
    }
  });
};

/** Claim suppression. Returns a release function that is safe to call twice. */
export const suppressIconBurst = (): (() => void) => {
  suppressionCount += 1;
  if (suppressionCount === 1) notify();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    suppressionCount = Math.max(0, suppressionCount - 1);
    if (suppressionCount === 0) notify();
  };
};

export const isIconBurstSuppressed = (): boolean => suppressionCount > 0;

export const subscribeIconBurstSuppression = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Escape hatch for teardown paths that cannot track their token. */
export const clearIconBurstSuppression = (): void => {
  if (suppressionCount === 0) return;
  suppressionCount = 0;
  notify();
};
