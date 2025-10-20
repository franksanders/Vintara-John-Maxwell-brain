import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import { z } from 'zod';
import { config } from './config';
import { logger } from './logger';
import { AppError, ValidationError } from './errors';
import { fetchWebPage, ingestText, ingestPdf, ingestTranscript } from './ingest';
import { toChunks } from './parse';
import { indexChunks, search, searchDetailed, getIndexStats } from './retrieve';
import { LRUCache, makeRetrievalKey } from './cache';
import { buildPrompt } from './prompt';
import { dedupStats } from './dedup';
import { generateAnswer, generateChatAnswer, streamAnswer, streamChatAnswer, ChatMessage } from './generate';
import { getMemory, upsertMemory, listMemories, recordFeedback, decayPreferences } from './memory';
import { listConfigHistory, currentRuntimeConfig, updateRuntimeConfig } from './admin_config';
import { createThread, addMessage, getThread, getHistory, listThreads, setThreadUser } from './conversation';
import { synthesizeSpeech } from './voice';
import { getDateTime, getWeather } from './context';
import { getRelevantPersonaSnippet } from './persona';
import { UserProfile } from './types';
import fs from 'fs';
import { checkRateLimit, remainingTokens } from './rate_limit';

const app = express();
// CORS for frontend apps
app.use(cors({
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    const allowList = config.cors.origins;
    if (!origin || !allowList.length || allowList.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));
app.use(express.json({ limit: '2mb' }));
// Global safety nets to avoid hard exits during long auto-ingest
process.on('uncaughtException', (err) => {
  try { logger.error({ err }, 'Uncaught exception'); } catch {}
});
process.on('unhandledRejection', (reason: any) => {
  try { logger.error({ err: reason }, 'Unhandled rejection'); } catch {}
});
// Serve simple mobile UI (use absolute path to be robust in dev/prod)
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));
// Also serve /voices if present inside public (for reference WAVs)
app.use('/voices', express.static(path.join(PUBLIC_DIR, 'voices')));
// Explicit root route for convenience
app.get('/', (_req: Request, res: Response) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// In-memory metrics (lightweight; consider Prometheus formatter later)
const metrics = {
  requests: 0,
  retrievalCacheHits: 0,
  generationCacheHits: 0,
  rerankApplied: 0,
  rateLimitDenied: 0,
  lastReset: Date.now()
};
// Authentication & Rate limiting middleware
app.use((req, res, next) => {
  if (req.path === '/health' || req.path === '/metrics' || req.path === '/corpus/stats') return next();
  const key = (req.headers['x-api-key'] as string) || '';
  const isAdmin = key && key === config.auth.adminKey;
  if (req.path.startsWith('/admin')) {
    if (!isAdmin) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Admin key required' } });
  }
  const validKeys = new Set(config.auth.apiKeys.concat([config.auth.adminKey]));
  if (!validKeys.size) {
    // In dev, allow requests without keys
    return next();
  }
  if (!validKeys.has(key)) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or missing API key' } });
  }
  // Rate limit (skip for admin)
  if (!isAdmin) {
    const rl = checkRateLimit(key);
    if (!rl.ok) {
      metrics.rateLimitDenied++;
      return res.status(429).set('Retry-After', String(rl.retryAfter || 1)).json({ error: { code: 'RATE_LIMIT', message: 'Rate limit exceeded', retryAfter: rl.retryAfter } });
    }
  }
  // Expose remaining tokens
  (req as any).apiKey = key;
  res.setHeader('X-RateLimit-Remaining', String(remainingTokens(key)));
  next();
});

app.use((req, _res, next) => {
  metrics.requests++;
  next();
});

// Global caches (could later namespace per user)
const retrievalCache = new LRUCache<any>(300, 3_000_000); // about ~3MB budget
const generationCache = new LRUCache<any>(200, 4_000_000);

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', env: config.env, vector: config.vector.kind, embedding: config.embedding.provider, voiceConfigured: !!(config.voice.hf.apiToken && config.voice.hf.ttsModel) });
});

