import fs from 'fs';
import path from 'path';

export interface PersonaSnippet {
  text: string;
  section: string;
}

const SECTION_HEADERS = [
  'Early Life and Family',
  'Relationships and Mentors',
  'Turning Points',
  'Signature Stories (Short)'
];

let cache: { path?: string; mtimeMs?: number; snippets: PersonaSnippet[] } = { snippets: [] };

function normalizeText(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(w => !STOPWORDS.has(w));
}

const STOPWORDS = new Set([
  'the','a','an','and','or','but','if','then','than','that','those','these','to','of','in','on','for','with','at','by','from','as','is','are','was','were','be','been','being','it','its','i','you','he','she','we','they','them','my','our','your','his','her','their','this','there','here','so','just','about','into','over','after','before','because','while','when'
]);

function firstSentence(s: string): string {
  const m = s.match(/^[^.!?]{10,200}[.!?]/);
  return m ? m[0].trim() : s.trim().slice(0, 220);
}

function loadSnippets(personaPath: string): PersonaSnippet[] {
  try {
    const abs = path.isAbsolute(personaPath) ? personaPath : path.join(process.cwd(), personaPath);
    if (!fs.existsSync(abs)) return [];
    const stat = fs.statSync(abs);
    if (cache.path === abs && cache.mtimeMs === stat.mtimeMs && cache.snippets.length) {
      return cache.snippets;
    }
    const txt = fs.readFileSync(abs, 'utf-8');
    const lines = txt.split(/\r?\n/);
    const snippets: PersonaSnippet[] = [];
    let currentSection = '';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const h = line.match(/^##\s+(.+)/);
      if (h) {
        const sec = h[1].trim();
        currentSection = SECTION_HEADERS.find(s => sec.toLowerCase().startsWith(s.toLowerCase())) || sec;
        continue;
      }
      if (line.startsWith('- ')) {
        // Remove "- " and any trailing (Source: ...)
        let body = line.slice(2).replace(/\(Source:.*\)\s*$/i, '').trim();
        if (!body) continue;
        body = firstSentence(body);
        if (body.length < 24) continue; // avoid too short
        if (body.length > 260) body = body.slice(0, 260);
        // Skip placeholder bullets
        if (/\[review|add|verified/i.test(body)) continue;
        snippets.push({ text: body, section: currentSection || 'Persona' });
      }
    }
    cache = { path: abs, mtimeMs: stat.mtimeMs, snippets };
    return snippets;
  } catch {
    return [];
  }
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const inter = new Set([...a].filter(x => b.has(x))).size;
  if (inter === 0) return 0;
  const uni = new Set([...a, ...b]).size;
  return inter / uni;
}

function sectionWeight(section: string): number {
  if (/turning point/i.test(section)) return 0.05;
  if (/relationships|mentors/i.test(section)) return 0.04;
  if (/early life/i.test(section)) return 0.02;
  if (/signature stories/i.test(section)) return 0.03;
  return 0;
}

export function getRelevantPersonaSnippet(query: string, personaPath?: string): string | undefined {
  if (!personaPath) return undefined;
  const snippets = loadSnippets(personaPath);
  if (!snippets.length) return undefined;
  const qTokens = new Set(normalizeText(query));
  let best: { text: string; score: number } | undefined;
  for (const s of snippets) {
    const sTokens = new Set(normalizeText(s.text));
    let score = jaccard(qTokens, sTokens) + sectionWeight(s.section);
    // Small boost for very short snippets (more likely to fit as a brief aside)
    if (s.text.length < 140) score += 0.02;
    if (!best || score > best.score) best = { text: s.text, score };
  }
  // Only return if reasonably relevant
  if (best && best.score >= 0.18) return best.text;
  return undefined;
}
