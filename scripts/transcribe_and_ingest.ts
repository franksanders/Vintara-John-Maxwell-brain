import fs from 'fs';
import path from 'path';
import axios from 'axios';
import FormData from 'form-data';
import dotenv from 'dotenv';
dotenv.config();

// Usage:
// ts-node scripts/transcribe_and_ingest.ts <wav_folder> <server_base_url> <api_key> [--copy-to-public] [--no-ingest]
// - <wav_folder>: directory containing .wav files (e.g., data/wav)
// - <server_base_url>: http://localhost:3000 or your ngrok URL
// - <api_key>: x-api-key for the server
// Flags:
//   --copy-to-public  Copies each WAV to public/voices and sets audioUri accordingly
//   --no-ingest       Only transcribe and write .txt/.json; do not POST to server

async function transcribeWav(wavPath: string, openaiKey: string): Promise<string> {
  const form = new FormData();
  form.append('file', fs.createReadStream(wavPath));
  form.append('model', 'whisper-1');
  form.append('response_format', 'text');
  // Optionally set language if known
  form.append('language', 'en');
  const res = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
    headers: { Authorization: `Bearer ${openaiKey}`, ...form.getHeaders() },
    timeout: 300_000
  });
  // For response_format=text, res.data is plain text
  return typeof res.data === 'string' ? res.data : String(res.data);
}

async function main() {
  const wavFolder = process.argv[2];
  const serverBase = process.argv[3] || 'http://localhost:3000';
  const apiKey = process.argv[4] || '';
  const copyToPublic = process.argv.includes('--copy-to-public');
  const noIngest = process.argv.includes('--no-ingest');
  const limitFlag = process.argv.find(a => a.startsWith('--limit='));
  const limit = limitFlag ? parseInt(limitFlag.split('=')[1] || '0', 10) : 0;
  const openaiKey = process.env.OPENAI_API_KEY || '';
  if (!wavFolder) {
    console.error('Usage: ts-node scripts/transcribe_and_ingest.ts <wav_folder> <server_base_url> <api_key> [--copy-to-public] [--no-ingest]');
    process.exit(1);
  }
  if (!openaiKey) {
    console.error('OPENAI_API_KEY is required in env for transcription.');
    process.exit(1);
  }

  const absWav = path.isAbsolute(wavFolder) ? wavFolder : path.join(process.cwd(), wavFolder);
  if (!fs.existsSync(absWav)) {
    console.error(`WAV folder not found: ${absWav}`);
    process.exit(1);
  }
  let files = fs.readdirSync(absWav).filter(f => f.toLowerCase().endsWith('.wav'));
  if (limit && files.length > limit) files = files.slice(0, limit);
  if (!files.length) {
    console.error('No .wav files found.');
    process.exit(1);
  }
  const voicesDir = path.join(process.cwd(), 'public', 'voices');
  if (copyToPublic && !fs.existsSync(voicesDir)) fs.mkdirSync(voicesDir, { recursive: true });

  console.log(`Found ${files.length} wav file(s). Starting transcription...`);
  const client = axios.create({ baseURL: serverBase, headers: { 'x-api-key': apiKey } });
  const outDir = path.join(process.cwd(), 'data', 'transcripts');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  for (const f of files) {
    const wavPath = path.join(absWav, f);
    const base = path.basename(f, path.extname(f));
    try {
      console.log(`Transcribing ${f}...`);
      const text = await transcribeWav(wavPath, openaiKey);
      const txtPath = path.join(outDir, `${base}.txt`);
      fs.writeFileSync(txtPath, text);
      let audioUri: string | undefined;
      if (copyToPublic) {
        const dest = path.join(voicesDir, path.basename(wavPath));
        if (!fs.existsSync(dest)) fs.copyFileSync(wavPath, dest);
        // If serverBase is external (ngrok), we can form a public URL
        try {
          const u = new URL(serverBase);
          audioUri = `${u.origin}/voices/${path.basename(wavPath)}`;
        } catch { /* ignore malformed base */ }
      }
      const sidecarPath = path.join(outDir, `${base}.json`);
      const meta = { title: base, audioUri };
      fs.writeFileSync(sidecarPath, JSON.stringify(meta));
      console.log(`Saved transcript: ${txtPath}`);
      if (!noIngest) {
        console.log(`Ingesting ${base}...`);
        await client.post('/ingest/transcript', {
          transcript: text,
          title: base,
          audioUri,
          chunk: { maxTokens: 450, overlapTokens: 60 }
        });
        console.log(`Ingested: ${base}`);
      }
    } catch (e: any) {
      console.error(`Failed for ${f}:`, e?.response?.data || e?.message || e);
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
