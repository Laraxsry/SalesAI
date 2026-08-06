/**
 * Embeddable SalesAI widget loader. Sellers drop this on their own site to
 * launch the AI sales rep in a floating panel (iframe to the Visitor app,
 * Shadow DOM isolated so host styles don't leak in either direction).
 *
 * Usage:
 *   <script src="https://api.salesai.com/sdk/salesai.js"></script>
 *   <script>SalesAI.init({ shareToken: 's_abc123' }).mount();</script>
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
 * ───────────────────────────────────────────────────────────────────────
 */
const DEFAULT_API_BASE = 'https://api.salesai.com';
const DEFAULT_VISITOR_BASE = 'https://app.salesai.com';

const READY_MESSAGE = 'salesai:embed:ready';
const SESSION_MESSAGE = 'salesai:embed:session';
const CLOSE_MESSAGE = 'salesai:embed:close';
const RESIZE_MESSAGE = 'salesai:embed:resize';

const DEFAULT_THEME = { primaryColor: '#4f46e5' };
const DEFAULT_LAUNCHER = { position: 'bottom-right', label: 'Talk to sales' };

function launcherPositionStyle(position) {
    return position === 'bottom-left' ? 'left:24px' : 'right:24px';
}

/** Builds the collapsed launcher bubble element. */
function buildLauncherButton({ theme, launcher, onClick }) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = launcher.label;
    button.style.cssText = `
        all: initial;
        font: 600 14px/1 -apple-system, system-ui, sans-serif;
        position: fixed;
        bottom: 24px;
        ${launcherPositionStyle(launcher.position)};
        z-index: 2147483647;
        padding: 14px 20px;
        border-radius: 999px;
        border: 0;
        color: #fff;
        background: ${theme.primaryColor};
        box-shadow: 0 8px 24px rgba(0,0,0,.25);
        cursor: pointer;
    `;
    button.addEventListener('click', onClick);
    return button;
}

/** Builds the expanded conversation iframe (no session credentials in the URL). */
function buildConversationFrame({ visitorBaseUrl, shareToken, position, parentOrigin }) {
    const frame = document.createElement('iframe');
    frame.src = `${visitorBaseUrl}/v/${encodeURIComponent(shareToken)}?embed=1&parentOrigin=${encodeURIComponent(parentOrigin)}`;
    frame.title = 'SalesAI görüşmesi';
    frame.allow = 'camera; microphone; display-capture; autoplay';
    frame.style.cssText = `
        border: 0;
        position: fixed;
        bottom: 24px;
        ${launcherPositionStyle(position)};
        z-index: 2147483647;
        width: 380px;
        height: 560px;
        border-radius: 16px;
        box-shadow: 0 12px 40px rgba(0,0,0,.35);
    `;
    if (window.matchMedia('(max-width: 640px)').matches) {
        frame.style.inset = '0';
        frame.style.width = '100%';
        frame.style.height = '100%';
        frame.style.borderRadius = '0';
    }
    return frame;
}

export function init({
    shareToken,
    apiBaseUrl = DEFAULT_API_BASE,
    visitorBaseUrl = DEFAULT_VISITOR_BASE,
    position
} = {}) {
    if (!shareToken) throw new Error('SalesAI.init: shareToken is required');

    const visitorOrigin = new URL(visitorBaseUrl).origin;

    let shadowRoot;
    let launcherEl;
    let frameEl;
    let messageListener;
    let sessionAbortController;
    // Config hasn't loaded yet when the launcher first renders, so it starts
    // with sane defaults and is re-rendered in place once the fetch resolves
    // (unless the visitor already clicked through to a conversation).
    let resolvedConfig = { theme: DEFAULT_THEME, launcher: { ...DEFAULT_LAUNCHER, ...(position && { position }) } };

    /** Fetches the agent's public render config; never throws — falls back to defaults. */
    async function fetchConfig() {
        try {
            const res = await fetch(`${apiBaseUrl}/api/v1/embed/${encodeURIComponent(shareToken)}/config`);
            if (!res.ok) return;
            const config = await res.json();
            resolvedConfig = {
                theme: { ...DEFAULT_THEME, ...config.theme },
                // An explicit `position` passed to init() is a deliberate host-page
                // override and wins over the seller's dashboard default.
                launcher: { ...DEFAULT_LAUNCHER, ...config.launcher, ...(position && { position }) }
            };
            if (launcherEl && !frameEl) renderLauncher();
        } catch {
            // Network hiccup — keep the defaults already rendered.
        }
    }

    function renderLauncher() {
        if (!shadowRoot) return;
        launcherEl?.remove();
        launcherEl = buildLauncherButton({
            theme: resolvedConfig.theme,
            launcher: resolvedConfig.launcher,
            onClick: openConversation
        });
        shadowRoot.appendChild(launcherEl);
    }

    function closeConversation() {
        if (!shadowRoot) return;
        frameEl?.remove();
        frameEl = null;
        if (messageListener) {
            window.removeEventListener('message', messageListener);
            messageListener = null;
        }
        renderLauncher();
    }

    /** Mints an embed session (origin + rate-limit checked) and swaps the launcher for the conversation iframe. */
    async function openConversation() {
        if (!launcherEl || launcherEl.disabled) return;
        launcherEl.disabled = true;
        const originalLabel = launcherEl.textContent;
        launcherEl.textContent = '…';

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
            if (launcherEl) {
                launcherEl.disabled = false;
                launcherEl.textContent = originalLabel;
            }
            return;
        } finally {
            sessionAbortController = null;
        }

        if (!shadowRoot || !launcherEl) return;

        launcherEl.remove();
        launcherEl = null;

        messageListener = (event) => {
            if (event.origin !== visitorOrigin || event.source !== frameEl.contentWindow) return;
            if (event.data?.type === READY_MESSAGE) {
                frameEl.contentWindow.postMessage({ type: SESSION_MESSAGE, session }, visitorOrigin);
            } else if (event.data?.type === CLOSE_MESSAGE) {
                closeConversation();
            } else if (event.data?.type === RESIZE_MESSAGE && !window.matchMedia('(max-width: 640px)').matches) {
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
        shadowRoot.appendChild(frameEl);
    }

    function mount() {
        if (shadowRoot) return api;
        const host = document.createElement('div');
        shadowRoot = host.attachShadow({ mode: 'open' });
        document.body.appendChild(host);

        renderLauncher();
        fetchConfig();
        return api;
    }

    function unmount() {
        sessionAbortController?.abort();
        if (messageListener) window.removeEventListener('message', messageListener);
        shadowRoot?.host?.remove();
        shadowRoot = null;
        launcherEl = null;
        frameEl = null;
    }

    const api = { mount, unmount, close: closeConversation };
    return api;
}

if (typeof window !== 'undefined') {
    window.SalesAI = { init };
}

export default { init };
