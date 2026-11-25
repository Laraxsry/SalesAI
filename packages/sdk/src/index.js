/**
 * Embeddable SalesAI widget loader. Sellers drop this on their own site to
 * launch the AI sales rep in a floating panel (iframe to the Visitor app,
 * Shadow DOM isolated so host styles don't leak in either direction).
 *
 * Usage:
 *   <script src="https://api.salesai.com/sdk/salesai.js"></script>
 *   <script>SalesAI.init({ shareToken: 's_abc123' }).mount();</script>
 *
 * Optional init overrides (the host page wins over the seller's dashboard
 * config): `position` ('bottom-right' | 'bottom-left') and `label` (launcher
 * text; can be changed later with `.setLabel()`, e.g. on a language switch).
 *
 * `onClose(summary)` fires when a conversation panel closes, so the host page
 * can act on the moment right after a conversation (e.g. a signup prompt):
 *   { reason: 'visitor' | 'host', connected: boolean, durationMs: number }
 * `reason` is 'visitor' when the visitor closed it from inside the panel and
 * 'host' for a `.close()` call; `connected` is whether the panel ever got its
 * session (i.e. the conversation could actually start).
 *
 * Why the session is minted from THIS script, not from inside the iframe:
 * the embed session endpoint (POST /api/v1/embed/:token/session) enforces a
 * per-agent domain allowlist by checking the request's Origin header. That
 * check is only meaningful if the request is made by code actually executing
 * on the seller's page — a fetch from inside the iframe would carry the
 * iframe's own origin (the Visitor app's domain), not the seller's, and
 * would never match any seller's allowlist. So this loader does the
 * session-minting handshake itself, then hands the result into the iframe
 * over `postMessage` (see CONTRACT below) rather than letting the iframe
 * request its own session.
 *
 * ─── CONTRACT with the Visitor app (apps/visitor, web Phase 6) ───────────
 * The iframe is loaded at `${visitorBaseUrl}/v/${shareToken}?embed=1` with
 * no session credentials in the URL (avoids leaking a LiveKit token into
 * browser history / Referer headers / server logs).
 *
 *   1. Visitor app, once mounted and ready to receive credentials, posts:
 *        window.parent.postMessage(
 *          { type: 'salesai:embed:ready' },
 *          '<the embedding page's origin>'
 *        )
 *
 *   2. This loader, on receiving that message from the iframe's own origin,
 *      responds with:
 *        iframe.contentWindow.postMessage(
 *          { type: 'salesai:embed:session', session: { roomName, token, livekitUrl } },
 *          '<visitorBaseUrl origin>'
 *        )
 *
 *   3. Visitor app joins the LiveKit room using that payload directly,
 *      instead of calling POST /sessions itself.
 *
 *   Panel size (expand to ~90% of the viewport and back): this loader owns
 *   the frame's size, so it is the source of truth. Right after the session
 *   — and whenever it changes — it tells the iframe:
 *        { type: 'salesai:embed:layout', expanded, canExpand }
 *   (`canExpand` is false on narrow screens, where the panel is already
 *   full-screen). The iframe asks for a change with:
 *        { type: 'salesai:embed:expand', expanded: true | false }
 * ───────────────────────────────────────────────────────────────────────
 */
import { startVoiceOrb } from '@repo/ui/voice-orb-renderer.js';
import { LAUNCHER_CSS, LAUNCHER_ORB_SIZE, launcherCopy, resolveLauncherLabel, resolveLocale, waveStepMs } from './launcher.js';

const DEFAULT_API_BASE = 'https://api.salesai.com';
const DEFAULT_VISITOR_BASE = 'https://app.salesai.com';

const READY_MESSAGE = 'salesai:embed:ready';
const SESSION_MESSAGE = 'salesai:embed:session';
const CLOSE_MESSAGE = 'salesai:embed:close';
const RESIZE_MESSAGE = 'salesai:embed:resize';
const EXPAND_MESSAGE = 'salesai:embed:expand';
const LAYOUT_MESSAGE = 'salesai:embed:layout';

const DEFAULT_THEME = { primaryColor: '#4f46e5' };
const DEFAULT_POSITION = 'bottom-right';

/** How long the "couldn't connect" label stays before the launcher resets. */
const ERROR_RESET_MS = 3500;
/** Upper bound for the panel's close animation, in case `animationend` never fires (e.g. backgrounded tab). */
const CLOSE_ANIMATION_FALLBACK_MS = 400;

const MOBILE_QUERY = '(max-width: 640px)';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function currentLocale() {
    return resolveLocale({ documentLang: document.documentElement.lang, navigatorLanguage: navigator.language });
}

function positionClass(position) {
    return position === 'bottom-left' ? 'pos-left' : 'pos-right';
}

