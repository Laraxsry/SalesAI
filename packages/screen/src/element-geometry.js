export const ELEMENT_GEOMETRY_SCRIPT = `(el) => {
    const rect = el.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const clientRects = Array.from(el.getClientRects()).map((item) => ({
        x: item.x, y: item.y, width: item.width, height: item.height
    })).filter((item) => item.width > 0 && item.height > 0);
    return {
        visible: rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < viewportHeight && rect.left < viewportWidth,
        viewport: { width: viewportWidth, height: viewportHeight },
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        clientRects
    };
}`;

function clamp(value) {
    return Math.max(0, Math.min(1, value));
}

function normalizedRect(rect, viewport) {
    return {
        x: clamp(rect.x / viewport.width),
        y: clamp(rect.y / viewport.height),
        width: clamp(rect.width / viewport.width),
        height: clamp(rect.height / viewport.height)
    };
}

export function normalizeElementGeometry(value) {
    if (!value?.visible || !value.viewport?.width || !value.viewport?.height || !value.rect) return null;
    return {
        ...normalizedRect(value.rect, value.viewport),
        rects: (value.clientRects ?? []).map((rect) => normalizedRect(rect, value.viewport))
    };
}

export function parseEvaluationJson(text = '') {
    const fenced = text.match(/```json\s*([\s\S]*?)```/i)?.[1];
    const candidate = fenced ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    if (!candidate) return null;
    try {
        return JSON.parse(candidate);
    } catch {
        return null;
    }
}
