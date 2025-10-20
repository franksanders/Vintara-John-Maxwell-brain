// Simple in-memory LRU cache for query retrieval & generation results.
// Key strategy: normalized JSON of {query, userId, topK, alpha,beta,gamma, preferredCategories(sorted)}.

interface CacheEntry<V> { key: string; value: V; size: number; ts: number; }

export class LRUCache<V> {
  private map = new Map<string, CacheEntry<V>>();
  private order: string[] = [];
  constructor(private maxEntries = 200, private maxTotalSize = 5_000_000) {}

  private totalSize = 0;

  get(key: string): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    e.ts = Date.now();
    // Move key to end
    this.order = this.order.filter(k => k !== key);
    this.order.push(key);
    return e.value;
  }

  set(key: string, value: V): void {
    const serializedSize = JSON.stringify(value).length;
    if (serializedSize > this.maxTotalSize / 2) return; // skip oversized single entry
    if (this.map.has(key)) this.delete(key);
    const entry: CacheEntry<V> = { key, value, size: serializedSize, ts: Date.now() };
    this.map.set(key, entry);
    this.order.push(key);
    this.totalSize += serializedSize;
    this.evict();
  }

  delete(key: string): void {
    const e = this.map.get(key);
    if (!e) return;
    this.map.delete(key);
    this.order = this.order.filter(k => k !== key);
    this.totalSize -= e.size;
  }

  private evict(): void {
    while (this.order.length > this.maxEntries || this.totalSize > this.maxTotalSize) {
      const oldest = this.order.shift();
      if (!oldest) break;
      this.delete(oldest);
    }
  }
}

export function makeRetrievalKey(params: {
  query: string; userId?: string; topK: number; alpha: number; beta: number; gamma: number; preferredCategories?: { categoryId: string; weight: number }[];
}): string {
  const normCats = (params.preferredCategories || [])
    .slice()
    .sort((a, b) => a.categoryId.localeCompare(b.categoryId))
    .map(c => `${c.categoryId}:${c.weight.toFixed(3)}`);
  return JSON.stringify({
    q: params.query.toLowerCase().trim(),
    u: params.userId || '',
    k: params.topK,
    a: params.alpha,
    b: params.beta,
    g: params.gamma,
    pc: normCats
  });
}