/**
 * Attaches the launcher stylesheet to the shadow root. A constructed
 * stylesheet is CSSOM, so a seller's strict CSP `style-src` (no
 * 'unsafe-inline') can't block it the way it would block a `<style>` tag;
 * the tag is only the fallback for browsers without constructable sheets.
 */
function adoptStyles(shadowRoot) {
    try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(LAUNCHER_CSS);
        shadowRoot.adoptedStyleSheets = [sheet];
    } catch {
        const style = document.createElement('style');
        style.textContent = LAUNCHER_CSS;
        shadowRoot.appendChild(style);
    }
}

function el(tag, className, attrs = {}) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    return node;
}

/**
 * Builds the collapsed launcher. The positioned wrapper owns the entrance
 * motion and the button owns hover/press/shake, so the two transforms never
 * fight over the same element.
 */
function buildLauncher(onClick) {
    const wrap = el('div', 'wrap');
    const button = el('button', 'launcher', { type: 'button', 'aria-busy': 'false' });
    const orb = el('canvas', 'orb', { 'aria-hidden': 'true' });
    const label = el('span', 'label');
    const labelText = el('span', 'label-text');
    // While connecting, the visible label is split into one span per letter
    // (the loading wave), which screen readers could spell out — so the
    // button's accessible name lives in aria-label, and failures are
    // announced through a polite live region.
    const status = el('span', 'sr-only', { role: 'status', 'aria-live': 'polite' });

    label.append(labelText);
    button.append(orb, label);
    wrap.append(button, status);
    button.addEventListener('click', onClick);
    return { wrap, button, labelText, status, orb };
}

/** Builds the expanded conversation iframe (no session credentials in the URL). */
function buildConversationFrame({ visitorBaseUrl, shareToken, position, parentOrigin }) {
    const frame = el('iframe', `frame ${positionClass(position)}`);
    frame.src = `${visitorBaseUrl}/v/${encodeURIComponent(shareToken)}?embed=1&parentOrigin=${encodeURIComponent(parentOrigin)}`;
    frame.title = 'SalesAI görüşmesi';
    frame.allow = 'camera; microphone; display-capture; autoplay';
    return frame;
}

/** Plays the close animation (scaling back toward the launcher corner), then removes the frame. */
function dismissFrame(frame) {
    if (window.matchMedia(REDUCED_MOTION_QUERY).matches) {
        frame.remove();
        return;
    }
    const remove = () => frame.remove();
    frame.addEventListener('animationend', remove, { once: true });
    setTimeout(remove, CLOSE_ANIMATION_FALLBACK_MS);
    frame.classList.add('is-closing');
}

