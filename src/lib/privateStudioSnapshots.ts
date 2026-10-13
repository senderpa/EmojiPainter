export interface PassportSnapshot {
  imageDataUrl: string;
  timestamp: number;
  uploadDate: string; // YYYY-MM-DD format
}

/**
 * Add one confirmed upload to the local animation history. The standalone
 * studio used to save once before upload and the uploader saved again after
 * success, producing duplicate frames (and even frames for failed uploads).
 */
export function appendPassportSnapshot(
  snapshots: PassportSnapshot[],
  imageDataUrl: string,
  timestamp: number,
  uploadDate: string,
): PassportSnapshot[] {
  const valid = Array.isArray(snapshots)
    ? snapshots.filter((snapshot) => typeof snapshot?.imageDataUrl === 'string' && snapshot.imageDataUrl.length > 0)
    : [];
  const last = valid[valid.length - 1];
  if (last?.imageDataUrl === imageDataUrl) {
    return valid.slice(-100);
  }
  return [
    ...valid,
    { imageDataUrl, timestamp, uploadDate },
  ].slice(-100);
}
