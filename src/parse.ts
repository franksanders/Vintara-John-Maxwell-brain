import { RawDocument, Chunk } from './types';
import { v4 as uuidv4 } from 'uuid';
import { chunkText, estimateTokens } from './utils';
import { tagContent } from './maxwell_taxonomy';
import { checkDuplicate } from './dedup';

export function cleanText(text: string): string {
  return text.replace(/\u00A0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s+\n/g, '\n').trim();
}

export function toChunks(doc: RawDocument, opts: { maxTokens?: number; overlapTokens?: number } = {}): Chunk[] {
  const clean = cleanText(doc.content);
  const parts = chunkText(clean, opts);
  const rawChunks: Chunk[] = parts.map((p, i) => ({
    id: uuidv4(),
    docId: doc.id,
    content: p,
    tokens: estimateTokens(p),
    order: i,
    metadata: { title: doc.title, uri: doc.uri, source: doc.source, tags: tagContent(p) }
  }));
  const filtered: Chunk[] = [];
  for (const ch of rawChunks) {
    const dedup = checkDuplicate(ch);
    if (dedup.isDuplicate) {
      ch.metadata = { ...(ch.metadata || {}), duplicateOf: dedup.duplicateOf, similarity: dedup.similarity };
      // Skip adding to filtered list (not indexed)
      continue;
    }
    filtered.push(ch);
  }
  return filtered;
}
