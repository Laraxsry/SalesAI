import { useEffect, useMemo, useRef, useState } from 'react';
import { containedVideoBox } from './video-geometry.js';

function targetStyle(target, box) {
    return {
        left: box.left + target.x * box.width,
        top: box.top + target.y * box.height,
        width: target.width * box.width,
        height: target.height * box.height
    };
}

export function TourOverlay({ cue }) {
    const rootRef = useRef(null);
    const [size, setSize] = useState({ width: 0, height: 0 });
    const [cursor, setCursor] = useState({ x: 0.5, y: 0.55, visible: false, durationMs: 420 });

    useEffect(() => {
        const node = rootRef.current;
        if (!node) return undefined;
        const update = () => setSize({ width: node.clientWidth, height: node.clientHeight });
        update();
        const observer = new ResizeObserver(update);
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!cue) {
            setCursor((current) => ({ ...current, visible: false, durationMs: 180 }));
            return undefined;
        }
        if (!cue.target || !['cursor_move', 'click'].includes(cue.action)) return undefined;
        const next = {
            x: cue.target.x + cue.target.width / 2,
            y: cue.target.y + cue.target.height / 2,
            visible: true,
            durationMs: cue.durationMs ?? 420
        };
        const frame = requestAnimationFrame(() => setCursor(next));
        return () => cancelAnimationFrame(frame);
    }, [cue]);

    const box = useMemo(() => containedVideoBox(size.width, size.height), [size]);
    const focusTarget = cue?.action === 'focus' && cue.target ? targetStyle(cue.target, box) : null;
    const markerRects = cue?.style === 'marker' && cue.target
        ? (cue.target.rects?.length ? cue.target.rects : [cue.target])
        : [];
    const cursorLeft = box.left + cursor.x * box.width;
    const cursorTop = box.top + cursor.y * box.height;

    return (
        <div ref={rootRef} className="tour-overlay pointer-events-none absolute inset-0 z-[15]" aria-hidden="true">
            {focusTarget && cue.style === 'spotlight' && (
                <div className="tour-spotlight absolute" style={focusTarget} />
            )}
            {focusTarget && cue.style === 'outline' && (
                <div className="tour-outline absolute" style={focusTarget} />
            )}
            {markerRects.map((rect, index) => (
                <div
                    key={`${cue.cueId}-marker-${index}`}
                    className="tour-marker absolute"
                    style={targetStyle(rect, box)}
                />
            ))}
            <div
                className={`tour-cursor absolute ${cursor.visible ? 'opacity-100' : 'opacity-0'} ${cue?.action === 'click' ? 'tour-cursor--clicking' : ''}`}
                style={{
                    left: cursorLeft,
                    top: cursorTop,
                    transitionDuration: `${cursor.durationMs}ms`
                }}
            >
                <svg width="28" height="34" viewBox="0 0 28 34" fill="none">
                    <path d="M3 2.5L24.2 19.2L14.8 20.8L9.7 30.5L3 2.5Z" fill="#F8FBF8" stroke="#071713" strokeWidth="2.2" strokeLinejoin="round" />
                </svg>
            </div>
            {cue?.action === 'click' && cue.target && (
                <div
                    key={cue.cueId}
                    className="tour-click-ripple absolute"
                    style={{
                        left: box.left + (cue.target.x + cue.target.width / 2) * box.width,
                        top: box.top + (cue.target.y + cue.target.height / 2) * box.height
                    }}
                />
            )}
            {cue?.action === 'scroll' && cue.target && (
                <div
                    key={cue.cueId}
                    className={`tour-scroll-cue tour-scroll-cue--${cue.direction} absolute`}
                    style={targetStyle(cue.target, box)}
                >
                    <span />
                </div>
            )}
        </div>
    );
}
