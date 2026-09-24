import { randomUUID } from 'node:crypto';
import { createConversationEventBus } from './conversation-event-bus.js';
import { createAnalystRegistry } from './analyst-registry.js';
import { createBoundedContextProjector } from './context-projector.js';
import { createAnalystProposalValidator } from './proposal-validator.js';
import { createAnalystRunner } from './analyst-runner.js';
import { createOrchestrationTelemetry } from './orchestration-telemetry.js';
import { createModelRouter } from './model-router.js';
import { createParticipantRegistry } from '../participants/participant-registry.js';
import { resolveTrustedParticipantContext } from '../participants/participant-attribution.js';
import { createParticipantScopedMemory } from '../participant-memory/memory-state.js';
import { reduceParticipantScopedMemory } from '../participant-memory/memory-reducer.js';
import { projectSpeakingAgentMemory } from '../participant-memory/memory-projector.js';
import { mapParticipantMemoryProposalToEvents } from '../analysts/participant-memory-proposal-mapper.js';

const DEFAULT_MODEL_ROUTE = Object.freeze({
    provider: 'openai', model: 'gpt-5.1-mini', timeoutMs: 1200,
    maxOutputTokens: 500, concurrencyClass: 'turn_background'
});

/** Owns one session's background analysts. It never blocks the realtime reply path. */
export function createMultiAgentSessionRuntime({
    sessionId,
    initialParticipants = [],
    analysts = [],
    rolloutDecision,
    modelRoutes = {},
    defaultModelRoute = DEFAULT_MODEL_ROUTE,
    createEventId = () => randomUUID(),
    now = () => Date.now(),
    onProjection = () => {},
    onAnalystResult = () => {},
    onTelemetry = () => {},
    onError = () => {}
} = {}) {
    const registry = createParticipantRegistry({ sessionId, initialParticipants });
    let memory = createParticipantScopedMemory();
    let currentTurnIndex = 0;
    let currentRouteRevision = 0;
    let activeParticipantId = null;
    let activeParticipantContext = null;
    let activeController = null;
    const controllersByEventId = new Map();
    let disposed = false;

    const eventBus = createConversationEventBus({ onSubscriberError: onError });
    const analystRegistry = createAnalystRegistry(analysts);
    const telemetry = createOrchestrationTelemetry({ onRecord: onTelemetry });
    const runner = createAnalystRunner({
        registry: analystRegistry,
        contextProjector: createBoundedContextProjector(),
        proposalValidator: createAnalystProposalValidator({ now }),
        telemetry,
        modelRouter: createModelRouter({ routes: modelRoutes, defaultRoute: defaultModelRoute })
    });

    function projection() {
        return projectSpeakingAgentMemory(memory, activeParticipantId);
    }

    eventBus.subscribe(async (event) => {
        if (!rolloutDecision?.enabled || disposed) return;
        const controller = controllersByEventId.get(event.eventId);
        const results = await runner.run({
            event,
            executionContext: {
                memory,
                routeRevision: currentRouteRevision,
                turnIndex: currentTurnIndex
            },
            getCurrentContext: () => ({
                memory,
                routeRevision: currentRouteRevision,
                turnIndex: currentTurnIndex
            }),
            signal: controller?.signal
        });
        try {
            for (const result of results) {
                onAnalystResult(result);
                if (result.status !== 'accepted' || !rolloutDecision.applyAcceptedState) continue;
                if (result.proposal.proposalType !== 'participant_memory') continue;
                const previousRevision = memory.revision;
                for (const acceptedEvent of mapParticipantMemoryProposalToEvents(result.proposal)) {
                    memory = reduceParticipantScopedMemory(memory, acceptedEvent);
                }
                if (memory.revision !== previousRevision) onProjection(projection());
            }
        } finally {
            controllersByEventId.delete(event.eventId);
        }
        return results;
    });

    function publishTranscript({
        text,
        eventSpeakerId = null,
        fallbackIdentity = null,
        micOnFor = () => false,
        routeRevision = 0,
        language = null
    }) {
        if (!rolloutDecision?.enabled || disposed || !String(text ?? '').trim()) return null;
        activeController?.abort(new Error('superseded_by_new_turn'));
        activeController = new AbortController();
        currentTurnIndex += 1;
        currentRouteRevision = Math.max(0, Number(routeRevision) || 0);
        const participant = resolveTrustedParticipantContext({
            registry, eventSpeakerId, fallbackIdentity, micOnFor
        });
        activeParticipantId = participant.participantId;
        activeParticipantContext = participant;
        const event = {
            eventId: createEventId(),
            type: 'final_transcript',
            sessionId: String(sessionId),
            participantId: participant.participantId,
            turnIndex: currentTurnIndex,
            routeRevision: currentRouteRevision,
            occurredAt: new Date(now()).toISOString(),
            payload: {
                text: String(text).trim(),
                language,
                speakerIdentity: participant.livekitIdentity
            }
        };
        controllersByEventId.set(event.eventId, activeController);
        const completion = eventBus.publish(event).catch((error) => {
            onError(error);
            return [];
        });
        return Object.freeze({ event, participant, completion });
    }

    return Object.freeze({
        registry,
        analystRegistry,
        publishTranscript,
        projection,
        activeParticipantContext: () => activeParticipantContext,
        publishTrustedEvent(event) {
            if (!rolloutDecision?.enabled || disposed) return null;
            const normalized = {
                ...event,
                sessionId: String(sessionId),
                turnIndex: currentTurnIndex,
                routeRevision: currentRouteRevision
            };
            const controller = new AbortController();
            controllersByEventId.set(normalized.eventId, controller);
            return eventBus.publish(normalized).catch((error) => {
                onError(error);
                return [];
            });
        },
        memorySnapshot: () => structuredClone(memory),
        telemetrySnapshot: () => telemetry.snapshot(),
        setRouteRevision(value) {
            currentRouteRevision = Math.max(currentRouteRevision, Number(value) || 0);
        },
        dispose() {
            disposed = true;
            activeController?.abort(new Error('session_disposed'));
        }
    });
}