// Lightweight corpus stats to verify ingestion progress/completion
app.get('/corpus/stats', (_req: Request, res: Response) => {
  try {
    const stats = getIndexStats();
    res.json({ ok: true, stats, autoIngest: autoIngestProgress });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || 'Failed to get corpus stats' });
  }
});

// --- Simple in-memory user profiles ---
const profiles = new Map<string, UserProfile>();

app.get('/profile', (req: Request, res: Response) => {
  const userId = String((req.query.userId || '').toString() || '');
  if (!userId) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Missing userId' } });
  res.json({ profile: profiles.get(userId) || { userId } });
});

app.post('/profile', (req: Request, res: Response) => {
  const { userId, firstName, timezone, latitude, longitude, locale, regionName,
    role, seniority, industry, teamSize, goals, currentChallenge, tonePref, brevityPref, cadencePref, stakeholders, deadlines, boundaries } = req.body || {};
  if (!userId) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Missing userId' } });
  const p: UserProfile = {
    userId: String(userId),
    firstName: firstName ? String(firstName) : undefined,
    timezone: timezone ? String(timezone) : undefined,
    latitude: typeof latitude === 'number' ? latitude : (latitude ? Number(latitude) : undefined),
    longitude: typeof longitude === 'number' ? longitude : (longitude ? Number(longitude) : undefined),
    locale: locale ? String(locale) : undefined,
    regionName: regionName ? String(regionName) : undefined,
    role: role ? String(role) : undefined,
    seniority: seniority ? String(seniority) : undefined,
    industry: industry ? String(industry) : undefined,
    teamSize: typeof teamSize === 'number' ? teamSize : (teamSize ? Number(teamSize) : undefined),
    goals: Array.isArray(goals) ? goals.map((g: any) => String(g)).slice(0, 10) : undefined,
    currentChallenge: currentChallenge ? String(currentChallenge) : undefined,
    tonePref: tonePref === 'direct' || tonePref === 'empathetic' ? tonePref : undefined,
    brevityPref: brevityPref === 'short' || brevityPref === 'normal' ? brevityPref : undefined,
    cadencePref: cadencePref ? String(cadencePref) : undefined,
    stakeholders: Array.isArray(stakeholders) ? stakeholders.map((s: any) => String(s)).slice(0, 10) : undefined,
    deadlines: Array.isArray(deadlines) ? deadlines.slice(0, 10).map((d: any) => ({ name: String(d?.name || ''), date: String(d?.date || '') })).filter(d => d.name && d.date) : undefined,
    boundaries: Array.isArray(boundaries) ? boundaries.map((b: any) => String(b)).slice(0, 10) : undefined
  };
  profiles.set(p.userId, p);
  res.json({ ok: true, profile: p });
});

// Helper: build prompt with personal touch and dynamic context
async function buildPersonalizedPrompt(query: string, results: Array<{ chunk: any; score: number }>, userId?: string) {
  const prompt = buildPrompt(query, results);
  let nameFrag = '';
  let contextFrag = '';
  let personaFrag = '';
  let profileFrag = '';
  const profile = userId ? profiles.get(userId) : undefined;
  if (profile?.firstName) nameFrag = `Use their first name "${profile.firstName}" when it adds warmth—don’t overuse it.`;
  if (profile) {
    const hints: string[] = [];
    if (profile.role || profile.seniority) hints.push(`Role: ${[profile.seniority, profile.role].filter(Boolean).join(' ')}`.trim());
    if (profile.brevityPref) hints.push(`Brevity: ${profile.brevityPref}`);
    if (profile.tonePref) hints.push(`Tone: ${profile.tonePref}`);
    if (profile.currentChallenge) hints.push(`Focus: ${profile.currentChallenge}`);
    // Cap to ~2 lines max
    if (hints.length) profileFrag = `Profile hints (do not override grounded content): ${hints.slice(0, 3).join('; ')}`;
  }
  if (config.context.dateTimeEnabled || config.context.weatherEnabled) {
    const dt = config.context.dateTimeEnabled ? getDateTime(profile) : undefined;
    const weather = config.context.weatherEnabled ? await getWeather(profile) : null;
    const bits: string[] = [];
    if (dt) bits.push(`Now: ${dt.local} (local time)`);
    if (weather && !Number.isNaN(weather.temperatureC)) {
      const where = profile?.regionName ? ` in ${profile.regionName}` : '';
      bits.push(`Weather${where}: ${weather.summary}, ${weather.temperatureC.toFixed(1)}°C/${weather.temperatureF.toFixed(1)}°F`);
    }
    if (bits.length) contextFrag = `\n---\nLive context (do not use to change facts of the teachings):\n${bits.join('\\n')}`;
  }
  // Add at most one supportive persona snippet when explicitly helpful
  if (config.content.personaSnippetsEnabled && config.content.personaPath) {
    const snip = getRelevantPersonaSnippet(query, config.content.personaPath);
    if (snip) personaFrag = `One brief, relevant personal aside you may reference (optional, keep to 1–2 sentences): ${snip}`;
  }
  const system = [prompt.system, nameFrag, profileFrag, personaFrag, contextFrag].filter(Boolean).join('\n');
  return { ...prompt, system } as typeof prompt;
}

