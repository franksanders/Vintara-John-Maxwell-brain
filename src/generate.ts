import axios, { AxiosError } from 'axios';
import { config } from './config';
import { logger } from './logger';
import { PromptParts } from './prompt';

export interface GenerateOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
}

export interface GeneratedCitation {
  chunkIndex: number; // 1-based index in context ordering
}

export interface GeneratedAnswer {
  answer: string;       // clean spoken text — no [#N] markers
  rawAnswer: string;    // original text with inline markers (for citation extraction)
  citations: GeneratedCitation[];
  model: string;
}

export interface StreamChunk {
  type: 'start' | 'token' | 'done' | 'error';
  data?: string;
  citations?: GeneratedCitation[];
  model?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Strip [#N] citation markers from the spoken answer — they are for internal use only. */
function stripCitationMarkers(text: string): string {
  return text.replace(/\[#\d+\]/g, '').replace(/\s{2,}/g, ' ').trim();
}

export async function *streamAnswer(prompt: PromptParts, opts: GenerateOptions = {}): AsyncGenerator<StreamChunk> {
  const apiKey = config.embedding.openaiApiKey;
  const model = config.chat.model;

  if (!apiKey) {
    // Stub fallback
    const full = await generateAnswer(prompt, opts);
    yield { type: 'start', citations: full.citations, model: full.model };
    for (const t of full.answer.split(/(\s+)/).filter(Boolean)) {
      yield { type: 'token', data: t };
    }
    yield { type: 'done' };
    return;
  }

  try {
    const { messages } = buildMessages(prompt);
    const instance = makeAxiosInstance(apiKey);
    const res = await instance.post('/v1/chat/completions', {
      model,
      messages,
      temperature: opts.temperature ?? 0.72,
      max_tokens: opts.maxTokens ?? 600,
      top_p: opts.topP ?? 0.9,
      presence_penalty: opts.presencePenalty ?? 0.1,
      frequency_penalty: opts.frequencyPenalty ?? 0.3,
      stream: true,
    }, { responseType: 'stream' });

    let accumulated = '';
    let citationsYielded = false;

    yield { type: 'start', citations: [], model };

    await new Promise<void>((resolve, reject) => {
      res.data.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().split('\n').filter((l: string) => l.trim());
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') { resolve(); return; }
          try {
            const parsed = JSON.parse(payload);
            const delta = parsed?.choices?.[0]?.delta?.content;
            if (delta) accumulated += delta;
          } catch { /* skip malformed SSE chunk */ }
        }
      });
      res.data.on('end', resolve);
      res.data.on('error', reject);
    });

    // Emit citations once we have the full accumulated text
    const citations = mergeCitationSources(
      extractContextCitations(prompt.context),
      extractAnswerInlineCitations(accumulated)
    );
    if (!citationsYielded) {
      // Re-emit start with full citations
      yield { type: 'start', citations, model };
    }

    // Stream the clean answer token by token
    const clean = stripCitationMarkers(accumulated);
    for (const t of clean.split(/(\s+)/).filter(Boolean)) {
      yield { type: 'token', data: t };
    }
    yield { type: 'done' };
  } catch (err: any) {
    // Fall back to non-streaming on error
    try {
      const full = await generateAnswer(prompt, opts);
      yield { type: 'start', citations: full.citations, model: full.model };
      for (const t of full.answer.split(/(\s+)/).filter(Boolean)) {
        yield { type: 'token', data: t };
      }
      yield { type: 'done' };
    } catch (e: any) {
      yield { type: 'error', data: e?.message || 'stream_failed' };
    }
  }
}

export async function generateAnswer(prompt: PromptParts, opts: GenerateOptions = {}): Promise<GeneratedAnswer> {
  const apiKey = config.embedding.openaiApiKey;
  const model = config.chat.model;

  if (!apiKey) {
    const firstLines = prompt.context.split(/\n/).slice(0, 3).join(' ');
    const rawAnswer = `I appreciate you reaching out. Let me share a thought that comes to mind: ${firstLines.slice(0, 300)} What aspect of this speaks most directly to your situation right now? [#1]`;
    const answer = stripCitationMarkers(rawAnswer);
    const citations = mergeCitationSources(extractContextCitations(prompt.context), extractAnswerInlineCitations(rawAnswer));
    return { answer, rawAnswer, citations, model: 'stub-local' };
  }

  try {
    const { messages } = buildMessages(prompt);
    const res = await postChatWithRetry({
      model,
      messages,
      temperature: opts.temperature ?? 0.72,
      max_tokens: opts.maxTokens ?? 600,
      top_p: opts.topP ?? 0.9,
      presence_penalty: opts.presencePenalty ?? 0.1,
      frequency_penalty: opts.frequencyPenalty ?? 0.3,
    }, apiKey);

    const rawAnswer = res.data?.choices?.[0]?.message?.content || 'No answer produced.';
    const answer = stripCitationMarkers(rawAnswer);
    const citations = mergeCitationSources(extractContextCitations(prompt.context), extractAnswerInlineCitations(rawAnswer));
    return { answer, rawAnswer, citations, model };
  } catch (err: any) {
    const s = sanitizeAxiosError(err as AxiosError);
    logger.error({ error: s }, 'Generation failed');
    if (s.isNetworkError) {
      const firstLines = prompt.context.split(/\n/).slice(0, 3).join(' ');
      const rawAnswer = `I'm having some trouble connecting right now, but let me share what comes to mind: ${firstLines.slice(0, 300)} What's the most pressing part of this for you? [#1]`;
      const answer = stripCitationMarkers(rawAnswer);
      const citations = mergeCitationSources(extractContextCitations(prompt.context), extractAnswerInlineCitations(rawAnswer));
      return { answer, rawAnswer, citations, model: 'stub-local' };
    }
    throw new Error('Generation API error');
  }
}

export async function generateChatAnswer(prompt: PromptParts, history: ChatMessage[], opts: GenerateOptions = {}): Promise<GeneratedAnswer> {
  const apiKey = config.embedding.openaiApiKey;
  const model = config.chat.model;

  if (!apiKey) {
    const lastUser = [...history].reverse().find(m => m.role === 'user')?.content || prompt.user;
    const rawAnswer = `Let's explore that together. ${lastUser.slice(0, 160)} — I want to understand your situation better first. What's driving that for you right now? [#1]`;
    const answer = stripCitationMarkers(rawAnswer);
    const citations = mergeCitationSources(extractContextCitations(prompt.context), extractAnswerInlineCitations(rawAnswer));
    return { answer, rawAnswer, citations, model: 'stub-local' };
  }

  const { messages } = buildMessages(prompt);
  const prior = history.filter(m => m.role === 'user' || m.role === 'assistant');
  const allMessages = [messages[0], ...prior, messages[messages.length - 1]];

  try {
    const res = await postChatWithRetry({
      model,
      messages: allMessages,
      temperature: opts.temperature ?? 0.72,
      max_tokens: opts.maxTokens ?? 600,
      top_p: opts.topP ?? 0.9,
      presence_penalty: opts.presencePenalty ?? 0.1,
      frequency_penalty: opts.frequencyPenalty ?? 0.3,
    }, apiKey);

    const rawAnswer = res.data?.choices?.[0]?.message?.content || 'No answer produced.';
    const answer = stripCitationMarkers(rawAnswer);
    const citations = mergeCitationSources(extractContextCitations(prompt.context), extractAnswerInlineCitations(rawAnswer));
    return { answer, rawAnswer, citations, model };
  } catch (err: any) {
    const s = sanitizeAxiosError(err as AxiosError);
    logger.error({ error: s }, 'Conversational generation failed');
    if (s.isNetworkError) {
      const lastUser = [...history].reverse().find(m => m.role === 'user')?.content || prompt.user;
      const rawAnswer = `I'm momentarily offline, but let me say this much: ${lastUser.slice(0, 160)} — that tells me something important about where you are. What would help most right now? [#1]`;
      const answer = stripCitationMarkers(rawAnswer);
      const citations = mergeCitationSources(extractContextCitations(prompt.context), extractAnswerInlineCitations(rawAnswer));
      return { answer, rawAnswer, citations, model: 'stub-local' };
    }
    throw new Error('Generation API error');
  }
}

export async function *streamChatAnswer(prompt: PromptParts, history: ChatMessage[], opts: GenerateOptions = {}): AsyncGenerator<StreamChunk> {
  const apiKey = config.embedding.openaiApiKey;
  const model = config.chat.model;

  if (!apiKey) {
    const full = await generateChatAnswer(prompt, history, opts);
    yield { type: 'start', citations: full.citations, model: full.model };
    for (const t of full.answer.split(/(\s+)/).filter(Boolean)) {
      yield { type: 'token', data: t };
    }
    yield { type: 'done' };
    return;
  }

  try {
    const { messages } = buildMessages(prompt);
    const prior = history.filter(m => m.role === 'user' || m.role === 'assistant');
    const allMessages = [messages[0], ...prior, messages[messages.length - 1]];

    const instance = makeAxiosInstance(apiKey);
    const res = await instance.post('/v1/chat/completions', {
      model,
      messages: allMessages,
      temperature: opts.temperature ?? 0.72,
      max_tokens: opts.maxTokens ?? 600,
      top_p: opts.topP ?? 0.9,
      presence_penalty: opts.presencePenalty ?? 0.1,
      frequency_penalty: opts.frequencyPenalty ?? 0.3,
      stream: true,
    }, { responseType: 'stream' });

    yield { type: 'start', citations: [], model };

    let accumulated = '';
    await new Promise<void>((resolve, reject) => {
      res.data.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().split('\n').filter((l: string) => l.trim());
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') { resolve(); return; }
          try {
            const parsed = JSON.parse(payload);
            const delta = parsed?.choices?.[0]?.delta?.content;
            if (delta) accumulated += delta;
          } catch { /* skip */ }
        }
      });
      res.data.on('end', resolve);
      res.data.on('error', reject);
    });

    const citations = mergeCitationSources(
      extractContextCitations(prompt.context),
      extractAnswerInlineCitations(accumulated)
    );
    yield { type: 'start', citations, model };

    const clean = stripCitationMarkers(accumulated);
    for (const t of clean.split(/(\s+)/).filter(Boolean)) {
      yield { type: 'token', data: t };
    }
    yield { type: 'done' };
  } catch (err: any) {
    try {
      const full = await generateChatAnswer(prompt, history, opts);
      yield { type: 'start', citations: full.citations, model: full.model };
      for (const t of full.answer.split(/(\s+)/).filter(Boolean)) {
        yield { type: 'token', data: t };
      }
      yield { type: 'done' };
    } catch (e: any) {
      yield { type: 'error', data: e?.message || 'stream_failed' };
    }
  }
}

