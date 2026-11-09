import { useEffect, useRef } from 'react';
import { cn } from './cn.js';

const TAU = Math.PI * 2;

// Colour stops of the glowing rim, going round the circle: magenta → violet →
// blue → back. The whole gradient slowly rotates.
const RIM_STOPS = [
    [0, '#f472b6'],
    [0.18, '#e879f9'],
    [0.38, '#8b5cf6'],
    [0.6, '#3b82f6'],
    [0.78, '#6366f1'],
    [1, '#f472b6']
];

// "Vocal cord" strands flowing across the inside of the disc.
const STRANDS = [
    { color: '#f9a8d4', freq: 1.6, speed: 2.4, phase: 0, amp: 1, width: 2.2, spread: 0 },
    { color: '#f0abfc', freq: 2.1, speed: -1.9, phase: 1.4, amp: 0.85, width: 1.8, spread: -0.5 },
    { color: '#c4b5fd', freq: 1.2, speed: 1.5, phase: 2.6, amp: 0.75, width: 1.6, spread: 0.5 },
    { color: '#fbcfe8', freq: 2.7, speed: -2.8, phase: 4.1, amp: 0.6, width: 1.3, spread: -1 },
    { color: '#a5b4fc', freq: 1.9, speed: 3.2, phase: 5.2, amp: 0.55, width: 1.2, spread: 1 }
];