const IngestSchema = z.object({
  url: z.string().url().optional(),
  text: z.string().min(1).optional(),
  pdfBase64: z.string().min(20).optional(),
  title: z.string().optional(),
  chunk: z.object({ maxTokens: z.number().int().positive().optional(), overlapTokens: z.number().int().nonnegative().optional() }).optional()
}).refine(v => v.url || v.text || v.pdfBase64, { message: 'Provide url, text, or pdfBase64' });

app.post('/ingest', async (req: Request, res: Response, next: NextFunction) => {
  try {
  const { url, text, pdfBase64, title, chunk: chunkOpts } = IngestSchema.parse(req.body ?? {});
  let raw;
  if (url) raw = await fetchWebPage(url);
  else if (pdfBase64) raw = await ingestPdf(pdfBase64, { title });
  else raw = await ingestText(String(text), { title });
    const chunks = toChunks(raw, chunkOpts);
    await indexChunks(chunks);
    res.json({ docId: raw.id, indexedChunks: chunks.length, dedupStats: dedupStats() });
  } catch (err) { next(err); }
});

// Ingest a transcript (plain text) with optional audioUri for provenance
const TranscriptSchema = z.object({
  transcript: z.string().min(1),
  title: z.string().optional(),
  audioUri: z.string().url().optional(),
  chunk: z.object({ maxTokens: z.number().int().positive().optional(), overlapTokens: z.number().int().nonnegative().optional() }).optional()
});

app.post('/ingest/transcript', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { transcript, title, audioUri, chunk: chunkOpts } = TranscriptSchema.parse(req.body ?? {});
    const raw = await ingestTranscript(transcript, { title, audioUri });
    const chunks = toChunks(raw, chunkOpts);
    await indexChunks(chunks);
    res.json({ docId: raw.id, indexedChunks: chunks.length, source: 'audio', dedupStats: dedupStats() });
  } catch (err) { next(err); }
});

const QuerySchema = z.object({ query: z.string().min(1), userId: z.string().optional(), topK: z.number().int().positive().max(50).optional() });

app.post('/query', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { query, userId, topK = 5 } = QuerySchema.parse(req.body ?? {});
    const { alpha, beta, gamma } = config.retrieval;
    const mem = userId ? getMemory(userId) : undefined;
    if (userId) decayPreferences(userId); // apply periodic decay
    const key = makeRetrievalKey({ query, userId, topK, alpha, beta, gamma, preferredCategories: mem?.preferredCategories });
    let results = retrievalCache.get(key);
    if (!results) {
      // Use detailed search for richer components; store simplified results
      const detailed = await searchDetailed(query, topK, userId, { alpha, beta, gamma });
      results = detailed.map(d => ({ chunk: d.chunk, score: d.score }));
      retrievalCache.set(key, results);
      if (config.rerank.enabled) metrics.rerankApplied++;
    } else {
      metrics.retrievalCacheHits++;
    }
    const prompt = await buildPersonalizedPrompt(query, results, userId);
    // NOTE: We stop at retrieval+prompt building; generation is out of scope of this scaffold.
  res.json({ prompt, results: results.map((r: any) => ({ score: r.score, chunkId: r.chunk.id, docId: r.chunk.docId })) });
  } catch (err) { next(err); }
});

