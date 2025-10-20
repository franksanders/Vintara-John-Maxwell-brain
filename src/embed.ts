import axios from 'axios';
import { config } from './config';
import { Chunk, EmbeddingResult } from './types';
import { logger } from './logger';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface Embedder {
  embed(texts: string[]): Promise<EmbeddingResult[]>;
  dim(): number;
}

class OpenAIEmbedder implements Embedder {
  private model = config.embedding.model;
  private apiKey = config.embedding.openaiApiKey;
  private cache: Map<string, number[]> | null = null;
  private cacheDirty = false;
  private lastCallTs = 0;
  private saving = false;
  private cachePath = config.embedding.cachePath;

  private ensureCacheLoaded() {
    if (this.cache) return;
    this.cache = new Map();
    try {
      if (this.cachePath && fs.existsSync(this.cachePath)) {
        const raw = fs.readFileSync(this.cachePath, 'utf-8');
        const data = JSON.parse(raw);
        Object.entries<any>(data).forEach(([k, v]) => {
          if (Array.isArray(v)) this.cache!.set(k, v as number[]);
        });
        logger.info({ entries: this.cache.size }, 'Loaded embedding cache');
      }
    } catch (e) {
      logger.warn({ err: e instanceof Error ? e.message : String(e) }, 'Failed to load embedding cache');
    }
  }

  private scheduleSave() {
    if (!this.cacheDirty || this.saving) return;
    this.saving = true;
    setTimeout(() => {
      try {
        if (!this.cacheDirty) { this.saving = false; return; }
        const dir = path.dirname(this.cachePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const obj: Record<string, number[]> = {};
        this.cache!.forEach((v, k) => { obj[k] = v; });
        fs.writeFileSync(this.cachePath, JSON.stringify(obj));
        this.cacheDirty = false;
      } catch (e) {
        logger.error({ err: e instanceof Error ? e.message : String(e) }, 'Failed to write embedding cache');
      } finally {
        this.saving = false;
      }
    }, 50); // small debounce
  }

  private keyFor(text: string): string {
    return `${this.model}:${crypto.createHash('sha256').update(text).digest('hex')}`;
  }

  async embed(texts: string[]): Promise<EmbeddingResult[]> {
    if (!this.apiKey) throw new Error('OPENAI_API_KEY missing');
    const url = 'https://api.openai.com/v1/embeddings';
    this.ensureCacheLoaded();
    const pending: { text: string; originalIndex: number }[] = [];
    const vectors: (number[] | null)[] = new Array(texts.length).fill(null);
    // Check cache
    texts.forEach((t, i) => {
      const k = this.keyFor(t);
      const v = this.cache!.get(k);
      if (v) {
        vectors[i] = v;
      } else {
        pending.push({ text: t, originalIndex: i });
      }
    });
    if (!pending.length) {
      return vectors.map((v, i) => ({ id: String(i), vector: v!, dim: v!.length }));
    }
    const batchSize = Math.max(1, config.embedding.batchSize || 32);
    const batches: { texts: string[]; originalIdx: number[] }[] = [];
    for (let i = 0; i < pending.length; i += batchSize) {
      const slice = pending.slice(i, i + batchSize);
      batches.push({ texts: slice.map(p => p.text), originalIdx: slice.map(p => p.originalIndex) });
    }
    for (const batch of batches) {
      const maxRetries = config.embedding.maxRetries || 5;
      let attempt = 0;
      let lastErr: any;
      while (attempt < maxRetries) {
        try {
          // Global pacing
            const minInterval = config.embedding.globalMinIntervalMs || 0;
            const since = Date.now() - this.lastCallTs;
            if (minInterval > 0 && since < minInterval) {
              await new Promise(r => setTimeout(r, minInterval - since));
            }
          const res = await axios.post(url, {
            model: this.model,
            input: batch.texts
          }, {
            timeout: 30000,
            headers: { Authorization: `Bearer ${this.apiKey}` }
          });
            const data = res.data?.data || [];
            if (!Array.isArray(data) || data.length !== batch.texts.length) {
              throw new Error('Unexpected embeddings response shape');
            }
            const dim = Array.isArray(data[0]?.embedding) ? data[0].embedding.length : 0;
            for (let j = 0; j < data.length; j++) {
              const vec = data[j].embedding as number[];
              const orig = batch.originalIdx[j];
              vectors[orig] = vec;
              const k = this.keyFor(batch.texts[j]);
              this.cache!.set(k, vec);
              this.cacheDirty = true;
            }
            this.scheduleSave();
            this.lastCallTs = Date.now();
            break; // batch success
        } catch (err: any) {
          lastErr = err;
          const status = err?.response?.status;
            if (status === 429 || (status >= 500 && status < 600)) {
              // Honor Retry-After if provided
              const retryAfter = parseFloat(err?.response?.headers?.['retry-after']) || 0;
              const backoff = retryAfter > 0 ? retryAfter * 1000 : Math.min(5000, (config.embedding.retryBaseMs || 200) * Math.pow(2, attempt));
              const jitter = Math.random() * 150;
              const delay = backoff + jitter;
              logger.warn({ attempt, delay, status, batchSize: batch.texts.length }, 'Embedding batch retry');
              await new Promise(r => setTimeout(r, delay));
              attempt++;
              continue;
            }
            throw err;
        }
      }
      if (vectors.some(v => v === null)) {
        logger.error({ err: lastErr }, 'Failed to embed a batch after retries');
        throw lastErr;
      }
      // Optional pacing between successful batches (useful for eval to avoid bursts)
      if (config.embedding.evalInterBatchDelayMs > 0) {
        await new Promise(r => setTimeout(r, config.embedding.evalInterBatchDelayMs));
      }
    }
    const dim = vectors[0]?.length || 0;
    return vectors.map((v, i) => ({ id: String(i), vector: v!, dim }));
  }
  dim(): number { return 1536; }
}

class LocalEmbedder implements Embedder {
  async embed(texts: string[]): Promise<EmbeddingResult[]> {
    return texts.map((t, i) => ({ id: String(i), vector: fakeVector(t, 128), dim: 128 }));
  }
  dim(): number { return 128; }
}

function fakeVector(text: string, d: number): number[] {
  // very simple hash-based pseudo embedding for local dev
  const out = new Array(d).fill(0);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out[i % d] = (out[i % d] + c) % 1_000;
  }
  // normalize
  const norm = Math.sqrt(out.reduce((s, v) => s + v * v, 0)) || 1;
  return out.map(v => v / norm);
}

