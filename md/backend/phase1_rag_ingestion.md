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
   - [x] `ensureBucket()` artık bucket'a CORS politikası da uyguluyor (`ensureBucketCors()`,
     `packages/storage/src/index.js`) — presigned GET/PUT URL'leri tarayıcıya doğrudan veriliyor
     (dosya upload'ı ve Knowledge detay modalının PDF/görsel/video önizlemesi), ama S3/MinIO'da
     CORS bucket'ın kendi özelliği, `apps/api`'nin Express `cors()` middleware'inden tamamen ayrı —
     biri diğerini kapsamıyor. CORS'suz bucket'a yapılan tarayıcı `fetch()`'i, presigned imza hiç
     kontrol edilmeden "No 'Access-Control-Allow-Origin' header" hatasıyla engelleniyordu. Aynı
     `CORS_ORIGIN` allowlist'i kullanıyor (dev'de boşsa `*`, prod'da boşsa hiçbir origin — Express
     middleware'iyle aynı davranış). **Mevcut ortamlarda etkili olması için API'nin yeniden
     başlatılması gerekiyor** (politika sadece boot'ta `ensureBucket()` çağrısında uygulanıyor).
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
   - [x] **Zip gruplama** — zip içindeki dosyalar artık gerçek, indekslenmiş bir `parentSourceId`
     ile parent kaynağa bağlanıyor (önceden sadece `meta.zipParent` string'i vardı, şemada
     birinci sınıf bir alan değildi, sorgularda kullanılmıyordu). Console'daki Knowledge listesi
     (`Knowledge.jsx`) artık zip'ten gelen dosyaları parent'ın altında açılır/kapanır bir grup
     ("Zip · N dosya") olarak gösteriyor — büyük zip'ler artık düz listede dağılmıyor
     (bkz. `md/web/phase1_console.md`).
   - [x] **Doküman düzenlemede kısmi re-chunk (token tasarrufu)** — `PATCH /knowledge/:id`
     ile bir kaynağın metnini (text `content` veya document `meta.extractedText`) elle
     düzenleyip kaydetmek, önceden kaynağın TÜM chunk'larını silip metni baştan
     chunk'layıp embed edip audience-classify ediyordu — küçük bir düzeltme bile büyük
     bir dokümanda tüm chunk'ları yeniden embed etmek anlamına geliyordu. Yeni
     `reingestSourceIncremental()` (`packages/rag/src/ingest.js`) sadece gerçekten
     DEĞİŞEN chunk'ları işliyor: `chunkText()` metnin deterministik saf bir fonksiyonu
     olduğu için (offset/pozisyon takibi GEREKMİYOR, şema değişikliği yok), eski ve yeni
     tam metin ayrı ayrı chunk'lanıp iki dizi `diffChunks()` (`packages/rag/src/chunk-diff.js`,
     `diff` paketinin `diffArrays()`'i ile LCS tabanlı) ile karşılaştırılıyor — ortak
     (değişmeyen) chunk'lar hiç dokunulmadan kalıyor, sadece eklenen/çıkarılan chunk'lar
     embed/silinip ekleniyor. **Güvenlik ağı**: DB'deki mevcut chunk'lar `chunkText(eski
     metin)`'in ürettiğiyle (multiset olarak, `multisetEqual()`) eşleşmiyorsa (ör. kaynak bu
     özellikten önce ingest edilmiş), sessizce tam `ingestSource()` yoluna düşülüyor —
     asla yanlış/eksik chunk bırakmıyor, sadece optimizasyonu kaybediyor. Vector store'lara
     (`mongo.store.js`, `qdrant.store.js`) `listBySource()` ve `deleteByIds()` eklendi.
     Unit test: `backend_tests/unit/chunk-diff.mjs`; mock'lu entegrasyon testleri:
     `packages/rag/src/ingest.test.js` (yeni — paket artık vitest ile test ediliyor,
     `packages/agent`'takiyle aynı `@repo/testing/vitest-preset` deseni). **Düzeltme**:
     `getVectorStore()` (`packages/rag/src/stores/index.js`) ham store örneğini değil,
     elle yazılmış sabit bir metod listesi ileten bir facade döndürüyor — yeni
     `listBySource()`/`deleteByIds()` ilk seferde bu facade'a eklenmeyi unutulmuştu
     (`store.listBySource is not a function`, sadece gerçek Mongo'ya karşı ortaya çıktı,
     mock'lu testler yakalayamadı). Facade'a eklendi + `stores/index.test.js` (yeni)
     bundan sonra facade'ın store class'ının HER metodunu ilettiğini garanti ediyor.
   - [x] **Görsel/video açıklamaları artık ürünün diline uyuyor** — `describeImage()`
     (image + video keyframe caption'ları) önceden sabit İngilizce prompt kullanıyordu, PDF/DOCX
     kaynaklar (kaynak metin doğrudan kullanıldığı için) hangi dildeyse öyle kalırken görsel/video
     açıklamaları her zaman İngilizce geliyordu — agent bir görsel chunk'ından bahsederken aniden
     dil değiştirebilirdi. `apps/worker-ingestion/src/handlers/ingest-source.js`'e yeni
     `resolveKnowledgeLanguage(productId)` — ürünün ilk `Agent`'ının `persona.language`'ini
     kullanıyor (yoksa `'en'`) — ve prompt'lara `Describe this image in detail for search, in
     ${language}.` şeklinde ekleniyor. `LANGUAGE_NAMES`/`languageName()` `packages/agent/src/persona.js`'den
     `packages/utils/src/index.js`'e taşındı (tek kaynak, ikisi de aynı haritayı kullanıyor).
   - [x] **URL/API — tekrarlayan nav/header temizliği** — `extractPage()`
     (`apps/worker-ingestion/src/extractors/url.js`) artık her sayfanın metnini satır satır
     (`\n` ile ayrılmış, boş satırlar atılmış) döndürüyor; `extractFromUrl()` tüm sayfalar
     toplandıktan sonra yeni `stripRepeatedBoilerplate()`'i çağırıyor — sayfaların en az
     `URL_CRAWL_BOILERPLATE_THRESHOLD` (varsayılan %60, en az 3 sayfa şartıyla) kadarında
     BİREBİR aynı görünen satırları (sidebar nav, header, oturum açmış kullanıcı bilgisi)
     siliyor, sayfaya özgü içerik kalıyor. DOM selector'üne değil salt istatistiğe dayanıyor
     (hangi satır kaç farklı sayfada geçiyor), bu yüzden herhangi bir müşteri sitesinin DOM
     yapısına özel bir yapılandırma gerektirmiyor. **Sebep**: temizlik olmadan her sayfanın
     metninin büyük kısmı (bazı panellerde neredeyse tamamı) diğer tüm sayfalarla birebir
     aynıydı — hem embedding token'ları boşa gidiyordu hem de vektör araması sayfaları
     ayırt edemiyordu (agent sayfaların gerçek içeriğine hakim olamıyordu). Unit test:
     `backend_tests/unit/strip-repeated-boilerplate.mjs`.
   - [x] **URL/API — sayfa başına chunk gruplama** — `extractFromUrl()`
     (`apps/worker-ingestion/src/extractors/url.js`) artık hem birleştirilmiş `text`'i (`meta.extractedText`
     için, salt görüntüleme) hem de ham `pages: [{url, text}]` dizisini döndürüyor. `ingestSource()`
     (`packages/rag/src/ingest.js`) artık `text` parametresi olarak tek bir string yerine
     `{text, metadata}[]` (segment) dizisi kabul edebiliyor — her segment ayrı ayrı chunk'lanıp
     embed ediliyor, `deleteBySource()` yine tek seferde (baştaki, tüm segmentler için) çağrılıyor.
     `handleIngestSource()`'un `url`/`api` case'i her sayfayı kendi segmenti olarak `{metadata:{pageUrl}}`
     ile geçiyor — sonuç: her `KnowledgeChunk.metadata.pageUrl` hangi sayfadan geldiğini biliyor.
     Yeni `GET /knowledge/:id/chunks` endpoint'i bunları döndürüyor; Console modalı `url`/`api`
     tipinde artık tek bir crawl-metni bloğu yerine, sayfa URL'si başlık + altında o sayfanın
     chunk'ları (genel/teknik etiketiyle) şeklinde gruplu gösteriyor — hem okunabilir hem de
     seller'ın "bu chunk'lar yeterli mi" diye kendi gözüyle denetleyebilmesini sağlıyor.
   - [x] **Knowledge detay/düzenleme** — ingestion sırasında çıkarılan metin
     (transkript/OCR/vision açıklaması/crawl metni) artık `KnowledgeSource.meta.extractedText`'e
     kalıcı yazılıyor (`handlers/ingest-source.js`, `handleIngestSource()` ve
     `ingestZipEntries()` içinde — önceden bu metin hiçbir yerde saklanmıyordu, sadece
     chunk'lanıp embed ediliyordu). Yeni `GET /knowledge/:id/download-url` (presigned dosya
     URL'i, workspace membership kontrolüyle) ve `PATCH /knowledge/:id` (rename / metin
     düzenleme + senkron re-embed / dosya değiştirme + tam pipeline'ı yeniden kuyruğa alma)
     endpoint'leri eklendi (`KnowledgeSourceUpdateInput` contract'ı). Console'da satıra
     tıklayınca açılan detay modalı bunları kullanıyor — bkz. `md/web/phase1_console.md`.
   - [x] `extractDocumentText()` (`packages/rag/src/document-text.js`'e taşındı, önceden
     `apps/worker-ingestion/src/handlers/ingest-source.js`'de tanımlıydı — o dosya artık
     `@repo/rag`'den re-export ediyor, mevcut import'lar bozulmadı) — `apps/api`'nin
     `GET /knowledge/:id/content` backfill'i de aynı fonksiyonu kullanabilsin diye paylaşıldı.
     **Sebep**: `meta.extractedText`'i olmayan eski kaynaklar için chunk'lardan metni yeniden
     birleştirmek (`chunkText()`'in embed öncesi TÜM whitespace'i tek boşluğa indirmesi
     yüzünden — `packages/rag/src/chunk.js`) paragraf yapısını tamamen kaybediyordu, kullanıcıya
     tek satırlık "duvar gibi" metin gösteriyordu. Artık `document` tipi + `fileKey`'i olan
     (zip olmayan) kaynaklarda backfill, dosyayı yeniden indirip `extractDocumentText()` ile
     yeniden çıkarıyor — ingestion'ın ürettiğiyle birebir aynı, paragraf aralarını koruyan metin.
     Chunk-birleştirme sadece dosyaya erişimi olmayan durumlarda (image/video/url/api)
     fallback olarak kalıyor. **Zip çocukları da dahil**: `extractZipMemberText(zipBuffer, entryName)`
     (aynı dosyada) çocuğun `parentSourceId`'sinden PARENT'ın `fileKey`'ini (arşivin kendisi)
     indirip yeniden açıyor, ilgili üyeyi adm-zip ile çıkarıp `extractDocumentText()`'e veriyor —
     zip çocuklarının kendi `fileKey`'i olmasa da (bkz. `ingestZipEntries`), paragraf yapısını
     koruyan tam yeniden-çıkarma standalone dosyalarla aynı şekilde çalışıyor.
   - [x] **URL/API — yorumlanmış sentez katmanı** — crawl edilen ham sayfa metni artık
     olduğu gibi chunk'lanmıyor, üstüne bir yorumlama katmanı ekleniyor: `packages/ai/src/synthesize.js`'deki
     `synthesizePage()` her sayfa için (sayılar/veriler ne anlama geliyor, sayfa ne işe yarıyor
     diye yorumlayan) kısa bir paragraf, `synthesizeOverview()` ise sayfalar arası ilişkilendiren
     tek bir kaynak-geneli özet üretiyor (`gpt-4o-mini`, `classifyAudience()`'la aynı desen,
     non-fatal — hata olursa o sayfa/overview sentezi atlanır). Bunlar ham per-page segment'lerin
     YANINA (`metadata.synthesized:true`) ekleniyor — ham metin site-içi yönlendirme ve tam veri
     erişimi için hâlâ chunk'lanıyor, sentez sadece ek bir katman. `GET /knowledge/:id/chunks`
     artık `synthesized`/`scope` alanlarını da döndürüyor; Console modalı sentez chunk'larını
     ayrı bir rozetle üstte, genel özeti ayrı bir kutuda gösteriyor (bkz. `md/web/phase1_console.md`).
   - [x] **URL/API — tekrar-tarama önleme (link-graph cache)** — bir kaynağın önceki
     ingestion'ında crawl edilmiş sayfalar `KnowledgeSource.meta.crawlIndex.pages`
     (`{[url]: {rawText, links}}`) olarak persist ediliyor; bir sonraki ingestion
     (`extractFromUrl()`'e `previousPages` parametresi) bu URL'leri BİR DAHA ZİYARET ETMİYOR
     — cache'lenen linkleri kuyruğa ekleyip devam ediyor, `MAX_CRAWL_PAGES` kotası sadece
     GERÇEKTEN yeni sayfalara harcanıyor. Motivasyon: login olmadan da büyük ölçüde
     erişilebilen bir site için, demo-oturumu eklenince yapılan re-crawl aynı sayfaları
     sıfırdan taramak yerine kotayı login-sonrası YENİ URL'lere ayırmalı. Sentez de aynı
     mekanizmadan faydalanıyor: bir sayfa cache'ten geldiyse VE dili değişmediyse
     `synthesizePage()` tekrar çağrılmıyor, eski sentez metni (artık `metadata.language`
     ile etiketli) aynen kullanılıyor. **Bilinçli sınır**: cache'ten reuse edilen bir sayfa
     `websiteUrl` değişene kadar bir daha asla yeniden taranmıyor — sitede değişiklik olsa
     bile.
   - [x] **URL/API — sentez artık ürünün diline uyuyor** — `resolveKnowledgeLanguage()`
     ürün oluşturma anında (`POST /products` → `syncWebsiteUrlSource()`) henüz hiç Agent
     olmadığı için ilk crawl hep `'en'` fallback'iyle sentezleniyordu, Agent'ın dili
     sonradan ayarlansa bile bu asla tekrarlanmıyordu. `reingestAutoUrlSource()`
     (`products.js`, önceden sadece `demoSession` değişikliğinde kullanılıyordu) artık
     export ediliyor ve `apps/api/src/routes/agents.js`'den de çağrılıyor: ürünün İLK
     agent'ı oluşturulunca, veya en-erken-oluşturulan agent'ın `persona.language`'i
     değişince, URL kaynağı doğru dille yeniden sentezlenmek üzere kuyruğa alınıyor.
     **Bilinen açık nokta**: gerçek testte dil sorunu tamamen çözülmedi (aşağıdaki
     fencing-token fix'i muhtemel bir yarış durumunu kapatıyor ama kesin doğrulanmadı) —
     ancak agent yanıt dilini DEĞİŞTİRMEDİĞİ için (agent kendi `persona.language`'inde
     konuşuyor, knowledge chunk'ının dili sadece retrieval'da eşleşme kalitesini etkiliyor)
     kullanıcı bunu blocker olarak görmüyor, düşük öncelikli bilinen sınırlama.
   - [x] **URL/API — boş/anlamsız içerik (adaptif bekleme)** — `extractPage()`'in eski
     sabit `waitForTimeout(3000)`'ü, birkaç saniye süren boot/splash-animasyonlu SPA'larda
     (gerçek örnek: bir müşteri sitesinde ~5sn'lik sahte-terminal intro ekranı) gerçek
     içerik render olmadan sayfayı yakalıyordu. Yeni `waitForStableContent()`
     (`apps/worker-ingestion/src/extractors/url.js`) `document.body.innerText` uzunluğunu
     500ms aralıklarla ölçüp art arda 2 ölçüm aynıysa erken çıkıyor, toplamda
     `URL_CRAWL_MAX_WAIT_MS` (varsayılan 8000ms) sınırıyla bekliyor — basit sitelerde eski
     sabit beklemeden bile hızlı, animasyonlu sitelerde gerçek içeriği yakalıyor.
     `MIN_CONTENT_CHARS` altındaki sayfalar için uyarı logu da eklendi.
   - [x] **URL/API — client-side routed navigasyon keşfi** — bazı siteler navigasyonu
     hiç gerçek `<a href>` kullanmadan, `<button>` tıklamalarıyla `history.pushState`
     client-router'ı üzerinden yapıyor (gerçek bir müşteri sitesinde doğrulandı: nav'da
     SIFIR anchor elementi vardı, crawler kök sayfadan öteye hiç geçemiyordu). Yeni
     `discoverClientRoutedLinks()` (`apps/worker-ingestion/src/extractors/url.js`)
     `<nav>`/`<header>` içindeki, metni kısa (`NAV_DISCOVERY_MAX_TEXT_CHARS`) VE eylem
     kelimesi içermeyen (`NAV_DISCOVERY_ACTION_WORDS` — "Demo Talep Et", "Gönder", "Satın
     Al" vb. hariç, yan-etki riski) butonlara tek tek tıklayıp URL değişimini gözlemliyor,
     değişen her URL'i keşfedilmiş link olarak kaydedip orijinal sayfaya geri dönüyor
     (`page.goBack()`). `<a href>` linkleriyle birleştirilip normal BFS'e katılıyor.
     `MAX_NAV_DISCOVERY_CLICKS` (varsayılan 20) ile sınırlı — gerçek bir müşteri sitesinde
     doğrulandı: 1 sayfadan 8 sayfaya çıktı, hiçbir eylem butonuna yanlışlıkla tıklanmadı.
   - [x] **Çakışan ingestion job'ları arasında "en son kazanır" garantisi** — ingestion
     kuyruğunun concurrency'si (3, `apps/worker-ingestion/src/main.js`) yüzünden aynı
     kaynak için art arda tetiklenen iki ingestion job'ı (ör. ürün oluşturma + hemen
     ardından ilk Agent oluşturma) paralel çalışıp HANGİSİ SONRA YAZARSA O KAZANMA riski
     taşıyordu — yeni (doğru dilde) sonuç, eski (İngilizce) job daha geç bitirirse
     sessizce ezilebiliyordu. Yeni `KnowledgeSource.meta.ingestGeneration` sayacı +
     `apps/api/src/lib/ingestion.js`'deki `enqueueIngestion()` (her enqueue çağrısı
     atomik `$inc` ile sayacı artırıp job payload'ına `generation` olarak koyuyor, TÜM
     ingest-source enqueue call site'ları buraya taşındı) + `handleIngestSource()`'un
     sonucu yazmadan hemen önce bu sayacı tekrar kontrol etmesi (daha yeni bir job bu
     arada bitmişse sonucu yazmıyor) — standart fencing-token deseni, hangi job'ın önce
     bittiğinden bağımsız olarak en son İSTENEN ingestion her zaman kazanıyor.

2. **Ingestion worker** ([`worker-ingestion`](../../apps/worker-ingestion))
   - Extraction by modality (see `handlers/ingest-source.js`):
     - [x] text: as-is; document: pdf-parse; image: `describeImage`;
       video: ffmpeg audio -> transcribe (Whisper); url: fetch + strip;
     - [x] mammoth (docx desteği eklendi); parser seçimi `mimeType` → uzantı önceliğiyle yapılıyor
       (PDF yanlışlıkla .docx olarak yüklense bile doğru parser devreye girer; PDF sadece gerçek
       `%PDF-` imzası varsa denenir; .md/.txt/.mdx düz metin olarak okunur; .zip arşivleri açılıp
       her desteklenen üye ayrı bir KnowledgeSource olarak ingest edilir — `adm-zip`, entry/boyut limitleri ile). (.json/.xml de düz metin olarak kabul ediliyor artık, hem tekil kaynak hem zip üyesi olarak)
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
   - [x] Her chunk, ingestion sırasında otomatik olarak `general`/`technical` diye
     etiketleniyor (`packages/rag/src/ingest.js` içindeki `classifyAudience()` — kaynak başına
     TEK bir ucuz LLM (`gpt-4o-mini`) çağrısıyla, tüm chunk'lar tek seferde; seller'dan hiçbir
     manuel işlem istemiyor, sınıflandırma başarısız olursa sessizce `general`'a düşüyor).
     Retrieval bunu ziyaretçinin teknik seviyesine göre önceliklendirmek için kullanıyor
     (bkz. madde 3 ve 5).
   - [x] `embedBatch()` (`packages/ai/src/embeddings.js`) artık `@repo/resilience` ile 30sn
     timeout + 3 deneme'ye sarmalı — önceden rate-limit'e takılan bir embedding isteği hiç
     resolve/reject olmadan sonsuza kadar asılı kalıp kaynağı (özellikle bir zip içindeki tek
     bir dosyayı, zip'in geri kalanının hiç işlenmemesine sebep olacak şekilde) `processing`
     durumunda süresiz bırakabiliyordu.

3. **RAG core** ([`@repo/rag`](../../packages/rag))
   - [x] `chunkText()` overlapping chunks.
   - [x] `ingestSource()` embeds + upserts; sets source status (failed da handle ediyor).
   - [x] `retrieve()` embeds query + vector search filtered by `productId`.
   - [x] `getVectorStore()` -> Mongo Atlas (default) or Qdrant.
   - [x] `retrieve()` artık opsiyonel `preferredAudience` (`general`/`technical`) parametresi
     alıyor — sonuçlar filtrelenmiyor, cross-encoder rerank sonrası skorlar ziyaretçinin
     tercih ettiği seviyeye göre boost/penalty (×1.15/×0.9) ile yeniden sıralanıyor (bilgi
     kaybı yok, sadece öncelik). Redis cache key'ine de dahil edildi.

4. **Index management**
   - [x] `npm run db:indexes` creates `vector_index`
     ([`sync-indexes.js`](../../packages/database/scripts/sync-indexes.js)).
   - [x] `EMBEDDING_DIM` must match the embedding model (3072 for
     `text-embedding-3-large`).

5. **Grounded chat endpoint**
   - [x] `POST /agents/:id/chat` (text): retrieve -> assemble context -> `getLLM().complete()`
     -> return answer + citations.
   - [x] Store turns in `messages` — her chat turunda `user` ve `assistant` mesajları `agentId` + `channel:'text'` ile kaydediliyor; citations `meta.citations`'da.
   - [x] Endpoint artık her istekte, client'ın gönderdiği TÜM konuşma geçmişinden (sadece son
     mesajdan değil) ucuz bir LLM çağrısıyla ziyaretçinin teknik derinlik tercihini
     (`classifyAudiencePreference()`) çıkarıp `retrieve({ preferredAudience })`'e ve sistem
     promptuna ("Audience level: ...") geçiyor. DB'de session state tutmuyor — endpoint zaten
     stateless, client full history gönderiyor — ama "bir kez teknik istenince konuşmanın geri
     kalanında da öyle kalır" davranışı bu sayede doğal olarak elde ediliyor.

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
- **Audience classification cost/latency** — her chunk sınıflandırması kaynak başına 1 ek LLM
  çağrısı ekliyor (embed ile paralel yapılıyor, ama yine de her ingestion'a bir istek daha
  bindiriyor — büyük zip'lerde dosya sayısı kadar ek çağrı demek, rate-limit riskini artırıyor).
