import { useEffect, useRef } from 'react';
import { version as sdkVersion } from '@repo/sdk/package.json';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';
const VISITOR_URL = import.meta.env.VITE_VISITOR_URL || 'http://localhost:5174';
const SHARE_TOKEN = import.meta.env.VITE_LANDING_SHARE_TOKEN;
const SCRIPT_ID = 'salesai-sdk';

/**
 * Loads the widget loader from the API exactly as a customer's site does —
 * same URL and `?v=` cache-busting as the Embed Studio snippet — instead of
 * bundling @repo/sdk into the console, so the landing page exercises the
 * real embed path end to end (served bundle, origin allowlist, session
 * minting, iframe handshake).
 */
function loadSdk() {
    if (window.SalesAI) return Promise.resolve(window.SalesAI);

    let script = document.getElementById(SCRIPT_ID);
    if (!script) {
        script = document.createElement('script');
        script.id = SCRIPT_ID;
        script.src = `${API_URL}/sdk/salesai.js?v=${sdkVersion}`;
        script.async = true;
        document.head.appendChild(script);
    }

    return new Promise((resolve, reject) => {
        script.addEventListener('load', () => resolve(window.SalesAI), { once: true });
        script.addEventListener(
            'error',
            () => {
                // Drop the failed tag so the next mount retries instead of
                // waiting forever on a script that will never fire `load`.
                script.remove();
                reject(new Error('SalesAI SDK failed to load'));
            },
            { once: true }
        );
    });
}

/**
 * Mounts our own SalesAI agent as the landing page's sales widget for as
 * long as the calling component is mounted. No-op when
 * VITE_LANDING_SHARE_TOKEN is unset.
 *
 * `label` overrides the launcher text (the host-page override every seller
 * also has) and follows the landing's language switch without remounting.
 * `onClose` receives the SDK's close summary ({ reason, connected, durationMs }).
 */
export function useSalesAIWidget({ label, onClose } = {}) {
    const widgetRef = useRef(null);
    const labelRef = useRef(label);
    const onCloseRef = useRef(onClose);

    useEffect(() => {
        labelRef.current = label;
        widgetRef.current?.setLabel(label);
    }, [label]);

    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        if (!SHARE_TOKEN) return;

        let cancelled = false;
        loadSdk()
            .then((SalesAI) => {
                if (cancelled) return;
                widgetRef.current = SalesAI.init({
                    shareToken: SHARE_TOKEN,
                    apiBaseUrl: API_URL,
                    visitorBaseUrl: VISITOR_URL,
                    label: labelRef.current,
                    // Read through the ref so the SDK always calls the latest handler.
                    onClose: (summary) => onCloseRef.current?.(summary)
                }).mount();
            })
            .catch(() => {
                // API down or SDK bundle not built — the landing page works without the widget.
            });

        return () => {
            cancelled = true;
            widgetRef.current?.unmount();
            widgetRef.current = null;
        };
    }, []);
}
