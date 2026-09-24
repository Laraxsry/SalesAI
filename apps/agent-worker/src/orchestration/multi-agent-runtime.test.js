import { describe, expect, it } from 'vitest';
import { createParticipantMemoryAnalyst } from '../analysts/participant-memory-analyst.js';
import { createAnalystProposalFactory } from '../analysts/proposal-factory.js';
import { createMultiAgentRolloutPolicy } from './multi-agent-rollout-policy.js';
import { createMultiAgentSessionRuntime } from './multi-agent-runtime.js';
import { buildSpeakingMemoryNote } from './speaking-memory-note.js';
import { resolveTargetedSurveyDelivery } from './targeted-survey-policy.js';

function rollout(mode) {
    return createMultiAgentRolloutPolicy({ mode, canaryPercent: 100 }).decide({
        sessionId: 'session-1', capabilityEnabled: true
    });
}

function memoryAnalyst() {
    return createParticipantMemoryAnalyst({
        invoke: async ({ transcript }) => ({
            confidence: 0.95,
            interests: transcript.toLocaleLowerCase('tr').includes('güvenlik')
                ? ['güvenlik'] : ['fiyat']
        }),
        proposalFactory: createAnalystProposalFactory({
            createId: () => 'proposal-1',
            now: () => Date.parse('2026-09-22T12:00:00.000Z')
        })
    });
}

function runtime(mode, overrides = {}) {
    return createMultiAgentSessionRuntime({
        sessionId: 'session-1',
        initialParticipants: [
            { participantId: 'p-ali', identity: 'visitor-ali', name: 'Ali' },
            { participantId: 'p-ayse', identity: 'visitor-ayse', name: 'Ayşe' }
        ],
        analysts: [memoryAnalyst()],
        rolloutDecision: rollout(mode),
        createEventId: () => 'event-1',
        now: () => Date.parse('2026-09-22T12:00:00.000Z'),
        ...overrides
    });
}

describe('multi-agent session runtime', () => {
    it('runs shadow analysis without applying memory state', async () => {
        const shadow = runtime('shadow');
        const run = shadow.publishTranscript({
            text: 'Güvenlik önemli.', eventSpeakerId: 'visitor-ali'
        });
        await run.completion;
        expect(run.participant.participantId).toBe('p-ali');
        expect(shadow.memorySnapshot().revision).toBe(0);
    });

    it('applies accepted canary memory only to the attributed participant', async () => {
        const projections = [];
        const canary = runtime('canary', { onProjection: (value) => projections.push(value) });
        const run = canary.publishTranscript({
            text: 'Güvenlik önemli.', eventSpeakerId: 'visitor-ali'
        });
        await run.completion;

        const memory = canary.memorySnapshot();
        expect(memory.participants['p-ali'].interests).toEqual(['güvenlik']);
        expect(memory.participants['p-ayse']).toBeUndefined();
        expect(projections).toHaveLength(1);
        expect(buildSpeakingMemoryNote(projections[0], { displayName: 'Ali' }))
            .toContain('Interests: güvenlik');
    });

    it('keeps unknown attribution out of participant memory', async () => {
        const canary = runtime('canary');
        const run = canary.publishTranscript({ text: 'Fiyat önemli.' });
        await run.completion;
        expect(run.participant.attribution).toBe('unattributed');
        expect(canary.memorySnapshot().participants).toEqual({});
    });

    it('does not wait for background analysis before returning the transcript event', async () => {
        let release;
        const slow = createParticipantMemoryAnalyst({
            invoke: () => new Promise((resolve) => { release = resolve; })
        });
        const live = createMultiAgentSessionRuntime({
            sessionId: 'session-1',
            initialParticipants: [{ participantId: 'p-1', identity: 'visitor-1' }],
            analysts: [slow], rolloutDecision: rollout('canary')
        });
        const result = live.publishTranscript({ text: 'Merhaba', eventSpeakerId: 'visitor-1' });
        expect(result.event.type).toBe('final_transcript');
        await new Promise((resolve) => setTimeout(resolve, 0));
        release(null);
        await result.completion;
    });
});

describe('targeted survey policy', () => {
    it('returns one trusted connected delivery identity', () => {
        const live = runtime('canary');
        expect(resolveTargetedSurveyDelivery({
            registry: live.registry, targetParticipantId: 'p-ayse'
        })).toEqual({
            allowed: true,
            targetParticipantId: 'p-ayse',
            destinationIdentities: ['visitor-ayse']
        });
        expect(resolveTargetedSurveyDelivery({ registry: live.registry }))
            .toEqual({ allowed: false, reason: 'target_required' });
    });
});

describe('multi-agent rollout policy', () => {
    it('keeps buckets stable and separates shadow from state-writing canary', () => {
        expect(rollout('shadow')).toMatchObject({ enabled: true, applyAcceptedState: false });
        expect(rollout('canary')).toMatchObject({ enabled: true, applyAcceptedState: true });
        expect(createMultiAgentRolloutPolicy({ mode: 'off' }).decide({
            sessionId: 'session-1', capabilityEnabled: true
        })).toMatchObject({ enabled: false, cohort: 'control' });
    });
});
