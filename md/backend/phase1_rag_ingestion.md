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
   - [x] `Product.websiteUrl` girildiğinde, aynı URL otomatik olarak bir `KnowledgeSource`
     (`type: 'url'`) olarak da oluşturulup ingestion kuyruğuna alınsın. `POST /products` ve
     `PATCH /products/:id`'de `websiteUrl` set/güncellendiğinde `syncWebsiteUrlSource()` yardımcı
     fonksiyonu çağrılır: kaynak yoksa oluşturulur + `enqueue('ingest-source', ...)`; URL değiştiyse
     güncellenir + re-ingest edilir; URL silinirse kaynak `status:'disabled'` yapılır (geçmiş
     chunk'lar korunur, liste görünümünden filtrelenir). İdempotent: `meta.autoCreated:true` ile
     etiketlenen auto-source sayesinde aynı URL için birden fazla kaynak oluşmaz.
   - [x] `KnowledgeSource type: 'url'/'api'` crawl'ı artık `Product.demoSession`'ı kullanıyor —
     önceden `extractFromUrl()` tamamen kimliksiz bir Playwright context açıyordu, auth
     gerektiren sayfalarda login ekranını/public görünümü indeksliyordu. `apps/worker-ingestion/src/extractors/url.js`
     artık opsiyonel `auth` parametresi alıyor, `handlers/ingest-source.js` bunu `Product.demoSession`'dan
     çözüp geçiyor. **Güncelleme:** `auth` artık cookie/localStorage snapshot değil,
     `{ loginUrl?, email, password, selectors? }` — crawl başlamadan önce `@repo/screen`'in
     paylaşılan `loginWithCredentials()` fonksiyonuyla sitenin gerçek giriş formu dolduruluyor
     (bkz. `md/backend/phase3_screen_intelligence.md` — aynı sebep: snapshot yöntemi access
     token süresi (genelde ~15dk) dolunca bozuluyordu).
   - [x] `extractFromUrl()` artık tek sayfa yerine **aynı-origin BFS crawl** yapıyor:
     kök URL'den başlayıp sayfadaki `<a href>` linklerini (SPA route'ları dahil, gerçek
     `<a>` etiketine render edilen client-side router linkleri de yakalanıyor) `URL_CRAWL_MAX_PAGES`
     (varsayılan 10, env ile ayarlanabilir) sayfaya kadar takip ediyor, tek bir authenticated
     browser context'i (giriş bir kez yapılıp tüm sayfalarda oturum kalıcı kalıyor) üzerinden.
     Her sayfa `checkSSRFUrl` ile ayrıca doğrulanıyor (kötü/ulaşılamaz link
     crawl'ı durdurmuyor, sadece atlanıyor). Sonuç, `[Page: <url>]` etiketiyle tek bir `text`'te
     birleştirilip mevcut `ingestSource()` akışına (tek çağrı, değişmeden) veriliyor —
     `ingestSource()`'un `deleteBySource()` çağırması nedeniyle sayfa başına ayrı `ingestSource()`
     çağrısı yapılmadı (önceki sayfanın chunk'larını silerdi). Seller artık panelin tek bir
     giriş URL'ini vermesi yeterli; alt-route'ları tek tek eklemesine gerek yok.
   - [x] **Collapsed nav / accordion sidebar desteği** — büyük panel'lerde ("Reports" gibi bir
     ana başlığın altında bir düzine alt sayfa) alt linkler tıklanıp genişletilmeden DOM'a hiç
     render edilmiyordu, crawler bunları göremiyordu. `extractPage()` artık her sayfada link
     taramadan önce `expandCollapsedNav()` çağırıyor — `[aria-expanded="false"]` toggle'larını
     bulup tıklıyor (bounded, `URL_CRAWL_MAX_EXPAND_CLICKS`, varsayılan 25), böylece nested
     sidebar linkleri açığa çıkıp `<a href>` taramasına dahil oluyor. `URL_CRAWL_MAX_PAGES`
     varsayılanı da 10 → 40'a çıkarıldı (büyük panel'ler için yetersizdi).
   - [x] **404/5xx sayfalar artık indexlenmiyor** — `extractPage()` `page.goto()`'nun response
     status'unü kontrol ediyor, 400+ dönen sayfaları (kırık link, silinmiş route) `ok:false`
     ile işaretleyip atlıyor — hem hata sayfasının boilerplate metni knowledge'a girmiyor hem de
     o sayfadan link takip edilmiyor (zaten yok).

2. **Ingestion worker** ([`worker-ingestion`](../../apps/worker-ingestion))
   - Extraction by modality (see `handlers/ingest-source.js`):
     - [x] text: as-is; document: pdf-parse; image: `describeImage`;
       video: ffmpeg audio -> transcribe (Whisper); url: fetch + strip;
     - [x] mammoth (docx desteği eklendi); parser seçimi `mimeType` → uzantı önceliğiyle yapılıyor
       (PDF yanlışlıkla .docx olarak yüklense bile doğru parser devreye girer).
     - [x] Video ingestion artık keyframe/vision adımını da içeriyor: ffmpeg `.screenshots()` ile
       videodan `VIDEO_MAX_KEYFRAMES` (varsayılan 6, env ile ayarlanabilir — video süresine göre
       literal 1/sn değil, maliyeti sınırlamak için sabit sayıda eşit aralıklı kare) çıkarılıyor,
       her kare `sharp` ile 1024px genişliğe küçültülüp JPEG'e çevrilip `describeImage()`'a
       gönderiliyor (image kaynak tipiyle aynı fonksiyon). Kare açıklamaları başarısız olursa
       (`Promise.allSettled`) o kare sessizce atlanıyor, tüm ingestion başarısız olmuyor. Transcript +
       `[Frame N]: ...` açıklamaları tek `text` alanında birleştirilip chunk'lanıyor; `meta.transcript`
       hâlâ ham transkripti tutuyor. Bu, konuşma/anlatım içermeyen (sessiz ekran kaydı) videolarda
       Whisper'ın ürettiği alakasız "halüsinasyon" metninin tek bilgi kaynağı olmasını engelliyor —
       videonun görsel içeriği (hangi ekranlar gezildi) artık bilgi tabanına giriyor.
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
