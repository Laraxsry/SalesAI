# SalesAI — Backend Kapsamlı Teknik Rehberi

> Bu döküman, SalesAI backend'inin **her katmanını**, kullanılan **her teknolojiyi** ve
> bunların **birbirleriyle neden bu şekilde birleştirildiğini** eksiksiz biçimde açıklar.
> Takım üyelerinin kodu ilk kez okurken kafasında tam bir resim oluşturması hedeflenmektedir.

---

## İçindekiler

1. [Projeye Genel Bakış](#1-projeye-genel-bakış)
2. [Monorepo Yapısı — Turborepo & npm Workspaces](#2-monorepo-yapısı--turborepo--npm-workspaces)
3. [Altyapı Servisleri (Docker)](#3-altyapı-servisleri-docker)
4. [Uygulamalar (`apps/`)](#4-uygulamalar-apps)
   - [apps/api — Ana REST + Realtime Sunucusu](#41-appsapi--ana-rest--realtime-sunucusu)
   - [apps/worker-ingestion — Bilgi Yutma İşçisi](#42-appsworker-ingestion--bilgi-yutma-işçisi)
   - [apps/worker-general — Genel Bakım İşçisi](#43-appsworker-general--genel-bakım-işçisi)
   - [apps/agent-worker — Gerçek Zamanlı AI Ajanı](#44-appsagent-worker--gerçek-zamanlı-ai-ajanı)
5. [Paylaşımlı Paketler (`packages/`)](#5-paylaşımlı-paketler-packages)
   - [@repo/database — Veri Katmanı](#51-repodatabase--veri-katmanı)
   - [@repo/auth — Kimlik Doğrulama](#52-repoauth--kimlik-doğrulama)
   - [@repo/access — Yetkilendirme (RBAC)](#53-repoaccess--yetkilendirme-rbac)
   - [@repo/queue — İş Kuyruğu](#54-repoqueue--iş-kuyruğu)
   - [@repo/realtime — Gerçek Zamanlı Olaylar](#55-reporealtime--gerçek-zamanlı-olaylar)
   - [@repo/ai — Yapay Zeka Katmanı](#56-repoai--yapay-zeka-katmanı)
   - [@repo/rag — Retrieval-Augmented Generation](#57-reporag--retrieval-augmented-generation)
   - [@repo/livekit — WebRTC & Ses Altyapısı](#58-repolivekit--webrtc--ses-altyapısı)
   - [@repo/avatar — Avatar Sağlayıcıları](#59-repoavatar--avatar-sağlayıcıları)
   - [@repo/screen — Ekran Zekası](#510-reposcreen--ekran-zekası)
   - [@repo/agent — Ajan Mantığı](#511-repoagent--ajan-mantığı)
   - [@repo/storage — Nesne Deposu](#512-repostorage--nesne-deposu)
   - [Diğer Yardımcı Paketler](#513-diğer-yardımcı-paketler)
6. [Uçtan Uca Akışlar](#6-uçtan-uca-akışlar)
   - [Kayıt & Giriş Akışı](#61-kayıt--giriş-akışı)
   - [Bilgi Yükleme & İndeksleme Akışı](#62-bilgi-yükleme--i̇ndeksleme-akışı)
   - [Gerçek Zamanlı Sesli Konuşma Akışı](#63-gerçek-zamanlı-sesli-konuşma-akışı)
   - [RAG (Bilgi Arama) Akışı](#64-rag-bilgi-arama-akışı)
   - [Ekran Paylaşımı & Rehberli Tur Akışı](#65-ekran-paylaşımı--rehberli-tur-akışı)
7. [Veri Modelleri](#7-veri-modelleri)
8. [Ortam Değişkenleri Referansı](#8-ortam-değişkenleri-referansı)
9. [Teknoloji Seçimlerinin Gerekçesi](#9-teknoloji-seçimlerinin-gerekçesi)

---

## 1. Projeye Genel Bakış

SalesAI, **satış temsilcisi rolü oynayan** bir yapay zeka platformudur. Bir şirketin ürünlerini tanıyan, sorulara bilgi tabanından yanıt veren, sesli konuşma yapabilen, isteğe bağlı olarak konuşan bir avatar ile görünen ve müşterinin ekranını izleyerek yönlendirme yapabilen bir AI satış temsilcisi oluşturmanıza olanak tanır.

**Temel özellikler:**
- 🧠 **RAG (Retrieval-Augmented Generation):** PDF, video, URL, görsel gibi farklı modalitelerdeki içerikleri indeksler; AI soruları bu indekslenmiş bilgiye dayanarak yanıtlar.
- 🎙️ **Gerçek Zamanlı Sesli Konuşma:** OpenAI Realtime API üzerinden speech-to-speech, LiveKit ile WebRTC kullanılarak düşük gecikmeyle iletilir.
- 👤 **Avatar Entegrasyonu:** Tavus, Simli, HeyGen veya D-ID ile konuşan yüz videosu oluşturulur.
- 🖥️ **Ekran Zekası:** Ajan ürünü canlı tarayıcıda gösterir (Playwright) ya da müşterinin ekranını Vision AI ile okuyup yönlendirme yapar.
- 🔐 **Güvenlik:** JWT tabanlı auth, rol bazlı erişim kontrolü (RBAC), workspace izolasyonu.

---

## 2. Monorepo Yapısı — Turborepo & npm Workspaces

### Neden Monorepo?

Proje birden fazla bağımsız çalışan süreçten oluşmaktadır: bir REST API, iki arka plan işçisi, bir AI ajan işçisi. Hepsinin `@repo/database`, `@repo/ai`, `@repo/queue` gibi ortak kodu paylaşması gerekir. Monorepo bu paylaşımı, her paketi ayrı bir npm paketi olarak yayınlamak zorunda kalmadan sağlar.

### npm Workspaces

`package.json` kökünde tanımlanır:

```json
{
  "workspaces": ["apps/*", "packages/*"]
}
```

`npm install` komutu çalıştırıldığında tüm workspace paketlerinin bağımlılıkları tek bir `node_modules/` altında toplanır. Paketler birbirlerine `@repo/database`, `@app/api` gibi sembolik linklerle bağlanır; kod değiştiğinde yeniden yayınlamaya gerek kalmaz.

### Turborepo

`turbo.json` ile görev grafiği tanımlanır. `npm run build` çalıştırıldığında Turborepo bağımlılık zincirini anlar:
- Önce `@repo/database` derlenir,
- sonra `@repo/rag` (database'e bağımlı),
- en son `apps/api` derlenir.

Bu sayede gereksiz yeniden derleme yapılmaz ve görevler paralel çalışabilir.

### Dizin Yapısı

```
SalesAI/
├── apps/
│   ├── api/              # REST API + Socket.IO sunucusu
│   ├── agent-worker/     # LiveKit AI ajan işçisi
│   ├── worker-ingestion/ # Bilgi yutma işçisi
│   ├── worker-general/   # Bakım görevleri işçisi
│   ├── console/          # Satıcı paneli (frontend)
│   └── visitor/          # Ziyaretçi arayüzü (frontend)
├── packages/
│   ├── database/         # Mongoose modelleri + DB bağlantısı
│   ├── auth/             # JWT + bcrypt
│   ├── access/           # RBAC
│   ├── queue/            # BullMQ (Redis üstü iş kuyruğu)
│   ├── realtime/         # Socket.IO + Redis pub/sub
│   ├── ai/               # OpenAI embeddings, LLM, Whisper, Vision
│   ├── rag/              # Chunk → Embed → Upsert → Retrieve
│   ├── livekit/          # LiveKit token + room + agent dispatch
│   ├── avatar/           # Avatar sağlayıcı stratejileri
│   ├── screen/           # Playwright GuidedTour + Vision analizi
│   ├── agent/            # System prompt + tool tanımları
│   ├── storage/          # MinIO/S3 presigned URL
│   ├── contracts/        # Zod şemaları (API kontratları)
│   ├── validation/       # Express Zod middleware
│   ├── config-env/       # .env yükleyici + doğrulayıcı
│   ├── logger/           # Merkezi loglama
│   └── utils/            # Yardımcı fonksiyonlar
└── infra/
    └── docker-compose.yaml
```

---

## 3. Altyapı Servisleri (Docker)

Tüm altyapı `infra/docker-compose.yaml` dosyasıyla tek komutla (`npm run infra:up`) ayağa kalkar.

### MongoDB Atlas Local

```yaml
image: mongodb/mongodb-atlas-local:latest
ports: 27017:27017
```

**Ne işe yarar?** SalesAI'nin birincil veri deposudur. Kullanıcılar, workspace'ler, ürünler, ajanlar, bilgi parçaları (chunk'lar), oturumlar ve konuşma geçmişleri MongoDB'de saklanır.

**Neden Atlas Local?** Normal `mongo` imajı yerine bu imaj kullanılmaktadır çünkü **Atlas Vector Search** özelliğini yerel geliştirme ortamında sunar. Bu özellik olmadan vektör tabanlı semantik arama (`$vectorSearch` aşaması) çalışmaz. Üretimde ise MongoDB Atlas bulut servisi kullanılır; geçiş için kod değişikliği gerekmez.

**Vektör indeksi:** `npm run db:indexes` komutu çalıştırıldığında `KnowledgeChunk` koleksiyonu üzerinde `vector_index` adında bir Atlas Vector Search indeksi oluşturulur. Bu indeks `embedding` alanını (3072 boyutlu, `text-embedding-3-large` için) ve metin araması için `text_index`'i tanımlar.

### Redis

```yaml
image: redis:7-alpine
ports: 6380:6379  # dış port 6380, iç port 6379
```

**Ne işe yarar?** Redis projede **üç farklı amaç için** kullanılmaktadır:

1. **BullMQ İş Kuyruğu:** `worker-ingestion` ve `worker-general` işçileri için görev kuyruğu. Redis olmadan bu işçiler çalışmaz.
2. **RAG Önbelleği:** `retrieve()` fonksiyonu sorgu sonuçlarını 24 saat boyunca Redis'te önbelleğe alır. Aynı ürün için tekrarlanan sorgu maliyetli embedding + vektör arama yapmak zorunda kalmaz.
3. **Pub/Sub (Gerçek Zamanlı Olaylar):** `worker-ingestion` veya `agent-worker` gibi farklı süreçlerden gelen olayları (ingestion progress, transcript) `api` sürecine ileten bir pub/sub kanalı (`rt:emit`) olarak kullanılır; `api` bu olayları Socket.IO üzerinden frontend'e iletir.

**Neden port 6380?** Docker Compose'da iç port 6379, dışarıya 6380 olarak maplenmiştir. `.env` dosyasında `REDIS_URL=redis://localhost:6380` ayarlanmalıdır.

### MinIO

```yaml
image: minio/minio:latest
ports: 9000:9000, 9001:9001
```

**Ne işe yarar?** AWS S3 ile tam uyumlu açık kaynaklı nesne deposudur. PDF'ler, görseller, videolar gibi ikili dosyalar burada saklanır. `9001` portu MinIO'nun yönetim arayüzüdür (tarayıcıdan erişilebilir, kullanıcı/şifre: `minioadmin`).

**Neden S3 değil?** Yerel geliştirmede harici bir bulut servisi gerektirmeden tam S3 API uyumluluğu sağlar. Üretimde `S3_ENDPOINT` değiştirilerek gerçek S3'e geçiş yapılabilir; kod değişmez.

**Presigned URL akışı:** Frontend büyük dosyaları doğrudan API üzerinden değil, MinIO'ya yükler. API `presignUpload()` ile 15 dakika geçerli bir yükleme linki üretir; frontend bu linke PUT isteği atar. Böylece API sunucusu büyük dosya trafiğini taşımaz.

### Qdrant

```yaml
image: qdrant/qdrant:latest
ports: 6333:6333, 6334:6334
```

**Ne işe yarar?** Özel vektör veritabanıdır. Varsayılan olarak MongoDB Atlas Vector Search kullanılmaktadır, ancak `VECTOR_STORE=qdrant` ortam değişkeniyle Qdrant'a geçiş yapılabilir. Strateji deseni (bkz. `@repo/rag`) sayesinde kod değişikliği gerektirmez.

**Neden iki seçenek?** MongoDB Atlas Vector Search, mevcut veri modeliyle entegre çalışır ve ek bir servis gerektirmez. Qdrant ise yüksek vektör arama performansı ve daha zengin filtreleme kapasitesi sunar. Hangi seçeneğin daha iyi performans gösterdiğini ölçmek için ikisi de desteklenmiştir.

### LiveKit

```yaml
image: livekit/livekit-server:latest
command: --dev --bind 0.0.0.0 --node-ip 172.20.10.3
ports: 7880 (HTTP/WS), 7881 (TCP), 7882/udp (WebRTC medya)
```

**Ne işe yarar?** Açık kaynaklı WebRTC altyapısıdır. Ziyaretçinin tarayıcısı ile AI ajanı arasındaki gerçek zamanlı ses (ve isteğe bağlı video) bağlantısını yönetir.

**`--dev` modu:** Yerel geliştirmede TURN sunucusu kurma zahmetine girmeden NAT traversal yapabilmek için sadeleştirilmiş mod. Üretimde LiveKit Cloud veya tam yapılandırılmış self-hosted kullanılır.

**`--node-ip`:** LiveKit'in duyurduğu IP adresi. Docker ağında katılımcıların bulabilmesi için manuel olarak belirtilir.

---

## 4. Uygulamalar (`apps/`)

### 4.1 `apps/api` — Ana REST + Realtime Sunucusu

**Teknoloji:** Express.js + Socket.IO + Node.js HTTP Server

**Port:** `5001`

#### Başlatma Sırası (`main.js`)

```
1. @repo/config-env/load → .env dosyasını yükle ve doğrula
2. connectDB()           → MongoDB'ye bağlan
3. ensureBucket()        → MinIO'da 'salesai-uploads' bucket'ını oluştur (yoksa)
4. Express uygulaması kur (helmet, cors, json parser)
5. Rotaları kaydet (registerRoutes)
6. HTTP server'a Socket.IO ekle (createRealtimeServer)
7. Redis pub/sub'ı dinle → gelen olayları Socket.IO'ya yönlendir
8. :5001'de dinlemeye başla
```

#### Middleware Zinciri

| Middleware | Amacı |
|---|---|
| `helmet()` | HTTP güvenlik başlıkları (XSS, clickjacking koruması) |
| `cors()` | Yalnızca izin verilen origin'lerden gelen isteklere izin ver |
| `express.json({ limit: '5mb' })` | JSON body ayrıştırıcısı (5 MB limit) |
| `requireAuth` | JWT doğrulama (korunan rotalar için) |
| `validate({ body: Schema })` | Zod şema doğrulaması |
| `errorHandler` | Merkezi hata yakalayıcı |

#### API Rotaları

| Rota | Auth | Amaç |
|---|---|---|
| `GET /health` | Hayır | Servis sağlık kontrolü |
| `POST /auth/register` | Hayır | Kullanıcı kaydı + kişisel workspace oluşturma |
| `POST /auth/login` | Hayır | Giriş + access/refresh token üretimi |
| `POST /auth/refresh` | Hayır | Token yenileme |
| `POST /auth/logout` | Hayır | Çıkış |
| `POST /workspaces` | Evet | Workspace oluştur |
| `POST /products` | Evet | Ürün oluştur |
| `POST /knowledge/upload-url` | Evet | MinIO presigned upload URL üret |
| `POST /knowledge` | Evet | Bilgi kaynağı ekle + ingestion kuyruğuna at |
| `GET /knowledge/:productId` | Evet | Ürünün bilgi kaynaklarını listele |
| `POST /agents` | Evet | Ajan oluştur/yapılandır |
| `POST /agents/:id/activate` | Evet | Ajanı aktifleştir + paylaşım linki üret |
| `GET /agents/:id/sessions` | Evet | Ajanın oturumlarını listele |
| `POST /agents/:id/chat` | Hayır | RAG tabanlı metin sohbeti |
| `POST /sessions` | Hayır | Ziyaretçi oturumu başlat (LiveKit token üret) |

#### Redis Pub/Sub Köprüsü

`agent-worker` ve `worker-ingestion` gibi ayrı süreçler `publishEvent()` ile Redis'e mesaj yayınlar. `api` bu kanalı dinler ve mesajları bağlı tüm Socket.IO istemcilerine iletir:

```
[agent-worker] → Redis publish('rt:emit', {...})
                              ↓
[api] redisSub.on('message') → io.emit(event, payload)
                              ↓
[Console/Visitor frontend] Socket.IO bağlantısı
```

Bu mimari sayesinde farklı süreçler birbirini doğrudan çağırmak zorunda kalmadan iletişim kurar.

---

### 4.2 `apps/worker-ingestion` — Bilgi Yutma İşçisi

**Teknoloji:** BullMQ Worker + Node.js

**Amaç:** API'den gelen `ingest-source` işlerini asenkron olarak işler. Büyük dosyaları (video transkripsiyon dakikalar sürebilir) senkron API isteğiyle işlemek mümkün değildir; bu yüzden kuyruk tabanlı asenkron mimari kullanılır.

#### Desteklenen Kaynak Türleri

| Tür | İşlem Süreci |
|---|---|
| `text` | Doğrudan alınır |
| `url` / `api` | `fetch` + HTML strip (içerik çıkarıcı) |
| `image` | MinIO'dan indir → `describeImage()` (GPT-4 Vision) |
| `document` (PDF) | MinIO'dan indir → `pdf-parse` |
| `document` (DOCX) | MinIO'dan indir → `mammoth.extractRawText()` |
| `video` | MinIO'dan indir → `ffmpeg` ile ses çıkar → Whisper transkripsiyon |

#### İşlem Akışı

```
BullMQ job alındı
  ↓
KnowledgeSource kaydı çekildi (MongoDB)
  ↓
emitProgress(sourceId, 'Başlatılıyor', 5%)  → Redis → Socket.IO → UI
  ↓
Modality'e göre text çıkarımı
  ↓
emitProgress(sourceId, 'Vektörleştiriliyor', 75%)
  ↓
ingestSource({ text, modality }) → chunk → embed → upsert
  ↓
publishEvent(INGESTION_READY, { chunks, modality })
  ↓
Geçici dosyalar temizlendi
```

**Hata toleransı:** BullMQ ile `attempts: 3`, `backoff: exponential 2s` yapılandırması. Başarısız işler 3 kez yeniden denenir, başarısız olursa `KnowledgeSource.status = 'failed'` olarak işaretlenir.

---

### 4.3 `apps/worker-general` — Genel Bakım İşçisi

**Teknoloji:** BullMQ Worker + Cron

**Amaç:** Periyodik bakım görevleri.

| Görev | Sıklık | İşlev |
|---|---|---|
| `expire-links` | Her dakika | Süresi geçmiş `ShareLink`'leri `active: false` yap |
| `close-stale-sessions` | Her 5 dakika | 2 saatten uzun süren `live` oturumları `ended` olarak işaretle |

Bu görevler BullMQ'nun `repeat: { pattern: 'cron expression' }` özelliğiyle planlanır. Redis'te saklanır, worker yeniden başlatılsa bile görevler devam eder.

---

### 4.4 `apps/agent-worker` — Gerçek Zamanlı AI Ajanı

**Teknoloji:** `@livekit/agents` SDK + OpenAI Realtime API + Playwright + Sharp

Bu, sistemin en karmaşık bileşenidir. LiveKit, yeni bir ziyaretçi odası oluşturulduğunda bu işçiyi otomatik olarak odaya çağırır.

#### Başlatma Sırası

```
LiveKit dispatch tetiklendi (POST /sessions → dispatchAgent())
  ↓
defineAgent.entry() çağrıldı
  ↓
connectDB() → MongoDB bağlantısı
ctx.connect() → LiveKit odasına katıl
  ↓
roomName'e göre Session → Agent → Product belgelerini çek
  ↓
buildSystemPrompt() → Ajan kimliğini ve kurallarını oluştur
buildTools()        → Araç setini hazırla
  ↓
GuidedTour nesnesi oluştur (hazır bekliyor, henüz başlamadı)
trackSubscribed dinleyicisini ekle (müşteri ekran paylaşımı için)
  ↓
getAvatarProvider() → Avatar bağla (Tavus, Simli vb.)
  ↓
AgentSession başlat (OpenAI Realtime API ile speech-to-speech)
  ↓
ConversationItemAdded → transcript Message olarak kaydet → RT event yayınla
Close → Tarayıcıları kapat, Session'ı 'ended' olarak işaretle
```

#### OpenAI Realtime API ile Speech-to-Speech

```
Ziyaretçi konuşur → LiveKit ses track → AgentSession (VAD)
  ↓
OpenAI Realtime API (gpt-realtime-2)
  - Speech-to-Text (dahili)
  - LLM (tool call'larla)
  - Text-to-Speech (dahili)
  ↓
AI ses yanıtı → LiveKit → Ziyaretçi kulağına
```

**VAD (Voice Activity Detection):** Konuşmanın ne zaman başlayıp bittiğini algılar. `@livekit/agents` bu özelliği yerleşik olarak sağlar.

**Interruption (Kesme):** Ziyaretçi konuşmaya başlarsa AI cümle yarıda kesilir; bu doğal konuşma hissi verir.

#### Tool Call Mekanizması

AI konuşurken ihtiyaç duyduğu bilgiye erişmek için araç çağrıları yapar:

```
AI: "Fiyatlandırma hakkında bilgi arıyorum..."
  ↓
Tool call: search_knowledge({ query: "pricing" })
  ↓
retrieve() → MongoDB Vector Search → rerank → chunks
  ↓
AI chunks'ı okur, yanıtı sentezler
  ↓
AI: "Ürünümüzün Starter planı aylık $29..."
```

---

## 5. Paylaşımlı Paketler (`packages/`)

### 5.1 `@repo/database` — Veri Katmanı

**Teknoloji:** Mongoose (MongoDB ODM)

Tüm veri modellerini ve MongoDB bağlantısını merkezi olarak yönetir. Her uygulama kendi `connectDB()` çağrısını yapar; Mongoose bağlantıyı tekileştirir (singleton).

#### Mongoose Modelleri

| Model | Amaç | Önemli Alanlar |
|---|---|---|
| `User` | Kullanıcı hesabı | `email`, `passwordHash` |
| `Workspace` | Çok kiracılı organizasyon birimi | `name`, `ownerId` |
| `Membership` | User-Workspace ilişkisi + rol | `userId`, `workspaceId`, `role` |
| `Product` | Ajana bağlı ürün | `name`, `description`, `websiteUrl`, `workspaceId` |
| `Agent` | AI satış temsilcisi yapılandırması | `productId`, `status`, `persona`, `avatarProvider`, `screenModes` |
| `ShareLink` | Ziyaretçiye gönderilecek paylaşım linki | `agentId`, `token`, `active`, `expiresAt`, `maxSessions` |
| `Session` | Bir ziyaretçinin tek görüşmesi | `agentId`, `roomName`, `status`, `visitorName` |
| `Message` | Konuşma kaydı | `sessionId`, `role`, `text`, `meta` |
| `KnowledgeSource` | Ham bilgi kaynağı | `productId`, `type`, `status`, `fileKey`, `mimeType` |
| `KnowledgeChunk` | Vektörize edilmiş bilgi parçası | `productId`, `sourceId`, `text`, `embedding`, `modality` |

#### `KnowledgeChunk.embedding`

`embedding` alanı 3072 elemanlı bir sayı dizisidir (OpenAI `text-embedding-3-large` modeli için). Atlas Vector Search bu alan üzerinde indeks oluşturarak semantik benzerlik araması yapar:

```js
{ embedding: { type: [Number], default: undefined } }
```

`VECTOR_STORE=qdrant` kullanıldığında vektörler Qdrant'ta saklanır ve bu alan boş kalabilir.

---

### 5.2 `@repo/auth` — Kimlik Doğrulama

**Teknoloji:** `jsonwebtoken` + `bcryptjs`

#### Çalışma Mantığı

**Kayıt:** Şifre `bcrypt.hash(plain, 10)` ile hashlenir (10 round = ~100ms, brute force direnci).

**Giriş:** `bcrypt.compare()` ile doğrulama yapılır. Başarılıysa iki token üretilir:
- **Access Token** (kısa ömürlü, varsayılan 15 dakika): Her API isteğinde `Authorization: Bearer <token>` başlığıyla gönderilir.
- **Refresh Token** (uzun ömürlü, varsayılan 7 gün): Yalnızca token yenileme isteğinde kullanılır.

**Neden iki token?** Access token'ın kısa tutulması güvenliği artırır; çalınsa bile kısa süre içinde geçersiz olur. Kullanıcının her 15 dakikada bir giriş yapmasını engellemek için refresh token devreye girer.

**`requireAuth` middleware:**
```
Authorization: Bearer <jwt>
  ↓ jwt.verify(token, ACCESS_SECRET)
  ↓ Geçerliyse req.user = decoded payload
  ↓ Sonraki middleware'e geç
```

---

### 5.3 `@repo/access` — Yetkilendirme (RBAC)

**Teknoloji:** Özel rol-izin matrisi

| Rol | İzinler |
|---|---|
| `OWNER` | Her şey (`*`) |
| `ADMIN` | `product:*`, `knowledge:*`, `agent:*`, `member:read`, `analytics:read` |
| `EDITOR` | `product:read`, `knowledge:*`, `agent:read,update`, `analytics:read` |
| `VIEWER` | `product:read`, `knowledge:read`, `agent:read`, `analytics:read` |

**Kullanımı:**
```js
router.delete('/products/:id',
  requireAuth,           // Kim olduğunu doğrula
  requirePermission('product:delete'),  // Ne yapabileceğini kontrol et
  handler
);
```

`requirePermission` middleware'i `req.member.role`'e bakar. `req.member`, tenant middleware'i tarafından `Membership` koleksiyonundan doldurulur.

---

### 5.4 `@repo/queue` — İş Kuyruğu

**Teknoloji:** BullMQ + ioredis

**Neden BullMQ?** Video transkripsiyon, embedding oluşturma gibi uzun süren işlemler senkron API isteğiyle yapılamaz. BullMQ bu işleri Redis'te sıraya koyar ve ayrı worker süreçleri bunları asenkron olarak işler.

#### Temel Yapılandırma

```js
export function enqueue(name, jobName, data, opts = {}) {
    return getQueue(name).add(jobName, data, {
        removeOnComplete: 1000,  // 1000 başarılı iş sakla, sonra sil
        removeOnFail: 5000,      // 5000 başarısız iş sakla (debugging için)
        attempts: 3,             // Başarısız olursa 3 kez dene
        backoff: { type: 'exponential', delay: 2000 },  // 2s, 4s, 8s aralar
        ...opts
    });
}
```

**Kuyruklar:**
- `INGESTION`: `ingest-source` işleri (video, PDF, URL işleme)
- `GENERAL`: `expire-links`, `close-stale-sessions` bakım işleri

---

### 5.5 `@repo/realtime` — Gerçek Zamanlı Olaylar

**Teknoloji:** Socket.IO + Redis Adapter + ioredis

**Ne işe yarar?** Farklı süreçlerden gelen olayları (ingestion progress, konuşma transkripti) frontend'e anlık olarak iletir.

#### Mimari

Socket.IO normalde tek bir süreç içinde çalışır. Ancak SalesAI'de `agent-worker` ayrı bir süreçte çalışır ve transcript olaylarını `api`'deki Socket.IO istemcilerine iletmesi gerekir. Bunu Redis pub/sub köprüsüyle çözer:

```
agent-worker → publishEvent('session:transcript', {...})
              ↓
         Redis.publish('rt:emit', JSON)
              ↓
         api → redisSub.on('message')
              ↓
         io.emit('session:transcript', payload)
              ↓
         Console frontend (Socket.IO istemcisi)
```

**Redis Adapter:** Socket.IO `@socket.io/redis-adapter` kullanılarak ölçeklenebilir hale getirilmiştir. Birden fazla API örneği çalışıyorsa (yatay ölçekleme), bir istemciye bağlı olduğu instance üzerinden değil herhangi bir instance'tan mesaj gönderilebilir.

#### Olay Türleri

| Olay | Tetikleyen | Alıcı | İçerik |
|---|---|---|---|
| `ingestion:progress` | worker-ingestion | Console | `{ sourceId, stage, pct }` |
| `ingestion:ready` | worker-ingestion | Console | `{ sourceId, chunks, modality }` |
| `session:started` | api | Console | `{ sessionId }` |
| `session:ended` | worker-general / agent-worker | Console | `{ sessionId }` |
| `session:transcript` | agent-worker | Console | `{ sessionId, role, text }` |

---

### 5.6 `@repo/ai` — Yapay Zeka Katmanı

**Teknoloji:** OpenAI SDK + `@xenova/transformers`

Tüm AI operasyonlarını tek bir pakette toplar. Diğer paketler doğrudan OpenAI SDK kullanmaz; bu paketi çağırır.

#### `embed(text)` — Metin Vektörleştirme

```js
// OpenAI text-embedding-3-large modeli (3072 boyut)
const embedding = await embed("Fiyatlandırma nasıl çalışır?");
// → [0.023, -0.041, ..., 0.012]  (3072 sayı)
```

Bu vektör MongoDB Atlas Vector Search'te saklanır ve semantik arama için kullanılır.

#### `getLLM().complete()` — Metin Tamamlama

Metin tabanlı sohbet endpointi (`POST /agents/:id/chat`) için kullanılır. `LLM_PROVIDER` ortam değişkenine göre OpenAI veya Anthropic kullanır.

#### `describeImage(url, prompt)` — Vision AI

```
İşlem:
1. Görsel URL veya base64 data URL alınır
2. GPT-4o'ya (vision) görsel + prompt gönderilir
3. Doğal dil açıklama döner

Kullanım yerleri:
- KnowledgeSource type='image' → metin çıkarımı
- analyzeFrame() → müşteri ekranı analizi
```

#### `transcribeAudio(filePath)` — Whisper

```
İşlem:
1. mp3 dosya yolu alınır
2. OpenAI Whisper API'ye gönderilir
3. Transkripsiyon metni döner

Kullanım yeri:
- KnowledgeSource type='video' → ses → metin
```

#### `rerank(query, documents, topK)` — Cross-Encoder Yeniden Sıralama

```js
// @xenova/transformers (Hugging Face - Xenova/bge-reranker-base)
const reranked = await rerank(query, mergedResults, topK);
```

**Neden rerank?** Vektör araması ve BM25 araması "aday" sonuçları bulur. Cross-encoder ise her aday çiftini (query, document) birlikte değerlendirerek daha doğru bir alaka puanı hesaplar. İlk arama hızı için dense/sparse vektör, kalite için cross-encoder kullanımı RAG'ın standart best-practice'idir.

---

### 5.7 `@repo/rag` — Retrieval-Augmented Generation

**Teknoloji:** Özel pipeline + MongoDB / Qdrant

RAG sistemi üç aşamadan oluşur: **Chunk → Embed → Retrieve**.

#### `chunkText(text)` — Metin Parçalama

Uzun metinleri örtüşen (overlapping) parçalara böler. Örtüşme sayesinde cümle sınırında kesilen bilgi kaybolmaz.

#### `ingestSource({ sourceId, productId, text, modality })` — Vektör Depolama

```
text
  ↓ chunkText() → ["chunk1...", "chunk2...", ...]
  ↓ embedBatch() → [[0.023, ...], [0.011, ...], ...]  (OpenAI)
  ↓ store.upsert() → MongoDB KnowledgeChunk koleksiyonu
  ↓ KnowledgeSource.status = 'ready'
```

#### `retrieve({ productId, query, topK })` — Hibrit Arama

```
query
  ↓ Redis önbellek kontrolü (rag:cache:{productId}:{query}:{topK})
  │
  ├─ Cache HIT → sonuçları döndür (24 saat geçerli)
  │
  └─ Cache MISS →
       ↓ embed(query) → dense vector
       ↓ Promise.all([
           store.query()        → Atlas $vectorSearch (semantik benzerlik)
           store.keywordQuery() → Atlas $search (BM25 / anahtar kelime)
         ])
       ↓ Sonuçları birleştir + tekilleştir (ID'ye göre)
       ↓ rerank(query, mergedResults, topK)  → Cross-Encoder
       ↓ Redis'e yaz (24 saat TTL)
       ↓ Sonuçları döndür
```

**Hibrit arama neden?** Tek başına vektör araması "yazım hatası" veya "tam ad" sorgularında zayıf kalabilir. BM25 ise exact match'te güçlüdür. İkisinin kombinasyonu her iki avantajı birleştirir.

#### Vektör Mağazası Stratejisi

```js
// VECTOR_STORE=mongodb (varsayılan)
const store = getVectorStore(); // → MongoVectorStore
// VECTOR_STORE=qdrant
const store = getVectorStore(); // → QdrantVectorStore
```

İki mağaza aynı arayüzü (`query()`, `upsert()`, `keywordQuery()`) uygular; kod değişikliği gerektirmez.

---

### 5.8 `@repo/livekit` — WebRTC & Ses Altyapısı

**Teknoloji:** `livekit-server-sdk`

LiveKit ile API katmanı arasındaki köprüdür. Üç ana işlevi vardır:

#### `createAccessToken()` — Katılım Tokeni

```js
const token = await createAccessToken({
    roomName: 's_abc123',
    identity: 'visitor_xyz789',
    name: 'Mehmet Yılmaz',
    metadata: { agentId: '...' }
});
// → JWT string, visitor frontend bunu LiveKit'e sunar
```

#### `dispatchAgent()` — Ajan İşçisi Çağırma

```js
await dispatchAgent({
    roomName: 's_abc123',
    agentName: 'salesai-agent',  // WorkerOptions'daki agentName ile eşleşmeli
    metadata: { sessionId: '...', agentId: '...' }
});
```

Bu çağrı LiveKit'e "Bu odaya `salesai-agent` isimli bir işçi gönder" emrini verir. LiveKit, `agent-worker`'ın WorkerOptions'ında kayıtlı `agentName: 'salesai-agent'` ile eşleştirir ve `defineAgent.entry()` fonksiyonunu tetikler.

#### `roomService()` — Oda Yönetimi

REST API üzerinden oda listeleme, silme gibi yönetim işlemleri için kullanılır.

---

### 5.9 `@repo/avatar` — Avatar Sağlayıcıları

**Desen:** Strategy Pattern

Her avatar sağlayıcısı aynı arayüzü uygular:

```js
interface AvatarProvider {
    start({ agentSession, room }): Promise<void>
    getClientConfig(): object
}
```

| Sağlayıcı | Teknoloji | Çalışma Şekli |
|---|---|---|
| `voice-only` | Yok | Sadece ses, avatar yok (her zaman çalışır) |
| `tavus` | Tavus API | Sunucu tarafında video sentezi, LiveKit video track |
| `simli` | Simli API | İstemci tarafında lip-sync video |
| `heygen` | HeyGen API | Sunucu tarafında avatar video |
| `did` | D-ID API | Sunucu tarafında konuşan yüz videosu |

**Seçim mekanizması:**
```js
// Agent belgesi üzerinden:
const avatar = getAvatarProvider(agentDoc.avatarProvider);
// Ya da ortam değişkeninden:
const avatar = getAvatarProvider(process.env.AVATAR_PROVIDER || 'voice-only');
```

**Hata toleransı:** Avatar bağlantısı başarısız olursa sistem `voice-only` moduna düşer; konuşma devam eder, sadece avatar görünmez.

---

### 5.10 `@repo/screen` — Ekran Zekası

İki farklı ekran modu vardır; her ikisi de `agentDoc.screenModes` ile kontrol edilir.

#### Mode A: `guided-tour` — Rehberli Tur

**Teknoloji:** Playwright (Chromium) + Sharp + LiveKit VideoSource

```
GuidedTour.open()
  ↓
chromium.launch({ headless: true })
  ↓
page.goto(product.websiteUrl)
  ↓
setInterval(1000): {
    page.screenshot() → PNG buffer
    sharp(png).resize(1280x720).ensureAlpha().raw() → RGBA buffer
    tourVideoSource.captureFrame(rgbaBuffer)
    → LiveKit VideoSource → LocalVideoTrack → room.localParticipant.publishTrack()
    → Ziyaretçi tarayıcısında canlı ekran görür
}
```

**Eşzamanlı tarayıcı limiti:** `activeBrowsers` Set'i ile global olarak izlenir. `MAX_TOUR_BROWSERS` (varsayılan 3) aşılırsa yeni tur başlatılamaz; bu sayede yüksek CPU/bellek tüketiminin önüne geçilir.

**Yönlendirme komutları:**
- `tour.goto(url)` → Sayfaya git
- `tour.highlight(selector)` → CSS selector ile elementi mor kenarlıkla vurgula
- `tour.click(selector)` → Elemente tıkla
- `tour.screenshot()` → Frame yakala

#### Mode B: `customer-share` — Müşteri Ekranı Vision

**Teknoloji:** LiveKit VideoStream + Sharp + GPT-4o Vision

```
Ziyaretçi ekranını paylaşır → LiveKit 'trackSubscribed' olayı tetiklenir
  ↓
VideoStream(track) nesnesi oluşturulur
  ↓
setInterval(1000): {
    videoStream iteratörünün next frame'ini al
    sharp(ARGB).resize(max 1024px wide).jpeg(80%) → base64
    latestCustomerFrameBase64 = 'data:image/jpeg;base64,...'
}
  ↓
AI 'read_customer_screen' aracını çağırır
  ↓
analyzeFrame(latestCustomerFrameBase64, question)
  ↓ describeImage() → GPT-4o Vision
  ↓ "Kullanıcı Ayarlar sayfasındadır. Sol menüde 'Billing' sekmesine tıklaması gerekiyor."
```

**Gizlilik:** Müşteri ekran paylaşımını durdurduğunda `track.ended` olayı tetiklenir; örnekleme durdurulur ve son frame bellekten silinir.

---

### 5.11 `@repo/agent` — Ajan Mantığı

#### `buildSystemPrompt({ name, product, persona })`

AI'ye verilen sistem prompt'unu oluşturur. Ajanın kimliği, ürün bilgisi, ton, dil, hedefler ve sınırlamalar (guardrails) bu prompt'a dahil edilir:

```
"You are Selin, a human-like AI sales representative for "CloudStore Pro".
Product summary: Enterprise cloud storage with AI-powered search.
Speak tr. Tone: profesyonel, samimi.

How you work:
- Answer using the product knowledge base via the search_knowledge tool...
- You can SHOW the product. Use start_guided_tour...
...

Your goals: Ürün demosunu tamamla; deneme hesabı açtır.

Guardrails:
- SLA garantisi verme.
- Aylık kullanıcı limitini kesinlikle söyleme."
```

#### `buildTools({ productId, tour, screen })`

LLM'in çağırabileceği araçları JSON Schema formatında tanımlar:

| Araç | Açıklama |
|---|---|
| `search_knowledge` | Ürün bilgi tabanında anlamsal arama |
| `start_guided_tour` | Ürünün canlı demosunu başlat |
| `navigate_to` | Demo tarayıcısında sayfaya git |
| `highlight` | Demo ekranında elementi vurgula |
| `read_customer_screen` | Müşterinin paylaştığı ekranı analiz et |

---

### 5.12 `@repo/storage` — Nesne Deposu

**Teknoloji:** AWS SDK v3 (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`) + MinIO

S3 uyumlu API üzerinden dosya yönetimi sağlar. MinIO ve gerçek AWS S3 aynı kod tarafından kullanılır.

#### `presignUpload(fileKey, contentType, expires)` — Yükleme Linki

Frontend doğrudan MinIO'ya yükler; API sunucusu büyük dosya trafiğini taşımaz.

#### `presignDownload(fileKey)` — İndirme Linki

Worker, dosyayı işlemek için geçici indirme linki alır.

#### `ensureBucket()` — Bucket Garantisi

API her başladığında `salesai-uploads` bucket'ının var olduğunu kontrol eder, yoksa oluşturur.

---

### 5.13 Diğer Yardımcı Paketler

| Paket | Amaç |
|---|---|
| `@repo/contracts` | Zod şemaları (API giriş doğrulama için sözleşmeler) |
| `@repo/validation` | Express middleware: `validate({ body: Schema })` |
| `@repo/config-env` | `.env` yükleyici; eksik zorunlu değişkenlerde boot'u durdurur |
| `@repo/logger` | Yapılandırılmış JSON loglama (tüm uygulamalarda aynı format) |
| `@repo/utils` | `shortId()` (oturum ID'leri), `shareToken()` (paylaşım token'ı) |

---

## 6. Uçtan Uca Akışlar

### 6.1 Kayıt & Giriş Akışı

```
POST /auth/register
  ↓
Zod doğrulama (email, password, name)
  ↓
hashPassword(plain) → bcrypt hash
  ↓
User.create({ email, passwordHash, name })
  ↓
Workspace.create({ name: "name's Workspace", ownerId: user._id })
  ↓
Membership.create({ userId, workspaceId, role: 'OWNER' })
  ↓
signTokens({ sub: user._id, email }) → { accessToken, refreshToken }
  ↓
201 { accessToken, refreshToken, user }
```

### 6.2 Bilgi Yükleme & İndeksleme Akışı

```
[Console UI]
POST /knowledge/upload-url { filename, contentType }
  ↓ presignUpload() → 15dk URL + fileKey

[Browser → MinIO, API bypass edildi]
PUT https://minio/salesai-uploads/{fileKey}  (binary dosya)

[Console UI]
POST /knowledge { productId, type, fileKey, mimeType }
  ↓ KnowledgeSource.create({ ...body, status: 'pending' })
  ↓ enqueue('ingestion', 'ingest-source', { sourceId, productId })
  ↓ 201 { id, status: 'pending' }

[worker-ingestion - asenkron]
BullMQ job işlendi
  → emitProgress events (Redis → Socket.IO → UI progress bar güncellenir)
  → Dosya türüne göre metin çıkarımı
  → chunkText() → chunk'lara böl
  → embedBatch() → vektörleştir
  → MongoVectorStore.upsert() → kaydet
  → KnowledgeSource.status = 'ready'
  → publishEvent(INGESTION_READY)
```

### 6.3 Gerçek Zamanlı Sesli Konuşma Akışı

```
[Satıcı]
POST /agents/:id/activate
  → Agent.status = 'active'
  → ShareLink.create({ token: '...' })
  → URL: "http://localhost:5174/v/abc123def456"

[Ziyaretçi tarayıcıdan URL'yi açar]
POST /sessions { shareToken: 'abc123def456', visitorName: 'Ali' }
  → ShareLink doğrulama (active, expiry, sessionCount)
  → Agent.status === 'active' kontrolü
  → Session.create({ agentId, roomName: 's_xyz', status: 'live' })
  → createAccessToken() → LiveKit JWT
  → dispatchAgent({ roomName, agentName: 'salesai-agent' })
  → 200 { roomName, token, livekitUrl }

[Visitor frontend]
LiveKit SDK → ws://localhost:7880 bağlantısı
  → token ile 's_xyz' odasına katıl
  → Mikrofon yayınlamaya başla

[LiveKit → agent-worker]
defineAgent.entry() tetiklendi
  → DB'den Session/Agent/Product yüklendi
  → buildSystemPrompt() + buildTools()
  → AgentSession.start({ agent, room })
  → OpenAI Realtime API bağlantısı
  → Ses akışı: Ziyaretçi ↔ OpenAI Realtime ↔ LiveKit ↔ Ziyaretçi
  → ConversationItemAdded → Message.create() + publishEvent(SESSION_TRANSCRIPT)

[Console UI (Socket.IO)]
'session:transcript' olayları gelir → transcript panelinde anlık gösterim
```

### 6.4 RAG (Bilgi Arama) Akışı

```
[AgentSession tool call: search_knowledge({ query })]
retrieve({ productId, query, topK: 8 })
  ↓
Redis cache kontrolü: 'rag:cache:{productId}:{query}:{topK}'
  ├─ HIT → JSON.parse ve hemen döndür
  └─ MISS:
       ↓ embed(query) → [0.023, ..., 0.012]
       ↓ Promise.all:
           MongoVectorStore.query()        → $vectorSearch → top-K chunks
           MongoVectorStore.keywordQuery() → $search (BM25) → top-K chunks
       ↓ Sonuçları birleştir (Map ile tekilleştir)
       ↓ rerank(query, mergedResults, 8) → bge-reranker-base cross-encoder
       ↓ redis.setex(cacheKey, 86400, JSON.stringify(reranked))
       ↓ Sonuçları döndür

[AI sonuçları alır ve doğal dilde sentezler]
"Fiyatlandırmamıza göre Starter plan aylık $29'dan başlar (kaynak: source_abc)."
```

### 6.5 Ekran Paylaşımı & Rehberli Tur Akışı

```
[Mode A: Guided Tour]
Ziyaretçi: "Bana billing özelliğini göster"
  ↓
AI: start_guided_tour({ url: '/billing' })
  ↓
GuidedTour.open() → chromium.launch({ headless: true })
  → page.goto(product.websiteUrl + '/billing')
  ↓
setInterval(1000ms):
  page.screenshot() → PNG
  sharp(png).resize(1280x720).ensureAlpha().raw() → RGBA
  tourVideoSource.captureFrame(rgba) → LiveKit video track
  → Ziyaretçi tarayıcısında 'screen_share' track görünür (~1 FPS)
  
AI: navigate_to('/billing/invoices') → page.goto()
AI: highlight('#invoice-table')      → el.style.outline = '3px solid #6d5efc'
AI: "Göründüğü gibi faturalarınız burada listelenmiştir..."

[Mode B: Customer Screen Share]
Ziyaretçi ekran paylaşımını başlatır → LiveKit 'trackSubscribed'
  ↓
VideoStream(track) → setInterval(1000ms):
  frame.data (ARGB) → sharp → resize 1024px → JPEG → base64
  latestCustomerFrameBase64 güncellendi

Ziyaretçi: "Bu sayfada ne yapmalıyım?"
AI: read_customer_screen({ question: "Kullanıcı ne yapmalı?" })
  ↓
analyzeFrame(base64, question) → describeImage() → GPT-4o
  → "Kullanıcı 'API Keys' sayfasındadır. 'Create New Key' butonuna tıklamalı."
AI: "Sağ üstteki 'Create New Key' butonuna tıklayabilirsiniz."
```

---

## 7. Veri Modelleri

### İlişki Diyagramı

```
User ─── Membership ─── Workspace
                              │
                          Product ─── KnowledgeSource ─── KnowledgeChunk
                              │                              (embedding [])
                           Agent ─── ShareLink
                              │
                           Session ─── Message
```

### Model Durumları

**KnowledgeSource.status:**
```
pending → (ingestion queue) → ready
                           ↘ failed  (3 deneme sonrası)
```

**Agent.status:**
```
draft → active ─→ paused
              └─→ archived
```

**Session.status:**
```
live → ended  (user kapanışı, timeout, veya agent disconnect)
```

**ShareLink.active:**
```
true → false  (expiresAt geçti veya maxSessions doldu)
```

---

## 8. Ortam Değişkenleri Referansı

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `MONGODB_URI` | `mongodb://localhost:27017/salesai?directConnection=true` | MongoDB bağlantı URI |
| `EMBEDDING_DIM` | `3072` | Embedding boyutu; Atlas index'iyle eşleşmeli |
| `REDIS_URL` | `redis://localhost:6380` | Redis bağlantısı (BullMQ + cache + pub/sub) |
| `S3_ENDPOINT` | `http://localhost:9000` | MinIO/S3 endpoint |
| `S3_BUCKET` | `salesai-uploads` | Dosya deposu bucket adı |
| `LIVEKIT_URL` | `ws://localhost:7880` | LiveKit WebSocket URL |
| `LIVEKIT_API_KEY` | `devkey` | LiveKit API anahtarı |
| `LIVEKIT_API_SECRET` | `secret` | LiveKit API gizli anahtarı |
| `LIVEKIT_AGENT_NAME` | `salesai-agent` | Worker dispatch adı; agent-worker'daki agentName ile eşleşmeli |
| `OPENAI_API_KEY` | _(zorunlu)_ | OpenAI API anahtarı |
| `OPENAI_REALTIME_MODEL` | `gpt-realtime-2` | Sesli konuşma modeli |
| `OPENAI_LLM_MODEL` | `gpt-5.1` | Metin sohbet modeli |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-large` | Embedding modeli |
| `AVATAR_PROVIDER` | `voice-only` | `voice-only` \| `tavus` \| `simli` \| `heygen` \| `did` |
| `VECTOR_STORE` | `mongodb` | `mongodb` (Atlas) \| `qdrant` |
| `MAX_TOUR_BROWSERS` | `3` | Eşzamanlı Playwright tarayıcı limiti |
| `JWT_SECRET` | `dev-access` | Access token gizli anahtarı (üretimde değiştir!) |
| `JWT_REFRESH_SECRET` | `dev-refresh` | Refresh token gizli anahtarı |
| `JWT_ACCESS_EXPIRES_IN` | `900` | Access token ömrü (saniye, 15 dk) |
| `JWT_REFRESH_EXPIRES_IN` | `604800` | Refresh token ömrü (saniye, 7 gün) |
| `CORS_ORIGIN` | `http://localhost:5173,http://localhost:5174` | İzin verilen frontend URL'leri |
| `VISITOR_PUBLIC_URL` | `http://localhost:5174` | Paylaşım linkinin base URL'i |

---

## 9. Teknoloji Seçimlerinin Gerekçesi

### Neden MongoDB Atlas Vector Search (ve neden Qdrant alternatifi var)?

MongoDB, ürün verisi için zaten kullanılmaktadır. Atlas Vector Search bu veri ile aynı sistem içinde semantik arama yapma imkânı tanır; ekstra servis gerektirmez. Ancak Qdrant özelleşmiş bir vektör DB olarak bazı senaryolarda daha iyi filtreleme ve ölçekleme sunar. Strateji deseni ile her iki seçenek aynı arayüzden sunulmaktadır; proje büyüdükçe geçiş yapılabilir.

### Neden BullMQ (ve neden Redis üstünde)?

Video transkripsiyon dakikalar sürebilir; bu işi senkron API isteğiyle yapmak mümkün değildir. BullMQ, Redis tabanlı olduğu için zaten altyapıda var olan Redis'e dayanır. Persistent kuyruğu, retry mekanizması ve cron desteğiyle SalesAI'nin ihtiyaçlarına birebir uymaktadır.

### Neden Socket.IO (WebSocket)?

Ingestion ilerleme bildirimleri ve konuşma transkripti gerçek zamanlı olarak frontend'e iletilmelidir. Socket.IO polling fallback, oda desteği ve Redis adapter ile yatay ölçekleme imkânı sunar. Tek başına Server-Sent Events (SSE) yeterli olabilirdi ancak ileride iki yönlü iletişim gerektiren özellikler için Socket.IO tercih edilmiştir.

### Neden LiveKit?

LiveKit, sunucu taraflı ajan entegrasyonunu birinci sınıf olarak destekler. `@livekit/agents` SDK ile Python veya Node.js ajanı doğrudan bir odaya katılabilir, ses track'i alabilir, konuşabilir, video track yayınlayabilir. Twilio veya Daily gibi alternatiflerde bu entegrasyon çok daha karmaşıktır.

### Neden Playwright (ve neden headless Chromium)?

Gerçek bir web tarayıcısını kontrol ederek ürünün gerçek hali gösterilir. Playwright, `screenshot()` ile PNG frame'leri alır; bu frame'ler Sharp ile işlenerek LiveKit video track'ine beslenir. Puppeteer yerine Playwright tercih edilmiştir çünkü Playwright çoklu tarayıcı (Chromium, Firefox, WebKit) desteği ve daha güçlü bir API sunar.

### Neden Sharp?

LiveKit `VideoSource.captureFrame()` raw RGBA/ARGB piksel tamponu bekler; PNG veya JPEG kabul etmez. Sharp, Node.js'in en hızlı görüntü işleme kütüphanesidir (libvips tabanlı) ve PNG → raw RGBA dönüşümünü milisaniyeler içinde gerçekleştirir. Müşteri ekranı için ARGB → JPEG → base64 dönüşümünü de Sharp üstlenir.

### Neden Hybrid Search + Cross-Encoder Rerank?

- **Dense (vektör) arama:** Semantik benzerlik. "Ödeme sistemi" sorusuna "billing infrastructure" içeren chunk'ı bulur.
- **Sparse (BM25) arama:** Exact match. Özel terim, ürün adı veya versiyon numarası gibi sorgularda güçlüdür.
- **Cross-Encoder rerank:** Her (query, document) çiftini birlikte değerlendirerek çok daha hassas alaka puanı hesaplar. Bi-encoder (dense) yönteminden daha yavaş ama çok daha doğrudur.

Üçünün kombinasyonu, tek bir yöntemden önemli ölçüde daha iyi RAG kalitesi sağlar.

### Neden Strategy Pattern (Avatar ve VectorStore)?

Avatar sağlayıcıları (Tavus, Simli, HeyGen, D-ID) ve vektör mağazaları (MongoDB, Qdrant) aynı arayüzü uygular. Yeni bir sağlayıcı eklemek için yalnızca yeni bir sınıf yazılır; çağrı noktaları değişmez. Test edilebilirlik de artar: gerçek sağlayıcı yerine mock sağlayıcı kolayca takılabilir.

---

*Bu döküman, projenin mevcut geliştirme aşamasını (Phase 0–3 tamamlanmış) yansıtmaktadır.*
*Yeni özellikler eklendikçe güncellenmesi önerilir.*
