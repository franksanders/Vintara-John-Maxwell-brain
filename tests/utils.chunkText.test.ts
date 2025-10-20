import { chunkText, estimateTokens } from '../src/utils';

describe('chunkText', () => {
  it('splits long text into multiple chunks with overlap', () => {
    const text = Array.from({ length: 1000 }, (_, i) => `word${i}`).join(' ');
    const chunks = chunkText(text, { maxTokens: 50, overlapTokens: 10 });
    expect(chunks.length).toBeGreaterThan(1);
    // Ensure overlap: last words of one appear at start of next
  const firstEndArr = chunks[0].split(/\s+/).slice(-15); // take a slightly larger tail window
  const secondStartArr = chunks[1].split(/\s+/).slice(0, 15);
  // Overlap should be non-trivial (>= 5 words in common)
  const overlapCount = secondStartArr.filter(w => firstEndArr.includes(w)).length;
  expect(overlapCount).toBeGreaterThanOrEqual(5);
  });

  it('returns single chunk when under limit', () => {
    const text = 'leadership growth influence';
    const chunks = chunkText(text, { maxTokens: 200 });
    expect(chunks).toHaveLength(1);
  });
});

describe('estimateTokens', () => {
  it('roughly maps length to token count', () => {
    expect(estimateTokens('abcd')).toBeGreaterThan(0);
  });
});
