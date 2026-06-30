/**
 * Embeddable SalesAI widget. Sellers drop this on their own site to launch the
 * AI sales rep in a floating panel (iframe to the Visitor app, Shadow DOM
 * isolated so host styles don't leak).
 *
 * Usage:
 *   <script src="https://cdn.salesai.com/sdk/v1/salesai.js"></script>
 *   <script>SalesAI.init({ shareToken: 's_abc123' }).mount();</script>
 */
const DEFAULT_BASE = 'https://app.salesai.com/v';

export function init({ shareToken, baseUrl = DEFAULT_BASE, position = 'bottom-right' } = {}) {
    if (!shareToken) throw new Error('SalesAI.init: shareToken is required');

    let host;

    function mount() {
        host = document.createElement('div');
        const shadow = host.attachShadow({ mode: 'open' });

        const frame = document.createElement('iframe');
        frame.src = `${baseUrl}/${encodeURIComponent(shareToken)}?embed=1`;
        frame.allow = 'camera; microphone; display-capture; autoplay';
        frame.style.cssText =
            'border:0;width:380px;height:560px;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.35)';

        const wrap = document.createElement('div');
        const pos =
            position === 'bottom-left' ? 'left:24px' : 'right:24px';
        wrap.style.cssText = `position:fixed;bottom:24px;${pos};z-index:2147483647`;
        wrap.appendChild(frame);
        shadow.appendChild(wrap);
        document.body.appendChild(host);
        return api;
    }

    function unmount() {
        host?.remove();
        host = null;
    }

    const api = { mount, unmount };
    return api;
}

if (typeof window !== 'undefined') {
    window.SalesAI = { init };
}

export default { init };
