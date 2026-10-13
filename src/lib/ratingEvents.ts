/**
 * Simple event emitter for triggering rating overlay check from anywhere in the app
 */

export interface RatingCheckOptions {
  /** Delay the check until the current success/navigation UI has settled. */
  delayMs?: number;
}

type RatingCheckListener = (options?: RatingCheckOptions) => void;

let listeners: RatingCheckListener[] = [];

export function addRatingCheckListener(listener: RatingCheckListener): () => void {
  // Prevent duplicate listeners
  if (listeners.includes(listener)) {
    console.warn('[RatingEvents] Duplicate listener detected, not adding');
    // Return a no-op unsubscribe function
    return () => {};
  }

  listeners.push(listener);

  // Return unsubscribe function
  return () => {
    listeners = listeners.filter(l => l !== listener);
  };
}

export function triggerRatingCheck(options?: RatingCheckOptions): void {
  listeners.forEach(listener => listener(options));
}
