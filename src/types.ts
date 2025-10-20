export type DocumentSource = 'web' | 'pdf' | 'text' | 'audio' | 'manual';

export interface RawDocument {
  id: string;
  source: DocumentSource;
  uri?: string;
  title?: string;
  author?: string;
  publishedAt?: string;
  content: string;
  metadata?: Record<string, any>;
}

export interface Chunk {
  id: string;
  docId: string;
  content: string;
  tokens: number;
  order: number;
  metadata?: Record<string, any>;
}

export interface EmbeddingResult {
  id: string; // chunk id
  vector: number[];
  dim: number;
}

export interface RetrievalResult {
  chunk: Chunk;
  score: number;
}

export interface UserMemory {
  userId: string;
  traits: Record<string, any>;
  preferredCategories?: { categoryId: string; weight: number }[]; // user-specific boosts
  feedbackHistory?: Array<{ timestamp: number; chunkId: string; categoryIds: string[] }>;
  lastDecayAt?: number;
}

export interface QueryRequest {
  userId?: string;
  query: string;
  topK?: number;
}

export interface QueryResponse {
  query: string;
  topK: number;
  results: Array<{
    chunkId: string;
    content: string;
    score: number;
    docId: string;
    metadata?: Record<string, any>;
  }>;
}

export interface UserProfile {
  userId: string;
  firstName?: string;
  timezone?: string; // IANA tz like "America/Chicago"
  latitude?: number;
  longitude?: number;
  locale?: string; // e.g., en-US
  regionName?: string; // human label for location (optional)
  // Optional personalization fields
  role?: string; // e.g., Executive, Entrepreneur, IC
  seniority?: string; // e.g., VP, Director, Founder
  industry?: string; // e.g., SaaS, Healthcare
  teamSize?: number; // approximate team size
  goals?: string[]; // top goals
  currentChallenge?: string; // one-liner current challenge
  tonePref?: 'direct' | 'empathetic';
  brevityPref?: 'short' | 'normal';
  cadencePref?: string; // e.g., weekly check-in
  stakeholders?: string[]; // key people
  deadlines?: Array<{ name: string; date: string }>; // ISO date strings preferred
  boundaries?: string[]; // topics to avoid, etc.
}
