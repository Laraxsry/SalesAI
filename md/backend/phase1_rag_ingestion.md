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
   - [x] `POST /knowledge` persists a `KnowledgeSource` and enqueues
     `ingest-source` ([`routes/knowledge.js`](../../apps/api/src/routes/knowledge.js)).
   - [x] `POST /knowledge/upload-url` returns a presigned PUT (S3/MinIO) for
     binary sources; client uploads, then registers the source with `fileKey`.

2. **Ingestion worker** ([`worker-ingestion`](../../apps/worker-ingestion))
   - Extraction by modality (see `handlers/ingest-source.js`):
     - [x] text: as-is; document: pdf-parse; image: `describeImage`;
       video: ffmpeg audio -> transcribe (Whisper); url: fetch + strip;
     - [ ] mammoth (docx desteği yok, sadece pdf-parse var); keyframe descriptions eksik; api modality stub.
   - [ ] Emits `ingestion:progress` / `ingestion:ready` over Socket.IO (Socket.IO emit yok).

3. **RAG core** ([`@repo/rag`](../../packages/rag))
   - [x] `chunkText()` overlapping chunks.
   - [x] `ingestSource()` embeds + upserts; sets source status (failed da handle ediyor).
   - [x] `retrieve()` embeds query + vector search filtered by `productId`.
   - [x] `getVectorStore()` -> Mongo Atlas (default) or Qdrant.

4. **Index management**
   - [x] `npm run db:indexes` creates `vector_index`
     ([`sync-indexes.js`](../../packages/database/scripts/sync-indexes.js)).
   - [x] `EMBEDDING_DIM` must match the embedding model (3072 for
     `text-embedding-3-large`).

5. **Grounded chat endpoint**
   - [x] `POST /agents/:id/chat` (text): retrieve -> assemble context -> `getLLM().complete()`
     -> return answer + citations.
   - [ ] Store turns in `messages` (chat endpoint'te mesaj kaydetme yok, sadece agent-worker'da var).

6. **Quality upgrades**
   - [ ] Hybrid search (dense + text/BM25) and cross-encoder rerank.
   - [ ] Per-(product, normalized query) retrieval cache in Redis.
   - [ ] Golden-set grounding eval.

---

## Acceptance criteria

- [x] Upload a PDF + a demo video + a URL; all reach `status: ready`.
- [x] `POST /agents/:id/chat` answers using retrieved chunks and cites `sourceId`s.
- [x] Switching `VECTOR_STORE=qdrant` works without code changes.
- [ ] Ingestion failures set `status: failed` with an error and are retried (failed set ediyor ama retry mekanizması yok).

---

## Risks

- **Video transcription cost/time** — run async, show progress, cache results.
- **SPA crawling** — needs Playwright rendering; budget time per page.
- **Embedding dim mismatch** — guard at boot; document `EMBEDDING_DIM`.
