# John Maxwell Voice Coach Brain — Requirements

Date: 2025-10-14

## Goal & Scope
Build a retrieval-augmented coaching service that answers user questions in the voice and principles of John Maxwell, grounded in curated source materials. Initial scope: ingestion, cleaning/chunking, embeddings, vector store, retrieval, prompt assembly, and HTTP API. Out of scope for v0: LLM text generation (prompt is returned), advanced auth, full UI.

## Functional Requirements
- Ingestion
  - Fetch web pages (HTML → text) and accept raw text payloads.
  - Extendable to PDF/audio later (stubs/TODOs in code).
- Parsing/Cleaning/Chunking
  - Normalize whitespace, remove boilerplate, and create overlapping chunks.
  - Configurable chunk size and overlap.
- Embedding & Vector DB
  - Pluggable embedding providers (Local, OpenAI stub).
  - Vector store interface with in-memory default; enable Qdrant/Pinecone later.
- Retrieval
  - Given a query, return top-k chunks with cosine similarity scores.
- Prompt Builder
  - Assemble a system prompt that instructs a Maxwell-like voice.
  - Compose context block from retrieved chunks with scores and doc references.
  - Include TODO hooks for Maxwell-specific “primary vs secondary” scoring.
- API / Service Layer
  - Endpoints: /health, /ingest, /query, /metadata, /memory (get/post).
  - JSON I/O. Return prompt parts for client-side or separate LLM generation.
- Memory / User Context
  - In-memory store keyed by userId; upsert and list.
  - TODO hooks for user affinity and topic taxonomy.
- Error Handling / Logging / Config
  - Centralized errors with HTTP codes. Pino logging. .env config.

## Non-Functional Requirements
- Performance & Latency
  - Ingestion and indexing should handle moderate articles (<100k chars) under 5s locally.
  - Query+retrieval should respond under 300ms with in-memory vector store for topK<=20.
- Modularity
  - Clear interfaces for embedder and vector store to swap implementations.
- Testability
  - Pure functions for cleaning/chunking. Deterministic local embeddings for tests.
- Observability
  - Structured logs; error codes; health endpoint.

## Data Requirements
- Chunk size: default 400 tokens; overlap 40 tokens (configurable via request body or constants).
- Embedding: default Local (fake) 128-d. OpenAI stub set to 256-d.
- Vector DB: default in-memory collection name from env: VECTOR_COLLECTION.
- Metadata: each chunk carries docId, order, and optional title/uri.

## Interface Requirements
- POST /ingest
  - Body: { url?: string, text?: string, chunk?: { maxTokens?: number, overlapTokens?: number } }
  - Response: { docId: string, chunks: number }
- POST /query
  - Body: { query: string, topK?: number, userId?: string }
  - Response: { prompt: { system: string, context: string, user: string }, results: Array<{ score:number, chunkId:string, docId:string }> }
- GET /health → { status, env, vector, embedding }
- GET /metadata → { collection }
- GET /memory → { memories: UserMemory[] }
- POST /memory → { userId: string, traits: object } → { ok: true }

## Milestones & Phases
- M1: Scaffold, config, logging, error handling [done]
- M2: Ingestion (web/text), parsing, chunking [done]
- M3: Embeddings + in-memory vector store, retrieval [done]
- M4: Prompt builder (Maxwell voice hooks) [done]
- M5: API endpoints and wiring [done]
- M6: Add Qdrant/Pinecone adapters [next]
- M7: Maxwell-specific scoring taxonomy; primary vs secondary [next]
- M8: Integration tests and load tests [next]
- M9: LLM generation integration (OpenAI/Azure/Ollama) [later]

## Todo / Backlog (as of 2025-10-14)
- Implement OpenAI embeddings with env-configured model [done]
- Implement Qdrant vector store with lazy collection create [done]
- Add simple reranker combining vector score + lexical overlap [done]
- Validate /ingest and /query requests with zod [done]
- Implement Pinecone adapter (requires PINECONE_INDEX_HOST and PINECONE_API_KEY) [done]
- Maxwell-specific scoring taxonomy: weights, tagging, retrieval & prompt ordering [done]
- PDF and audio ingestion pipelines (respecting permissions) [next]
- Retrieval eval set + metrics (Recall@K, MRR) and tuning [next]
 - Retrieval evaluation harness (corpus + queries + metrics script) [done]
- Parameter tuning: optimize alpha/beta/gamma weights using eval results [done]
 - Add reranker variants: cross-encoder / LLM judge [later]
- Streaming generation responses (SSE/WebSocket) [later]
- Inline citations in generated answer [later]
- Caching layer for repeated queries [later]
 - PDF ingestion via pdfBase64 and pdf-parse extraction [done]