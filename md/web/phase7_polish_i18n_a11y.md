# Web — Phase 7: Polish, i18n & Accessibility

> Apps: [`apps/console`](../../apps/console) + [`apps/visitor`](../../apps/visitor).
> Goal: production-grade polish — internationalization, accessibility, theming,
> performance, and error/empty states — so both apps feel finished and inclusive.

---

## Scope

- Internationalization (UI strings + agent language) with locale switching.
- WCAG 2.1 AA accessibility across console and visitor.
- Theming (light/dark/system) and a consistent design system in `@repo/ui`.
- Performance budget: code-splitting, lazy routes, asset optimization.
- Comprehensive loading / empty / error states.

---

## Tasks

1. **Internationalization**
   - `react-i18next` with per-locale message catalogs; language switcher.
   - Localize dates/numbers (Intl); RTL layout support (Arabic/Hebrew).
   - Visitor app: match UI locale to the agent's configured language.

2. **Accessibility (WCAG 2.1 AA)**
   - Keyboard navigation + visible focus everywhere; logical tab order.
   - ARIA roles/labels for custom components (menus, dialogs, tabs, charts).
   - Live regions for captions and status changes; prefers-reduced-motion.
   - Color-contrast audit; screen-reader passes on core flows.

3. **Theming & design system**
   - Light/dark/system via Tailwind v4 tokens (`@repo/tailwind-config`).
   - Consolidate primitives in `@repo/ui` (buttons, inputs, dialogs, toasts,
     tables, charts) with documented variants.

4. **Performance**
   - Route-based code splitting + lazy loading; prefetch on intent.
   - Optimize LiveKit/visitor bundle; defer non-critical work.
   - Set a performance budget; track Lighthouse/Web Vitals in CI.

5. **States & resilience**
   - Loading skeletons, empty states with CTAs, and friendly error boundaries.
   - Offline/disconnect handling for the visitor call; retry affordances.

6. **Quality**
   - Component tests + a few end-to-end happy-path tests (Playwright).
   - Visual regression on key screens.

---

## Acceptance criteria

- The UI can switch locales (incl. one RTL) with dates/numbers localized.
- Core flows are fully keyboard-navigable and pass an automated a11y audit.
- Light/dark/system themes work across both apps without contrast issues.
- Lighthouse performance + a11y scores meet the agreed budget in CI.
- Every list/detail screen has proper loading, empty, and error states.

---

## Risks

- **Translation drift** — extract strings via lint rule; no hardcoded copy.
- **A11y regressions** — add automated axe checks to CI.
- **Bundle creep** — enforce the budget; fail CI on regressions.
