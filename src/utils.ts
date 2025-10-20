export function estimateTokens(text: string): number {
  // naive: ~4 chars per token; replace with tiktoken if desired
  return Math.ceil(text.length / 4);
}

export function chunkText(
  text: string,
  opts: { maxTokens?: number; overlapTokens?: number } = {}
): string[] {
  const maxTokens = opts.maxTokens ?? 400;
  const overlap = opts.overlapTokens ?? 40;
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const w of words) {
    const wTokens = estimateTokens(w + ' ');
    if (currentTokens + wTokens > maxTokens && current.length > 0) {
      chunks.push(current.join(' ').trim());
      // create overlap
      const overlapWords = [] as string[];
      let oTok = 0;
      for (let i = current.length - 1; i >= 0 && oTok < overlap; i--) {
        const t = estimateTokens(current[i] + ' ');
        oTok += t;
        overlapWords.unshift(current[i]);
      }
      current = overlapWords;
      currentTokens = overlapWords.reduce((acc, s) => acc + estimateTokens(s + ' '), 0);
    }
    current.push(w);
    currentTokens += wTokens;
  }
  if (current.length) chunks.push(current.join(' ').trim());
  return chunks.filter(Boolean);
}
