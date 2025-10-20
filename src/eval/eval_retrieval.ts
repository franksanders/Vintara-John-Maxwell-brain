import fs from 'fs';
import path from 'path';
import { ingestText } from '../ingest';
import { config } from '../config';
import { toChunks } from '../parse';
import { indexChunks, search } from '../retrieve';
import { logger } from '../logger';

interface EvalQuery {
  query: string;
  expectedSubstrings: string[];
  expectedCategories: string[];
}

function loadQueries(file: string): EvalQuery[] {
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as EvalQuery[];
}

async function loadCorpus(dir: string) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.txt'));
  const allChunks = [] as ReturnType<typeof toChunks>;
  for (const f of files) {
    const content = fs.readFileSync(path.join(dir, f), 'utf-8');
    const doc = await ingestText(content, { title: f.replace('.txt', '') });
    const chunks = toChunks(doc);
    allChunks.push(...chunks);
  }
  await indexChunks(allChunks);
  logger.info({ chunks: allChunks.length }, 'Indexed evaluation corpus');
}

function recallAtK(matches: string[], expected: string[]): number {
  const hitCount = expected.filter(e => matches.some(m => m.includes(e))).length;
  return hitCount / Math.max(1, expected.length);
}

function meanReciprocalRank(ranks: number[]): number {
  if (!ranks.length) return 0;
  return ranks.reduce((s, r) => s + 1 / r, 0) / ranks.length;
}

async function runEval() {
  // Force local embedder if OpenAI key absent for offline eval
  if (!config.embedding.openaiApiKey && config.embedding.provider === 'openai') {
    (config as any).embedding.provider = 'local';
    // Clear cached embedder by deleting dynamic property if exists
    // (Simplistic approach: rely on lazy init in retrieve.ts after provider change)
  }
  const queriesPath = path.resolve('src/eval/queries.json');
  const corpusDir = path.resolve('src/eval/corpus');
  await loadCorpus(corpusDir);
  const queries = loadQueries(queriesPath);
  const k = 5;
  let totalRecall = 0;
  const rrRanks: number[] = [];

  for (const q of queries) {
    const results = await search(q.query, k);
    const contents = results.map(r => r.chunk.content);
    // Find first rank where any expected substring appears
    let firstRank: number | undefined;
    for (let i = 0; i < contents.length; i++) {
      if (q.expectedSubstrings.some(es => contents[i].includes(es))) {
        firstRank = i + 1; // 1-based
        break;
      }
    }
    if (firstRank) rrRanks.push(firstRank);
    const recall = recallAtK(contents, q.expectedSubstrings);
    totalRecall += recall;
    logger.info({ query: q.query, recall, firstRank }, 'Eval query');
  }

  const avgRecall = totalRecall / queries.length;
  const mrr = meanReciprocalRank(rrRanks);
  logger.info({ avgRecall, mrr, queries: queries.length, k }, 'Retrieval evaluation summary');
  console.log(JSON.stringify({ avgRecall, mrr, queries: queries.length, k }, null, 2));
}

runEval().catch(err => {
  logger.error({ err }, 'Evaluation failed');
  process.exit(1);
});
