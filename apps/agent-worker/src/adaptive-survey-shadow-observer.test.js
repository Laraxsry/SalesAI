import { describe, expect, it } from 'vitest';
import {
    createAdaptiveSurveyShadowObserver, decideAdaptiveSurveyShadowActivation
} from './adaptive-survey-shadow-observer.js';

const fields = [{ key: 'company.industry', importance: 'recommended',
    affects: ['demo_route'], preferredInput: 'single_select' }];

function state() {
    return { routeRevision: 0, openQuestions: [],
        adaptiveSurvey: { epoch: 0, activeSurveyId: null },
        memory: { turnIndex: 1, discoveredFacts: {}, askedQuestions: {} } };
}

describe('adaptive survey shadow observer', () => {
    it('uses the active shadow session and product opt-in without ID allowlists', () => {
        const input = { featureEnabled: true, productConfigValid: true,
            rolloutDecision: { cohort: 'shadow', dynamicStateEnabled: true },
            maxParticipants: 1 };
        expect(decideAdaptiveSurveyShadowActivation(input)).toBe(true);
        expect(decideAdaptiveSurveyShadowActivation({ ...input,
            rolloutDecision: { cohort: 'canary', dynamicStateEnabled: true } })).toBe(false);
        expect(decideAdaptiveSurveyShadowActivation({ ...input,
            maxParticipants: 2 })).toBe(false);
    });

    it('observes an unknown field once without writing state or displaying a survey', async () => {
        const current = state();
        const before = structuredClone(current);
        const events = [];
        const observer = createAdaptiveSurveyShadowObserver({
            store: { snapshot: () => current }, fields,
            knownFactResolver: { resolve: async () => ({ status: 'unknown' }) },
            onObservation: (event) => events.push(event)
        });
        expect(await observer.observe()).toEqual([{
            questionKey: 'company.industry', status: 'unknown_field_candidate',
            factStatus: 'unknown', turnIndex: 1
        }]);
        expect(await observer.observe()).toEqual([]);
        current.memory.turnIndex = 2;
        expect(await observer.observe()).toEqual([]);
        expect(events).toHaveLength(1);
        expect({ ...current, memory: { ...current.memory, turnIndex: 1 } }).toEqual(before);
    });

    it('does not report a stale fact result or interrupt an open customer question', async () => {
        const current = state();
        let release;
        const observer = createAdaptiveSurveyShadowObserver({
            store: { snapshot: () => current }, fields,
            knownFactResolver: { resolve: () => new Promise((resolve) => { release = resolve; }) }
        });
        const pending = observer.observe();
        current.memory.discoveredFacts['company.industry'] = { value: 'finance' };
        release({ status: 'unknown' });
        expect(await pending).toEqual([]);
        current.memory.turnIndex = 2;
        current.openQuestions.push({ id: 'question-1' });
        expect(await observer.observe()).toEqual([]);
    });

    it('drops an observation if the customer begins speaking during lookup', async () => {
        const current = state();
        let release;
        let canObserve = true;
        const observer = createAdaptiveSurveyShadowObserver({
            store: { snapshot: () => current }, fields,
            knownFactResolver: { resolve: () => new Promise((resolve) => { release = resolve; }) }
        });
        const pending = observer.observe({ canObserve: () => canObserve });
        canObserve = false;
        release({ status: 'unknown' });
        expect(await pending).toEqual([]);
    });

    it('does not run during the greeting or for prohibited fields', async () => {
        const current = state();
        current.memory.turnIndex = 0;
        let lookups = 0;
        const observer = createAdaptiveSurveyShadowObserver({
            store: { snapshot: () => current },
            fields: [{ ...fields[0], importance: 'do_not_ask' }],
            knownFactResolver: { resolve: () => { lookups++; } }
        });
        expect(await observer.observe()).toEqual([]);
        current.memory.turnIndex = 1;
        expect(await observer.observe()).toEqual([]);
        expect(lookups).toBe(0);
    });
});
