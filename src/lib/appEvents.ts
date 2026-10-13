type Listener<T = void> = (payload: T) => void;

const listeners = new Map<string, Set<Listener<any>>>();
const lastPayload = new Map<string, unknown>();

export function emitAppEvent<T = void>(event: string, payload?: T): void {
  const bucket = listeners.get(event);
  lastPayload.set(event, payload);
  if (!bucket || bucket.size === 0) {
    return;
  }
  bucket.forEach((listener) => {
    try {
      (listener as Listener<T>)(payload as T);
    } catch (error) {
      console.warn(`App event listener for ${event} threw`, error);
    }
  });
}

export function addAppEventListener<T = void>(event: string, listener: Listener<T>): () => void {
  const bucket = listeners.get(event) ?? new Set<Listener<any>>();
  bucket.add(listener as Listener<any>);
  listeners.set(event, bucket);
  if (lastPayload.has(event)) {
    try {
      listener(lastPayload.get(event) as T);
    } catch (error) {
      console.warn(`App event listener for ${event} threw`, error);
    }
  }
  return () => {
    bucket.delete(listener as Listener<any>);
    if (bucket.size === 0) {
      listeners.delete(event);
      lastPayload.delete(event);
    }
  };
}
