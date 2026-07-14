/**
 * Public session bootstrap — same contract as apps/visitor.
 * POST /api/v1/sessions → { roomName, token, livekitUrl }
 */

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:5001';

/**
 * On a physical device, API may be http://192.168.x.x:5001 while LiveKit
 * still returns ws://localhost:7880. Rewrite localhost to the API host.
 */
export function rewriteLocalhost(url, apiBase = API_URL) {
    try {
        const { hostname } = new URL(apiBase);
        if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1') return url;
        return url.replace(/\/\/(localhost|127\.0\.0\.1)(?=[:/]|$)/g, `//${hostname}`);
    } catch {
        return url;
    }
}

/**
 * @param {string} shareToken
 * @param {string} [visitorName]
 * @returns {Promise<{ roomName: string, token: string, livekitUrl: string }>}
 */
export async function createSession(shareToken, visitorName) {
    const res = await fetch(`${API_URL}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shareToken, visitorName })
    });

    if (!res.ok) {
        let message = 'Could not start session';
        try {
            const body = await res.json();
            if (body?.error) message = body.error;
        } catch {
            /* ignore */
        }
        throw new Error(message);
    }

    const data = await res.json();
    return {
        ...data,
        livekitUrl: rewriteLocalhost(data.livekitUrl)
    };
}

export { API_URL };
