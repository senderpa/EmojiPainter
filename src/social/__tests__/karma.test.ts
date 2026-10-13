import { computeKarma, computeKarmaBreakdown } from '../karma';

const entry = (over: Partial<any> = {}): any => ({
  id: 1, imageUrl: '', rawUrl: '', topic: 't', createdAt: 0,
  upvotes: 0, downvotes: 0, solveCount: 0, ...over,
});

const snap = (entries: any[]): any => ({ galleryEntries: entries });

describe('computeKarma', () => {
  test('empty profile → 0', () => {
    expect(computeKarma(null)).toBe(0);
    expect(computeKarma(snap([]))).toBe(0);
  });

  test('posts count toward karma', () => {
    expect(computeKarma(snap([entry(), entry(), entry()]))).toBe(3); // +1 each
  });

  test('upvotes weigh 3, downvotes -1', () => {
    // 1 post (+1), 10 upvotes (+30), 4 downvotes (-4) = 27
    expect(computeKarma(snap([entry({ upvotes: 10, downvotes: 4 })]))).toBe(27);
  });

  test('solves weigh 5', () => {
    // 1 post (+1) + 2 solves (+10) = 11
    expect(computeKarma(snap([entry({ solveCount: 2 })]))).toBe(11);
  });

  test('correct guesses weigh 2', () => {
    // 1 post (+1) + 3 guesses (+6) = 7
    expect(computeKarma(snap([entry()]), 3)).toBe(7);
  });

  test('clamps to >= 0 on heavy downvotes', () => {
    // 1 post (+1) - 100 downvotes = -99 → clamp 0
    expect(computeKarma(snap([entry({ downvotes: 100 })]))).toBe(0);
  });

  test('breakdown sums correctly', () => {
    const b = computeKarmaBreakdown(snap([entry({ upvotes: 2, solveCount: 1 }), entry({ upvotes: 1 })]), 4);
    expect(b.upvotes).toBe(3);
    expect(b.solves).toBe(1);
    expect(b.posts).toBe(2);
    expect(b.correctGuesses).toBe(4);
    // 3*3 - 0 + 5*1 + 2*4 + 2 = 9 + 5 + 8 + 2 = 24
    expect(b.total).toBe(24);
  });
});
