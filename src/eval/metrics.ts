// Evaluation metrics utilities: NDCG, citation accuracy, and helpers
import { RetrievalResult } from '../types';

/**
 * Compute Discounted Cumulative Gain for a ranked list given relevance scores.
 * relevance[i] corresponds to result at rank i (0-based).
 */
export function dcg(relevance: number[], topK?: number): number {
  const k = topK ? Math.min(topK, relevance.length) : relevance.length;
  let sum = 0;
  for (let i = 0; i < k; i++) {
    const rel = relevance[i];
    // Using standard formulation: (2^rel - 1) / log2(i+2)
    sum += (Math.pow(2, rel) - 1) / Math.log2(i + 2);
  }
  return sum;
}

/**
 * Normalized Discounted Cumulative Gain.
 * idealRelevance: same relevance array sorted descending for ideal ranking.
 */
export function ndcg(relevance: number[], topK?: number): number {
  if (!relevance.length) return 0;
  const ideal = [...relevance].sort((a, b) => b - a);
  const actual = dcg(relevance, topK);
  const idealScore = dcg(ideal, topK);
  return idealScore === 0 ? 0 : actual / idealScore;
}

/**
 * Mean Reciprocal Rank elements:
 * reciprocalRank returns 1 / (rank of first relevant result), or 0 if none.
 * Relevant is defined as rel > 0.
 */
export function reciprocalRank(relevance: number[]): number {
  for (let i = 0; i < relevance.length; i++) {
    if (relevance[i] > 0) return 1 / (i + 1);
  }
  return 0;
}

/**
 * Build relevance scores for NDCG from retrieved results vs a ground truth set.
 * If chunkId is in groundTruth map, use its relevance (>=0), else 0.
 */
export function relevanceFromResults(results: RetrievalResult[], groundTruth: Map<string, number>): number[] {
  return results.map(r => groundTruth.get(r.chunk.id) ?? 0);
}

export interface CitationSourceInfo {
  chunkId: string;
  content: string;
}

export interface GeneratedCitationRef {
  chunkIndex: number; // 1-based index corresponding to retrieval ordering
  chunkId?: string;   // enriched chunk id if available
  docId?: string;
}

/**
 * Citation Accuracy Metrics:
 * precision: fraction of cited chunks that actually contain supporting evidence.
 * recall: fraction of relevant chunks that were cited.
 * support match: simple token overlap Jaccard between answer segment referencing the citation and chunk.
 */
export interface CitationMetrics {
  precision: number;
  recall: number;
  f1: number;
  falsePositives: string[];
  missedRelevant: string[];
}

/**
 * Compute citation accuracy.
 * answer: full generated text.
 * citations: list of citation references (with chunkId).
 * sources: map chunkId -> source content.
 * groundTruthRelevant: optional set of chunkIds considered truly relevant (for recall) if known.
 * tokenThreshold: minimum Jaccard overlap to count as supporting (default 0.05).
 */
export function computeCitationAccuracy(answer: string, citations: GeneratedCitationRef[], sources: Map<string, CitationSourceInfo>, groundTruthRelevant?: Set<string>, tokenThreshold = 0.05): CitationMetrics {
  const citedChunkIds = citations.map(c => c.chunkId).filter((id): id is string => !!id);
  const uniqueCited = Array.from(new Set(citedChunkIds));
  let truePositive = 0;
  const falsePositives: string[] = [];
  const missedRelevant: string[] = [];

  for (const cid of uniqueCited) {
    const source = sources.get(cid);
    if (!source) { falsePositives.push(cid); continue; }
    const overlap = jaccardTokens(answer, source.content);
    if (overlap >= tokenThreshold) truePositive++; else falsePositives.push(cid);
  }

  if (groundTruthRelevant) {
    for (const rel of groundTruthRelevant) {
      if (!uniqueCited.includes(rel)) missedRelevant.push(rel);
    }
  }

  const precision = uniqueCited.length ? truePositive / uniqueCited.length : 0;
  const recall = groundTruthRelevant ? (groundTruthRelevant.size ? truePositive / groundTruthRelevant.size : 0) : 0;
  const f1 = (precision + recall) ? (2 * precision * recall) / (precision + recall) : 0;

  return { precision, recall, f1, falsePositives, missedRelevant };
}

function jaccardTokens(a: string, b: string): number {
  const at = tokenize(a);
  const bt = tokenize(b);
  if (!at.size || !bt.size) return 0;
  let intersection = 0;
  for (const t of at) if (bt.has(t)) intersection++;
  const union = at.size + bt.size - intersection;
  return union ? intersection / union : 0;
}

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean));
}
