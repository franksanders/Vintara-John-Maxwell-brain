import dotenv from 'dotenv';
dotenv.config();

export type VectorDBKind = 'qdrant' | 'pinecone' | 'memory';
export type EmbeddingProvider = 'openai' | 'azure-openai' | 'ollama' | 'local';

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  cors: {
    // Comma-separated list of allowed origins, e.g. http://localhost:5173,https://your-ngrok-url.ngrok.io
    origins: (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
  },
  embedding: {
    provider: (process.env.EMBEDDING_PROVIDER as EmbeddingProvider) || 'openai',
    model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
    altModel: process.env.EMBEDDING_ALT_MODEL || 'text-embedding-3-large',
    openaiApiKey: process.env.OPENAI_API_KEY,
    azure: {
      endpoint: process.env.AZURE_OPENAI_ENDPOINT || '',
      apiKey: process.env.AZURE_OPENAI_API_KEY || '',
      apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-02-15-preview',
      embeddingDeployment: process.env.AZURE_EMBEDDING_DEPLOYMENT || ''
    },
    batchSize: parseInt(process.env.EMBEDDING_BATCH_SIZE || '32', 10),
    maxRetries: parseInt(process.env.EMBEDDING_MAX_RETRIES || '5', 10),
    retryBaseMs: parseInt(process.env.EMBEDDING_RETRY_BASE_MS || '200', 10),
    evalInterBatchDelayMs: parseInt(process.env.EVAL_EMBED_SLEEP_MS || '0', 10),
    globalMinIntervalMs: parseInt(process.env.EMBEDDING_GLOBAL_MIN_INTERVAL_MS || '0', 10),
    cachePath: process.env.EMBEDDING_CACHE_PATH || '.cache/embeddings.json'
  },
  chat: {
    model: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini'
  },
  voice: {
    hf: {
      apiToken: process.env.HUGGINGFACE_API_TOKEN || '',
      ttsModel: process.env.HF_TTS_MODEL || '',
      parameters: process.env.HF_TTS_PARAMETERS || '',
      endpoint: process.env.HF_TTS_ENDPOINT || '',
      altToken: process.env.HF_TOKEN || ''
    }
  },
  context: {
    dateTimeEnabled: process.env.DATETIME_ENABLED ? process.env.DATETIME_ENABLED !== 'false' : true,
    weatherEnabled: process.env.WEATHER_ENABLED === 'true', // off by default
    weatherCacheMs: parseInt(process.env.WEATHER_CACHE_MS || '900000', 10) // 15 min
  },
  content: {
    autoIngestDir: process.env.AUTO_INGEST_DIR || '', // optional: directory to auto-ingest .txt transcripts on startup
    personaPath: process.env.PERSONA_PATH || '', // optional: markdown/plaintext file to enrich the Maxwell persona
    retrievalEnabled: process.env.RETRIEVAL_ENABLED === undefined ? true : process.env.RETRIEVAL_ENABLED !== 'false',
    personaSnippetsEnabled: process.env.PERSONA_SNIPPETS_ENABLED ? process.env.PERSONA_SNIPPETS_ENABLED === 'true' : true
  },
  vector: {
    kind: (process.env.VECTOR_DB as VectorDBKind) || 'memory',
    collection: process.env.VECTOR_COLLECTION || 'maxwell_knowledge',
    qdrant: {
      url: process.env.QDRANT_URL || 'http://localhost:6333',
      apiKey: process.env.QDRANT_API_KEY || '',
    },
    pinecone: {
      apiKey: process.env.PINECONE_API_KEY || '',
      index: process.env.PINECONE_INDEX || 'maxwell-brain',
      host: process.env.PINECONE_INDEX_HOST || '',
    }
  }
  , retrieval: {
    alpha: parseFloat(process.env.RETRIEVE_ALPHA || '0.7'),
    beta: parseFloat(process.env.RETRIEVE_BETA || '0.2'),
    gamma: parseFloat(process.env.RETRIEVE_GAMMA || '0.1')
  },
  rerank: {
    enabled: (process.env.RERANK_ENABLED === 'true') || false,
    lambda: parseFloat(process.env.RERANK_LAMBDA || '0.5'), // blend between original score and reranker score
    topN: parseInt(process.env.RERANK_TOPN || '25', 10) // number of candidates to rerank (>= final topK)
  },
  auth: {
    adminKey: process.env.ADMIN_API_KEY || 'dev-admin-key',
    // Comma-separated list of allowed API keys for clients
    apiKeys: (process.env.API_KEYS || '').split(',').map(k => k.trim()).filter(Boolean),
    // Rate limiting settings (token bucket)
    rateLimitPerMin: parseInt(process.env.RATE_LIMIT_PER_MIN || '60', 10),
    burst: parseInt(process.env.RATE_LIMIT_BURST || '20', 10)
  }
} as const;
