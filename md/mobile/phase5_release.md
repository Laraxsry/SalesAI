# Mobile — Phase 5: Release & Store Readiness

> App: [`apps/mobile`](../../apps/mobile).
> Goal: ship to the App Store and Google Play with EAS builds, OTA updates,
> crash/analytics reporting, deep-link verification, and store compliance.

---

## Scope

- EAS Build + Submit pipelines for iOS and Android.
- EAS Update (OTA) with release channels.
- Universal links / App Links verification for share links.
- Crash reporting + product analytics.
- Store listing, privacy disclosures, and review compliance.

---

## Tasks

1. **Build & submit** (EAS)
   - [x] `eas build` profiles: `development`, `preview`, `production` configured in `eas.json`.
   - [ ] `eas submit` to App Store Connect + Google Play; managed credentials.
   - [x] App icons, splash, scheme, bundleId, and package configured in `app.json`.

2. **OTA updates** (EAS Update)
   - [x] Release channels mapped to build profiles in `eas.json`.
   - [ ] Update-on-launch policy with a fallback to store update for native changes.

3. **Deep links**
   - [ ] Verify iOS Universal Links (`apple-app-site-association`) and Android App
     Links (`assetlinks.json`) so `https://…/v/:token` opens the app.
   - [x] Configure `salesai://` custom URL scheme for local/dev deep links.

4. **Observability**
   - [ ] Crash reporting (Sentry) with source maps uploaded per build.
   - [x] Product analytics / error logging foundation.
   - [x] Correlate mobile errors with backend `sessionId` where possible.

5. **Store compliance**
   - [x] Permission usage strings in `app.json` (Microphone, Notifications).
   - [ ] Screenshots, descriptions, age rating, and support/marketing URLs.

6. **Release process**
   - [x] CI scripts: lint / test commands configured.
   - [ ] Automated EAS build -> TestFlight -> production pipeline.

---

## Acceptance criteria

- [ ] Production builds are submitted to both stores via EAS.
- [ ] An OTA update ships a JS-only change and can be rolled back.
- [x] A `salesai://v/:token` link opens the installed app to the visit screen.
- [ ] Crashes report with symbolicated stack traces; key funnels are tracked.
- [ ] Store review passes with complete privacy disclosures.

---

## Risks

- **Store review rejections** — mic/notification usage must be clearly justified;
  disclose data collection accurately.
- **OTA misuse** — never push native changes via OTA; gate by runtime version.
- **Universal link setup** — AASA/assetlinks hosting + signing must match exactly.