function clamp01(value) {
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** Ambient energy for modes that are not driven by live audio. */
function ambientEnergy(mode, t) {
    if (mode === 'thinking') return 0.18 + 0.12 * (0.5 + 0.5 * Math.sin(t * 4.2));
    if (mode === 'connecting') return 0.05 + 0.04 * (0.5 + 0.5 * Math.sin(t * 2.4));
    return 0.06;
}

/** Fills the band between the disc edge and a crescent-shaped outer edge. */
function rimPath(ctx, cx, cy, R, rot, t, energy, thickness) {
    const steps = 180;
    ctx.beginPath();
    for (let i = 0; i <= steps; i += 1) {
        const theta = (i / steps) * TAU;
        // Thick on the side facing `rot`, thin on the opposite side.
        const crescent = ((1 + Math.cos(theta - rot)) / 2) ** 1.6;
        const wobble = Math.sin(theta * 3 + t * 2.6) * 0.5 + Math.sin(theta * 5 - t * 3.4) * 0.5;
        const r =
            R +
            thickness * (0.18 + 0.82 * crescent) * (1 + energy * 1.1) +
            wobble * R * energy * 0.035;
        const x = cx + Math.cos(theta) * r;
        const y = cy + Math.sin(theta) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.moveTo(cx + R, cy);
    ctx.arc(cx, cy, R, 0, TAU, true);
}

function rimGradient(ctx, cx, cy, R, rot) {
    if (typeof ctx.createConicGradient === 'function') {
        const gradient = ctx.createConicGradient(rot - Math.PI / 2, cx, cy);
        for (const [offset, color] of RIM_STOPS) gradient.addColorStop(offset, color);
        return gradient;
    }
    const gradient = ctx.createLinearGradient(cx - R, cy + R, cx + R, cy - R);
    gradient.addColorStop(0, '#3b82f6');
    gradient.addColorStop(0.5, '#8b5cf6');
    gradient.addColorStop(1, '#f472b6');
    return gradient;
}

function drawStrand(ctx, cx, cy, R, strand, t, energy, dpr) {
    const left = cx - R * 0.86;
    const width = R * 1.72;
    const amp = R * (0.1 + energy * 0.45) * strand.amp;
    // Strands fan apart in the middle (more when loud), meeting at the ends.
    const spread = strand.spread * R * (0.2 + energy * 0.12);
    const steps = 90;
    ctx.beginPath();
    for (let i = 0; i <= steps; i += 1) {
        const u = i / steps;
        // Taper to zero at both ends so the strands look pinned like cords.
        const envelope = Math.sin(u * Math.PI) ** 1.6;
        const y =
            cy +
            envelope *
                (spread +
                    amp *
                        (Math.sin(u * TAU * strand.freq + t * strand.speed + strand.phase) * 0.75 +
                            Math.sin(u * TAU * strand.freq * 2.3 - t * strand.speed * 1.4) * 0.25));
        const x = left + u * width;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = strand.color;
    ctx.globalAlpha = 0.55 + energy * 0.45;
    ctx.lineWidth = strand.width * dpr;
    ctx.stroke();
    ctx.globalAlpha = 1;
}

/**
 * Audio-reactive voice orb: a deep indigo disc with pink "vocal cord"
 * strands inside and a glowing magenta → violet → blue rim that swells and
 * spins faster while it talks.
 *
 * The animation runs on a canvas in its own requestAnimationFrame loop, so a
 * parent can feed it live audio levels without re-rendering on every frame:
 * `getLevel` is called once per frame and should return 0..1.
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

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!ctx) return undefined;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = size * dpr;
        canvas.height = size * dpr;
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        // Glow on small orbs (e.g. a 40px chip) just muddies the lines.
        const glow = size >= 90;

        let frame = 0;
        let energy = 0;
        let rot = -Math.PI / 4;
        const supportsFilter = 'filter' in ctx;
        const start = performance.now();

        const render = (now) => {
            const t = ((now - start) / 1000) * (reduceMotion ? 0.25 : 1);
            const currentMode = modeRef.current;
            const audioDriven = currentMode === 'speaking' || currentMode === 'listening';
            const live = audioDriven ? clamp01(levelFnRef.current?.() ?? 0) : 0;
            const target = Math.max(
                audioDriven ? live * (currentMode === 'listening' ? 0.65 : 1) : 0,
                ambientEnergy(currentMode, t)
            );
            // Fast attack, slow release — reads like a voice rather than a meter.
            energy += (target - energy) * (target > energy ? 0.32 : 0.07);

            const S = size * dpr;
            const cx = S / 2;
            const cy = S / 2;
            const R = (S / 2) * 0.6 * (1 + energy * 0.04);

            ctx.clearRect(0, 0, S, S);

            // The rim rotates slowly, a little faster while talking.
            rot += (0.006 + energy * 0.03) * (reduceMotion ? 0.25 : 1);
            const thickness = R * 0.075;
            const rim = rimGradient(ctx, cx, cy, R, rot);

            // Soft outer glow of the rim.
            if (glow && supportsFilter) {
                ctx.save();
                ctx.globalCompositeOperation = 'lighter';
                ctx.filter = `blur(${Math.round(R * (0.2 + energy * 0.08))}px)`;
                ctx.globalAlpha = 0.85;
                rimPath(ctx, cx, cy, R, rot, t, energy, thickness * 3);
                ctx.fillStyle = rim;
                ctx.fill('evenodd');
                ctx.filter = `blur(${Math.round(R * 0.07)}px)`;
                ctx.globalAlpha = 0.6 + energy * 0.4;
                rimPath(ctx, cx, cy, R, rot, t, energy, thickness * 1.6);
                ctx.fill('evenodd');
                ctx.restore();
            }

            // Deep indigo disc, lit faintly from the rim's bright side.
            const disc = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R);
            disc.addColorStop(0, '#1b1450');
            disc.addColorStop(0.7, '#120d3d');
            disc.addColorStop(1, '#0c0a2a');
            ctx.beginPath();
            ctx.arc(cx, cy, R, 0, TAU);
            ctx.fillStyle = disc;
            ctx.fill();
            const lx = cx + Math.cos(rot) * R * 0.55;
            const ly = cy + Math.sin(rot) * R * 0.55;
            const spill = ctx.createRadialGradient(lx, ly, 0, lx, ly, R * 1.1);
            spill.addColorStop(0, `rgba(217, 70, 239, ${0.22 + energy * 0.22})`);
            spill.addColorStop(0.5, `rgba(99, 102, 241, ${0.1 + energy * 0.1})`);
            spill.addColorStop(1, 'rgba(99, 102, 241, 0)');
            ctx.fillStyle = spill;
            ctx.fill();
            if (glow && supportsFilter) {
                // The rim's light bleeding into the inside of the disc.
                ctx.save();
                ctx.beginPath();
                ctx.arc(cx, cy, R, 0, TAU);
                ctx.clip();
                ctx.filter = `blur(${Math.round(R * 0.1)}px)`;
                ctx.globalAlpha = 0.55 + energy * 0.3;
                rimPath(ctx, cx, cy, R * 0.86, rot, t, energy, thickness * 1.4);
                ctx.fillStyle = rim;
                ctx.fill('evenodd');
                ctx.restore();
            }

            // Vocal-cord strands, clipped to the disc.
            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, R * 0.97, 0, TAU);
            ctx.clip();
            const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.8);
            core.addColorStop(0, `rgba(244, 114, 182, ${0.12 + energy * 0.28})`);
            core.addColorStop(1, 'rgba(244, 114, 182, 0)');
            ctx.fillStyle = core;
            ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
            ctx.lineCap = 'round';
            if (glow) {
                ctx.shadowColor = 'rgba(249, 168, 212, 0.6)';
                ctx.shadowBlur = 5 * dpr;
            }
            for (const strand of STRANDS) drawStrand(ctx, cx, cy, R, strand, t, energy, dpr);
            ctx.restore();

            // Crisp rim band on top of the disc edge.
            rimPath(ctx, cx, cy, R * 0.985, rot, t, energy, thickness);
            ctx.fillStyle = rim;
            ctx.fill('evenodd');

            const halo = haloRef.current;
            if (halo) {
                halo.style.opacity = String(0.35 + energy * 0.65);
                halo.style.transform = `scale(${0.92 + energy * 0.25})`;
            }

            frame = requestAnimationFrame(render);
        };

        frame = requestAnimationFrame(render);
        return () => cancelAnimationFrame(frame);
    }, [size]);

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
