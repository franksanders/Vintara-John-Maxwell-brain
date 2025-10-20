import axios from 'axios';
import cheerio from 'cheerio';
import { v4 as uuidv4 } from 'uuid';
import { RawDocument } from './types';
// pdf-parse does not ship proper ES callable default types; use require for compatibility
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse');
import { logger } from './logger';

export async function fetchWebPage(url: string): Promise<RawDocument> {
  const res = await axios.get(url, { timeout: 20000 });
  const $ = cheerio.load(res.data);
  const title = $('title').text() || url;
  const content = $('body').text().replace(/\s+/g, ' ').trim();
  const doc: RawDocument = {
    id: uuidv4(),
    source: 'web',
    uri: url,
    title,
    content,
    metadata: { fetchedAt: new Date().toISOString() }
  };
  logger.debug({ url, len: content.length }, 'Fetched web page');
  return doc;
}

export async function ingestText(content: string, meta?: Partial<RawDocument>): Promise<RawDocument> {
  return {
    id: uuidv4(),
    source: 'text',
    content,
    title: meta?.title,
    author: meta?.author,
    metadata: meta?.metadata,
  };
}

// TODO(maxwell): Add PDF, audio transcription ingestion. Respect copyright; only ingest permitted content.

export async function ingestTranscript(content: string, meta?: Partial<RawDocument> & { audioUri?: string }): Promise<RawDocument> {
  return {
    id: uuidv4(),
    source: 'audio',
    content,
    title: meta?.title || 'Audio Transcript',
    author: meta?.author,
    uri: meta?.audioUri,
    metadata: { ...(meta?.metadata || {}), audioUri: meta?.audioUri },
  };
}

export async function ingestPdf(base64: string, meta?: Partial<RawDocument>): Promise<RawDocument> {
  const buf = Buffer.from(base64, 'base64');
  const data = await pdfParse(buf);
  const text = (data.text || '').replace(/\s+/g, ' ').trim();
  return {
    id: uuidv4(),
    source: 'pdf',
    content: text,
    title: meta?.title || meta?.uri || 'PDF Document',
    metadata: { pages: data.numpages, ...meta?.metadata },
  };
}
