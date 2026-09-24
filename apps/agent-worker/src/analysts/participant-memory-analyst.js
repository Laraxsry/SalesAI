import { AnalystProposalInput } from '@repo/contracts';
import { createAnalystProposalFactory } from './proposal-factory.js';

export function createParticipantMemoryAnalyst({
    invoke,
    id = 'participant_memory',
    version = '1.0.0',
    timeoutMs,
    enabled,
    proposalFactory = createAnalystProposalFactory()
}) {
    if (typeof invoke !== 'function') throw new TypeError('participant memory invoke is required');

    const analyst = {
        id,
        version,
        timeoutMs,
        enabled,
        contextNeeds: ['participant_memory', 'shared_memory'],
        supports(event) {
            return event.type === 'final_transcript' && Boolean(event.participantId);
        },
        async analyze(context, { signal }) {
            const result = await invoke({
                modelRoute: context.modelRoute,
                transcript: context.event.payload.text,
                participantMemory: context.participantMemory,
                sharedMemory: context.sharedMemory,
                signal
            });
            if (!result) return null;
            return AnalystProposalInput.parse(proposalFactory({
                analyst,
                event: context.event,
                context,
                proposalType: 'participant_memory',
                payload: {
                    confidence: result.confidence,
                    value: {
                        knownFacts: result.knownFacts ?? [],
                        interests: result.interests ?? [],
                        objections: result.objections ?? [],
                        askedQuestions: result.askedQuestions ?? [],
                        declinedTopics: result.declinedTopics ?? []
                    }
                }
            }));
        }
    };
    return Object.freeze(analyst);
}