const GenerateSchema = z.object({
  query: z.string().min(1),
  userId: z.string().optional(),
  topK: z.number().int().positive().max(50).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().max(2000).optional(),
  topP: z.number().min(0).max(1).optional(),
  presencePenalty: z.number().min(-2).max(2).optional(),
  frequencyPenalty: z.number().min(-2).max(2).optional(),
  history: z.array(z.object({ role: z.enum(['system','user','assistant']), content: z.string() })).optional()
});

app.post('/generate', async (req: Request, res: Response, next: NextFunction) => {
  try {
  const { query, userId, topK = 5, temperature, maxTokens, topP, presencePenalty, frequencyPenalty, history } = GenerateSchema.parse(req.body ?? {});
    // Retrieve when enabled, otherwise run persona-only
    let results: Array<{ chunk: any; score: number }> = [];
    if (config.content.retrievalEnabled) {
      const { alpha, beta, gamma } = config.retrieval;
      const mem = userId ? getMemory(userId) : undefined;
      if (userId) decayPreferences(userId);
      const detailed = await searchDetailed(query, topK, userId, { alpha, beta, gamma });
      results = detailed.map(d => ({ chunk: d.chunk, score: d.score }));
    }
  const prompt = await buildPersonalizedPrompt(query, results, userId);
    const gen = (history && history.length)
      ? await generateChatAnswer(prompt, history as ChatMessage[], { temperature, maxTokens, topP, presencePenalty, frequencyPenalty })
      : await generateAnswer(prompt, { temperature, maxTokens, topP, presencePenalty, frequencyPenalty });
    // Enrich citations with doc metadata
    const resultsMap = new Map<number, { chunk: any; score: number }>();
    results.forEach((r, idx) => resultsMap.set(idx + 1, r));
    const citations = (gen.citations || []).map(c => {
      const r = resultsMap.get(c.chunkIndex);
      return {
        chunkIndex: c.chunkIndex,
        chunkId: r?.chunk?.id,
        docId: r?.chunk?.docId,
        title: r?.chunk?.metadata?.title,
        uri: r?.chunk?.metadata?.uri,
        score: r?.score
      };
    });
    res.json({ prompt, answer: gen.answer, model: gen.model, citations });
  } catch (err) { next(err); }
});

