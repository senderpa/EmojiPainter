export const INFO_WELCOMER_STAGE_COUNT = 9;
export const INFO_WELCOMER_HITS_PER_STAGE = 8;
export const INFO_WELCOMER_TOTAL_HITS =
  INFO_WELCOMER_STAGE_COUNT * INFO_WELCOMER_HITS_PER_STAGE;
export const INFO_WELCOMER_COOLDOWN_MS = 30_000;

export interface InfoWelcomerHitProgress {
  totalHits: number;
  stage: number;
  hitInStage: number;
  completed: boolean;
}

/** Progress is calculated from the accepted hit count before the new hit. */
export function acceptInfoWelcomerHit(previousTotalHits: number): InfoWelcomerHitProgress {
  const safePrevious = Math.max(0, Math.min(INFO_WELCOMER_TOTAL_HITS - 1, Math.floor(previousTotalHits)));
  const totalHits = safePrevious + 1;
  return {
    totalHits,
    stage: Math.floor(safePrevious / INFO_WELCOMER_HITS_PER_STAGE) + 1,
    hitInStage: (safePrevious % INFO_WELCOMER_HITS_PER_STAGE) + 1,
    completed: totalHits >= INFO_WELCOMER_TOTAL_HITS,
  };
}

export function shuffledInfoWelcomerDeck<T>(values: readonly T[], random = Math.random): T[] {
  const deck = [...values];
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
  }
  return deck;
}
