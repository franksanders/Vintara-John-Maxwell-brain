import fs from 'fs';
import path from 'path';
import axios from 'axios';

// Usage: ts-node scripts/bulk_ingest_transcripts.ts <folder> <server_base_url> <api_key> [--delay-ms=1100] [--max-retries=8] [--resume-file=<path>]
// - <folder>: directory containing .txt transcripts; optional .json sidecars with { title, audioUri }
// - <server_base_url>: e.g., http://localhost:3000 or your ngrok URL
// - <api_key>: x-api-key for the server

type ProgressEntry = { done: boolean; docId?: string; chunks?: number; lastError?: string };

function sleep(ms: number) { return new Promise(res => setTimeout(res, ms)); }

async function postWithRetry(client: any, body: any, opts: { maxRetries: number }): Promise<any> {
  let attempt = 0;
  while (true) {
    try {
      const resp = await client.post('/ingest/transcript', body);
      return resp;
    } catch (err: any) {
      const status = err?.response?.status;
      const data = err?.response?.data;
      const headers = err?.response?.headers || {};
      const retryAfterHeader = headers['retry-after'] || headers['Retry-After'];
      const retryAfterSec = typeof retryAfterHeader === 'string' ? parseFloat(retryAfterHeader) : (typeof retryAfterHeader === 'number' ? retryAfterHeader : 0);
      const serverRetry = data?.error?.retryAfter ? Number(data.error.retryAfter) : 0;
      const retriable = status === 429 || (status >= 500 && status < 600) || !status; // network
      if (!retriable || attempt >= opts.maxRetries) {
        throw err;
      }
      const baseMs = 400;
      const expo = Math.min(5000, baseMs * Math.pow(2, attempt));
      const waitMs = (serverRetry > 0 ? serverRetry * 1000 : (retryAfterSec > 0 ? retryAfterSec * 1000 : expo)) + Math.floor(Math.random()*250);
      const reason = status === 429 ? '429 rate limit' : (status ? `HTTP ${status}` : 'network');
      console.warn(`Retrying after ${Math.round(waitMs)}ms due to ${reason} (attempt ${attempt+1}/${opts.maxRetries})`);
      await sleep(waitMs);
      attempt++;
      continue;
    }
  }
}

async function main() {
  const folder = process.argv[2];
  const base = process.argv[3] || 'http://localhost:3000';
  const apiKey = process.argv[4] || '';
  const delayArg = process.argv.find(a => a.startsWith('--delay-ms='));
  const delayMs = delayArg ? parseInt(delayArg.split('=')[1] || '1100', 10) : 1100; // default ~1 req/sec
  const retryArg = process.argv.find(a => a.startsWith('--max-retries='));
  const maxRetries = retryArg ? parseInt(retryArg.split('=')[1] || '8', 10) : 8;
  const resumeArg = process.argv.find(a => a.startsWith('--resume-file='));
  const resumePath = resumeArg ? resumeArg.split('=')[1] : path.join(folder || '.', '.ingest_progress.json');

  if (!folder) {
    console.error('Usage: ts-node scripts/bulk_ingest_transcripts.ts <folder> <server_base_url> <api_key> [--delay-ms=1100] [--max-retries=8] [--resume-file=<path>]');
    process.exit(1);
  }
  const files = fs.readdirSync(folder).filter(f => f.endsWith('.txt')).sort();
  console.log(`Found ${files.length} transcript(s) in ${folder}`);

  let progress: Record<string, ProgressEntry> = {};
  if (resumePath && fs.existsSync(resumePath)) {
    try { progress = JSON.parse(fs.readFileSync(resumePath, 'utf-8')); } catch {}
  }

  const client = axios.create({ baseURL: base, headers: { 'x-api-key': apiKey } });
  let indexed = 0; let skipped = 0; let failed = 0;

  for (const f of files) {
    const txtPath = path.join(folder, f);
    const already = progress[f];
    if (already?.done) {
      skipped++;
      continue;
    }
    const txt = fs.readFileSync(txtPath, 'utf-8');
    const sidecarPath = txtPath.replace(/\.txt$/, '.json');
    let meta: any = {};
    if (fs.existsSync(sidecarPath)) {
      try { meta = JSON.parse(fs.readFileSync(sidecarPath, 'utf-8')); } catch {}
    }
    const title = meta.title || path.basename(f, '.txt');
    const audioUri = meta.audioUri;
    try {
      const resp = await postWithRetry(client, {
        transcript: txt,
        title,
        audioUri,
        chunk: { maxTokens: 450, overlapTokens: 60 }
      }, { maxRetries });
      console.log(`Indexed ${f} -> docId=${resp.data.docId}, chunks=${resp.data.indexedChunks}`);
      progress[f] = { done: true, docId: resp.data.docId, chunks: resp.data.indexedChunks };
      indexed++;
    } catch (e: any) {
      const msg = e?.response?.data ? JSON.stringify(e.response.data) : (e?.message || String(e));
      console.error(`Failed ${f}: ${msg}`);
      progress[f] = { done: false, lastError: msg };
      failed++;
    }
    try { fs.writeFileSync(resumePath, JSON.stringify(progress, null, 2)); } catch {}
    if (delayMs > 0) await sleep(delayMs);
  }
  console.log(`Summary: indexed=${indexed}, skipped=${skipped}, failed=${failed}. Progress saved to ${resumePath}`);
}

main().catch(err => { console.error(err?.response?.data || err); process.exit(1); });
