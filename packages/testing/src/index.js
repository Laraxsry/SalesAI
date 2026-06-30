/** Test factories/helpers shared across packages and apps. */

export function makeProduct(overrides = {}) {
    return { name: 'Acme Cloud', description: 'A cloud product', ...overrides };
}

export function makeAgentConfig(overrides = {}) {
    return {
        name: 'Alex',
        persona: { tone: 'friendly, expert', language: 'en', goals: [], guardrails: [] },
        avatarProvider: 'voice-only',
        screenModes: ['guided-tour', 'customer-share'],
        ...overrides
    };
}
