// Chunk deduplication utilities using MinHash for approximate Jaccard similarity.
// Keeps an in-memory index of signatures to skip near-duplicate chunks during ingestion.

import crypto from 'crypto';
import { Chunk } from './types';

interface SignatureEntry {
  chunkId: string;
  docId: string;
  signature: number[]; // MinHash values
  tokens: number; // distinct token count
}

const index: SignatureEntry[] = [];

// Configuration
const NUM_HASHES = parseInt(process.env.DEDUP_HASHES || '32', 10);
const JACCARD_THRESHOLD = parseFloat(process.env.DEDUP_JACCARD_THRESHOLD || '0.85');

function tokenize(content: string): string[] {
  return content.toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean);
}

function uniqueTokens(tokens: string[]): string[] {
  return Array.from(new Set(tokens));
}

// Simple family of hash functions derived via seed salt
function hashToken(token: string, seed: number): number {
  const h = crypto.createHash('sha256').update(seed + ':' + token).digest();
  // Take first 4 bytes for 32-bit int
  return h.readUInt32BE(0);
}

function minHash(tokens: string[]): number[] {
  const uniq = uniqueTokens(tokens);
  const signature = new Array<number>(NUM_HASHES).fill(Number.MAX_SAFE_INTEGER);
  for (const t of uniq) {
    for (let i = 0; i < NUM_HASHES; i++) {
      const hv = hashToken(t, i);
      if (hv < signature[i]) signature[i] = hv;
    }
  }
  return signature;
}

function estimateJaccard(sigA: number[], sigB: number[]): number {
  let match = 0;
  for (let i = 0; i < Math.min(sigA.length, sigB.length); i++) {
    if (sigA[i] === sigB[i]) match++;
  }
  return match / sigA.length;
}

export interface DedupResult {
  isDuplicate: boolean;
  duplicateOf?: string; // chunkId of existing duplicate
  similarity?: number;
}

export function checkDuplicate(chunk: Chunk): DedupResult {
  const tokens = tokenize(chunk.content);
  const signature = minHash(tokens);
  for (const entry of index) {
    const sim = estimateJaccard(signature, entry.signature);
    if (sim >= JACCARD_THRESHOLD) {
      return { isDuplicate: true, duplicateOf: entry.chunkId, similarity: sim };
    }
  }
  // Not a duplicate: add to index
  index.push({ chunkId: chunk.id, docId: chunk.docId, signature, tokens: uniqueTokens(tokens).length });
  return { isDuplicate: false };
}

export function dedupStats() {
  return {
    entries: index.length,
    threshold: JACCARD_THRESHOLD,
    numHashes: NUM_HASHES
  };
}

// For isolated evaluation/indexing runs, allow resetting the in-memory index
export function resetDedup() {
  index.length = 0;
}
