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
  // Placeholder fields; server will enrich with docId/title/uri.
}

export interface GeneratedAnswer {
  answer: string;
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

// Simple streaming wrapper: generate full answer then emit tokens.
// For a first iteration we split on whitespace; can later replace with real API stream.
export async function *streamAnswer(prompt: PromptParts, opts: GenerateOptions = {}): AsyncGenerator<StreamChunk> {
  try {
    const full = await generateAnswer(prompt, opts);
    yield { type: 'start', citations: full.citations, model: full.model };
    const tokens = full.answer.split(/(\s+)/); // preserve spaces for natural formatting
    for (const t of tokens) {
      if (!t) continue;
      yield { type: 'token', data: t };
    }
    yield { type: 'done' };
  } catch (err: any) {
    yield { type: 'error', data: err?.message || 'stream_failed' };
  }
}

export async function generateAnswer(prompt: PromptParts, opts: GenerateOptions = {}): Promise<GeneratedAnswer> {
  const apiKey = config.embedding.openaiApiKey; // reuse OPENAI_API_KEY
  const model = config.chat.model;
  if (!apiKey) {
    // Fallback stub: combine top context snippet with a Maxwell-styled summary.
    const firstLines = prompt.context.split(/\n/).slice(0, 3).join(' ');
  const answer = `Leadership Insight: ${firstLines.slice(0, 300)} ... (stubbed; provide OPENAI_API_KEY for real generation) [#1]`;
  // Include at least one inline marker to exercise citation extraction.
  const citations = mergeCitationSources(extractContextCitations(prompt.context), extractAnswerInlineCitations(answer));
  return { answer, citations, model: 'stub-local' };
  }
  try {
    const sys = prompt.system;
    const userContent = [
      'Context:',
      prompt.context,
      'User Query:',
      prompt.user,
  'Instructions: Respond as John C. Maxwell in first person, be concise and practical, and cite chunk numbers inline like [#1], [#2] when you use the context. End with one short reflective question.'
    ].join('\n\n');
    const res = await postChatWithRetry({
      model,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: userContent }
      ],
      temperature: opts.temperature ?? 0.8,
      max_tokens: opts.maxTokens ?? 400,
      top_p: opts.topP ?? 0.9,
      presence_penalty: opts.presencePenalty ?? 0.1,
      frequency_penalty: opts.frequencyPenalty ?? 0.2
    }, apiKey);
  const answer = res.data?.choices?.[0]?.message?.content || 'No answer produced.';
  const citations = mergeCitationSources(extractContextCitations(prompt.context), extractAnswerInlineCitations(answer));
  return { answer, citations, model };
  } catch (err: any) {
    const s = sanitizeAxiosError(err as AxiosError);
    logger.error({ error: s }, 'Generation failed');
    // Graceful fallback for transient network errors to avoid breaking UX
    if (s.isNetworkError) {
      const firstLines = prompt.context.split(/\n/).slice(0, 3).join(' ');
      const answer = `Leadership Insight: ${firstLines.slice(0, 300)} ... (temporary offline; showing cached context) [#1]`;
      const citations = mergeCitationSources(extractContextCitations(prompt.context), extractAnswerInlineCitations(answer));
      return { answer, citations, model: 'stub-local' };
    }
    throw new Error('Generation API error');
  }
}

