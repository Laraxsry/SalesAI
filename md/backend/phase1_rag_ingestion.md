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
   - [x] **Site Bilgisi — Konu Ağacı (map-reduce) + Site Yapı Ağacı** — mevcut
     ham+sentez chunk katmanının (yukarıdaki "yorumlanmış sentez katmanı")
     üstüne, siteyi TAMAMEN farklı iki açıdan yapılandıran bir katman daha
     eklendi. Motivasyon: bir konu (ör. "İletişim") sıklıkla birden fazla
     sayfaya dağılmış oluyor (footer + ayrı /contact sayfası + SSS) ve hiçbir
     yerde bu bilgiler birleştirilip tek, kapsamlı bir doküman haline
     gelmiyordu — `search_knowledge`'ın bulduğu şey hep tek-sayfalık kısa
     parçalardı; ayrıca site'nin sayfa/buton grafiği (hangi buton hangi
     sayfaya götürüyor) crawl sırasında zaten üretiliyor ama hiç
     saklanmıyordu.
     - **Site Yapı Ağacı** (LLM'siz, ücretsiz) —
       `apps/worker-ingestion/src/extractors/url.js`'in BFS'i artık her kuyruk
       öğesini `{url, parentUrl}` olarak taşıyor (`enqueueLinks`), ve hem
       gerçek `<a href>` linkleri hem `discoverClientRoutedLinks()`'in
       bulduğu client-routed nav butonları artık düz URL string'i değil
       `{label, targetUrl, kind:'link'|'button'}` olarak toplanıyor. Sonuç,
       `KnowledgeSource.meta.crawlIndex.pages[url]`'e (mevcut `rawText`/`links`
       alanlarının yanına) `parentUrl` olarak persist ediliyor — eski cache
       formatı (düz string linkler) `enqueueLinks` tarafından geriye dönük
       kabul ediliyor. `GET /knowledge/:productId/sitemap`
       (`apps/api/src/routes/knowledge.js`) bunu düzleştirip döndürüyor;
       Console'da "Site Bilgisi" sekmesinin salt-okunur "Site Yapısı"
       bölümü ve agent-worker'ın `find_page` tool'u (aşağıya bkz.) bunu
       tüketiyor.
     - **Konu Ağacı** (`packages/ai/src/site-topics.js`, yeni) —
       `analyze-knowledge-gaps.js`'in map-reduce deseniyle aynı ruhta ama
       farklı bir amaç için: **Map** (`classifyPageTopics()`, sayfa başına 1
       LLM çağrısı, `mapWithConcurrency` ile paralel — `synthesizePage()`'e
       PARALEL, onu DEĞİŞTİRMİYOR, bilinçli olarak ayrı bir geçiş) her
       sayfayı sabit bir taksonomiye (`FIXED_TOPICS` — İletişim, Hakkımızda,
       Ürün/Hizmetler, Fiyatlandırma, SSS, Referanslar, Kariyer,
       Blog/Haberler, Destek/Yardım, Yasal) karşı sınıflandırıp ham bulgular
       (yorum değil, somut bilgi) çıkarıyor; hiçbir sabit başlığa uymayan
       içerik için `proposedTopic` alanı dolduruluyor. **Dedupe**
       (`dedupeProposedTopics()`, ≤1 LLM çağrısı — 0 veya 1 öneri varsa hiç
       çağrılmıyor) bu run'ın tüm siteye-özgü önerilerini (ör. "İletişim
       Bilgileri" + "Bize Ulaşın" aynı sayfada farklı ifade edilmiş olabilir)
       küçük bir kümeye indirgiyor, GAP analizindeki index→ID eşleme
       deseniyle. **Reduce** (`composeTopicDocument()`, konu başına 1 LLM
       çağrısı) o konuya katkı sağlayan TÜM sayfalardan gelen bulguları tek,
       uzun/tutarlı bir markdown dokümanına birleştiriyor — kısalık
       sorununun asıl çözümü burası, çünkü artık tek sayfa değil birden
       fazla kaynak aynı anda görülüyor.
     - **Maliyet önbellekleme** — her `KnowledgeTopic.lastContributingPages`
       (bu run'da o konuya katkı sağlayan sayfa URL'lerinin seti) bir
       önceki run'la karşılaştırılıyor; SET AYNIYSA reduce (composeTopicDocument)
       hiç çağrılmıyor, konunun `body`'si aynen kalıyor —
       `previousPages`/cache-hit BFS mantığıyla aynı ruhta. Bilinçli maliyet
       kararı (kullanıcıyla netleştirildi): bu geçiş her URL/API crawl'ında
       **otomatik** çalışıyor (opsiyonel/manuel tetiklenen GAP analizinden
       FARKLI), bu yüzden ~40 sayfalık bir crawl'ın LLM çağrı sayısını
       kabaca 2x'e çıkarıyor (map: sayfa başına +1; reduce: SADECE
       değişen/yeni konular için +1) — ilk crawl'da tam maliyet, sonraki
       re-ingest'lerde sadece gerçekten değişen konular kadar.
     - **Yeni model**: `KnowledgeTopic` (`packages/database/src/models/KnowledgeTopic.js`)
       — `productId`, `slug` (product başına unique), `title`,
       `parentTopicId` (self-ref, Console'da ağaç görünümü için),
       `body` (markdown), `autoGenerated` (siteye-özgü yeni konular için
       `true`, Console'da rozetle işaretleniyor — kullanıcı kararı: onay
       beklemeden otomatik yayınlanıyor), `sourcePages[]`,
       `lastContributingPages[]`.
     - **Embedding — `ingestSource()`'a DEĞİL, ayrı bir fonksiyona**: bir
       konu birden fazla kaynağa/sayfaya ait olabildiği için (cross-source),
       `KnowledgeChunk`'a `sourceId`'nin yanına opsiyonel bir `topicId` alanı
       eklendi (ikisinden tam olarak biri zorunlu, `pre('validate')` hook'uyla
       enforce ediliyor — bkz. `KnowledgeChunk.js`). Konu dokümanlarını konu
       segmenti olarak mevcut `ingestSegments`/`ingestSource()` akışına
       sokmak YANLIŞ olurdu, çünkü o akışın `deleteBySource(sourceId)`'ı
       kaynak-bazlı — bunun yerine `packages/rag/src/ingest.js`'e
       `ingestTopicDocument({topicId, productId, text})` eklendi: aynı
       `chunkText`/`embedBatch`/`classifyAudience`/store adımlarını (yeni bir
       pipeline değil) `topicId` bazlı `deleteByTopic()`+`upsert()` ile
       çalıştırıyor. Vector store'lara (`mongo.store.js`, `qdrant.store.js`)
       `deleteByTopic()`/`listByTopic()` eklendi — **ve
       `getVectorStore()`'un (`packages/rag/src/stores/index.js`) elle
       yazılmış forward listesine de eklenmesi gerekti** (bilinen "facade
       gotcha" — `stores/index.test.js`'teki facade-completeness testi
       bunu otomatik yakalıyor).
     - **API**: `GET/POST` yerine sadece `GET /knowledge/:productId/topics`,
       `GET/PATCH/DELETE /knowledge/topics/:id` (müşteri düzenlemesi —
       `body` değişirse `ingestTopicDocument()` ile tam re-embed; kısmi
       diff YOK, konu dokümanları sayfa kadar büyük değil,
       `reingestSourceIncremental()`'ın karmaşıklığı gerekmiyor), `DELETE`
       çocukları koparmaz (ebeveynine taşır).
     - **Console**: `KnowledgeGaps.jsx`'e üçüncü sekme "Site Bilgisi" —
       düzenlenebilir konu ağacı (accordion, inline markdown editör,
       `sourcePages` chip'leriyle `?source=` deep-link) + salt-okunur Site
       Yapısı listesi (bkz. `md/web/phase1_console.md`).
     - **GuidedTour entegrasyonu**: `packages/agent/src/tools.js`'e yeni
       `find_page` tool'u — `siteMap`'i (agent-worker'ın `runSession()`'da
       `meta.crawlIndex.pages`'ten düzleştirdiği) case-insensitive alt-dize
       eşlemesiyle (LLM'siz) arayıp gerçek URL/buton adaylarını döndürüyor.
       LLM artık `navigate_to`/`click_element`'ten ÖNCE `find_page`'i
       çağırıp gerçek veriyle çalışabiliyor, tahmin etmek yerine
       (`persona.js`'e bu sırayı öneren bir kural eklendi). **Bulunan gerçek
       bug**: arama fonksiyonu ilk halinde `.toLowerCase()` kullanıyordu —
       JS'in varsayılan (İngilizce) kuralı `'İ'.toLowerCase()`'i `'i̇'`
       (i + birleşik nokta işareti, U+0307) yapıyor, düz `'i'` ile
       eşleşmiyor; `.toLocaleLowerCase('tr')`'ye çevrildi (testte yakalandı).
     - **Kapsam sınırı** (bilinçli): sadece `type: 'url'/'api'` kaynakları
       kapsıyor — doküman/görsel/video kaynakları konu ağacına dahil değil.
     - Doğrulandı: `worker-ingestion` 32/32 (yeni `runSiteTopicsPass()`
       testleri dahil — seedleme, compose+embed, cache-skip, dedupe→yeni
       konu senaryoları), `packages/agent` 49/49 (yeni `find_page` testleri
       dahil), `apps/api` 47/47, `packages/rag` 4/4 (facade-completeness
       testi yeni `deleteByTopic`/`listByTopic`'i de otomatik kapsıyor),
       `apps/agent-worker` 104/104, Console `npm run build` temiz.
       **`packages/ai`'de hiç test altyapısı yok** (bu paketin hiçbir
       fonksiyonu, `synthesizePage()` dahil, test edilmiyor — `site-topics.js`
       da bu emsale uyuyor, sadece `ingest-source.test.js`'in mock'ları
       üzerinden dolaylı doğrulanıyor). **Gerçek ortamda/tarayıcıda HENÜZ
       denenmedi** — kod tamamlandıktan sonra kullanıcıyla birlikte uçtan
       uca test edilecek (sonraki AGENT_HANDOFF girişine bakın).
   - [x] **Round 8 — iki gerçek bug + component-seviyesi keşif**: Round 7'nin
     ilk gerçek ortam testinde kullanıcı iki bağımsız sorun bildirdi.
     - **Bug 1** (her konu dokümanı embed'i `next is not a function` ile
       başarısız oluyordu) — `KnowledgeChunk.js`'teki `pre('validate')`
       hook'u eski callback-tarzı (`function(next){...}`) yazılmıştı; Mongoose
       9.9.1'in `insertMany()`'ı dokümanları PARALEL doğruluyor
       (`parallelLimit`) ve bu yolda callback-tarzı hook'a Kareem güvenilir
       bir `next` vermiyordu. Fix: hook, callback almayan senkron `throw`
       eden forma çevrildi — davranış aynı, mekanizma farklı.
     - **Bug 2** (agent artık site içinde gezinemiyor, `find_page` boş
       dönüyordu) — hem `agent.js`'in siteMap sorgusu hem `GET
       /knowledge/:productId/sitemap` route'u `status:'ready'` filtresi
       kullanıyordu; bir kaynak yeniden taranırken (dakikalarca sürebiliyor)
       `status` geçici olarak `'processing'` oluyor ve bu süre boyunca site
       haritası TAMAMEN boşalıyordu — halbuki önceki başarılı taramadan kalan
       harita hâlâ `meta.crawlIndex.pages`'te duruyordu. Fix: her iki sorgu da
       `'meta.crawlIndex.pages': {$exists:true}` filtresine geçirildi.
     - **Component-seviyesi keşif** (yeni özellik, kullanıcı isteği) —
       `extractPageComponents()` (`extractors/url.js`, yeni, DOM-only/LLM
       yok) her taranan sayfada başlık hiyerarşisini (h1-h6), site genelindeki
       (nav/header'la sınırlı değil, `discoverClientRoutedLinks`'ten farklı
       olarak hiçbir şeye TIKLAMIYOR, sadece okuyor) etkileşimli
       öğeleri/butonları (hazır `text=<label>` selector'ıyla — `GuidedTour`'ın
       zaten kabul ettiği format) ve `aria-label`'lı/form/section bloklarını
       kataloglıyor. `meta.crawlIndex.pages[url].components` olarak persist
       ediliyor. Yeni agent tool'u `find_element` (`packages/agent/src/tools.js`)
       — `find_page`'in eşleniği, sayfa değil ELEMENT çözüyor — bunu arayıp
       `click_element`/`highlight`'a gerçek bir selector veriyor
       (`persona.js`'e `find_page` kuralının yanına eşlenik bir kural eklendi).
       Console'un salt-okunur "Site Yapısı" listesi bu envanteri (başlık/öğe
       sayıları + genişletilince tam liste) de gösteriyor.
     - **Knowledge sayfası görünürlüğü** — otomatik üretilen konu dokümanları
       artık Knowledge ana sayfasında da (ilgili url/api kaynağının altında,
       zip-child genişletme deseniyle, salt-okunur önizleme) görünüyor;
       düzenleme bilinçli olarak "Bilgi boşlukları" sayfasında kalıyor
       (kullanıcı: "Knowledge kısmını karmaşıklaştırmayalım").
     - Doğrulandı: `apps/worker-ingestion` 35/35 (yeni
       `extractPageComponents` testleri dahil), `packages/agent` 54/54 (yeni
       `find_element` testleri dahil), `apps/api` 47/47, `packages/rag` 4/4,
       Console lint + `npm run build` temiz. **Gerçek tarayıcıda HENÜZ
       denenmedi.**

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

7. **Ingestion reliability + dedup** *(bu turda eklendi — canlı bir kaynağın saatlerce
   `status:'processing'`de donmasından sonra)*
   - [x] **Üç katmanlı timeout**: `embedBatch()` zaten korumalıydı (30sn + 3 deneme,
     `packages/ai/src/embeddings.js`). `ingestSource()`'un TÜMÜ (embed/upsert fazı) artık
     3 dakikada, `handleIngestSource()`'un TÜMÜ (crawl/extraction fazı, embed'e ulaşmadan
     önceki her şey) artık 10 dakikada `withTimeout` (`@repo/resilience`) ile kesiliyor —
     hangi await'in içeride donduğu önemli değil, sonuçta gerçek bir hata ile `failed`'e
     düşüyor.
   - [x] **BullMQ "stalled" job'ların Mongo'ya senkronu** (`apps/worker-ingestion/src/main.js`) —
     worker process'i job ortasında ölürse (ör. dev `--watch` restart) BullMQ bunu kendi
     `maxStalledCount` mekanizmasıyla yakalayıp job'ı kalıcı `failed` yapıyor, ama eski
     `worker.on('failed', ...)` kontrolü (`attemptsMade >= attempts`) bunu "henüz tükenmedi"
     sanıp Mongo'ya hiç yazmıyordu — kaynak sonsuza kadar eski durumunda kalıyordu.
     `job.finishedOn` (BullMQ'nun kendi "bu job kesin bitti" sinyali) kontrolü eklendi.
   - [x] **Crawl'ın kendi içinde checkpoint** (`extractFromUrl`'in `onProgress` callback'i artık
     o ana kadarki `pagesIndex`'i taşıyor, `handleIngestSource` her sayfa bitince
     `meta.crawlIndex.pages`'e yazıyor) — önceden bu SADECE crawl'ın sonunda tek seferde
     yazılıyordu, yani üstteki timeout'lardan biri tetiklenirse retry sıfırdan başlıyordu.
     Gerçek ölçüm: 49 sayfalık bir site 4 denemede (her biri kaldığı yerden devam ederek:
     9→26→34→49 sayfa) tamamlandı, tek seferde denenen ilk hâli hiç bitmiyordu.
   - [x] **Katman 1 — birebir aynı metin tekilleştirme** (`packages/rag/src/ingest.js`) —
     chunk'lama sonrası, embed'den ÖNCE, kaynağın tamamında (case/whitespace normalize)
     birebir aynı chunk'lar eleniyor. LLM/embedding maliyeti yok, risk sıfır. Gerçek bir
     sitede (edge.cyberverse) 1718 chunk içinde **4.470 çift tam 1.0 benzerlik** bulundu,
     hepsi aynı sayfanın kendi içinde (muhtemelen DOM'da gizli/görünür iki kez render
     edilen bir bileşen).
   - [x] **Katman 2 — otomatik near-duplicate/çelişki denetimi** (`packages/rag/src/audit/
     auto-dedupe.js`, yeni) — embed+kaydet bitince, `status:'ready'` yazılmadan önce, aynı
     kaynağın chunk'ları üzerinde mevcut Knowledge Audit'in AYNI mekanizması (`clusterChunks`
     0.88 eşik + `reviewCluster` LLM) otomatik çalışıyor. **Sadece `"duplicate"` verdict'i
     otomatik uygulanır** — `"contradiction"` (ör. iki farklı fiyat) ASLA otomatik silinmez,
     normal bir `KnowledgeAudit` kaydı olarak beklemede bırakılır. Bilinçli tasarım kararı:
     benzerlik eşiği TEK BAŞINA "sil" kararı için güvenli değil — `cluster.js`'in kendi
     kalibrasyonu bir fiyat çelişkisinin (0.947) gerçek bir tekrardan (0.918) DAHA YÜKSEK
     benzerlik skoru aldığını gösteriyor, yani düz bir eşik çelişkiyi tekrardan ayıramaz.
   - [x] `getVectorStore().listByProduct()`'a opsiyonel `sourceId` filtresi eklendi (hem Mongo
     hem Qdrant) — Katman 2 tüm ürünü değil sadece ilgili kaynağı tarasın diye.
   - [x] **Denetim bulgularının "hayalet" olma riski** (`packages/rag/src/audit/index.js`,
     `apps/api/src/routes/knowledge.js`) — bir bulgunun `chunkIds`'i, kaynak denetimden SONRA
     yeniden taranırsa (chunk'lar silinip yeni ID'lerle yaratılır) artık yok oluyor.
     `applyAuditFindings()` artık onaylamadan önce chunk'ların hâlâ var olup olmadığını
     kontrol ediyor (yoksa `failed` + açık hata, sessizce gereksiz bir curated chunk
     yazmıyor); Console bu durumu `stale:true` ile önceden (onay denemesinden ÖNCE) uyarıyor.
   - [x] Console: zip container'ın kendi başlığı artık dosya adını gösteriyor (önceden boştu,
     kullanıcı yükleme sırasında başlık girmezse tip etiketi — "Doküman" vb. — görünüyordu;
     artık `file.name` varsayılan oluyor). Zip'teki "başarısız" rozeti artık `meta.zipSummary`
     donmuş anlık görüntüsünden değil, canlı children listesinden hesaplanıyor (bir çocuk
     silinince/düzelince rozet otomatik güncelleniyor).

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
- **Site Bilgisi (Konu Ağacı) maliyet/süre** — her URL/API crawl'ında otomatik çalışıyor,
  ~2x LLM çağrısı ekliyor (bkz. madde 1'in "Site Bilgisi" girişi). Reduce-fazı önbelleklemesi
  (sadece değişen konular) sonraki re-ingest'lerde bunu ciddi azaltıyor ama İLK crawl'da tam
  maliyet kaçınılmaz. Çok sayfalı (40'a yakın) bir site için ilk taramanın süresi de buna
  bağlı olarak uzuyor — **artık ölçüldü**: 49 sayfalık gerçek bir site (sekme keşfi dahil)
  tek bir denemede 10 dakikayı aşıyor, bu yüzden madde 7'nin checkpoint/resume mekanizması
  eklendi (aksi halde her timeout'ta sıfırdan başlayıp asla bitmiyordu).