// Streaming generation via Server-Sent Events
app.post('/generate/stream', async (req: Request, res: Response, next: NextFunction) => {
  try {
  const { query, userId, topK = 5, temperature, maxTokens, topP, presencePenalty, frequencyPenalty, history } = GenerateSchema.parse(req.body ?? {});
    const { alpha, beta, gamma } = config.retrieval;
    const mem = userId ? getMemory(userId) : undefined;
    if (userId) decayPreferences(userId);
    const rKey = makeRetrievalKey({ query, userId, topK, alpha, beta, gamma, preferredCategories: mem?.preferredCategories });
    let results = retrievalCache.get(rKey);
    if (!results) {
      const detailed = await searchDetailed(query, topK, userId, { alpha, beta, gamma });
      results = detailed.map(d => ({ chunk: d.chunk, score: d.score }));
      retrievalCache.set(rKey, results);
      if (config.rerank.enabled) metrics.rerankApplied++;
    } else {
      metrics.retrievalCacheHits++;
    }
  const prompt = await buildPersonalizedPrompt(query, results, userId);
    // Setup SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    const controller = new AbortController();
    req.on('close', () => controller.abort());
    const resultsMap = new Map<number, (typeof results)[number]>();
  results.forEach((r: any, idx: number) => resultsMap.set(idx + 1, r));
    const gKey = rKey + `:gen:${temperature ?? 'def'}:${maxTokens ?? 'def'}`;
    // We do not stream from cache; if cached generation exists we emit tokens from it.
    let gen = generationCache.get(gKey);
    if (gen) {
      metrics.generationCacheHits++;
      // Emit cached answer as token stream
      res.write(`event: start\n`);
      const citations = (gen.citations || []).map((c: any) => {
        const r = resultsMap.get(c.chunkIndex);
        return {
          chunkIndex: c.chunkIndex,
          chunkId: r?.chunk.id,
          docId: r?.chunk.docId,
          title: r?.chunk.metadata?.title,
          uri: r?.chunk.metadata?.uri,
          score: r?.score
        };
      });
      res.write(`data: ${JSON.stringify({ model: gen.model, prompt, citations })}\n\n`);
      for (const t of gen.answer.split(/(\s+)/).filter(Boolean)) {
        res.write(`event: token\n`);
        res.write(`data: ${JSON.stringify({ token: t })}\n\n`);
      }
      res.write(`event: done\n`);
      res.write(`data: {}\n\n`);
      res.end();
      return;
    }
  const stream = history && history.length ? streamChatAnswer(prompt, history as ChatMessage[], { temperature, maxTokens, topP, presencePenalty, frequencyPenalty }) : streamAnswer(prompt, { temperature, maxTokens, topP, presencePenalty, frequencyPenalty });
    for await (const chunk of stream) {
      if (controller.signal.aborted) break;
      if (chunk.type === 'start') {
        // enrich citations
        const citations = (chunk.citations || []).map(c => {
          const r = resultsMap.get(c.chunkIndex);
          return {
            chunkIndex: c.chunkIndex,
            chunkId: r?.chunk.id,
            docId: r?.chunk.docId,
            title: r?.chunk.metadata?.title,
            uri: r?.chunk.metadata?.uri,
            score: r?.score
          };
        });
        res.write(`event: start\n`);
        res.write(`data: ${JSON.stringify({ model: chunk.model, prompt, citations })}\n\n`);
      } else if (chunk.type === 'token') {
        res.write(`event: token\n`);
        res.write(`data: ${JSON.stringify({ token: chunk.data })}\n\n`);
      } else if (chunk.type === 'done') {
        res.write(`event: done\n`);
        res.write(`data: {}\n\n`);
      } else if (chunk.type === 'error') {
        res.write(`event: error\n`);
        res.write(`data: ${JSON.stringify({ message: chunk.data })}\n\n`);
      }
    }
    // Cache full generation after streaming
    // Reconstruct answer from tokens if not cached.
    // NOTE: We captured tokens via streaming; simpler is to regenerate once more or modify streamAnswer to expose final answer.
    // For now we regenerate once to store (small overhead acceptable initial version).
    const final = await generateAnswer(prompt, { temperature, maxTokens });
    generationCache.set(gKey, final);
    res.end();
  } catch (err) { next(err); }
});

app.get('/metadata', async (_req: Request, res: Response) => {
  res.json({ collection: config.vector.collection });
});

// Conversation management endpoints
app.post('/conversation/start', (req: Request, res: Response) => {
  const { userId, seed } = req.body || {};
  const initial = Array.isArray(seed) ? seed : [];
  // Show opening message only for new/anonymous users
  if (!userId) {
    const opening: ChatMessage = {
      role: 'assistant',
      content: "Hello, I’m John C. Maxwell. It’s good to meet you. I’m here to serve you as a coach—practical, encouraging, and honest. Before we dive in, who am I speaking with? What’s your first name?"
    };
    const t = createThread(undefined, [opening, ...initial]);
    res.json({ id: t.id, openingMessage: opening.content });
  } else {
    const t = createThread(userId, initial);
    res.json({ id: t.id });
  }
});

app.get('/conversation', (_req: Request, res: Response) => {
  res.json({ threads: listThreads() });
});

