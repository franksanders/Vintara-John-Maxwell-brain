import fs from 'fs';
import path from 'path';

/*
  Curate persona from john_persona_drafts.md by grouping excerpts into sections:
  Early Life and Family, Relationships and Mentors, Turning Points, Signature Stories.
  Heuristics based on keywords. Produces john_persona_curated.md as a starting point.

  Usage: ts-node scripts/curate_persona_from_drafts.ts [draftFile] [outputFile]
*/

const DRAFT = process.argv[2] || path.resolve('data/persona/john_persona_drafts.md');
const OUT = process.argv[3] || path.resolve('data/persona/john_persona_curated.md');

const EARLY = /(child|kid|grew up|growing up|parents|home|high school|teen|youth|hometown)/i;
const REL = /(wife|husband|married|family|children|daughter|son|mentor|mentors|pastor|church|congregation|leader I learned from)/i;
const TURN = /(first job|calling|call to|turning point|pivot|mistake|failure|learned the hard way|changed direction|challenge that|decided to|left|resigned)/i;
const STORY = /(I remember|I learned|I once|there was a time|story|illustrates|for example)/i;

function loadDraft(p: string): string {
  const abs = path.isAbsolute(p) ? p : path.resolve(p);
  if (!fs.existsSync(abs)) throw new Error(`Draft not found: ${abs}`);
  return fs.readFileSync(abs, 'utf-8');
}

function parseExcerpts(md: string): Array<{ source: string; prev?: string; body: string; next?: string }>{
  const lines = md.split(/\r?\n/);
  const results: Array<{ source: string; prev?: string; body: string; next?: string }> = [];
  let currentSource = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^##\s+Source:\s+(.+)/);
    if (m) { currentSource = m[1].trim(); continue; }
    if (line.startsWith('- Excerpt:')) {
      const prevLine = lines[i+1]?.replace(/^\s*-\s*prev:\s*/, '').trim();
      const thisLine = lines[i+2]?.replace(/^\s*-\s*this:\s*/, '').trim();
      const nextLine = lines[i+3]?.replace(/^\s*-\s*next:\s*/, '').trim();
      if (thisLine) results.push({ source: currentSource, prev: prevLine || undefined, body: thisLine, next: nextLine || undefined });
    }
  }
  return results;
}

function classify(text: string): 'EARLY'|'REL'|'TURN'|'STORY' {
  if (EARLY.test(text)) return 'EARLY';
  if (REL.test(text)) return 'REL';
  if (TURN.test(text)) return 'TURN';
  return 'STORY';
}

function curate() {
  const md = loadDraft(DRAFT);
  const ex = parseExcerpts(md);
  const early: string[] = [];
  const rel: string[] = [];
  const turn: string[] = [];
  const story: string[] = [];

  for (const e of ex) {
    const cat = classify([e.prev, e.body, e.next].filter(Boolean).join(' '));
    const bullet = `- ${e.body} (Source: ${e.source})`;
    if (cat === 'EARLY') early.push(bullet);
    else if (cat === 'REL') rel.push(bullet);
    else if (cat === 'TURN') turn.push(bullet);
    else story.push(bullet);
  }

  const out: string[] = [];
  out.push('# John C. Maxwell Persona (Curated Draft)');
  out.push('');
  out.push('This file was auto-curated from transcripts. Review and edit for accuracy, brevity, and tone.');
  out.push('Do not include anything you cannot verify from authorized sources.');
  out.push('');
  out.push('---');
  out.push('');
  out.push('## Early Life and Family');
  out.push(...(early.length ? early : ['- [Review and add verified points]']));
  out.push('');
  out.push('## Relationships and Mentors');
  out.push(...(rel.length ? rel : ['- [Review and add verified points]']));
  out.push('');
  out.push('## Turning Points');
  out.push(...(turn.length ? turn : ['- [Review and add verified points]']));
  out.push('');
  out.push('## Signature Stories (Short)');
  out.push(...(story.slice(0, 8).length ? story.slice(0, 8) : ['- [Add 2–5 short anecdotes]']));
  out.push('');
  out.push('## Boundaries');
  out.push('- Reference only what appears here or in retrieved context.');
  out.push('- Avoid private details not already public.');
  out.push('- Anecdotes illustrate principles; they do not replace grounded teaching.');
  out.push('');
  out.push('## Sources / Provenance');
  out.push('- See bullets above for per-item sources.');

  const absOut = path.isAbsolute(OUT) ? OUT : path.resolve(OUT);
  fs.mkdirSync(path.dirname(absOut), { recursive: true });
  fs.writeFileSync(absOut, out.join('\n'));
  console.log(`Wrote curated persona to ${absOut}`);
}

curate();
