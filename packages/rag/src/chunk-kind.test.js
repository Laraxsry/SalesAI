import { describe, expect, it } from 'vitest';
import { inKindScope, UI_KIND } from './chunk-kind.js';

describe('inKindScope', () => {
    it('treats chunks without a kind as product knowledge (nothing to migrate)', () => {
        expect(inKindScope(undefined)).toBe(true);
        expect(inKindScope(undefined, 'knowledge')).toBe(true);
        expect(inKindScope('knowledge', 'knowledge')).toBe(true);
    });

    it('keeps dashboard chunks out of the default, visitor-facing scope', () => {
        expect(inKindScope(UI_KIND)).toBe(false);
        expect(inKindScope(UI_KIND, 'knowledge')).toBe(false);
    });

    it('the ui scope returns only dashboard chunks', () => {
        expect(inKindScope(UI_KIND, 'ui')).toBe(true);
        expect(inKindScope(undefined, 'ui')).toBe(false);
        expect(inKindScope('knowledge', 'ui')).toBe(false);
    });

    it('the all scope returns everything', () => {
        for (const kind of [undefined, 'knowledge', UI_KIND]) expect(inKindScope(kind, 'all')).toBe(true);
    });
});