export function init({
    shareToken,
    apiBaseUrl = DEFAULT_API_BASE,
    visitorBaseUrl = DEFAULT_VISITOR_BASE,
    position,
    label,
    onClose
} = {}) {
    if (!shareToken) throw new Error('SalesAI.init: shareToken is required');

    const visitorOrigin = new URL(visitorBaseUrl).origin;

    let shadowRoot;
    let launcher; // { wrap, button, labelText, status, orb } — built once, updated in place
    let frameEl;
    let messageListener;
    let sessionAbortController;
    let errorTimer;
    let labelOverride = label || undefined;
    let conversation; // { openedAt, connected } while a panel is open
    let expanded = false;
    let backdropEl;
    let mobileQuery;
    let stopOrb;
    let orbMode = 'idle'; // 'idle' at rest, 'speaking' while hovered/focused, 'thinking' while connecting
    // Config hasn't loaded yet when the launcher is built, so it starts from
    // defaults and is updated in place once the fetch resolves. The launcher
    // only slides in after ENTRANCE_DELAY_MS, so a normal config fetch lands
    // before the visitor ever sees the default label.
    let resolvedConfig = {
        theme: DEFAULT_THEME,
        launcher: { position: position || DEFAULT_POSITION, label: undefined }
    };

    /** Fetches the agent's public render config; never throws — falls back to defaults. */
    async function fetchConfig() {
        try {
            const res = await fetch(`${apiBaseUrl}/api/v1/embed/${encodeURIComponent(shareToken)}/config`);
            if (!res.ok) return;
            const config = await res.json();
            resolvedConfig = {
                theme: { ...DEFAULT_THEME, ...config.theme },
                launcher: {
                    // An explicit `position` passed to init() is a deliberate host-page
                    // override and wins over the seller's dashboard default.
                    position: position || config.launcher?.position || DEFAULT_POSITION,
                    label: config.launcher?.label
                }
            };
            applyLauncher();
        } catch {
            // Network hiccup — keep the defaults already rendered.
        }
    }

    /** Syncs the launcher's label, side and color with the current config/overrides. */
    function applyLauncher() {
        if (!shadowRoot || !launcher) return;
        shadowRoot.host.style.setProperty('--sa-primary', resolvedConfig.theme.primaryColor);

        const isLeft = resolvedConfig.launcher.position === 'bottom-left';
        launcher.wrap.classList.toggle('pos-left', isLeft);
        launcher.wrap.classList.toggle('pos-right', !isLeft);

        // Don't clobber the error message mid-display; its reset re-applies.
        if (errorTimer) return;
        const text = resolveLauncherLabel({
            override: labelOverride,
            configLabel: resolvedConfig.launcher.label,
            locale: currentLocale()
        });
        renderLabel(text);
        launcher.button.setAttribute('aria-label', text);
    }

    /** Narrow screens already get a full-screen panel, so there's nothing to expand into. */
    function canExpand() {
        return !window.matchMedia(MOBILE_QUERY).matches;
    }

    /** Tells the iframe the current panel size so its expand/collapse button always matches reality. */
    function postLayout() {
        frameEl?.contentWindow?.postMessage({ type: LAYOUT_MESSAGE, expanded, canExpand: canExpand() }, visitorOrigin);
    }

    function setExpanded(next) {
        const value = Boolean(next) && Boolean(frameEl) && canExpand();
        if (value !== expanded) {
            expanded = value;
            frameEl?.classList.toggle('is-expanded', expanded);
            backdropEl?.classList.toggle('is-visible', expanded);
        }
        // Echo even when unchanged, so a refused request still resyncs the iframe's button.
        postLayout();
    }

    function handleViewportChange() {
        if (!frameEl) return;
        if (!canExpand()) setExpanded(false);
        else postLayout();
    }

    function setBusy(busy) {
        launcher.button.disabled = busy;
        launcher.button.setAttribute('aria-busy', String(busy));
        orbMode = busy ? 'thinking' : 'idle';
        // Turning busy off needs no restore here: every path out of busy
        // (error message, or hide + applyLauncher on return) rewrites the text.
        if (busy) renderLabel(launcher.labelText.textContent);
    }

    /** Shows `text` as the label: plain at rest, as a letter-by-letter wave while connecting. */
    function renderLabel(text) {
        const labelText = launcher.labelText;
        if (!launcher.button.disabled) {
            labelText.textContent = text;
            return;
        }
        const chars = Array.from(text); // code points, so ş/ğ/emoji stay whole
        labelText.style.setProperty('--sa-wave-step', `${waveStepMs(chars.length)}ms`);
        labelText.replaceChildren(
            ...chars.map((char, index) => {
                const span = el('span', 'wave-char');
                span.style.setProperty('--i', String(index));
                span.textContent = char;
                return span;
            })
        );
    }

    /**
     * Runs the launcher's voice orb — the same renderer as the in-app
     * VoiceOrb. Only while the launcher is visible: an rAF loop on every
     * seller's page shouldn't keep drawing behind an open panel.
     */
    function startOrb() {
        if (stopOrb || !launcher) return;
        stopOrb = startVoiceOrb(launcher.orb, {
            size: LAUNCHER_ORB_SIZE,
            glow: false,
            discRatio: 0.86,
            lineScale: 0.6,
            getMode: () => orbMode,
            // No audio before a conversation — hovering makes the orb "talk"
            // with a synthetic, speech-like level instead.
            getLevel: () => {
                const t = performance.now();
                return 0.45 + 0.35 * Math.sin(t / 160) * Math.sin(t / 410);
            }
        });
    }

    function stopOrbLoop() {
        stopOrb?.();
        stopOrb = null;
    }

    function setHovering(hovering) {
        if (launcher?.button.disabled) return;
        orbMode = hovering ? 'speaking' : 'idle';
    }

    function clearError() {
        clearTimeout(errorTimer);
        errorTimer = null;
        if (!launcher) return;
        launcher.button.classList.remove('is-error');
        launcher.status.textContent = '';
    }

    function showError() {
        const message = launcherCopy(currentLocale()).error;
        clearError();
        launcher.labelText.textContent = message;
        launcher.button.setAttribute('aria-label', message);
        launcher.status.textContent = message;
        // Force a reflow so a second failure in a row replays the shake.
        void launcher.button.offsetWidth;
        launcher.button.classList.add('is-error');
        errorTimer = setTimeout(() => {
            clearError();
            applyLauncher();
        }, ERROR_RESET_MS);
    }

    function closeConversation(reason = 'host') {
        if (!shadowRoot) return;
        if (messageListener) {
            window.removeEventListener('message', messageListener);
            messageListener = null;
        }
        if (expanded) {
            expanded = false;
            backdropEl?.classList.remove('is-visible');
        }
        if (frameEl) {
            dismissFrame(frameEl);
            frameEl = null;
        }
        if (launcher?.wrap.hidden) {
            // Coming back from a conversation: replay the entrance, without the first-load delay.
            launcher.wrap.classList.add('is-returning');
            launcher.wrap.hidden = false;
            orbMode = 'idle';
            startOrb();
            applyLauncher();
        }
        if (conversation) {
            const summary = {
                reason,
                connected: conversation.connected,
                durationMs: Date.now() - conversation.openedAt
            };
            conversation = null;
            try {
                onClose?.(summary);
            } catch {
                // A throwing host callback must not break the widget.
            }
        }
    }

    /** Mints an embed session (origin + rate-limit checked) and swaps the launcher for the conversation iframe. */
    async function openConversation() {
        if (!launcher || launcher.button.disabled || frameEl) return;
        clearError();
        applyLauncher();
        setBusy(true);

        let session;
        try {
            sessionAbortController = new AbortController();
            const res = await fetch(`${apiBaseUrl}/api/v1/embed/${encodeURIComponent(shareToken)}/session`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pageUrl: location.href }),
                signal: sessionAbortController.signal
            });
            if (!res.ok) throw new Error(`Session request failed: ${res.status}`);
            session = await res.json();
        } catch {
            if (!shadowRoot) return; // unmounted mid-request
            setBusy(false);
            showError();
            return;
        } finally {
            sessionAbortController = null;
        }

        if (!shadowRoot) return;

        setBusy(false);
        launcher.wrap.hidden = true;
        stopOrbLoop();

        messageListener = (event) => {
            if (!frameEl || event.origin !== visitorOrigin || event.source !== frameEl.contentWindow) return;
            if (event.data?.type === READY_MESSAGE) {
                frameEl.contentWindow.postMessage({ type: SESSION_MESSAGE, session }, visitorOrigin);
                postLayout();
                if (conversation) conversation.connected = true;
            } else if (event.data?.type === CLOSE_MESSAGE) {
                closeConversation('visitor');
            } else if (event.data?.type === EXPAND_MESSAGE) {
                setExpanded(event.data.expanded === true);
            } else if (event.data?.type === RESIZE_MESSAGE && !window.matchMedia(MOBILE_QUERY).matches) {
                const height = Math.min(Math.max(Number(event.data.height) || 560, 360), 760);
                frameEl.style.height = `${height}px`;
            }
        };
        window.addEventListener('message', messageListener);

        // Register the listener before attaching the iframe so its initial
        // ready message cannot win a race against the parent page.
        frameEl = buildConversationFrame({
            visitorBaseUrl,
            shareToken,
            position: resolvedConfig.launcher.position,
            parentOrigin: location.origin
        });
        conversation = { openedAt: Date.now(), connected: false };
        shadowRoot.appendChild(frameEl);
    }

    function mount() {
        if (shadowRoot) return api;
        const host = document.createElement('div');
        shadowRoot = host.attachShadow({ mode: 'open' });
        adoptStyles(shadowRoot);
        launcher = buildLauncher(openConversation);
        for (const [type, hovering] of [['pointerenter', true], ['pointerleave', false], ['focus', true], ['blur', false]]) {
            launcher.button.addEventListener(type, () => setHovering(hovering));
        }
        // Dims the page behind an expanded panel; clicking it shrinks the panel back.
        backdropEl = el('div', 'backdrop', { 'aria-hidden': 'true' });
        backdropEl.addEventListener('click', () => setExpanded(false));
        shadowRoot.append(backdropEl, launcher.wrap);
        document.body.appendChild(host);

        mobileQuery = window.matchMedia(MOBILE_QUERY);
        mobileQuery.addEventListener('change', handleViewportChange);

        applyLauncher();
        startOrb();
        fetchConfig();
        return api;
    }

    function unmount() {
        sessionAbortController?.abort();
        stopOrbLoop();
        clearTimeout(errorTimer);
        errorTimer = null;
        if (messageListener) window.removeEventListener('message', messageListener);
        messageListener = null;
        mobileQuery?.removeEventListener('change', handleViewportChange);
        mobileQuery = null;
        expanded = false;
        backdropEl = null;
        shadowRoot?.host?.remove();
        shadowRoot = null;
        launcher = null;
        frameEl = null;
        conversation = null; // tearing the widget down isn't a conversation ending — no onClose
    }

    /** Replaces the launcher text (host-page override); pass a falsy value to fall back to config/locale. */
    function setLabel(nextLabel) {
        labelOverride = nextLabel || undefined;
        applyLauncher();
        return api;
    }

    const api = { mount, unmount, close: () => closeConversation('host'), setLabel };
    return api;
}

if (typeof window !== 'undefined') {
    window.SalesAI = { init };
}

export default { init };