/** Build the final messages array for chat completions. */
function buildMessages(prompt: PromptParts): { messages: ChatMessage[] } {
  const userContent = [
    prompt.context ? 'Context from Maxwell teachings:\n' + prompt.context : '',
    'User message:\n' + prompt.user,
  ].filter(Boolean).join('\n\n');

  return {
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: userContent },
    ],
  };
}

function extractContextCitations(context: string): GeneratedCitation[] {
  const regex = /\[#(\d+)\s+score=/g;
  const out: GeneratedCitation[] = [];
  let m;
  while ((m = regex.exec(context)) !== null) {
    const idx = parseInt(m[1], 10);
    if (!isNaN(idx)) out.push({ chunkIndex: idx });
  }
  return out;
}

function extractAnswerInlineCitations(answer: string): GeneratedCitation[] {
  const regex = /\[#(\d+)\]/g;
  const seen = new Set<number>();
  const out: GeneratedCitation[] = [];
  let m;
  while ((m = regex.exec(answer)) !== null) {
    const idx = parseInt(m[1], 10);
    if (!isNaN(idx) && !seen.has(idx)) {
      seen.add(idx);
      out.push({ chunkIndex: idx });
    }
  }
  return out;
}

function mergeCitationSources(a: GeneratedCitation[], b: GeneratedCitation[]): GeneratedCitation[] {
  const dedup = new Map<number, GeneratedCitation>();
  for (const c of [...a, ...b]) dedup.set(c.chunkIndex, c);
  return Array.from(dedup.values()).sort((x, y) => x.chunkIndex - y.chunkIndex);
}

export { extractAnswerInlineCitations };

// --- Internals ---

type ChatCompletionsBody = {
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature: number;
  max_tokens: number;
  top_p?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
};

function sleep(ms: number) { return new Promise(res => setTimeout(res, ms)); }

function makeAxiosInstance(apiKey: string) {
  return axios.create({
    baseURL: 'https://api.openai.com',
    timeout: 60_000,
    proxy: false,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  });
}

async function postChatWithRetry(body: ChatCompletionsBody, apiKey: string) {
  const instance = makeAxiosInstance(apiKey);
  const maxAttempts = 3;
  let attempt = 0;
  let lastErr: any;
  while (attempt < maxAttempts) {
    try {
      return await instance.post('/v1/chat/completions', body);
    } catch (err: any) {
      const axErr = err as AxiosError;
      lastErr = axErr;
      const retriable = isNetworkAxiosError(axErr) || axErr.response?.status === 429 || (axErr.response?.status && axErr.response.status >= 500);
      attempt++;
      if (!retriable || attempt >= maxAttempts) break;
      await sleep(500 * Math.pow(2, attempt - 1));
    }
  }
  throw lastErr;
}

function isNetworkAxiosError(err: AxiosError): boolean {
  const codes = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNABORTED']);
  return !!(err.code && codes.has(err.code)) || (!err.response && !!err.message);
}

function sanitizeAxiosError(err: AxiosError) {
  const out: any = {
    message: err.message,
    code: err.code,
    status: err.response?.status,
    isNetworkError: isNetworkAxiosError(err),
  };
  if (err.response && typeof err.response.data === 'string') {
    out.responseSnippet = String(err.response.data).slice(0, 200);
  }
  return out;
}
