# Web — Phase 1: Seller Console

> App: [`apps/console`](../../apps/console) (React 19 + Vite + Tailwind v4).
> Goal: sellers manage products, add knowledge of any modality, watch ingestion
> progress, and configure + activate agents.

---

## Scope

- [x] Auth (login/register) + workspace context.
- [x] Product CRUD.
- [x] Knowledge manager: add text/URL/API, upload docs/images/video, live status.
- [x] Agent builder: persona, avatar provider, screen modes, tool access.
- [x] Activate -> show share link + embed snippet.

---

## Routes

| Route | Purpose |
|---|---|
| `/login`, `/register` | Auth |
| `/` | Overview: products, recent sessions, KPIs |
| `/products/:id` | Product detail |
| `/knowledge` | Sources list + add/upload + ingestion status |
| `/agents` | Agents list |
| `/agents/:id` | Agent builder + activation |
| `/agents/:id/sessions` | Transcripts + analytics |

---

## Key UX

- **Knowledge manager**
  - Drag-and-drop upload (presigned S3); per-source status chips
    (`pending -> processing -> ready/failed`) updated live via Socket.IO
    (`ingestion:progress`, `ingestion:ready`).
  - "Add live software": enter the product URL (+ optional OpenAPI/MCP) to enable
    crawling and live tool access.
  - Zip yüklemeleri artık düz listede dağılmıyor — parent kaynağın altında açılır/kapanır
    bir grup ("Zip · N dosya") olarak gösteriliyor (`SourceRow` bileşeni,
    `KnowledgeSource.parentSourceId`'ye göre gruplanıyor; bkz.
    `md/backend/phase1_rag_ingestion.md`).
  - **Knowledge detay/düzenleme modalı** (`KnowledgeDetailModal`, `Knowledge.jsx`) — bir
    satıra tıklayınca açılır. Tip + `fileKey`'e göre dallanıyor: `text` ve PDF-olmayan
    `document` (docx/txt/md/json/xml) için çıkarılan metin (`meta.extractedText`)
    düzenlenip kaydedilebiliyor (kaydedince sadece değişen chunk'lar senkron re-embed
    edilir — `reingestSourceIncremental()`, bkz. `md/backend/phase1_rag_ingestion.md`);
    PDF (`react-pdf`/`pdfjs-dist`,
    sayfa gezinmeli gerçek render), image/video ise sadece görüntüleniyor (medya +
    salt-okunur AI açıklaması/transkript). Zip çocuklarının `fileKey`'i olmadığından
    (orijinal dosya hiç saklanmıyor) otomatik olarak düzenlenebilir-metin görünümüne
    düşüyorlar. `fileKey`'i olan her kaynakta "Dosyayı değiştir" ile dosya değiştirilip
    tüm ingestion pipeline'ı yeniden çalıştırılabiliyor. Başlık her tipte düzenlenebilir.
    `url`/`api` tipinde artık tek blok crawl-metni yerine sayfa URL'si başlık + altında o
    sayfanın chunk'ları (genel/teknik etiketiyle, `GET /knowledge/:id/chunks`) şeklinde gruplu
    gösteriliyor. Her sayfa grubunda, varsa yorumlanmış-sentez chunk'ı (bkz.
    `md/backend/phase1_rag_ingestion.md` — "yorumlanmış sentez katmanı") ayrı bir stille
    ("yorumlanmış özet" rozeti) ham chunk'ların ÜSTÜNDE gösteriliyor; kaynak geneli
    ilişkilendirici özet ise sayfa gruplarının üstünde ayrı bir "genel özet" kutusunda —
    ikisi de `GET /knowledge/:id/chunks`'ın döndürdüğü `synthesized`/`scope` alanlarına göre
    ayrıştırılıyor.
    Backend: `GET /knowledge/:id/download-url`, `PATCH /knowledge/:id` (bkz.
    `md/backend/phase1_rag_ingestion.md`). Zip **parent** satırına (container,
    `meta.zipSummary` set) tıklanınca içerik/medya/düzenleme bölümleri hiç
    gösterilmiyor — o satırın kendi içeriği yok, her dosyası ayrı bir çocuk
    kaynak — sadece metadata paneli (+ zip özeti: toplam/işlenen/başarısız/
    atlanan) gösteriliyor.
    `Knowledge.jsx` artık `?source=<id>` query param'ını da okuyor — o
    kaynağın detay modalını sayfa yüklenir yüklenmez otomatik açar (tek
    seferlik, URL'den hemen temizlenir). Bu, aşağıdaki GAP raporundan bir
    bulgunun kaynağına "git" denince kullanılan deep-link mekanizması.
  - **İçerik Analizi (proaktif Knowledge GAP raporu)** — `/knowledge/gaps`
    sayfasına (`KnowledgeGaps.jsx`) ikinci bir sekme olarak eklendi (ilk
    sekme "Cevapsız Sorular" — ziyaretçinin cevaplanamayan gerçek soruları,
    reaktif, değişmedi). Bu, ziyaretçi trafiği hiç gerekmeden, ürün
    sahibinin isteği üzerine knowledge içeriğinin KENDİSİNİ LLM ile
    (map-reduce, bkz. `md/backend/phase4_analytics_insights.md` madde 7)
    tutarlılık/kapsam analizinden geçiren tamamen ayrı bir özellik.
    - "Analiz Et" butonu — günlük kota şu an **devre dışı** (geliştirme
      aşamasında kaldırıldı, `apps/api/src/routes/knowledge.js`'teki
      `GAP_ANALYSIS_DAILY_LIMIT`; ileride geri eklenecek, bkz. phase4 md).
    - Rapor listesi (`ReportCard`) artık bir **accordion** — hem en güncel
      hem geçmiş raporlar tıklanıp genişletilip daraltılabiliyor (chevron
      ikonu), en yeni rapor varsayılan açık geliyor. Eskiden sadece en son
      rapor tam gösterilir, geçmiş raporlar tek satırlık özetti.
    - Her bulgu üç gruba ayrılmış (tutarsızlık/yetersiz detay/eksik konu)
      gösteriliyor; ilgili kaynak başlığına tıklanınca yukarıdaki
      `?source=` deep-link'iyle o kaynağın düzenleme moduna gidiliyor.
    - **PDF indirme** (`apps/console/src/lib/gapReportPdf.js`, yeni) — her
      rapor kartında bir "PDF" butonu; Console'ın zaten elindeki rapor
      JSON'ından (`jspdf`, tamamen istemci tarafında, hiçbir LLM/API
      çağrısı yok — token maliyeti sıfır) başlık/tarih/durum/3 bulgu grubu
      içeren bir PDF üretip indiriyor. Türkçe karakter desteği için
      `pdfmake` paketinin gömülü Roboto TTF'i (`fontkit` ile Türkçe glyph
      kapsamı doğrulanıp) base64 olarak `apps/console/src/lib/fonts/`'a
      gömüldü (jsPDF'in varsayılan Helvetica'sı Türkçe karakterleri
      desteklemiyor — bozuk/rastgele glyph'e map'liyordu); bu, `jspdf`'in
      `2.5.2` → `4.2.1`'e yükseltilmesini de gerektirdi (eski sürüm bu
      TTF'in standart cmap tablosunu tanımıyordu). jsPDF + gömülü font
      (~400KB) `KnowledgeGaps.jsx`'in ana chunk'ını şişirmesin diye
      `gapReportPdf.js` importu dinamik (`await import(...)`, sadece
      "PDF indir"e basılınca) yapıldı, kendi ayrı chunk'ına taşındı.

- **Agent builder**
  - Persona form (tone, language, goals, guardrails).
  - Avatar provider selector (developer/admin choice) with a preview.
  - Screen-mode toggles (guided tour / customer share).
  - Activate button -> modal with the share link + copy-paste embed snippet.

---

## Tech

- State: Zustand (UI) + React Query (server state).
- Forms: React Hook Form + Zod (`@repo/contracts`).
- Components: `@repo/ui` + Tailwind v4 (`@repo/tailwind-config`).
- Realtime: Socket.IO client subscribed to ingestion + session events.

---

## Acceptance criteria

- [x] Add every source type and see status reach `ready` live.
- [x] Build and activate an agent; copy a working share link.
- [x] See live transcripts stream in for an active session.
