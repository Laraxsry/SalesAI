# 🆘 SalesAI — Disaster Recovery Playbook

> **Amaç:** Felaket kurtarma senaryolarında RTO (Recovery Time Objective) ve RPO
> (Recovery Point Objective) hedeflerini karşılamak için adım adım kılavuz.
>
> **RTO Hedefi:** < 1 saat  
> **RPO Hedefi:** < 5 dakika (MongoDB PITR ile)

---

## Senaryo 1: MongoDB Veri Kaybı / Bozulması

### Belirtiler
- Uygulama MongoDB'ye bağlanamıyor (`/ready` → `mongo: false`)
- Sorgular beklenmedik sonuçlar döndürüyor (data corruption)
- Atlas cluster'ı offline

### Adımlar

#### 1.1 — Etki Tespiti
```bash
# API sağlık kontrolü
curl http://localhost:5001/ready

# MongoDB Atlas console'da cluster durumunu kontrol et
# https://cloud.mongodb.com → Clusters → <cluster-name>
```

#### 1.2 — Uygulamayı Maintenance Moduna Al
```bash
# Tüm pod'lara maintenance modunu aktifleştir
kubectl set env deployment/salesai-api MAINTENANCE_MODE=true
# veya API'yi geçici olarak durdur
kubectl scale deployment/salesai-api --replicas=0
```

#### 1.3 — MongoDB Atlas PITR Restore
1. Atlas Console → **Clusters** → **...** → **Restore**
2. **Point in Time** seçeneğini seç
3. Kurtarılmak istenen timestamp'i belirle (son başarılı backup'tan önce)
4. Hedef cluster'ı seç (aynı cluster veya yeni cluster)
5. **Restore** butonuna bas
6. İşlem tamamlanana kadar bekle (genellikle 15-45 dakika)

#### 1.4 — Veri Tutarlılığını Doğrula
```bash
# Toplam döküman sayılarını kontrol et
mongosh $MONGODB_URI --eval "
  db.getSiblingDB('salesai').getCollectionNames().forEach(c => {
    print(c + ': ' + db.getSiblingDB('salesai')[c].countDocuments())
  })
"
```

#### 1.5 — Uygulamayı Yeniden Başlat
```bash
kubectl scale deployment/salesai-api --replicas=3
kubectl set env deployment/salesai-api MAINTENANCE_MODE-
```

---

## Senaryo 2: Redis Kaybı

### Belirtiler
- Rate limiting çalışmıyor
- Socket.IO event'leri iletilmiyor
- Session caching bozulmuş

### Adımlar

#### 2.1 — Redis'i Yeniden Başlat
```bash
# Docker ortamı
docker compose -f infra/docker-compose.yaml restart salesai-redis

# Kubernetes ortamı
kubectl rollout restart statefulset/redis
```

#### 2.2 — AOF Restore (eğer data önemliyse)
Redis AOF (Append Only File) etkinse:
```bash
# AOF dosyasını kontrol et
ls -la /data/appendonly.aof

# Redis'i AOF ile başlat
redis-server --appendonly yes --appendonlyfile /data/appendonly.aof
```

#### 2.3 — Uygulama Reconnect
Redis yeniden başlayınca uygulamalar otomatik bağlanır (ioredis retry logic).

---

## Senaryo 3: S3 / MinIO Dosya Kaybı

### Belirtiler
- Knowledge source upload'ları başarısız
- Presigned URL'ler çalışmıyor

### Adımlar

#### 3.1 — MinIO Durumunu Kontrol Et
```bash
curl http://localhost:9001/health/live
```

#### 3.2 — S3 Lifecycle Policy Kontrolü
```bash
# AWS CLI ile bucket lifecycle'ı kontrol et
aws s3api get-bucket-lifecycle-configuration --bucket salesai-uploads
```

#### 3.3 — Silinen Dosyaları Glacier'dan Geri Yükle
```bash
# Glacier'dan restore başlat (1-5 dakika Expedited, 3-5 saat Standard)
aws glacier initiate-job \
  --vault-name salesai-backup \
  --job-parameters '{"Type":"archive-retrieval","ArchiveId":"<archive-id>","Tier":"Expedited"}'
```

---

## Senaryo 4: Tüm Pod'lar Çöktü (Total Outage)

### Adımlar

```bash
# 1. Infra'yı başlat
docker compose -f infra/docker-compose.yaml up -d
# veya Kubernetes'te
kubectl apply -f infra/k8s/

# 2. Migration'ları çalıştır
npm run db:migrate

# 3. Uygulamaları başlat
kubectl rollout restart deployment/salesai-api
kubectl rollout restart deployment/salesai-worker-general
kubectl rollout restart deployment/salesai-worker-ingestion

# 4. Sağlık kontrolü
curl http://localhost:5001/ready
```

---

## Kontrol Listesi — Kurtarma Sonrası

- [ ] `/ready` endpoint'i tüm bağımlılıklar için `ok: true` döndürüyor
- [ ] Birkaç test session oluşturuldu ve başarıyla sonlandırıldı
- [ ] Lead capture ve webhook akışı test edildi
- [ ] Stripe webhook'ları çalışıyor (billing/webhook endpoint'i canlı)
- [ ] Socket.IO bağlantısı ve real-time event'ler çalışıyor
- [ ] Monitoring (Grafana/Prometheus) yeniden bağlandı
- [ ] Incident report'u yazdı ve ekiple paylaş

---

## İletişim

| Rol | Sorumluluk |
|-----|-----------|
| Backend Lead | MongoDB restore, API pod'ları |
| DevOps | Kubernetes, Docker, infra |
| Product Owner | Kullanıcı iletişimi, karar alma |

---

*Son güncelleme: 28.07.2026*
