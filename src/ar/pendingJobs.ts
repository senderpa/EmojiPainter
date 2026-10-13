/**
 * pendingJobs — remembers Tripo/face-emoji jobs we kicked off so we can re-check
 * them later. The server sometimes finishes a job AFTER the app gave up (or even
 * after it reported a failure), so on every visit to the face scene we re-poll
 * each pending job once and download anything that has since landed.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@face_pending_jobs_v1';
const MAX_PENDING = 12;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // drop jobs older than a week

export interface PendingJob {
  jobId: string;
  statusUrl: string;
  assetsUrl: string;
  createdAt: number;
}

export async function loadPendingJobs(): Promise<PendingJob[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    const now = Date.now();
    return list.filter((j) => j && j.jobId && now - (j.createdAt ?? 0) < MAX_AGE_MS);
  } catch {
    return [];
  }
}

async function save(list: PendingJob[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_PENDING)));
  } catch {
    /* ignore */
  }
}

export async function addPendingJob(job: PendingJob): Promise<void> {
  const existing = await loadPendingJobs();
  const deduped = existing.filter((j) => j.jobId !== job.jobId);
  await save([job, ...deduped]);
}

export async function removePendingJob(jobId: string): Promise<void> {
  const existing = await loadPendingJobs();
  await save(existing.filter((j) => j.jobId !== jobId));
}