class AzureOpenAIEmbedder extends OpenAIEmbedder {
  async embed(texts: string[]): Promise<EmbeddingResult[]> {
    const azure = config.embedding.azure;
    if (!azure.endpoint || !azure.apiKey || !azure.embeddingDeployment) {
      throw new Error('Azure OpenAI embedding is not configured (endpoint/apiKey/deployment).');
    }
    // Temporarily override the HTTP call using Azure endpoint semantics
    // We reuse caching/pacing from OpenAIEmbedder by copying most logic here, but sending to Azure URL and headers.
    const url = `${azure.endpoint}/openai/deployments/${azure.embeddingDeployment}/embeddings?api-version=${encodeURIComponent(azure.apiVersion || '2024-02-15-preview')}`;
    // Load cache via super method side-effects
    // We'll mimic the batching/retry loop but with Azure headers
    const batchSize = Math.max(1, config.embedding.batchSize || 32);
    // @ts-ignore access private members via any
    this.ensureCacheLoaded?.();
    // @ts-ignore
    const keyFor = (t: string) => this.keyFor(t);
    // @ts-ignore
    const cache = this.cache as Map<string, number[]>;
    const pending: { text: string; originalIndex: number }[] = [];
    const vectors: (number[] | null)[] = new Array(texts.length).fill(null);
    texts.forEach((t, i) => {
      const k = keyFor(t);
      const v = cache?.get(k);
      if (v) vectors[i] = v; else pending.push({ text: t, originalIndex: i });
    });
    if (!pending.length) {
      const dim = vectors[0]?.length || 0;
      return vectors.map((v, i) => ({ id: String(i), vector: v!, dim }));
    }
    const batches: { texts: string[]; originalIdx: number[] }[] = [];
    for (let i = 0; i < pending.length; i += batchSize) {
      const slice = pending.slice(i, i + batchSize);
      batches.push({ texts: slice.map(p => p.text), originalIdx: slice.map(p => p.originalIndex) });
    }
    for (const batch of batches) {
      const maxRetries = config.embedding.maxRetries || 5;
      let attempt = 0;
      let lastErr: any;
      while (attempt < maxRetries) {
        try {
          // @ts-ignore
          const minInterval = config.embedding.globalMinIntervalMs || 0;
          // @ts-ignore
          const since = Date.now() - this.lastCallTs;
          if (minInterval > 0 && since < minInterval) {
            await new Promise(r => setTimeout(r, minInterval - since));
          }
          const res = await axios.post(url, { input: batch.texts }, {
            timeout: 30000,
            headers: { 'api-key': azure.apiKey, 'Content-Type': 'application/json' }
          });
          const data = res.data?.data || [];
          if (!Array.isArray(data) || data.length !== batch.texts.length) {
            throw new Error('Unexpected Azure embeddings response shape');
          }
          const dim = Array.isArray(data[0]?.embedding) ? data[0].embedding.length : 0;
          for (let j = 0; j < data.length; j++) {
            const vec = data[j].embedding as number[];
            const orig = batch.originalIdx[j];
            vectors[orig] = vec;
            const k = keyFor(batch.texts[j]);
            cache?.set(k, vec);
            // @ts-ignore
            this.cacheDirty = true;
          }
          // @ts-ignore
          this.scheduleSave?.();
          // @ts-ignore
          this.lastCallTs = Date.now();
          break;
        } catch (err: any) {
          lastErr = err;
          const status = err?.response?.status;
          if (status === 429 || (status >= 500 && status < 600)) {
            const retryAfter = parseFloat(err?.response?.headers?.['retry-after']) || 0;
            const backoff = retryAfter > 0 ? retryAfter * 1000 : Math.min(5000, (config.embedding.retryBaseMs || 200) * Math.pow(2, attempt));
            const jitter = Math.random() * 150;
            const delay = backoff + jitter;
            logger.warn({ attempt, delay, status, batchSize: batch.texts.length }, 'Azure Embedding batch retry');
            await new Promise(r => setTimeout(r, delay));
            attempt++;
            continue;
          }
          throw err;
        }
      }
      if (vectors.some(v => v === null)) {
        throw lastErr || new Error('Failed to embed a batch after retries (Azure)');
      }
      if (config.embedding.evalInterBatchDelayMs > 0) {
        await new Promise(r => setTimeout(r, config.embedding.evalInterBatchDelayMs));
      }
    }
    const dim = vectors[0]?.length || 0;
    return vectors.map((v, i) => ({ id: String(i), vector: v!, dim }));
  }
}

