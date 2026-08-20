import { describe, it, expect } from 'vitest';
import { createPlaybookCursor } from './playbook-cursor.js';

function node(id, order, extra = {}) {
    return { id, order, url: null, directive: `directive-${id}`, attach: null, mode: 'situational', ...extra };
}

describe('createPlaybookCursor — ordering', () => {
    it('starts at the first node', () => {
        const cursor = createPlaybookCursor([node('a', 1), node('b', 2)]);
        expect(cursor.current()?.id).toBe('a');
    });

    it('advance() moves to the next node in order', () => {
        const cursor = createPlaybookCursor([node('a', 1), node('b', 2), node('c', 3)]);
        cursor.advance();
        expect(cursor.current()?.id).toBe('b');
        cursor.advance();
        expect(cursor.current()?.id).toBe('c');
    });

    it('current() returns null on an empty playbook', () => {
        const cursor = createPlaybookCursor([]);
        expect(cursor.current()).toBeNull();
        expect(cursor.exhausted).toBe(true);
    });

    it('is exhausted only after the last node is passed', () => {
        const cursor = createPlaybookCursor([node('a', 1), node('b', 2)]);
        expect(cursor.exhausted).toBe(false);
        cursor.advance();
        expect(cursor.exhausted).toBe(false);
        cursor.advance();
        expect(cursor.exhausted).toBe(true);
        expect(cursor.current()).toBeNull();
    });

    it('advance() past the end stays exhausted rather than growing unbounded', () => {
        const cursor = createPlaybookCursor([node('a', 1)]);
        cursor.advance();
        cursor.advance();
        cursor.advance();
        expect(cursor.exhausted).toBe(true);
        expect(cursor.snapshot().index).toBe(1);
    });
});

describe('createPlaybookCursor — satisfy idempotence', () => {
    it('satisfy() returns true the first time, false on repeat', () => {
        const cursor = createPlaybookCursor([node('a', 1)]);
        expect(cursor.satisfy('a', 'advance_step')).toBe(true);
        expect(cursor.satisfy('a', 'advance_step')).toBe(false);
    });

    it('isSatisfied reflects prior satisfy calls', () => {
        const cursor = createPlaybookCursor([node('a', 1), node('b', 2)]);
        expect(cursor.isSatisfied('a')).toBe(false);
        cursor.satisfy('a', 'silence');
        expect(cursor.isSatisfied('a')).toBe(true);
        expect(cursor.isSatisfied('b')).toBe(false);
    });
});

describe('createPlaybookCursor — out-of-order satisfaction', () => {
    it('a step satisfied ahead of the cursor is silently skipped when reached', () => {
        // The visitor asks about node 4's topic while node 2 is current — the
        // cursor should skip straight from 3 to 5 without ever presenting 4.
        const cursor = createPlaybookCursor([
            node('n1', 1), node('n2', 2), node('n3', 3), node('n4', 4), node('n5', 5)
        ]);
        cursor.advance(); // -> n2
        expect(cursor.current()?.id).toBe('n2');

        cursor.satisfy('n4', 'answered');

        cursor.advance(); // -> n3
        expect(cursor.current()?.id).toBe('n3');
        cursor.advance(); // n4 is satisfied, so this lands on n5
        expect(cursor.current()?.id).toBe('n5');
    });

    it('satisfying the current node then advancing moves cleanly to the next', () => {
        const cursor = createPlaybookCursor([node('a', 1), node('b', 2)]);
        cursor.satisfy('a', 'tool');
        expect(cursor.current()?.id).toBe('a'); // satisfy alone does not move the cursor
        cursor.advance();
        expect(cursor.current()?.id).toBe('b');
    });
});

describe('createPlaybookCursor — anyRemainingUrl lookahead', () => {
    it('is true when a later not-yet-satisfied node has a url', () => {
        const cursor = createPlaybookCursor([
            node('a', 1),
            node('b', 2, { url: 'https://salesai.example/reports' })
        ]);
        expect(cursor.anyRemainingUrl()).toBe(true);
    });

    it('is false when no remaining node has a url', () => {
        const cursor = createPlaybookCursor([node('a', 1), node('b', 2)]);
        expect(cursor.anyRemainingUrl()).toBe(false);
    });

    it('ignores a url-bearing node that has already been satisfied', () => {
        const cursor = createPlaybookCursor([
            node('a', 1),
            node('b', 2, { url: 'https://salesai.example/reports' })
        ]);
        cursor.satisfy('b', 'tool');
        expect(cursor.anyRemainingUrl()).toBe(false);
    });

    it('does not count a url on a node already passed', () => {
        const cursor = createPlaybookCursor([
            node('a', 1, { url: 'https://salesai.example/landing' }),
            node('b', 2)
        ]);
        cursor.advance(); // past node a
        expect(cursor.anyRemainingUrl()).toBe(false);
    });
});

describe('createPlaybookCursor — snapshot', () => {
    it('reports index, total, and satisfied ids', () => {
        const cursor = createPlaybookCursor([node('a', 1), node('b', 2), node('c', 3)]);
        cursor.satisfy('c', 'answered');
        cursor.advance();
        expect(cursor.snapshot()).toEqual({ index: 1, total: 3, satisfied: ['c'] });
    });
});
