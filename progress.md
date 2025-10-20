### Reranker Integration (Date: 2025-10-14)
Implemented optional pseudo cross-encoder reranker with config flags (RERANK_ENABLED, RERANK_LAMBDA, RERANK_TOPN). Retrieval pipeline now conditionally re-embeds concatenated query+chunk to refine ordering before generation. Updated server endpoints to use detailed retrieval path and blend final scores. Next: add evaluation metrics (NDCG, citation accuracy) to quantify improvement.

### Metrics Utilities & Endpoint (Date: 2025-10-14)
Added evaluation utilities (NDCG, citation accuracy functions) in `src/eval/metrics.ts` and a basic `/metrics` endpoint exposing counts: requests, cache hits, rerank applications, uptime. Provides groundwork for future Prometheus integration and quantitative assessment of reranker impact.

### Rate Limiting & API Key Auth (Date: 2025-10-14)
Integrated API key authentication (header `x-api-key`) with configurable allowed keys and admin key. Added token bucket rate limiting (configurable rate/min & burst) excluding admin traffic, returning 429 with retry-after when exceeded. Metrics now track `rateLimitDenied`. Dev mode permits absence of keys if none configured.

### Architecture Diagrams (Date: 2025-10-14)
Inserted Mermaid sequence and component diagrams into README along with a data flow summary. Clarifies relationships among ingestion, retrieval blend, reranker, prompt builder, generation, caching, auth, and metrics components.

### Memory Personalization (Date: 2025-10-14)
Added feedback endpoint `/feedback` allowing users to submit helpful chunk IDs with taxonomy categories. Implemented weight increments, capping, and 24h decay for unstimulated categories. Retrieval now applies decay before scoring. Extended `UserMemory` with feedbackHistory and timestamps.

### Chunk Deduplication (Date: 2025-10-14)
Implemented MinHash-based deduplication during ingestion. Near-duplicate chunks (Jaccard est >= threshold) are skipped from indexing and annotated with duplicate metadata. Added `/dedup/stats` endpoint and ingestion response now includes `dedupStats`.

### Dynamic Config Endpoint (Date: 2025-10-14)
Added `/admin/config` GET/POST endpoints (admin key protected) enabling live adjustments to retrieval weights (alpha/beta/gamma) and reranker parameters (enabled, lambda, topN). Changes are validated, snapshotted to `config.snapshots.json`, and immediately used in subsequent retrieval.
# Project Progress Log

| Date       | Milestone/Module         | Status   | Notes                                            | Next Steps |
|------------|---------------------------|----------|--------------------------------------------------|------------|
| 2025-10-14 | Scaffold generated        | Done     | Node+TS structure, config, logging, errors.      | Wire vector DB adapters |
| 2025-10-14 | Requirements drafted      | Done     | requirements.md added with scope & milestones.   | Review & refine with stakeholders |
| 2025-10-14 | Ingest module stubbed     | Done     | Web/text ingestion, cleaning+chunking.           | Add PDF/audio ingestion |
| 2025-10-14 | Embedding & retrieval     | Done     | Local embedder + in-memory vector store.         | Add Qdrant/Pinecone implementations |
| 2025-10-14 | Prompt builder            | Done     | Maxwell voice system prompt; context assembly.   | Insert primary/secondary scoring |
| 2025-10-14 | API endpoints             | Done     | /health, /ingest, /query, /metadata, /memory.    | Add auth, rate limiting |
| 2025-10-14 | Maxwell taxonomy + scoring| Done     | Categories added; tag & weighted retrieval active| Add evaluation harness |
| 2025-10-14 | Retrieval eval harness    | Done     | Corpus+queries+metrics script (avgRecall=1, MRR≈0.389) | Tune alpha/beta/gamma |
| 2025-10-14 | Parameter tuning harness  | Done     | Grid search added; best MRR≈0.556 (alpha=0.5,beta=0.1,gamma=0.15) | Expand corpus |
| 2025-10-14 | PDF ingestion             | Done     | /ingest supports pdfBase64 via pdf-parse          | Add audio ingestion |
| 2025-10-14 | Generation endpoint       | Done     | /generate wires retrieval + prompt + OpenAI chat  | Streaming + citations |
| 2025-10-14 | Streaming + citations     | Done     | /generate/stream SSE + enriched citation output   | Add caching layer |

## Notes
- Maxwell-specific logic TODOs are annotated in code (prompt.ts, memory.ts).
- When enabling real embeddings (OpenAI), set OPENAI_API_KEY and adjust provider/model.
