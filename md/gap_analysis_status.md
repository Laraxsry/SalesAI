# Gap Analysis — Durum Özeti

> Kaynak: `md/` faz checklist’leri vs mevcut kod (2026-07-23).
> Sonuç: API-ağır işler ileride; seller-facing console ve mobile geride.

---

## Durum efsanesi

| Etiket | Anlam |
|---|---|
| Hazır | Doc + kod uyumlu, anlamlı gap yok |
| Kısmi | Kod var ama eksik / doc overclaim |
| Açık | Henüz yapılmadı veya sadece iskelet |
| Doc drift | Kod var, checklist güncel değil |

---

## Backend

| Faz | Doc | Kod | Durum | Eksik / not |
|---|---|---|---|---|
| 0 Foundation | Done | Var | Hazır | — |
| 1 RAG | Done | Var | Hazır | — |
| 2 Realtime agent | Done | Var | Hazır | — |
| 3 Screen intelligence | Done | Playwright + vision | Kısmi | Browserbase/Stagehand; demo-account tour auth |
| 4 Analytics | Done; CRM açık | Summary/leads/gaps/search | Kısmi | `POST /integrations/crm/lead` yok |
| 5 Embed SDK | Unchecked | API + `@repo/sdk` + origin check | Doc drift | Studio UI Web 6’da; doc güncellenmeli |
| 6 Billing / quotas | Done | Stripe/mock + quotas | Hazır | Console UI Web 5’te eksik |
| 7 Observability | Unchecked | Yok / minimal | Açık | Fallback, OTEL, Prometheus, `/ready`, DLQ, load/chaos |
| 8 Security / scale | Kısmi | Auth/PII/audit/2FA API | Kısmi | CI audit/Trivy, multi-pod Socket.IO, DR drill, secrets-manager AC |

---

## Web

| Faz | Doc | Kod | Durum | Eksik / not |
|---|---|---|---|---|
| 1 Console | Hepsi `[x]` | Auth, products, knowledge, agents, leads | Kısmi | Sessions stub; live transcript yok; DnD / RHF+Zod overclaim |
| 2 Visitor | Done | LiveKit visitor | Hazır | — |
| 3 Cobrowse UI | Done | Tour / share layout | Hazır | — |
| 4 Analytics UI | Sadece leads `[x]` | `/leads` | Açık | KPI, `/analytics`, sessions detail, `/knowledge/gaps` |
| 5 Team & billing | Unchecked | Settings: account/workspace | Açık | Members, Stripe, usage, API keys, `/invite/:token` |
| 6 Embed Studio | Unchecked | AgentDetail iframe snippet | Açık | Studio, live preview, `salesai.js` snippet |
| 7 Polish | Unchecked | Yok | Açık | i18n/RTL, a11y AA, themes, Playwright |

---

## Mobile

| Faz | Doc | Kod | Durum | Eksik / not |
|---|---|---|---|---|
| 1 Visitor | Açık | Expo iskelet | Açık | Deep link + LiveKit + mic/captions |
| 2 Avatar / screen | Açık | Minimal | Açık | Provider avatars, tour, share |
| 3 Push & saved | Açık | Mock (`push.js`, `savedConversations.js`) | Açık | Devices, magic-link, `/sessions/mine`, push |
| 4 Console-lite | Auth `[x]` | Auth + dashboard stub | Kısmi | Live sessions, analytics, leads, pause/resume |
| 5 Release | Açık | Yok | Açık | EAS, store, Sentry, universal links |

---

## Backend hazır → UI eksik

| Backend | Console / UI gap |
|---|---|
| Analytics API | Dashboard, sessions, gaps |
| Invitations + Stripe + usage | Settings shell |
| Embed config/session + `salesai.js` | Embed Studio |
| 2FA / API keys / privacy / audit | Settings UI |

---

## Doc overclaim (checklist `[x]`, kod yetersiz)

**Web Phase 1** (`md/web/phase1_console.md`):

- `/agents/:id/sessions` → sadece başlık stub
- Overview KPI / recent sessions yok (asıl Web Phase 4)
- Knowledge drag-and-drop yok (file input var)
- React Hook Form + Zod kullanılmıyor
- Live transcript stream UI yok (API var)

**Embed:** console snippet = visitor iframe; loader + studio yok. Backend embed path yazılmış; Phase 5 doc unchecked kalmış.

---

## Öncelik sırası

### P0 — Console

1. Web Phase 4 — analytics + sessions + gaps (backend hazır; Phase 1 transcript AC’yi de kapatır)
2. Web Phase 5 — team / billing / API keys UI
3. Web Phase 6 — Embed Studio + SDK snippet

### P1 — Production

4. Backend Phase 7 — observability & fallbacks
5. Backend Phase 8 kalan AC — CI security, Socket.IO scale, DR, secrets

### P2 — Mobile + polish

6. Mobile 1–2 visitor/avatar
7. Mobile 3 push/saved
8. Mobile 4 console-lite tamamla
9. Mobile 5 release
10. Web Phase 7 i18n/a11y

### P3 — Ertelenmiş

- CRM webhook (BE 4)
- Browserbase/Stagehand + demo-account auth (BE 3 notes)

---

## Numaralandırma notu

| Konu | Backend | Web |
|---|---|---|
| Embed / widget | Phase 5 | Phase 6 |
| Team / billing | Phase 6 | Phase 5 |

---

## Önerilen sonraki odak

**Web Phase 4** (sessions + analytics + gaps): en yüksek ROI — backend hazır, Phase 1 overclaim’ini düzeltir, overview’u gerçek dashboard yapar.
