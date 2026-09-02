import { describe, it, expect } from 'vitest';
import { isDirectivelessAdvanceStepFollowup } from './followup-guard.js';

function functionCall(name) {
    return { type: 'function_call', name };
}

describe('isDirectivelessAdvanceStepFollowup', () => {
    it('is false for anything other than a tool_response-sourced speech', () => {
        expect(isDirectivelessAdvanceStepFollowup({ source: 'generate_reply' })).toBe(false);
        expect(isDirectivelessAdvanceStepFollowup({ source: 'say' })).toBe(false);
        expect(isDirectivelessAdvanceStepFollowup({})).toBe(false);
    });

    it('is true when the triggering turn called only advance_step', () => {
        const event = {
            source: 'tool_response',
            speechHandle: { parent: { chatItems: [functionCall('advance_step')] } }
        };
        expect(isDirectivelessAdvanceStepFollowup(event)).toBe(true);
    });

    it('is true for repeated advance_step calls in the same turn (no other tool present)', () => {
        const event = {
            source: 'tool_response',
            speechHandle: { parent: { chatItems: [functionCall('advance_step'), functionCall('advance_step')] } }
        };
        expect(isDirectivelessAdvanceStepFollowup(event)).toBe(true);
    });

    // *** THE ONE INVARIANT THAT MATTERS MOST — DO NOT RELAX ***
    // search_knowledge's own follow-up is the actual RAG answer. If this
    // ever returns true when search_knowledge (or any non-advance_step tool)
    // is present, the fix silences real answers instead of empty noise.
    it('is false when search_knowledge is present, even alongside advance_step', () => {
        const event = {
            source: 'tool_response',
            speechHandle: { parent: { chatItems: [functionCall('search_knowledge'), functionCall('advance_step')] } }
        };
        expect(isDirectivelessAdvanceStepFollowup(event)).toBe(false);
    });

    it('is false when only search_knowledge (or any other single tool) was called', () => {
        const event = {
            source: 'tool_response',
            speechHandle: { parent: { chatItems: [functionCall('click_element')] } }
        };
        expect(isDirectivelessAdvanceStepFollowup(event)).toBe(false);
    });

    it('is false when no function_call is present at all (nothing to attribute this to)', () => {
        const event = { source: 'tool_response', speechHandle: { parent: { chatItems: [] } } };
        expect(isDirectivelessAdvanceStepFollowup(event)).toBe(false);
    });

    it('ignores non-function_call chatItems (message, function_call_output) when checking names', () => {
        const event = {
            source: 'tool_response',
            speechHandle: {
                parent: {
                    chatItems: [
                        { type: 'message', role: 'assistant' },
                        functionCall('advance_step'),
                        { type: 'function_call_output' }
                    ]
                }
            }
        };
        expect(isDirectivelessAdvanceStepFollowup(event)).toBe(true);
    });

    it('never throws when parent/chatItems/speechHandle are missing', () => {
        expect(() => isDirectivelessAdvanceStepFollowup({ source: 'tool_response' })).not.toThrow();
        expect(isDirectivelessAdvanceStepFollowup({ source: 'tool_response' })).toBe(false);
        expect(() => isDirectivelessAdvanceStepFollowup({ source: 'tool_response', speechHandle: {} })).not.toThrow();
        expect(() => isDirectivelessAdvanceStepFollowup(null)).not.toThrow();
        expect(isDirectivelessAdvanceStepFollowup(null)).toBe(false);
        expect(() => isDirectivelessAdvanceStepFollowup(undefined)).not.toThrow();
    });
});
