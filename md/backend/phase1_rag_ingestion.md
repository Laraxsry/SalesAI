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
   - [x] `KnowledgeSource` model ve `KnowledgeSourceInput` contract'ına opsiyonel `mimeType` alanı eklendi;
     client yüklediği dosyanın gerçek MIME tipini gönderir, worker uzantı yerine bunu kullanır.
   - [x] MinIO bucket (`salesai-uploads`) API ayağa kalkarken `ensureBucket()` ile otomatik oluşturuluyor
     (önceden bucket yoksa presigned URL çalışmıyordu).

2. **Ingestion worker** ([`worker-ingestion`](../../apps/worker-ingestion))
   - Extraction by modality (see `handlers/ingest-source.js`):
     - [x] text: as-is; document: pdf-parse; image: `describeImage`;
       video: ffmpeg audio -> transcribe (Whisper); url: fetch + strip;
     - [x] mammoth (docx desteği eklendi); parser seçimi `mimeType` → uzantı önceliğiyle yapılıyor
       (PDF yanlışlıkla .docx olarak yüklense bile doğru parser devreye girer).
   - [x] Emits `ingestion:progress` / `ingestion:ready` over Socket.IO (Redis pub/sub üzerinden `publishEvent()` ile her aşamada emit ediliyor).

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
   - [x] Store turns in `messages` — her chat turunda `user` ve `assistant` mesajları `agentId` + `channel:'text'` ile kaydediliyor; citations `meta.citations`'da.

6. **Quality upgrades**
   - [x] Hybrid search (dense + text/BM25) and cross-encoder rerank — Atlas `text_index` eklendi, sonuçlar `@xenova/transformers` bge-reranker-base ile yeniden sıralanıyor.
   - [x] Per-(product, normalized query) retrieval cache in Redis — `retrieve` fonksiyonunda `rag:cache:{productId}:{normalizedQuery}:{topK}` formatında 24 saatlik önbellek eklendi.
   - [x] Golden-set grounding eval — `packages/rag/scripts/eval.js` scripti eklendi (faithfulness ve relevancy testleri yapıyor).

---

## Acceptance criteria

- [x] Upload a PDF + a demo video + a URL; all reach `status: ready`.
- [x] `POST /agents/:id/chat` answers using retrieved chunks and cites `sourceId`s.
- [x] Switching `VECTOR_STORE=qdrant` works without code changes.
- [x] Ingestion failures set `status: failed` with an error and are retried (BullMQ: `attempts:3`, `backoff: exponential 2s` — `packages/queue/src/index.js:33-35`).

---

## Risks

- **Video transcription cost/time** — run async, show progress, cache results.
- **SPA crawling** — needs Playwright rendering; budget time per page.
- **Embedding dim mismatch** — guard at boot; document `EMBEDDING_DIM`.
