import {
  INFO_WELCOMER_TOTAL_HITS,
  acceptInfoWelcomerHit,
  shuffledInfoWelcomerDeck,
} from '../infoWelcomerPolicy';

describe('Info welcomer escalation policy', () => {
  it('uses eight hits per stage across all nine stages', () => {
    expect(acceptInfoWelcomerHit(0)).toMatchObject({ stage: 1, hitInStage: 1, completed: false });
    expect(acceptInfoWelcomerHit(7)).toMatchObject({ stage: 1, hitInStage: 8, completed: false });
    expect(acceptInfoWelcomerHit(8)).toMatchObject({ stage: 2, hitInStage: 1, completed: false });
    expect(acceptInfoWelcomerHit(63)).toMatchObject({ stage: 8, hitInStage: 8, completed: false });
    expect(acceptInfoWelcomerHit(64)).toMatchObject({ stage: 9, hitInStage: 1, completed: false });
  });

  it('becomes permanently complete only after the 72nd accepted hit', () => {
    expect(INFO_WELCOMER_TOTAL_HITS).toBe(72);
    expect(acceptInfoWelcomerHit(70).completed).toBe(false);
    expect(acceptInfoWelcomerHit(71)).toMatchObject({
      totalHits: 72,
      stage: 9,
      hitInStage: 8,
      completed: true,
    });
  });

  it('shuffles without dropping or duplicating languages', () => {
    const languages = ['en', 'de', 'fr', 'it', 'ja', 'ko', 'ru', 'zh'] as const;
    const deck = shuffledInfoWelcomerDeck(languages, () => 0.25);
    expect(deck).toHaveLength(languages.length);
    expect([...deck].sort()).toEqual([...languages].sort());
  });
});
