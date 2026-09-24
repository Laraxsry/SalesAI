import { ConversationEventInput } from '@repo/contracts';

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
    return value;
}

/** In-memory, process-local bus. Persistence and broker delivery are adapters. */
export function createConversationEventBus({ onSubscriberError = () => {} } = {}) {
    const subscribers = new Set();

    return Object.freeze({
        subscribe(handler) {
            if (typeof handler !== 'function') throw new TypeError('event subscriber must be a function');
            subscribers.add(handler);
            return () => subscribers.delete(handler);
        },
        async publish(input) {
            const event = deepFreeze(structuredClone(ConversationEventInput.parse(input)));
            const settled = await Promise.allSettled(
                [...subscribers].map((handler) => Promise.resolve().then(() => handler(event)))
            );
            settled.forEach((result, index) => {
                if (result.status !== 'rejected') return;
                try {
                    onSubscriberError({ index, eventType: event.type, error: result.reason });
                } catch {
                    // Diagnostics must not change event delivery behavior.
                }
            });
            return settled;
        },
        get subscriberCount() {
            return subscribers.size;
        }
    });
}
