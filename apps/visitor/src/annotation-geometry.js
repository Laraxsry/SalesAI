const ANNOTATION_STYLES = new Set(['circle', 'arrow']);
const ARROW_GAP = 10;
const ARROW_MIN_LENGTH = 56;
const ARROW_MAX_LENGTH = 120;
const ARROWHEAD_LENGTH = 14;
const ARROWHEAD_SPREAD = 0.5;

/**
 * Circle and arrow marks outlive the cursor and click cues that follow them,
 * so the cursor visibly lands inside the circle before clicking. Only a new
 * focus cue replaces them; a clear (page changed, customer interrupted) drops them.
 */
export function nextAnnotation(current, cue) {
    if (!cue) return null;
    if (cue.action !== 'focus') return current;
    return ANNOTATION_STYLES.has(cue.style) && cue.target ? cue : null;
}

function round(value) {
    return Math.round(value * 10) / 10;
}

/**
 * A slightly overshooting, slowly widening loop around the rect, like a pen
 * circling a button. Semi-axes scale by √2 so the ellipse clears the corners.
 */
export function circlePath(rect, { segments = 56 } = {}) {
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const rx = (rect.width / 2) * Math.SQRT2 + 6;
    const ry = (rect.height / 2) * Math.SQRT2 + 6;
    const start = -Math.PI * 0.62;
    const sweep = Math.PI * 2 + 0.42;
    const points = [];
    for (let index = 0; index <= segments; index += 1) {
        const progress = index / segments;
        const angle = start + sweep * progress;
        const wobble = 1 + 0.025 * Math.sin(angle * 3) + 0.05 * progress;
        points.push(`${round(cx + Math.cos(angle) * rx * wobble)} ${round(cy + Math.sin(angle) * ry * wobble)}`);
    }
    return `M ${points.join(' L ')}`;
}

/**
 * A curved arrow that comes in from whichever side of the target has the most
 * free space inside the video box, so it never runs off the visible frame.
 */
export function arrowGeometry(rect, box) {
    const room = {
        left: rect.left - box.left,
        right: box.left + box.width - (rect.left + rect.width),
        top: rect.top - box.top,
        bottom: box.top + box.height - (rect.top + rect.height)
    };
    const side = Object.keys(room).reduce((best, key) => (room[key] > room[best] ? key : best), 'left');
    const direction = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] }[side];
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const head = {
        x: direction[0] ? cx + direction[0] * (rect.width / 2 + ARROW_GAP) : cx,
        y: direction[1] ? cy + direction[1] * (rect.height / 2 + ARROW_GAP) : cy
    };
    const length = Math.max(ARROW_MIN_LENGTH, Math.min(ARROW_MAX_LENGTH, room[side] - ARROW_GAP - 16));
    // Lean the tail sideways so the arrow arrives at an angle, not dead straight.
    const perpendicular = [-direction[1], direction[0]];
    const tail = {
        x: head.x + direction[0] * length + perpendicular[0] * length * 0.45,
        y: head.y + direction[1] * length + perpendicular[1] * length * 0.45
    };
    const control = {
        x: (head.x + tail.x) / 2 + direction[0] * length * 0.25,
        y: (head.y + tail.y) / 2 + direction[1] * length * 0.25
    };
    const angle = Math.atan2(head.y - control.y, head.x - control.x);
    const barb = (offset) => ({
        x: head.x - Math.cos(angle + offset) * ARROWHEAD_LENGTH,
        y: head.y - Math.sin(angle + offset) * ARROWHEAD_LENGTH
    });
    const left = barb(ARROWHEAD_SPREAD);
    const right = barb(-ARROWHEAD_SPREAD);
    return {
        side,
        head,
        shaft: `M ${round(tail.x)} ${round(tail.y)} Q ${round(control.x)} ${round(control.y)} ${round(head.x)} ${round(head.y)}`,
        tip: `M ${round(left.x)} ${round(left.y)} L ${round(head.x)} ${round(head.y)} L ${round(right.x)} ${round(right.y)}`,
        nudge: { x: 0 - direction[0] * 5, y: 0 - direction[1] * 5 }
    };
}

export { ANNOTATION_STYLES };
