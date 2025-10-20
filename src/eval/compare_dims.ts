import fs from 'fs';
import path from 'path';
import { ingestText } from '../ingest';
import { toChunks } from '../parse';
import { resetDedup } from '../dedup';
import { createEmbedder, createVectorStore } from '../embed';
import { config } from '../config';
// We intentionally do not import the global search() from retrieve.ts because
// it uses a singleton embedder & vector store (and optional reranking) which would
// pollute / conflate model-specific indexing. For a fair dimension comparison we
// isolate each model in its own in-memory store and perform pure vector similarity
// (optionally you could replicate lexical/tag weighting here if desired).
import { logger } from '../logger';
import { MAXWELL_CATEGORIES } from '../maxwell_taxonomy';
import { pseudoCrossEncoderRerank } from '../rerank';
import { relevanceFromResults, ndcg, reciprocalRank } from './metrics';

interface EvalQuery { query: string; relevantSubstrings: string[]; }
interface PerQueryMetrics { ndcg1: number; ndcg3: number; ndcg5: number; mrr: number }
interface PerQueryResult extends PerQueryMetrics { query: string }
interface PartialEvalSummary { model: string; results: PerQueryResult[] }

const PROGRESS_DIR = path.resolve('.cache');
const RESULTS_FILE = path.join(PROGRESS_DIR, 'dim_eval_results.json');
const RESULTS_JSONL = path.join(PROGRESS_DIR, 'dim_eval_progress.jsonl');
const RESULTS_CSV = path.join(PROGRESS_DIR, 'dim_eval_results.csv');

function ensureProgressDir() {
  if (!fs.existsSync(PROGRESS_DIR)) fs.mkdirSync(PROGRESS_DIR, { recursive: true });
}

function loadJSON<T>(file: string, fallback: T): T {
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8')) as T; } catch {/* ignore */}
  return fallback;
}

function appendJSONL(obj: any) {
  try { ensureProgressDir(); fs.appendFileSync(RESULTS_JSONL, JSON.stringify(obj) + '\n'); } catch {/* ignore */}
}

function writeCSV(baseEval: { query: string; ndcg1: number; ndcg3: number; ndcg5: number; mrr: number }[], altEval: { query: string; ndcg1: number; ndcg3: number; ndcg5: number; mrr: number }[]) {
  try {
    const header = 'query,base_ndcg1,base_ndcg3,base_ndcg5,base_mrr,alt_ndcg1,alt_ndcg3,alt_ndcg5,alt_mrr,delta_ndcg5\n';
    const map = new Map<string, { base?: PerQueryMetrics; alt?: PerQueryMetrics }>();
    for (const r of baseEval) map.set(r.query, { ...(map.get(r.query)||{}), base: { ndcg1: r.ndcg1, ndcg3: r.ndcg3, ndcg5: r.ndcg5, mrr: r.mrr } });
    for (const r of altEval) map.set(r.query, { ...(map.get(r.query)||{}), alt: { ndcg1: r.ndcg1, ndcg3: r.ndcg3, ndcg5: r.ndcg5, mrr: r.mrr } });
    const lines: string[] = [header];
    for (const [q, v] of map.entries()) {
      const b = v.base; const a = v.alt;
      const delta = (b && a) ? (a.ndcg5 - b.ndcg5).toFixed(6) : '';
      lines.push(`"${q.replace(/"/g,'""')}",${b?b.ndcg1:''},${b?b.ndcg3:''},${b?b.ndcg5:''},${b?b.mrr:''},${a?a.ndcg1:''},${a?a.ndcg3:''},${a?a.ndcg5:''},${a?a.mrr:''},${delta}\n`);
    }
    fs.writeFileSync(RESULTS_CSV, lines.join(''));
  } catch {/* ignore */}
}

async function loadCorpus(dir: string) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.txt'));
  const docs = [] as { id: string; title?: string; content: string }[];
  for (const f of files) {
    const content = fs.readFileSync(path.join(dir, f), 'utf-8');
    const doc = await ingestText(content, { title: f.replace(/\.txt$/, '') });
    docs.push({ id: doc.id, title: doc.title, content });
  }
  return docs;
}

interface ModelIndexCtx { model: string; collection: string; store: ReturnType<typeof createVectorStore>; embedder: ReturnType<typeof createEmbedder>; chunks: any[]; }

