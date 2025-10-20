import { UserMemory } from './types';
import { MAXWELL_CATEGORIES } from './maxwell_taxonomy';

// Personalization tuning constants
const FEEDBACK_INCREMENT = 0.15; // weight added per positive feedback
const MAX_WEIGHT = 2.5; // cap for a category
const DECAY_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const DECAY_FACTOR = 0.9; // multiplicative decay applied to categories with no recent reinforcement

const store = new Map<string, UserMemory>();

export function getMemory(userId: string): UserMemory | undefined {
  return store.get(userId);
}

export function upsertMemory(mem: UserMemory): void {
  const existing = store.get(mem.userId);
  // Merge preferredCategories if both exist (overwrite by categoryId)
  let preferred = mem.preferredCategories || existing?.preferredCategories || [];
  if (existing && mem.preferredCategories) {
    const idx = new Map(preferred.map(p => [p.categoryId, p.weight]));
    for (const p of mem.preferredCategories) idx.set(p.categoryId, p.weight);
    preferred = Array.from(idx.entries()).map(([categoryId, weight]) => ({ categoryId, weight }));
  }
  store.set(mem.userId, { ...existing, ...mem, preferredCategories: preferred });
}

export function listMemories(): UserMemory[] {
  return Array.from(store.values());
}

/** Record positive feedback for specific chunks (with their taxonomy tags). */
export function recordFeedback(userId: string, feedback: Array<{ chunkId: string; categoryIds: string[] }>): UserMemory {
  const mem = getMemory(userId) || { userId, traits: {}, preferredCategories: [], feedbackHistory: [], lastDecayAt: Date.now() };
  const now = Date.now();
  mem.feedbackHistory = mem.feedbackHistory || [];
  // Build weight map
  const weightMap = new Map<string, number>((mem.preferredCategories || []).map(p => [p.categoryId, p.weight]));
  for (const f of feedback) {
    mem.feedbackHistory.push({ timestamp: now, chunkId: f.chunkId, categoryIds: f.categoryIds });
    for (const cat of f.categoryIds) {
      const current = weightMap.get(cat) ?? (MAXWELL_CATEGORIES.find(c => c.id === cat)?.weight || 0);
      const updated = Math.min(MAX_WEIGHT, current + FEEDBACK_INCREMENT);
      weightMap.set(cat, updated);
    }
  }
  mem.preferredCategories = Array.from(weightMap.entries()).map(([categoryId, weight]) => ({ categoryId, weight }));
  store.set(userId, mem);
  return mem;
}

/** Apply decay to categories not reinforced within DECAY_INTERVAL_MS. */
export function decayPreferences(userId: string): UserMemory | undefined {
  const mem = getMemory(userId);
  if (!mem) return undefined;
  const now = Date.now();
  if (mem.lastDecayAt && now - mem.lastDecayAt < DECAY_INTERVAL_MS) return mem; // skip if interval not reached
  const recentCutoff = now - DECAY_INTERVAL_MS;
  const reinforced = new Set<string>();
  for (const f of mem.feedbackHistory || []) {
    if (f.timestamp >= recentCutoff) {
      for (const c of f.categoryIds) reinforced.add(c);
    }
  }
  const updated = (mem.preferredCategories || []).map(p => {
    if (reinforced.has(p.categoryId)) return p; // keep weight
    const decayed = Math.max(0, p.weight * DECAY_FACTOR);
    return { categoryId: p.categoryId, weight: decayed };
  });
  mem.preferredCategories = updated;
  mem.lastDecayAt = now;
  store.set(userId, mem);
  return mem;
}

/** Convenience: get current preference map. */
export function preferenceMap(userId: string): Map<string, number> {
  const mem = getMemory(userId);
  return new Map((mem?.preferredCategories || []).map(p => [p.categoryId, p.weight]));
}
