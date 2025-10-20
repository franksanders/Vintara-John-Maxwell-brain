import { config } from './config';

interface Bucket {
  tokens: number;
  lastRefill: number; // epoch ms
}

const buckets = new Map<string, Bucket>();

function refill(bucket: Bucket, now: number) {
  const perMinute = config.auth.rateLimitPerMin;
  const ratePerMs = perMinute / 60_000;
  const elapsed = now - bucket.lastRefill;
  const add = elapsed * ratePerMs;
  if (add > 0) {
    bucket.tokens = Math.min(perMinute + config.auth.burst, bucket.tokens + add);
    bucket.lastRefill = now;
  }
}

export function checkRateLimit(key: string): { ok: boolean; retryAfter?: number } {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: config.auth.rateLimitPerMin + config.auth.burst, lastRefill: now };
    buckets.set(key, bucket);
  }
  refill(bucket, now);
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { ok: true };
  }
  // Compute time until next token
  const perMinute = config.auth.rateLimitPerMin;
  const ratePerMs = perMinute / 60_000;
  const needed = 1 - bucket.tokens;
  const waitMs = needed / ratePerMs;
  return { ok: false, retryAfter: Math.ceil(waitMs / 1000) };
}

export function remainingTokens(key: string): number {
  const bucket = buckets.get(key);
  if (!bucket) return config.auth.rateLimitPerMin + config.auth.burst;
  refill(bucket, Date.now());
  return Math.floor(bucket.tokens);
}
