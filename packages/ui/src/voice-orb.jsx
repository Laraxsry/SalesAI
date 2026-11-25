import { useEffect, useRef } from 'react';
import { cn } from './cn.js';
import { startVoiceOrb } from './voice-orb-renderer.js';

/**
 * Audio-reactive voice orb: a deep indigo disc with pink "vocal cord"
 * strands inside and a glowing magenta → violet → blue rim that swells and
 * spins faster while it talks.
 *
 * The animation runs on a canvas in its own requestAnimationFrame loop (see
 * voice-orb-renderer.js, shared with the SDK launcher), so a parent can feed
 * it live audio levels without re-rendering on every frame: `getLevel` is
 * called once per frame and should return 0..1.
 *
 * @param {{
 *   size?: number,
 *   mode?: 'speaking' | 'listening' | 'thinking' | 'connecting' | 'idle',
 *   getLevel?: () => number,
 *   className?: string,
 *   label?: string
 * }} props
 */
export function VoiceOrb({
    size = 180,
    mode = 'idle',
    getLevel,
    className,
    label = 'AI temsilci ses göstergesi'
}) {
    const canvasRef = useRef(null);
    const haloRef = useRef(null);
    const modeRef = useRef(mode);
    const levelFnRef = useRef(getLevel);
    modeRef.current = mode;
    levelFnRef.current = getLevel;

    useEffect(
        () =>
            startVoiceOrb(canvasRef.current, {
                size,
                getMode: () => modeRef.current,
                getLevel: () => levelFnRef.current?.() ?? 0,
                onFrame: (energy) => {
                    const halo = haloRef.current;
                    if (!halo) return;
                    halo.style.opacity = String(0.35 + energy * 0.65);
                    halo.style.transform = `scale(${0.92 + energy * 0.25})`;
                }
            }),
        [size]
    );

    return (
        <div
            role="img"
            aria-label={label}
            className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
            style={{ width: size, height: size }}
        >
            <span
                ref={haloRef}
                aria-hidden="true"
                style={{
                    position: 'absolute',
                    inset: '4%',
                    borderRadius: '999px',
                    background:
                        'radial-gradient(circle, rgba(139,92,246,0.42) 0%, rgba(236,72,153,0.2) 45%, rgba(30,27,75,0) 70%)',
                    filter: 'blur(16px)',
                    pointerEvents: 'none',
                    transition: 'opacity 120ms linear'
                }}
            />
            <canvas ref={canvasRef} style={{ position: 'relative', width: size, height: size }} />
        </div>
    );
}

/** Four-point star glint used for the assistant's open / close transition. */
export function Sparkle({ size = 120, className, style }) {
    return (
        <svg
            aria-hidden="true"
            viewBox="0 0 100 100"
            width={size}
            height={size}
            className={className}
            style={{ overflow: 'visible', ...style }}
        >
            <defs>
                <radialGradient id="salesai-sparkle-core" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#ffffff" />
                    <stop offset="45%" stopColor="#fbcfe8" />
                    <stop offset="100%" stopColor="#c084fc" />
                </radialGradient>
                <radialGradient id="salesai-sparkle-glow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="rgba(244,114,182,0.8)" />
                    <stop offset="100%" stopColor="rgba(139,92,246,0)" />
                </radialGradient>
            </defs>
            <circle cx="50" cy="50" r="34" fill="url(#salesai-sparkle-glow)" />
            <path
                d="M50 2 C53 36 64 47 98 50 C64 53 53 64 50 98 C47 64 36 53 2 50 C36 47 47 36 50 2 Z"
                fill="url(#salesai-sparkle-core)"
            />
            <path
                d="M50 26 C51.2 44 56 48.8 74 50 C56 51.2 51.2 56 50 74 C48.8 56 44 51.2 26 50 C44 48.8 48.8 44 50 26 Z"
                fill="#ffffff"
                transform="rotate(45 50 50)"
                opacity="0.7"
            />
        </svg>
    );
}
