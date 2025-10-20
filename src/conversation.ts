import { v4 as uuidv4 } from 'uuid';
import { ChatMessage } from './generate';
import fs from 'fs';
import path from 'path';

export interface ConversationThread {
  id: string;
  userId?: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

// Simple in-memory store. For production, swap to Redis or DB.
const threads = new Map<string, ConversationThread>();

// Persistence
const STORE_PATH = process.env.CONVERSATION_STORE_PATH || path.resolve('.cache/conversations.json');
let dirty = false;
let saving = false;

function ensureDir(p: string) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadStore() {
  try {
    if (!fs.existsSync(STORE_PATH)) return;
    const raw = fs.readFileSync(STORE_PATH, 'utf-8');
    const arr = JSON.parse(raw) as ConversationThread[];
    threads.clear();
    for (const t of arr) {
      // Basic validation
      if (!t.id || !Array.isArray(t.messages)) continue;
      threads.set(t.id, t);
    }
  } catch {
    // ignore load errors
  }
}

function scheduleSave() {
  if (saving || !dirty) return;
  saving = true;
  setTimeout(() => {
    try {
      if (!dirty) return;
      ensureDir(STORE_PATH);
      const arr = Array.from(threads.values());
      fs.writeFileSync(STORE_PATH, JSON.stringify(arr));
      dirty = false;
    } catch {
      // ignore save errors
    } finally {
      saving = false;
    }
  }, 100);
}

// Load existing threads on module import
loadStore();

export function createThread(userId?: string, seed?: ChatMessage[]): ConversationThread {
  const id = uuidv4();
  const now = Date.now();
  const t: ConversationThread = { id, userId, messages: seed ? [...seed] : [], createdAt: now, updatedAt: now };
  threads.set(id, t);
  dirty = true;
  scheduleSave();
  return t;
}

export function getThread(id: string): ConversationThread | undefined {
  return threads.get(id);
}

export function setThreadUser(id: string, userId: string): ConversationThread | undefined {
  const t = threads.get(id);
  if (!t) return undefined;
  t.userId = userId;
  t.updatedAt = Date.now();
  dirty = true;
  scheduleSave();
  return t;
}

export function addMessage(id: string, msg: ChatMessage): ConversationThread | undefined {
  const t = threads.get(id);
  if (!t) return undefined;
  t.messages.push(msg);
  t.updatedAt = Date.now();
  trimThread(t);
  dirty = true;
  scheduleSave();
  return t;
}

export function getHistory(id: string, maxTurns = 8): ChatMessage[] {
  const t = threads.get(id);
  if (!t) return [];
  // Return last N messages (excluding any system messages from storage by convention)
  const msgs = t.messages.filter(m => m.role === 'user' || m.role === 'assistant');
  return msgs.slice(-maxTurns);
}

function trimThread(t: ConversationThread, maxTokensApprox = 4000, maxMessages = 24): void {
  // Crude trimming: cap message count and approximate token budget by char length.
  while (t.messages.length > maxMessages) t.messages.shift();
  let total = t.messages.reduce((s, m) => s + m.content.length, 0);
  while (total > maxTokensApprox && t.messages.length > 4) {
    const m = t.messages.shift();
    total -= m ? m.content.length : 0;
  }
}

export function listThreads(limit = 50) {
  return Array.from(threads.values()).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit).map(t => ({ id: t.id, userId: t.userId, updatedAt: t.updatedAt }));
}
