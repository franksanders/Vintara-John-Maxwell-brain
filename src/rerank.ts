import { config } from './config';
import { Chunk, RetrievalResult } from './types';
import { createEmbedder } from './embed';
import { logger } from './logger';

/**
 * Reranker interface output augments each candidate with a rerankScore and finalScore.
 */
export interface RerankedResult extends RetrievalResult {
  rerankScore: number; // score from reranker model (0..1 typical)
  finalScore: number;  // blended score used for ordering
}

/**
 * Simple pseudo cross-encoder reranker.
 * Strategy: Re-embed concatenated query + candidate snippet using a (possibly larger) embedding model
 * then compute cosine similarity with the standalone query embedding. This approximates a cross-encoder
 * without needing a dedicated model service. If a larger model is not available, falls back to existing embedding provider.
 */
export async function pseudoCrossEncoderRerank(query: string, candidates: RetrievalResult[]): Promise<RerankedResult[]> {
  const embedder = createEmbedder(); // create fresh in case model differs; could be optimized
  try {
    const [queryEmb] = await embedder.embed([query]);
    // Construct joint texts
    const jointTexts = candidates.map(c => `${query}\n---\n${truncate(c.chunk.content, 800)}`);
    const jointEmbeddings = await embedder.embed(jointTexts);
    // Cosine similarity already provided in embedding vectors vs query vector? We need manual calc.
    const qv = queryEmb.vector;
    const results: RerankedResult[] = jointEmbeddings.map((je, idx) => {
      const rv = je.vector;
      const cosine = cosineSimilarity(qv, rv);
      const original = candidates[idx].score;
      // Blend: final = lambda * original + (1 - lambda) * cosine
      const lambda = config.rerank.lambda;
      const final = lambda * original + (1 - lambda) * cosine;
      return { ...candidates[idx], rerankScore: cosine, finalScore: final };
    });
    return results.sort((a, b) => b.finalScore - a.finalScore);
  } catch (err) {
    logger.warn({ err }, 'Rerank failed; falling back to original order');
    return candidates.map(c => ({ ...c, rerankScore: c.score, finalScore: c.score }));
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length && i < b.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '…';
}

/**
 * Apply rerank logic conditionally based on config.rerank.enabled.
 * topK: desired final number of results.
 */
export async function maybeRerank(query: string, initial: RetrievalResult[], topK: number): Promise<RerankedResult[]> {
  if (!config.rerank.enabled) {
    return initial.slice(0, topK).map(c => ({ ...c, rerankScore: c.score, finalScore: c.score }));
  }
  // Expand candidate set to rerank (topN from config or length of initial)
  const topN = Math.min(config.rerank.topN, initial.length);
  const subset = initial.slice(0, topN);
  const reranked = await pseudoCrossEncoderRerank(query, subset);
  return reranked.slice(0, topK);
}
