import { lexicalOverlapScore } from '../src/retrieve';

// Minimal reproducible lexicalOverlapScore test (function exported from retrieve.ts)

describe('lexicalOverlapScore', () => {
  it('computes higher score for greater overlap', () => {
    const q = 'leadership growth influence';
    const a = 'Leadership growth requires intentional influence and reflection.';
    const b = 'Bananas are yellow.';
    const scoreA = lexicalOverlapScore(q, a);
    const scoreB = lexicalOverlapScore(q, b);
    expect(scoreA).toBeGreaterThan(scoreB);
  });
});