export function createEmbedder(): Embedder {
  switch (config.embedding.provider) {
    case 'openai':
      return new OpenAIEmbedder();
    case 'azure-openai':
      return new AzureOpenAIEmbedder();
    case 'local':
    case 'ollama':
    default:
      logger.warn({ provider: config.embedding.provider }, 'Using LocalEmbedder fallback');
      return new LocalEmbedder();
  }
}

export interface VectorStore {
  upsert(collection: string, points: { id: string; vector: number[]; payload: any }[]): Promise<void>;
  query(collection: string, vector: number[], topK: number): Promise<{ id: string; score: number; payload: any }[]>;
}

export class MemoryVectorStore implements VectorStore {
  private data = new Map<string, { id: string; vector: number[]; payload: any }[]>();
  async upsert(collection: string, points: { id: string; vector: number[]; payload: any }[]) {
    const arr = this.data.get(collection) || [];
    // upsert by id
    const idx = new Map(arr.map((p, i) => [p.id, i]));
    for (const p of points) {
      const i = idx.get(p.id);
      if (i !== undefined) arr[i] = p; else arr.push(p);
    }
    this.data.set(collection, arr);
  }
  async query(collection: string, vector: number[], topK: number) {
    const arr = this.data.get(collection) || [];
    const scored = arr.map(p => ({
      id: p.id,
      score: cosineSim(vector, p.vector),
      payload: p.payload
    }));
    return scored.sort((a, b) => b.score - a.score).slice(0, topK);
  }
}