app.post('/conversation/:id/send', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id;
  const { query, topK = 5, temperature, maxTokens, topP, presencePenalty, frequencyPenalty } = req.body || {};
    if (!query) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Missing query' } });
    const t = getThread(id);
    if (!t) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Conversation not found' } });
    // If this is the first user response and we don't have a userId yet, try to capture first name.
    const userText = String(query);
    // Very light name extraction: first token up to punctuation, alphabetic only
    if (!t.userId) {
      const m = userText.match(/^(?:hi|hello|hey|it'?s|i am|i'm|my name is|name's)?\s*([A-Za-z\-']{2,})(?:[\s,!.?]|$)/i);
      const firstName = m ? m[1] : undefined;
      if (firstName) {
        // Create a simple user id and store profile
        const newUserId = 'u_' + Math.random().toString(36).slice(2, 10);
        setThreadUser(id, newUserId);
        profiles.set(newUserId, { userId: newUserId, firstName });
      }
    }
    addMessage(id, { role: 'user', content: userText });
    let results: Array<{ chunk: any; score: number }> = [];
    if (config.content.retrievalEnabled) {
      const { alpha, beta, gamma } = config.retrieval;
      const mem = t.userId ? getMemory(t.userId) : undefined;
      if (t.userId) decayPreferences(t.userId);
      const detailed = await searchDetailed(query, topK, t.userId, { alpha, beta, gamma });
      results = detailed.map(d => ({ chunk: d.chunk, score: d.score }));
    }
  const prompt = await buildPersonalizedPrompt(query, results, t.userId);
    const history = getHistory(id);
  const gen = await generateChatAnswer(prompt, history, { temperature, maxTokens, topP, presencePenalty, frequencyPenalty });
    addMessage(id, { role: 'assistant', content: gen.answer });
    // Enrich citations
    const resultsMap = new Map<number, (typeof results)[number]>();
    results.forEach((r: any, idx: number) => resultsMap.set(idx + 1, r));
    const citations = gen.citations.map((c: any) => {
      const r = resultsMap.get(c.chunkIndex);
      return {
        chunkIndex: c.chunkIndex,
        chunkId: r?.chunk.id,
        docId: r?.chunk.docId,
        title: r?.chunk.metadata?.title,
        uri: r?.chunk.metadata?.uri,
        score: r?.score
      };
    });
    res.json({ id, answer: gen.answer, model: gen.model, citations, userId: t.userId });
  } catch (err) { next(err); }
});

app.post('/conversation/:id/stream', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id;
  const { query, topK = 5, temperature, maxTokens, topP, presencePenalty, frequencyPenalty } = req.body || {};
    if (!query) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Missing query' } });
    const t = getThread(id);
    if (!t) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Conversation not found' } });
    const userText = String(query);
    if (!t.userId) {
      const m = userText.match(/^(?:hi|hello|hey|it'?s|i am|i'm|my name is|name's)?\s*([A-Za-z\-']{2,})(?:[\s,!.?]|$)/i);
      const firstName = m ? m[1] : undefined;
      if (firstName) {
        const newUserId = 'u_' + Math.random().toString(36).slice(2, 10);
        setThreadUser(id, newUserId);
        profiles.set(newUserId, { userId: newUserId, firstName });
      }
    }
    addMessage(id, { role: 'user', content: userText });
    const { alpha, beta, gamma } = config.retrieval;
    const mem = t.userId ? getMemory(t.userId) : undefined;
    if (t.userId) decayPreferences(t.userId);
    const detailed = await searchDetailed(query, topK, t.userId, { alpha, beta, gamma });
  const results = detailed.map(d => ({ chunk: d.chunk, score: d.score }));
  const prompt = await buildPersonalizedPrompt(query, results, t.userId);
    const history = getHistory(id);
    // SSE setup
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    const controller = new AbortController();
    req.on('close', () => controller.abort());
    const resultsMap = new Map<number, (typeof results)[number]>();
    results.forEach((r: any, idx: number) => resultsMap.set(idx + 1, r));
  for await (const chunk of streamChatAnswer(prompt, history, { temperature, maxTokens, topP, presencePenalty, frequencyPenalty })) {
      if (controller.signal.aborted) break;
      if (chunk.type === 'start') {
        const citations = (chunk.citations || []).map((c: any) => {
          const r = resultsMap.get(c.chunkIndex);
          return {
            chunkIndex: c.chunkIndex,
            chunkId: r?.chunk.id,
            docId: r?.chunk.docId,
            title: r?.chunk.metadata?.title,
            uri: r?.chunk.metadata?.uri,
            score: r?.score
          };
        });
        res.write(`event: start\n`);
        res.write(`data: ${JSON.stringify({ model: config.chat.model, citations, userId: t.userId })}\n\n`);
      } else if (chunk.type === 'token') {
        res.write(`event: token\n`);
        res.write(`data: ${JSON.stringify({ token: chunk.data })}\n\n`);
      } else if (chunk.type === 'done') {
        res.write(`event: done\n`);
        res.write(`data: {}\n\n`);
      } else if (chunk.type === 'error') {
        res.write(`event: error\n`);
        res.write(`data: ${JSON.stringify({ message: chunk.data })}\n\n`);
      }
    }
    // After stream, finalize and store assistant message (regenerate once for cache consistency)
  const final = await generateChatAnswer(prompt, history, { temperature, maxTokens, topP, presencePenalty, frequencyPenalty });
    addMessage(id, { role: 'assistant', content: final.answer });
    res.end();
  } catch (err) { next(err); }
});

