# Backend — Phase 1: Knowledge Ingestion & RAG

> Goal: sellers add knowledge of any modality; the system makes it retrievable;
> a text chat endpoint answers questions grounded in it.
> Outcome: ask a question via REST and get a grounded answer with citations.

---

## Scope

- `Product`, `KnowledgeSource`, `KnowledgeChunk` models.
- Upload flow (presigned S3) for documents/images/video.
- `apps/worker-ingestion`: extract -> chunk -> embed -> upsert.
- `@repo/rag`: chunking, ingestion, retrieval, vector store strategy.
- Atlas Vector Search index (`vector_index`).
- Text chat Q&A endpoint (no realtime yet) as the first provable slice.

---

## Tasks

1. **Knowledge intake**
   - `POST /knowledge` persists a `KnowledgeSource` and enqueues
     `ingest-source` ([`routes/knowledge.js`](../../apps/api/src/routes/knowledge.js)).
   - `POST /knowledge/upload-url` returns a presigned PUT (S3/MinIO) for
     binary sources; client uploads, then registers the source with `fileKey`.

2. **Ingestion worker** ([`worker-ingestion`](../../apps/worker-ingestion))
   - Extraction by modality (see `handlers/ingest-source.js`):
     - text: as-is; document: pdf-parse/mammoth; image: `describeImage`;
       video: ffmpeg audio -> transcribe + keyframe descriptions; url: fetch +
       strip (Playwright render for SPAs); api: index OpenAPI/MCP descriptors.
   - Emits `ingestion:progress` / `ingestion:ready` over Socket.IO.

3. **RAG core** ([`@repo/rag`](../../packages/rag))
   - `chunkText()` overlapping chunks.
   - `ingestSource()` embeds + upserts; sets source status.
   - `retrieve()` embeds query + vector search filtered by `productId`.
   - `getVectorStore()` -> Mongo Atlas (default) or Qdrant.

4. **Index management**
   - `npm run db:indexes` creates `vector_index`
     ([`sync-indexes.js`](../../packages/database/scripts/sync-indexes.js)).
   - `EMBEDDING_DIM` must match the embedding model (3072 for
     `text-embedding-3-large`).

5. **Grounded chat endpoint**
   - `POST /agents/:id/chat` (text): retrieve -> assemble context -> `getLLM().complete()`
     with the `search_knowledge` tool -> return answer + citations.
   - Store turns in `messages` (even pre-realtime) to seed eval data.

6. **Quality upgrades**
   - Hybrid search (dense + text/BM25) and cross-encoder rerank.
   - Per-(product, normalized query) retrieval cache in Redis.
   - Golden-set grounding eval.

---

## Acceptance criteria

- Upload a PDF + a demo video + a URL; all reach `status: ready`.
- `POST /agents/:id/chat` answers using retrieved chunks and cites `sourceId`s.
- Switching `VECTOR_STORE=qdrant` works without code changes.
- Ingestion failures set `status: failed` with an error and are retried.

---

## Risks

- **Video transcription cost/time** — run async, show progress, cache results.
- **SPA crawling** — needs Playwright rendering; budget time per page.
- **Embedding dim mismatch** — guard at boot; document `EMBEDDING_DIM`.