function cosineSim(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / ((Math.sqrt(na) || 1) * (Math.sqrt(nb) || 1));
}

export function createVectorStore(): VectorStore {
  switch (config.vector.kind) {
    case 'qdrant':
      return new QdrantVectorStore(config.vector.qdrant.url, config.vector.qdrant.apiKey);
    case 'pinecone':
      return new PineconeVectorStore(config.vector.pinecone.host, config.vector.pinecone.apiKey);
    case 'memory':
    default:
      return new MemoryVectorStore();
  }
}

class QdrantVectorStore implements VectorStore {
  constructor(private baseUrl: string, private apiKey?: string) {}
  private async ensureCollection(collection: string, dim: number) {
    try {
      await axios.get(`${this.baseUrl}/collections/${collection}`, {
        headers: this.headers()
      });
      return; // exists
    } catch (e: any) {
      // create
      await axios.put(`${this.baseUrl}/collections/${collection}`, {
        vectors: { size: dim, distance: 'Cosine' }
      }, { headers: this.headers() });
    }
  }
  private headers() {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) h['api-key'] = this.apiKey;
    return h;
  }
  async upsert(collection: string, points: { id: string; vector: number[]; payload: any }[]): Promise<void> {
    const dim = points[0]?.vector?.length ?? 0;
    if (!dim) throw new Error('Qdrant upsert requires non-empty vectors');
    await this.ensureCollection(collection, dim);
    await axios.put(`${this.baseUrl}/collections/${collection}/points`, { points }, { headers: this.headers() });
  }
  async query(collection: string, vector: number[], topK: number): Promise<{ id: string; score: number; payload: any }[]> {
    const res = await axios.post(`${this.baseUrl}/collections/${collection}/points/search`, {
      vector,
      limit: topK,
      with_payload: true
    }, { headers: this.headers() });
    const pts = res.data?.result || [];
    return pts.map((p: any) => ({ id: String(p.id), score: p.score, payload: p.payload }));
  }
}

class PineconeVectorStore implements VectorStore {
  constructor(private indexHost: string, private apiKey?: string) {}
  private headers() {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) h['Api-Key'] = this.apiKey;
    return h;
  }
  private baseUrl() {
    if (!this.indexHost) throw new Error('PINECONE_INDEX_HOST is required for Pinecone');
    return `https://${this.indexHost}`; // e.g., my-index-xxxx.svc.us-east1-aws.pinecone.io
  }
  async upsert(_collection: string, points: { id: string; vector: number[]; payload: any }[]): Promise<void> {
    // Pinecone uses per-index hosts; collection name is implicit in the host.
    const url = `${this.baseUrl()}/vectors/upsert`;
    await axios.post(url, { vectors: points.map(p => ({ id: p.id, values: p.vector, metadata: p.payload })) }, { headers: this.headers() });
  }
  async query(_collection: string, vector: number[], topK: number): Promise<{ id: string; score: number; payload: any }[]> {
    const url = `${this.baseUrl()}/query`;
    const res = await axios.post(url, { vector, topK, includeMetadata: true }, { headers: this.headers() });
    const matches = res.data?.matches || [];
    return matches.map((m: any) => ({ id: String(m.id), score: m.score, payload: m.metadata }));
  }
}