app.get('/memory', (_req: Request, res: Response) => {
  res.json({ memories: listMemories() });
});

app.post('/memory', (req: Request, res: Response) => {
  const { userId, traits } = req.body || {};
  if (!userId) throw new ValidationError('Missing userId');
  upsertMemory({ userId, traits: traits || {} });
  res.json({ ok: true });
});

// Dynamic config endpoints (admin only)
app.get('/admin/config', (_req: Request, res: Response) => {
  res.json({ current: currentRuntimeConfig(), history: listConfigHistory() });
});

app.post('/admin/config', (req: Request, res: Response) => {
  try {
    const patch = req.body || {};
    const updated = updateRuntimeConfig(patch);
    res.json({ ok: true, updated });
  } catch (err: any) {
    return res.status(400).json({ error: { code: 'CONFIG_INVALID', message: err.message } });
  }
});

app.get('/dedup/stats', (_req: Request, res: Response) => {
  res.json(dedupStats());
});

// Feedback endpoint: user marks which chunks were helpful
app.post('/feedback', (req: Request, res: Response) => {
  const { userId, helpful } = req.body || {};
  if (!userId) throw new ValidationError('Missing userId');
  if (!Array.isArray(helpful) || !helpful.length) throw new ValidationError('Provide non-empty helpful array');
  // helpful: [{ chunkId, categoryIds: [] }]
  const updated = recordFeedback(userId, helpful);
  res.json({ ok: true, preferredCategories: updated.preferredCategories });
});

// Metrics endpoint
app.get('/metrics', (_req: Request, res: Response) => {
  const uptimeMs = Date.now() - metrics.lastReset;
  res.json({
    uptimeMs,
    requests: metrics.requests,
    retrievalCacheHits: metrics.retrievalCacheHits,
    generationCacheHits: metrics.generationCacheHits,
    rerankApplied: metrics.rerankApplied,
    rateLimitDenied: metrics.rateLimitDenied,
    rerankEnabled: config.rerank.enabled
  });
});

// Text-to-Speech endpoint (Hugging Face)
app.post('/tts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { text, format, parameters } = req.body || {};
    if (!text || typeof text !== 'string') return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Missing text' } });
    if (!config.voice.hf.apiToken || !config.voice.hf.ttsModel) {
      return res.status(400).json({ error: { code: 'TTS_NOT_CONFIGURED', message: 'Voice is not configured. Set HUGGINGFACE_API_TOKEN and HF_TTS_MODEL.' } });
    }
    const audio = await synthesizeSpeech(text, (format || 'mp3'), parameters);
    res.setHeader('Content-Type', `audio/${format || 'mp3'}`);
    res.send(audio);
  } catch (err) { next(err); }
});

// Generate answer then return speech audio
app.post('/generate/voice', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { query, userId, topK = 5, temperature, maxTokens, format = 'mp3', parameters } = req.body || {};
    if (!query) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Missing query' } });
    if (!config.voice.hf.apiToken || !config.voice.hf.ttsModel) {
      return res.status(400).json({ error: { code: 'TTS_NOT_CONFIGURED', message: 'Voice is not configured. Set HUGGINGFACE_API_TOKEN and HF_TTS_MODEL.' } });
    }
    let results: Array<{ chunk: any; score: number }> = [];
    if (config.content.retrievalEnabled) {
      const { alpha, beta, gamma } = config.retrieval;
      const mem = userId ? getMemory(userId) : undefined;
      if (userId) decayPreferences(userId);
      const detailed = await searchDetailed(query, topK, userId, { alpha, beta, gamma });
      results = detailed.map(d => ({ chunk: d.chunk, score: d.score }));
    } else {
      results = [];
    }
    const prompt = await buildPersonalizedPrompt(query, results, userId);
    const gen = await generateAnswer(prompt, { temperature, maxTokens });
    const audio = await synthesizeSpeech(gen.answer, format, parameters);
    res.setHeader('Content-Type', `audio/${format}`);
    res.send(audio);
  } catch (err) { next(err); }
});

