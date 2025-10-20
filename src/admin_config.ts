import fs from 'fs';
import path from 'path';
import { config } from './config';

export interface RuntimeConfigSnapshot {
  timestamp: number;
  retrieval: { alpha: number; beta: number; gamma: number };
  rerank: { enabled: boolean; lambda: number; topN: number };
}

const SNAPSHOT_FILE = path.join(process.cwd(), 'config.snapshots.json');

let history: RuntimeConfigSnapshot[] = [];

// Load existing snapshots if present
try {
  if (fs.existsSync(SNAPSHOT_FILE)) {
    const raw = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf-8')) as RuntimeConfigSnapshot[];
    history = raw;
  }
} catch {
  history = [];
}

export function currentRuntimeConfig(): RuntimeConfigSnapshot {
  return {
    timestamp: Date.now(),
    retrieval: { ...config.retrieval },
    rerank: { ...config.rerank }
  };
}

export function listConfigHistory(): RuntimeConfigSnapshot[] {
  return history.slice(-50); // limit to last 50 snapshots
}

interface UpdateConfigInput {
  retrieval?: Partial<{ alpha: number; beta: number; gamma: number }>;
  rerank?: Partial<{ enabled: boolean; lambda: number; topN: number }>;
}

function validateWeights(alpha: number, beta: number, gamma: number) {
  const arr = [alpha, beta, gamma];
  if (arr.some(v => v < 0 || v > 1)) throw new Error('Weights must be between 0 and 1');
  if ((alpha + beta + gamma) > 2.0) throw new Error('Sum of weights must be <= 2.0');
}

export function updateRuntimeConfig(patch: UpdateConfigInput): RuntimeConfigSnapshot {
  if (patch.retrieval) {
    const alpha = patch.retrieval.alpha ?? config.retrieval.alpha;
    const beta = patch.retrieval.beta ?? config.retrieval.beta;
    const gamma = patch.retrieval.gamma ?? config.retrieval.gamma;
    validateWeights(alpha, beta, gamma);
    (config.retrieval as any).alpha = alpha;
    (config.retrieval as any).beta = beta;
    (config.retrieval as any).gamma = gamma;
  }
  if (patch.rerank) {
    if (patch.rerank.enabled !== undefined) (config.rerank as any).enabled = patch.rerank.enabled;
    if (patch.rerank.lambda !== undefined) {
      if (patch.rerank.lambda < 0 || patch.rerank.lambda > 1) throw new Error('rerank.lambda must be 0..1');
      (config.rerank as any).lambda = patch.rerank.lambda;
    }
    if (patch.rerank.topN !== undefined) {
      if (patch.rerank.topN < 1 || patch.rerank.topN > 200) throw new Error('rerank.topN out of range');
      (config.rerank as any).topN = patch.rerank.topN;
    }
  }
  const snap = currentRuntimeConfig();
  history.push(snap);
  // Persist snapshots
  try {
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(history.slice(-200), null, 2));
  } catch {/* ignore persist errors */}
  return snap;
}
