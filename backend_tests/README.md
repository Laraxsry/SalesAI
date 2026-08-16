# backend_tests

Ad-hoc doğrulama script'leri — `packages/*/src/*.test.js` içindeki asıl
vitest birim testlerinin (bkz. `npm test`) yerini almaz, onları tamamlar.
Buradakiler `node dosya.mjs` ile doğrudan çalıştırılan, kendi pass/fail
raporlamasını (`✅`/`❌` + `process.exit(1)`) kendi yapan bağımsız script'ler.

## Klasörler

- **`unit/`** — hiçbir canlı servise (DB/Redis/MinIO/LiveKit/OpenAI/HTTP
  sunucusu) ihtiyaç duymaz, saf mantığı test eder (ör. format algılama,
  Zod şema doğrulama). Her zaman, her ortamda çalışır.
- **`integration/`** — gerçek pipeline'ı uçtan uca doğrular; genelde
  `npm run infra:up` (Mongo/Redis/MinIO/LiveKit) ve/veya ayakta bir
  `npm run dev:api` ve geçerli API anahtarları (`OPENAI_API_KEY` vb.) ister.
  Dosya başlarındaki yorumlar ön koşulları belirtir.

## Çalıştırma

```bash
npm run test:backend             # unit + integration, hepsi
npm run test:backend:unit        # sadece unit (infra gerekmez)
npm run test:backend:integration # sadece integration (infra + API gerekir)

# Tek bir dosya:
node backend_tests/unit/extract-document-text.mjs
```

`run-all.mjs` klasörleri glob ile tarar — **yeni bir dosya eklemek için
hiçbir yeri kayıt etmeye gerek yok**, `unit/` veya `integration/` altına
bırakmak yeterli, bir sonraki `npm run test:backend` çalıştırmasında
otomatik dahil olur.

## Yeni test eklerken

Saf mantık (dosya/DB/ağ bağımlılığı yok) → `unit/`. Gerçek bir servise
dokunuyorsa (Mongo, S3/MinIO, LiveKit, OpenAI, çalışan bir HTTP sunucusu,
Playwright/tarayıcı) → `integration/`. Şüpheye düşersen: "bu script CI'da
hiçbir Docker container'ı ayakta olmadan yeşil geçer mi?" sorusu ayracı.