// Error handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof z.ZodError) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: err.errors.map(e => e.message).join('; ') } });
  }
  const status = err instanceof AppError ? err.status : 500;
  const code = err instanceof AppError ? err.code : 'INTERNAL_ERROR';
  logger.error({ err }, 'Request error');
  res.status(status).json({ error: { code, message: err.message || 'Unexpected error' } });
});

function startServer(port: number, attemptsLeft = 5) {
  const server = app.listen(port, () => {
    logger.info(`Server listening on :${port}`);
  });
  server.on('error', (err: any) => {
    if (err?.code === 'EADDRINUSE' && attemptsLeft > 0) {
      const nextPort = port + 1;
      logger.warn(`Port ${port} in use, trying ${nextPort}...`);
      setTimeout(() => startServer(nextPort, attemptsLeft - 1), 200);
    } else {
      logger.error({ err }, 'Failed to start server');
      process.exit(1);
    }
  });
}

startServer(config.port);

// Optional: auto-ingest transcripts from a folder on startup
// Track auto-ingest progress for visibility
const autoIngestProgress: {
  enabled: boolean;
  expected: number;
  processed: number;
  failed: number;
  lastFile?: string;
  startedAt?: string;
  finishedAt?: string;
} = { enabled: Boolean(config.content.autoIngestDir), expected: 0, processed: 0, failed: 0 };

(async () => {
  try {
    const dir = config.content.autoIngestDir;
    if (!dir) return;
    const abs = path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
    if (!fs.existsSync(abs)) return;
    const files = fs.readdirSync(abs).filter(f => f.endsWith('.txt'));
    if (!files.length) return;
    autoIngestProgress.startedAt = new Date().toISOString();
    autoIngestProgress.expected = files.length;
    autoIngestProgress.processed = 0;
    autoIngestProgress.failed = 0;
    logger.info({ dir: abs, count: files.length }, 'Auto-ingesting transcripts');
    for (const f of files) {
      try {
        const txtPath = path.join(abs, f);
        const transcript = fs.readFileSync(txtPath, 'utf-8');
        const sidePath = txtPath.replace(/\.txt$/, '.json');
        let meta: any = {};
        if (fs.existsSync(sidePath)) {
          try { meta = JSON.parse(fs.readFileSync(sidePath, 'utf-8')); } catch {}
        }
        const raw = await ingestTranscript(transcript, { title: meta.title || path.basename(f, '.txt'), audioUri: meta.audioUri, metadata: meta.metadata });
        const chunks = toChunks(raw, { maxTokens: 450, overlapTokens: 60 });
        await indexChunks(chunks);
        autoIngestProgress.processed += 1;
        autoIngestProgress.lastFile = f;
        logger.info({ file: f, chunks: chunks.length }, 'Auto-ingested transcript');
      } catch (e: any) {
        autoIngestProgress.failed += 1;
        autoIngestProgress.lastFile = f;
        logger.warn({ file: f, err: e?.message }, 'Failed to auto-ingest transcript');
      }
    }
    autoIngestProgress.finishedAt = new Date().toISOString();
    logger.info({ processed: autoIngestProgress.processed, failed: autoIngestProgress.failed }, 'Auto-ingest complete');
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'Auto-ingest initialization failed');
  }
})();

// Centralized error handler (returns JSON)
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  const status = typeof err?.status === 'number' ? err.status : 500;
  const code = typeof err?.code === 'string' ? err.code : 'INTERNAL_ERROR';
  const message = err?.message || 'Internal server error';
  logger.error({ err, path: req.path }, 'Request failed');
  res.status(status).json({ error: { code, message } });
});
