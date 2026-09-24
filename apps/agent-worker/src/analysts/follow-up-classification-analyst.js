import { AnalystProposalInput } from '@repo/contracts';
import { createAnalystProposalFactory } from './proposal-factory.js';

export function createFollowUpClassificationAnalyst({
    invoke,
    id = 'follow_up_classification',
    version = '1.0.0',
    timeoutMs,
    enabled,
    proposalFactory = createAnalystProposalFactory()
}) {
    if (typeof invoke !== 'function') throw new TypeError('follow-up classifier invoke is required');

    const analyst = {
        id,
        version,
        timeoutMs,
        enabled,
        contextNeeds: [],
        supports(event) {
            return event.type === 'company_question' && Boolean(event.participantId);
        },
        async analyze(context, { signal }) {
            const result = await invoke({
                modelRoute: context.modelRoute,
                question: context.event.payload.question,
                signal
            });
            if (!result) return null;
            return AnalystProposalInput.parse(proposalFactory({
                analyst,
                event: context.event,
                context,
                proposalType: 'follow_up_classification',
                payload: {
                    confidence: result.confidence,
                    value: {
                        category: result.category,
                        department: result.department ?? null,
                        priority: result.priority
                    }
                }
            }));
        }
    };
    return Object.freeze(analyst);
}
