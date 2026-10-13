// @ts-strict-ignore
const SEASONS_URL = 'https://emojipainter.com/api/seasons.php';
const FETCH_TIMEOUT_MS = 10_000;

export interface Season {
  id: number;
  name: string;
  theme: string;
  startTs: number;
  endTs: number;
  daysLeft: number;
}

export interface SeasonEntry {
  deviceId: string;
  name: string | null;
  portrait: string | null;
  uploadCount: number;
}

export interface SeasonResponse {
  season: Season;
  leaderboard: SeasonEntry[];
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return r;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

export async function fetchCurrentSeason(): Promise<SeasonResponse | null> {
  try {
    const res = await fetchWithTimeout(`${SEASONS_URL}?action=current`);
    if (!res.ok) {
      return null;
    }
    const json = await res.json();
    if (!json || json.ok !== true || !json.season) {
      return null;
    }
    const season: Season = {
      id: Number(json.season.id),
      name: String(json.season.name ?? ''),
      theme: String(json.season.theme ?? ''),
      startTs: Number(json.season.startTs),
      endTs: Number(json.season.endTs),
      daysLeft: Number(json.season.daysLeft),
    };
    const leaderboard: SeasonEntry[] = Array.isArray(json.leaderboard)
      ? json.leaderboard.map((e: any) => ({
          deviceId: String(e.deviceId ?? ''),
          name: e.name != null ? String(e.name) : null,
          portrait: e.portrait != null ? String(e.portrait) : null,
          uploadCount: Number(e.uploadCount ?? 0),
        }))
      : [];
    return { season, leaderboard };
  } catch {
    return null;
  }
}

export async function fetchSeasonById(seasonId: number): Promise<SeasonResponse | null> {
  try {
    const res = await fetchWithTimeout(`${SEASONS_URL}?action=leaderboard&season_id=${seasonId}`);
    if (!res.ok) {
      return null;
    }
    const json = await res.json();
    if (!json || json.ok !== true || !json.season) {
      return null;
    }
    const season: Season = {
      id: Number(json.season.id),
      name: String(json.season.name ?? ''),
      theme: String(json.season.theme ?? ''),
      startTs: Number(json.season.startTs),
      endTs: Number(json.season.endTs),
      daysLeft: Number(json.season.daysLeft),
    };
    const leaderboard: SeasonEntry[] = Array.isArray(json.leaderboard)
      ? json.leaderboard.map((e: any) => ({
          deviceId: String(e.deviceId ?? ''),
          name: e.name != null ? String(e.name) : null,
          portrait: e.portrait != null ? String(e.portrait) : null,
          uploadCount: Number(e.uploadCount ?? 0),
        }))
      : [];
    return { season, leaderboard };
  } catch {
    return null;
  }
}
