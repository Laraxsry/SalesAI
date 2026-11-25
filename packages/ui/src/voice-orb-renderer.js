/**
 * Framework-free canvas renderer for the SalesAI voice orb: a deep indigo
 * disc with pink "vocal cord" strands inside and a glowing magenta → violet
 * → blue rim that swells and spins faster while it talks.
 *
 * Lives apart from the React `VoiceOrb` wrapper so that code which can't
 * ship React — the embeddable SDK's launcher button — draws the exact same
 * orb from the exact same code.
 */

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

function drawStrand(ctx, cx, cy, R, strand, t, energy, dpr, lineScale) {
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
    ctx.lineWidth = strand.width * dpr * lineScale;
    ctx.stroke();
    ctx.globalAlpha = 1;
}

/**
 * Starts drawing the orb into `canvas` on its own requestAnimationFrame loop.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{
 *   size: number,                       // CSS pixels (square)
 *   getMode?: () => string,             // 'speaking' | 'listening' | 'thinking' | 'connecting' | 'idle'
 *   getLevel?: () => number,            // live audio level 0..1, read once per frame
 *   onFrame?: (energy: number) => void, // e.g. to drive an outer halo element
 *   glow?: boolean,                     // blurred rim glow; defaults to on for size >= 90
 *   discRatio?: number,                 // disc radius as a share of half the canvas (default 0.6 leaves room for glow)
 *   lineScale?: number                  // strand thickness multiplier (thin strands vanish on tiny orbs)
 * }} options
 * @returns {() => void} stop — cancels the animation loop
 */
export function startVoiceOrb(canvas, { size, getMode, getLevel, onFrame, glow = size >= 90, discRatio = 0.6, lineScale = 1 }) {
    const ctx = canvas?.getContext('2d');
    if (!ctx) return () => {};

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let frame = 0;
    let energy = 0;
    let rot = -Math.PI / 4;
    const supportsFilter = 'filter' in ctx;
    const start = performance.now();

    const render = (now) => {
        const t = ((now - start) / 1000) * (reduceMotion ? 0.25 : 1);
        const currentMode = getMode?.() ?? 'idle';
        const audioDriven = currentMode === 'speaking' || currentMode === 'listening';
        const live = audioDriven ? clamp01(getLevel?.() ?? 0) : 0;
        const target = Math.max(
            audioDriven ? live * (currentMode === 'listening' ? 0.65 : 1) : 0,
            ambientEnergy(currentMode, t)
        );
        // Fast attack, slow release — reads like a voice rather than a meter.
        energy += (target - energy) * (target > energy ? 0.32 : 0.07);

        const S = size * dpr;
        const cx = S / 2;
        const cy = S / 2;
        const R = (S / 2) * discRatio * (1 + energy * 0.04);

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
        for (const strand of STRANDS) drawStrand(ctx, cx, cy, R, strand, t, energy, dpr, lineScale);
        ctx.restore();

        // Crisp rim band on top of the disc edge.
        rimPath(ctx, cx, cy, R * 0.985, rot, t, energy, thickness);
        ctx.fillStyle = rim;
        ctx.fill('evenodd');

        onFrame?.(energy);
        frame = requestAnimationFrame(render);
    };

    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
}
