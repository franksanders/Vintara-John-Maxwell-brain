import fs from 'fs';
import path from 'path';

/*
  Extract candidate personal anecdotes from transcript .txt files.
  Heuristics: sentences with first-person markers and life-stage keywords.
  Usage: ts-node scripts/extract_persona_anecdotes.ts <inputDir> [outputFile]
*/

const INPUT_DIR = process.argv[2] || path.resolve('data/transcripts');
const OUTPUT_FILE = process.argv[3] || path.resolve('data/persona/john_persona_drafts.md');

const FIRST_PERSON = /(\bI\b|\bI'm\b|\bI am\b|\bmy\b|\bme\b|\bwhen I\b|\bI remember\b|\bI learned\b)/i;
const LIFE_STAGE = /(child|kid|teen|high school|college|married|wife|husband|father|mother|parents|pastor|church|first job|mentor|grew up|growing up|younger|youth)/i;

function readTxtFiles(dir: string): Array<{ file: string; text: string }> {
  const abs = path.isAbsolute(dir) ? dir : path.resolve(dir);
  if (!fs.existsSync(abs)) throw new Error(`Input dir not found: ${abs}`);
  const files = fs.readdirSync(abs).filter(f => f.endsWith('.txt'));
  return files.map(f => ({ file: f, text: fs.readFileSync(path.join(abs, f), 'utf-8') }));
}

function splitSentences(text: string): string[] {
  // naive split; keeps punctuation
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z"'])/)
    .map(s => s.trim())
    .filter(Boolean);
}

function extract() {
  const docs = readTxtFiles(INPUT_DIR);
  const out: string[] = [];
  out.push('# John Maxwell Persona Drafts');
  out.push('');
  out.push('This file is auto-generated from transcripts. Review, paraphrase where needed, and move curated content into your final persona file.');
  out.push('');
  out.push('---');
  out.push('');

  for (const d of docs) {
    const sents = splitSentences(d.text);
    const picks: Array<{ idx: number; sent: string }> = [];
    for (let i = 0; i < sents.length; i++) {
      const s = sents[i];
      if (FIRST_PERSON.test(s) && LIFE_STAGE.test(s)) {
        picks.push({ idx: i, sent: s });
      }
    }
    if (!picks.length) continue;
    out.push(`## Source: ${d.file}`);
    out.push('');
    for (const p of picks) {
      const prev = sents[p.idx - 1] || '';
      const next = sents[p.idx + 1] || '';
      out.push('- Excerpt:');
      if (prev) out.push(`  - prev: ${prev}`);
      out.push(`  - this: ${p.sent}`);
      if (next) out.push(`  - next: ${next}`);
      out.push('');
    }
  }

  const outAbs = path.isAbsolute(OUTPUT_FILE) ? OUTPUT_FILE : path.resolve(OUTPUT_FILE);
  const outDir = path.dirname(outAbs);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outAbs, out.join('\n'));
  console.log(`Wrote persona drafts to ${outAbs}`);
}

extract();