async function indexWithModel(model: string, docs: Awaited<ReturnType<typeof loadCorpus>>): Promise<ModelIndexCtx> {
  (config.embedding as any).model = model; // mutate config before creating embedder
  // Force in-memory store for isolated evaluation regardless of global config
  (config.vector as any).kind = 'memory';
  const embedder = createEmbedder();
  const store = createVectorStore();
  const collection = config.vector.collection + '_' + model.replace(/[^a-zA-Z0-9_-]/g, '_');
  const allChunks: any[] = [];
  let indexedDocs = 0;
  const started = Date.now();
  // Ensure dedup index does not carry over across models
  resetDedup();
  for (const d of docs) {
    const chunks = toChunks({ id: d.id, source: 'text', content: d.content, title: d.title } as any);
    if (!chunks.length) continue;
    const embeddings = await embedder.embed(chunks.map(c => c.content));
    const points = embeddings
      .filter(e => e.vector && e.vector.length)
      .map((e, i) => ({ id: chunks[i].id, vector: e.vector, payload: { ...chunks[i] } }));
    if (points.length) {
      await store.upsert(collection, points);
    } else {
      logger.warn({ model, docId: d.id }, 'No embeddings produced for document');
    }
    allChunks.push(...chunks);
    indexedDocs++;
    const elapsed = Date.now() - started;
    const rate = indexedDocs / Math.max(1, elapsed/1000);
    const remaining = docs.length - indexedDocs;
    const etaSecs = rate > 0 ? remaining / rate : 0;
    appendJSONL({ phase: 'index', model, indexedDocs, totalDocs: docs.length, etaMillis: Math.round(etaSecs*1000), timestamp: Date.now() });
  }
  return { model, collection, store, embedder, chunks: allChunks };
}

function groundTruthMap(chunks: any[], substrings: string[]) {
  // Give relevance 1 if chunk contains any expected substring
  const map = new Map<string, number>();
  for (const ch of chunks) {
    if (substrings.some(s => ch.content.includes(s))) map.set(ch.id, 1);
  }
  return map;
}

async function evaluateModel(ctx: ModelIndexCtx, queries: EvalQuery[], already: Set<string>) {
  const results: { model: string; query: string; ndcg1: number; ndcg3: number; ndcg5: number; mrr: number }[] = [];
  let processed = 0;
  const start = Date.now();
  const prodMode = process.env.DIM_EVAL_PROD_MODE === 'true';
  const useRerank = process.env.DIM_EVAL_RERANK === 'true';
  const { alpha, beta, gamma } = config.retrieval;
  const baseMap = new Map<string, number>(MAXWELL_CATEGORIES.map(c => [c.id, c.weight]));
  function lexicalOverlapScore(query: string, text: string): number {
    const q = new Set(query.toLowerCase().split(/\W+/).filter(Boolean));
    if (!q.size) return 0;
    const t = text.toLowerCase().split(/\W+/).filter(Boolean);
    let hit = 0;
    for (const w of t) if (q.has(w)) hit++;
    return hit / Math.max(1, t.length);
  }
  for (const q of queries) {
    if (already.has(q.query)) continue;
    // Embed query with model-specific embedder
    const [qEmb] = await ctx.embedder.embed([q.query]);
    // Retrieve candidates
    const raw = await ctx.store.query(ctx.collection, qEmb.vector, 15);
    let retrieved = raw.map(r => ({ chunk: r.payload, score: r.score }));
    if (prodMode) {
      // Blend vector + lexical + tag
      const rescored = retrieved.map(r => {
        const tags = (r.chunk.metadata?.tags as { categoryId: string; score: number }[] | undefined) || [];
        let tagScore = 0;
        for (const t of tags) {
          const baseW = baseMap.get(t.categoryId) || 0;
          tagScore += t.score * baseW;
        }
        const lex = lexicalOverlapScore(q.query, r.chunk.content);
        const combined = alpha * r.score + beta * lex + gamma * tagScore;
        return { chunk: r.chunk, score: combined };
      }).sort((a, b) => b.score - a.score).slice(0, 10);
      if (useRerank) {
        const reranked = await pseudoCrossEncoderRerank(q.query, rescored);
        retrieved = reranked.slice(0, 5).map(rr => ({ chunk: rr.chunk, score: rr.finalScore }));
      } else {
        retrieved = rescored.slice(0, 5);
      }
    } else {
      // Embedding-only mode
      retrieved = retrieved.slice(0, 5);
    }
    const gt = groundTruthMap(ctx.chunks, q.relevantSubstrings || []);
    const rel = relevanceFromResults(retrieved, gt);
    const metrics = { ndcg1: ndcg(rel, 1), ndcg3: ndcg(rel, 3), ndcg5: ndcg(rel, 5), mrr: reciprocalRank(rel) };
    results.push({ model: ctx.model, query: q.query, ...metrics });
    processed++;
    const elapsed = Date.now() - start;
    const rate = processed / Math.max(1, elapsed/1000);
    const remaining = queries.length - already.size - processed;
    const etaSecs = rate > 0 ? remaining / rate : 0;
    appendJSONL({ phase: 'query', model: ctx.model, query: q.query, prodMode, rerank: useRerank, ...metrics, processed, totalQueries: queries.length - already.size, etaMillis: Math.round(etaSecs*1000), timestamp: Date.now() });
  }
  return results;
}