// Conversational generation with chat history using role-based messages.
export async function generateChatAnswer(prompt: PromptParts, history: ChatMessage[], opts: GenerateOptions = {}): Promise<GeneratedAnswer> {
  const apiKey = config.embedding.openaiApiKey;
  const model = config.chat.model;
  if (!apiKey) {
    const lastUser = [...history].reverse().find(m => m.role === 'user')?.content || prompt.user;
    const answer = `Coach: Let's explore that together. ${lastUser.slice(0, 160)} — Here are a few principles to consider based on the references above. [#1] (stubbed; set OPENAI_API_KEY for real generation)`;
    const citations = mergeCitationSources(extractContextCitations(prompt.context), extractAnswerInlineCitations(answer));
    return { answer, citations, model: 'stub-local' };
  }
  const sys = prompt.system;
  // Build final user turn including retrieval context and instructions
  const finalUser = [
    'Context:',
    prompt.context,
    'User Query:',
    prompt.user,
  'Instructions: Respond as John C. Maxwell in first person. Be concise and practical, cite chunk numbers inline like [#1], [#2] when you use the context, and end with one short reflective question.'
  ].join('\n\n');
  // Filter out any system messages from provided history; we provide our own system prompt
  const prior = history.filter(m => m.role === 'user' || m.role === 'assistant');
  try {
    const res = await postChatWithRetry({
      model,
      messages: [
        { role: 'system', content: sys },
        ...prior,
        { role: 'user', content: finalUser }
      ],
      temperature: opts.temperature ?? 0.8,
      max_tokens: opts.maxTokens ?? 400,
      top_p: opts.topP ?? 0.9,
      presence_penalty: opts.presencePenalty ?? 0.1,
      frequency_penalty: opts.frequencyPenalty ?? 0.2
    }, apiKey);
    const answer = res.data?.choices?.[0]?.message?.content || 'No answer produced.';
    const citations = mergeCitationSources(extractContextCitations(prompt.context), extractAnswerInlineCitations(answer));
    return { answer, citations, model };
  } catch (err: any) {
    const s = sanitizeAxiosError(err as AxiosError);
    logger.error({ error: s }, 'Conversational generation failed');
    if (s.isNetworkError) {
      const lastUser = [...history].reverse().find(m => m.role === 'user')?.content || prompt.user;
      const answer = `Coach (offline): Let's explore that. ${lastUser.slice(0, 160)} — Here are a few principles to consider based on the references above. [#1]`;
      const citations = mergeCitationSources(extractContextCitations(prompt.context), extractAnswerInlineCitations(answer));
      return { answer, citations, model: 'stub-local' };
    }
    throw new Error('Generation API error');
  }
}

export async function *streamChatAnswer(prompt: PromptParts, history: ChatMessage[], opts: GenerateOptions = {}): AsyncGenerator<StreamChunk> {
  try {
    const full = await generateChatAnswer(prompt, history, opts);
    yield { type: 'start', citations: full.citations, model: full.model };
    for (const t of full.answer.split(/(\s+)/).filter(Boolean)) {
      yield { type: 'token', data: t };
    }
    yield { type: 'done' };
  } catch (err: any) {
    yield { type: 'error', data: err?.message || 'stream_failed' };
  }
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
  const all = [...a, ...b];
  const dedup = new Map<number, GeneratedCitation>();
  for (const c of all) dedup.set(c.chunkIndex, c);
  return Array.from(dedup.values()).sort((x, y) => x.chunkIndex - y.chunkIndex);
}

export { extractAnswerInlineCitations }; // exported for testing if needed

// --- Internals: axios retry + sanitization ---

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

async function postChatWithRetry(body: ChatCompletionsBody, apiKey: string) {
  const instance = axios.create({
    baseURL: 'https://api.openai.com',
    timeout: 30_000,
    // Disable env proxy auto-detection which can cause ECONNRESET with misconfigured proxies
    proxy: false,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
  });
  const maxAttempts = 3;
  let attempt = 0;
  let lastErr: any;
  while (attempt < maxAttempts) {
    try {
      return await instance.post('/v1/chat/completions', body);
    } catch (err: any) {
      const axErr = err as AxiosError;
      lastErr = axErr;
      // Retry on network-level/transient issues
      const retriable = isNetworkAxiosError(axErr) || (axErr.response?.status === 429) || (axErr.response?.status && axErr.response.status >= 500);
      attempt++;
      if (!retriable || attempt >= maxAttempts) break;
      const backoff = 500 * Math.pow(2, attempt - 1);
      await sleep(backoff);
    }
  }
  throw lastErr;
}

function isNetworkAxiosError(err: AxiosError): boolean {
  const networkCodes = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNABORTED']);
  return !!(err.code && networkCodes.has(err.code)) || (!err.response && !!err.message);
}

function sanitizeAxiosError(err: AxiosError) {
  const out: any = {
    message: err.message,
    code: err.code,
    status: err.response?.status,
    isNetworkError: isNetworkAxiosError(err)
  };
  // Include small response snippet for debugging (but avoid large payloads)
  if (err.response && typeof err.response.data === 'string') {
    out.responseSnippet = String(err.response.data).slice(0, 200);
  }
  return out;
}
