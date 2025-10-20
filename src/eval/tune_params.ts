import fs from 'fs';
import path from 'path';
import { ingestText } from '../ingest';
import { toChunks } from '../parse';
import { indexChunks, searchDetailed } from '../retrieve';
import { logger } from '../logger';
import { config } from '../config';

interface EvalQuery { query: string; expectedSubstrings: string[]; expectedCategories: string[]; }

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
  logger.info({ chunks: allChunks.length }, 'Indexed tuning corpus');
}

function meanReciprocalRank(ranks: number[]): number {
  if (!ranks.length) return 0;
  return ranks.reduce((s, r) => s + 1 / r, 0) / ranks.length;
}

function recallAtK(contents: string[], expected: string[]): number {
  const hitCount = expected.filter(e => contents.some(c => c.includes(e))).length;
  return hitCount / Math.max(1, expected.length);
}

async function main() {
  if (!config.embedding.openaiApiKey && config.embedding.provider === 'openai') {
    (config as any).embedding.provider = 'local';
  }
  const queriesPath = path.resolve('src/eval/queries.json');
  const corpusDir = path.resolve('src/eval/corpus');
  await loadCorpus(corpusDir);
  const queries = loadQueries(queriesPath);
  const k = 5;

  const alphas = [0.5, 0.6, 0.7, 0.8];
  const betas = [0.1, 0.2, 0.3];
  const gammas = [0.05, 0.1, 0.15, 0.2];

  const rows: string[] = ['alpha,beta,gamma,avgRecall,mrr'];
  let best = { alpha: 0, beta: 0, gamma: 0, avgRecall: 0, mrr: 0 };

  for (const alpha of alphas) {
    for (const beta of betas) {
      for (const gamma of gammas) {
        let totalRecall = 0;
        const rrRanks: number[] = [];
        for (const q of queries) {
          const results = await searchDetailed(q.query, k, undefined, { alpha, beta, gamma });
          const contents = results.map(r => r.chunk.content);
          let firstRank: number | undefined;
          for (let i = 0; i < contents.length; i++) {
            if (q.expectedSubstrings.some(es => contents[i].includes(es))) { firstRank = i + 1; break; }
          }
          if (firstRank) rrRanks.push(firstRank);
          totalRecall += recallAtK(contents, q.expectedSubstrings);
        }
        const avgRecall = totalRecall / queries.length;
        const mrr = meanReciprocalRank(rrRanks);
        rows.push(`${alpha},${beta},${gamma},${avgRecall.toFixed(4)},${mrr.toFixed(4)}`);
        if (mrr > best.mrr || (mrr === best.mrr && avgRecall > best.avgRecall)) {
          best = { alpha, beta, gamma, avgRecall, mrr };
        }
        logger.info({ alpha, beta, gamma, avgRecall, mrr }, 'Tuning iteration');
      }
    }
  }
  const outPath = path.resolve('tuning_results.csv');
  fs.writeFileSync(outPath, rows.join('\n'));
  console.log('Best:', best);
  console.log('Results written to tuning_results.csv');
}

main().catch(err => { logger.error({ err }, 'Tuning failed'); process.exit(1); });
