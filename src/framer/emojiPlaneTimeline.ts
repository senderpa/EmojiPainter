/** Helpers for a 📐 plane lifetime inside Framer's active [cropStart, cropEnd) loop. */

export function planeTimelineLength(cropStart: number, cropEnd: number): number {
  return Math.max(1, Math.round(cropEnd) - Math.round(cropStart));
}

export function clampPlaneLifetime(lifetime: number, cropStart: number, cropEnd: number): number {
  return Math.max(1, Math.min(planeTimelineLength(cropStart, cropEnd), Math.round(lifetime)));
}

export function normalizePlaneFrame(frame: number, cropStart: number, cropEnd: number): number {
  const length = planeTimelineLength(cropStart, cropEnd);
  return Math.round(cropStart) + ((((Math.round(frame) - Math.round(cropStart)) % length) + length) % length);
}

export function planeFrameDistance(
  birthFrame: number,
  frame: number,
  cropStart: number,
  cropEnd: number,
): number {
  const length = planeTimelineLength(cropStart, cropEnd);
  const birth = normalizePlaneFrame(birthFrame, cropStart, cropEnd);
  const target = normalizePlaneFrame(frame, cropStart, cropEnd);
  return ((target - birth) % length + length) % length;
}

export function isPlaneVisibleAtFrame(
  birthFrame: number,
  lifetime: number,
  frame: number,
  cropStart: number,
  cropEnd: number,
): boolean {
  if (frame < cropStart || frame >= cropEnd) return false;
  return planeFrameDistance(birthFrame, frame, cropStart, cropEnd)
    < clampPlaneLifetime(lifetime, cropStart, cropEnd);
}

/** Last visible frame, normalized into the active loop. */
export function planeLastVisibleFrame(
  birthFrame: number,
  lifetime: number,
  cropStart: number,
  cropEnd: number,
): number {
  return normalizePlaneFrame(
    normalizePlaneFrame(birthFrame, cropStart, cropEnd) + clampPlaneLifetime(lifetime, cropStart, cropEnd) - 1,
    cropStart,
    cropEnd,
  );
}

export function planeLifetimeWraps(
  birthFrame: number,
  lifetime: number,
  cropStart: number,
  cropEnd: number,
): boolean {
  const start = normalizePlaneFrame(birthFrame, cropStart, cropEnd);
  return start + clampPlaneLifetime(lifetime, cropStart, cropEnd) > cropEnd;
}
