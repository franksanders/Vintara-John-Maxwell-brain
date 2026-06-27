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
  'Signature Stories (Short)',
];

let cache: { path?: string; mtimeMs?: number; snippets: PersonaSnippet[] } = { snippets: [] };

const STOPWORDS = new Set([
  'the','a','an','and','or','but','if','then','than','that','those','these','to','of','in','on','for',
  'with','at','by','from','as','is','are','was','were','be','been','being','it','its','i','you','he',
  'she','we','they','them','my','our','your','his','her','their','this','there','here','so','just',
  'about','into','over','after','before','because','while','when',
]);

// Artifact patterns that indicate dirty auto-extracted persona content
const ARTIFACT_PATTERNS = [
  /^-\s*-\s*next:/i,                          // "- - next:" prefix
  /\(Source:\s*John\d+-\d+\.txt\)\s*$/i,      // trailing source references
  /\[Review\s+and\s+add/i,                     // placeholder bullets
  /\[add\s+verified/i,
  /^\s*-?\s*\[/,                               // lines that are just bracketed placeholders
];

function isArtifact(text: string): boolean {
  return ARTIFACT_PATTERNS.some(p => p.test(text));
}

function cleanSnippet(raw: string): string {
  // Remove trailing source reference
  let s = raw.replace(/\(Source:\s*John\d+-\d+\.txt\)\s*$/i, '').trim();
  // Remove leading "- - next:" or similar
  s = s.replace(/^-\s*-\s*next:\s*/i, '').trim();
  // Strip inline bracketed refs like [John2-123]
  s = s.replace(/\[John\d+-\d+\]/gi, '').trim();
  // Collapse double spaces
  s = s.replace(/\s{2,}/g, ' ').trim();
  return s;
}

function firstFullSentence(s: string): string {
  // Prefer ending at sentence boundary, but ensure min length
  const m = s.match(/^.{20,220}[.!?]/);
  if (m) return m[0].trim();
  // Fallback: trim to 220 chars at word boundary
  if (s.length <= 220) return s.trim();
  const cut = s.slice(0, 220).replace(/\s\S+$/, '');
  return cut.trim();
}

function normalizeText(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(w => !STOPWORDS.has(w));
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

    for (const line of lines) {
      const trimmed = line.trim();
      const h = trimmed.match(/^##\s+(.+)/);
      if (h) {
        const sec = h[1].trim();
        currentSection = SECTION_HEADERS.find(s => sec.toLowerCase().startsWith(s.toLowerCase())) || sec;
        continue;
      }
      if (!trimmed.startsWith('- ')) continue;

      const raw = trimmed.slice(2);
      if (isArtifact(raw)) continue;

      const cleaned = cleanSnippet(raw);
      if (!cleaned || cleaned.length < 24) continue;

      const body = firstFullSentence(cleaned);
      if (body.length < 24) continue;

      snippets.push({ text: body, section: currentSection || 'Persona' });
    }

    cache = { path: abs, mtimeMs: stat.mtimeMs, snippets };
    return snippets;
  } catch {
    return [];
  }
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const inter = [...a].filter(x => b.has(x)).length;
  if (inter === 0) return 0;
  return inter / new Set([...a, ...b]).size;
}

function sectionWeight(section: string): number {
  if (/turning point/i.test(section)) return 0.05;
  if (/relationships|mentors/i.test(section)) return 0.04;
  if (/signature stories/i.test(section)) return 0.03;
  if (/early life/i.test(section)) return 0.02;
  return 0;
}

/** Return the top N most relevant persona snippets for a query. */
export function getRelevantPersonaSnippets(query: string, personaPath: string, topN = 2): string[] {
  const snippets = loadSnippets(personaPath);
  if (!snippets.length) return [];
  const qTokens = new Set(normalizeText(query));
  const scored = snippets.map(s => {
    const sTokens = new Set(normalizeText(s.text));
    let score = jaccard(qTokens, sTokens) + sectionWeight(s.section);
    if (s.text.length < 140) score += 0.02; // slight boost for concise snippets
    return { text: s.text, score };
  });
  return scored
    .filter(s => s.score >= 0.12) // lowered threshold: 0.18 → 0.12
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map(s => s.text);
}

/** Backward-compatible single-snippet accessor. */
export function getRelevantPersonaSnippet(query: string, personaPath?: string): string | undefined {
  if (!personaPath) return undefined;
  const results = getRelevantPersonaSnippets(query, personaPath, 1);
  return results[0];
}
