import { Chunk, RetrievalResult, UserMemory } from './types';
import { createEmbedder, createVectorStore, Embedder } from './embed';
import { config } from './config';
import { getMemory } from './memory';
import { MAXWELL_CATEGORIES } from './maxwell_taxonomy';
import { maybeRerank } from './rerank';

let _embedder: Embedder | null = null;
const store = createVectorStore();

// Simple in-process index stats
const indexedDocCounts = new Map<string, number>();
let totalIndexedChunks = 0;

function getEmbedder(): Embedder {
  if (!_embedder) {
    _embedder = createEmbedder();
  }
  return _embedder;
}

export async function indexChunks(chunks: Chunk[]): Promise<void> {
  const embeddings = await getEmbedder().embed(chunks.map(c => c.content));
  const points = embeddings.map((e, i) => ({
    id: chunks[i].id,
    vector: e.vector,
    payload: { ...chunks[i] }
  }));
  await store.upsert(config.vector.collection, points);
  // Update index stats
  for (const c of chunks) {
    const docId = c.docId || 'unknown';
    indexedDocCounts.set(docId, (indexedDocCounts.get(docId) || 0) + 1);
    totalIndexedChunks += 1;
  }
}

export function getIndexStats() {
  return {
    docs: indexedDocCounts.size,
    chunks: totalIndexedChunks,
  };
}

export function lexicalOverlapScore(query: string, text: string): number {
  const q = new Set(query.toLowerCase().split(/\W+/).filter(Boolean));
  if (!q.size) return 0;
  const t = text.toLowerCase().split(/\W+/).filter(Boolean);
  let hit = 0;
  for (const w of t) if (q.has(w)) hit++;
  return hit / Math.max(1, t.length);
}

export interface SearchWeights { alpha: number; beta: number; gamma: number; }

export interface DetailedRetrieval extends RetrievalResult {
  components: { vector: number; lexical: number; tag: number }; // raw components before combination
}

export async function search(query: string, topK = 5, userId?: string, weights: SearchWeights = { alpha: 0.7, beta: 0.2, gamma: 0.1 }): Promise<RetrievalResult[]> {
  const [qEmb] = await getEmbedder().embed([query]);
  const initial = await store.query(config.vector.collection, qEmb.vector, topK * 3);
  const { alpha, beta, gamma } = weights;
  const mem: UserMemory | undefined = userId ? getMemory(userId) : undefined;
  const preferenceMap = new Map<string, number>(mem?.preferredCategories?.map(p => [p.categoryId, p.weight]) || []);
  // Precompute category base weight map
  const baseMap = new Map<string, number>(MAXWELL_CATEGORIES.map(c => [c.id, c.weight]));

  const rescored = initial.map(r => {
    const chunk = r.payload as Chunk;
    const lex = lexicalOverlapScore(query, chunk.content);
    const tags = (chunk.metadata?.tags as { categoryId: string; score: number }[] | undefined) || [];
    // Aggregate tag signal
    let tagScore = 0;
    for (const t of tags) {
      const baseW = baseMap.get(t.categoryId) || 0;
      const prefBoost = preferenceMap.get(t.categoryId) || 0;
      tagScore += t.score * (baseW + prefBoost);
    }
    const score = alpha * r.score + beta * lex + gamma * tagScore;
    return { chunk, score } as RetrievalResult;
  });
  const sorted = rescored.sort((a, b) => b.score - a.score);
  // Maybe rerank
  const reranked = await maybeRerank(query, sorted, topK);
  // Return with finalScore mapped to score for compatibility
  return reranked.map(r => ({ chunk: r.chunk, score: r.finalScore }));
}

export async function searchDetailed(query: string, topK = 5, userId?: string, weights: SearchWeights = { alpha: 0.7, beta: 0.2, gamma: 0.1 }): Promise<DetailedRetrieval[]> {
  const [qEmb] = await getEmbedder().embed([query]);
  const initial = await store.query(config.vector.collection, qEmb.vector, topK * 3);
  const mem: UserMemory | undefined = userId ? getMemory(userId) : undefined;
  const preferenceMap = new Map<string, number>(mem?.preferredCategories?.map(p => [p.categoryId, p.weight]) || []);
  const baseMap = new Map<string, number>(MAXWELL_CATEGORIES.map(c => [c.id, c.weight]));
  const { alpha, beta, gamma } = weights;
  const rescored = initial.map(r => {
    const chunk = r.payload as Chunk;
    const lex = lexicalOverlapScore(query, chunk.content);
    const tags = (chunk.metadata?.tags as { categoryId: string; score: number }[] | undefined) || [];
    let tagScore = 0;
    for (const t of tags) {
      const baseW = baseMap.get(t.categoryId) || 0;
      const prefBoost = preferenceMap.get(t.categoryId) || 0;
      tagScore += t.score * (baseW + prefBoost);
    }
    const combined = alpha * r.score + beta * lex + gamma * tagScore;
    return { chunk, score: combined, components: { vector: r.score, lexical: lex, tag: tagScore } };
  });
  const sorted = rescored.sort((a, b) => b.score - a.score);
  const reranked = await maybeRerank(query, sorted.map(r => ({ chunk: r.chunk, score: r.score })), topK);
  // Merge rerank scores back with components
  const map = new Map(reranked.map(r => [r.chunk.id, r]));
  return sorted
    .filter(r => map.has(r.chunk.id))
    .slice(0, topK)
    .map(r => {
      const rr = map.get(r.chunk.id)!;
      return { chunk: r.chunk, score: rr.finalScore, components: r.components };
    });
}