async function main() {
  const corpusDir = path.resolve('src/eval/corpus');
  const queriesPath = path.resolve('src/eval/queries.json');
  const rawQueries: any[] = JSON.parse(fs.readFileSync(queriesPath, 'utf-8'));
  const queries: EvalQuery[] = rawQueries.map(q => ({
    query: q.query,
    relevantSubstrings: q.expectedSubstrings || q.relevantChunkSubstrings || []
  }));
  const docs = await loadCorpus(corpusDir);
  const baseModel = process.env.EMBEDDING_MODEL || config.embedding.model;
  const altModel = process.env.EMBEDDING_ALT_MODEL || config.embedding.altModel;
  logger.info({ baseModel, altModel }, 'Starting dimension comparison');
  ensureProgressDir();
  const prior: { base?: PartialEvalSummary; alt?: PartialEvalSummary } = loadJSON(RESULTS_FILE, {} as any);
  const onlyBase = process.env.DIM_EVAL_ONLY_BASE === 'true';
  const onlyAlt = process.env.DIM_EVAL_ONLY_ALT === 'true';
  if (onlyBase && onlyAlt) {
    logger.warn('Both DIM_EVAL_ONLY_BASE and DIM_EVAL_ONLY_ALT set; proceeding with both.');
  }
  let mergedBase: PartialEvalSummary = prior.base || { model: baseModel, results: [] };
  let mergedAlt: PartialEvalSummary = prior.alt || { model: altModel, results: [] };
  if (!onlyAlt) {
    const baseIdx = await indexWithModel(baseModel, docs);
  const baseDone = new Set<string>((prior.base?.results || []).map((r: PerQueryResult) => r.query));
    const baseNew = await evaluateModel(baseIdx, queries, baseDone);
    mergedBase = { model: baseModel, results: [...(prior.base?.results || []), ...baseNew] };
    fs.writeFileSync(RESULTS_FILE, JSON.stringify({ ...prior, base: mergedBase, alt: prior.alt }, null, 2));
    appendJSONL({ phase: 'checkpoint', model: baseModel, total: mergedBase.results.length, timestamp: Date.now() });
  }
  if (!onlyBase) {
    const altIdx = await indexWithModel(altModel, docs);
  const altDone = new Set<string>((prior.alt?.results || []).map((r: PerQueryResult) => r.query));
    const altNew = await evaluateModel(altIdx, queries, altDone);
    mergedAlt = { model: altModel, results: [...(prior.alt?.results || []), ...altNew] };
    fs.writeFileSync(RESULTS_FILE, JSON.stringify({ base: mergedBase, alt: mergedAlt }, null, 2));
    appendJSONL({ phase: 'checkpoint', model: altModel, total: mergedAlt.results.length, timestamp: Date.now() });
  }
  const baseEval = mergedBase.results.map((r: PerQueryResult) => ({ model: baseModel, query: r.query, ndcg1: r.ndcg1, ndcg3: r.ndcg3, ndcg5: r.ndcg5, mrr: r.mrr }));
  const altEval = mergedAlt.results.map((r: PerQueryResult) => ({ model: altModel, query: r.query, ndcg1: r.ndcg1, ndcg3: r.ndcg3, ndcg5: r.ndcg5, mrr: r.mrr }));
  type MetricRow = { query: string; model: string; ndcg1: number; ndcg3: number; ndcg5: number; mrr: number };
  const agg = (rows: MetricRow[], key: keyof Omit<MetricRow, 'query' | 'model'>) => rows.length ? rows.reduce((s: number, r) => s + (r[key] ?? 0), 0) / rows.length : 0;
  const improvements = baseEval.length && altEval.length ? altEval.map((a) => {
    const b = baseEval.find((x) => x.query === a.query);
    return { query: a.query, base: b?.ndcg5 ?? 0, alt: a.ndcg5, delta: (a.ndcg5 - (b?.ndcg5 ?? 0)) };
  }) : [];
  const avgDelta = improvements.length ? improvements.reduce((s: number, r) => s + r.delta, 0) / improvements.length : 0;
  const pctImproved = improvements.length ? improvements.filter((r) => r.delta > 0).length / improvements.length : 0;
  const summary = {
    baseModel,
    altModel,
  baseAvgNDCG1: agg(baseEval, 'ndcg1'),
  baseAvgNDCG3: agg(baseEval, 'ndcg3'),
  baseAvgNDCG5: agg(baseEval, 'ndcg5'),
  baseMRR: agg(baseEval, 'mrr'),
  altAvgNDCG1: agg(altEval, 'ndcg1'),
  altAvgNDCG3: agg(altEval, 'ndcg3'),
  altAvgNDCG5: agg(altEval, 'ndcg5'),
  altMRR: agg(altEval, 'mrr'),
    avgDelta,
    pctImproved,
    perQuery: { base: baseEval, alt: altEval },
    improvements
  };
  console.log(JSON.stringify(summary, null, 2));
  writeCSV(baseEval.map(r => ({ query: r.query, ndcg1: r.ndcg1, ndcg3: r.ndcg3, ndcg5: r.ndcg5, mrr: r.mrr })), altEval.map(r => ({ query: r.query, ndcg1: r.ndcg1, ndcg3: r.ndcg3, ndcg5: r.ndcg5, mrr: r.mrr })));
  appendJSONL({ phase: 'final', summary, timestamp: Date.now() });
}

main().catch(err => {
  logger.error({ err }, 'Dimension comparison failed');
  process.exit(1);
});
