import { REPLAY_FIXTURE_SCHEMA_VERSION } from './replay-fixture-sanitizer.js';

const FIXTURE_ID = /^session:anon:[a-f0-9]{16}$/;
const PILOT_SCOPE = /^pilot_scope:anon:[a-f0-9]{32}$/;
const PRIVACY_FLAGS = [
    'allowlistProjection', 'opaqueIdsPseudonymized',
    'absoluteTimestampsRemoved', 'freeTextRemoved', 'urlsRemoved'
];

/** Validates the exported replay envelope before it is used as pilot evidence. */
export function validateAdaptiveSurveyCorpus(corpus) {
    if (corpus?.schemaVersion !== REPLAY_FIXTURE_SCHEMA_VERSION
        || corpus.privacy !== 'allowlist-projected-pseudonymous'
        || !Array.isArray(corpus.fixtures)
        || (corpus.pilotScope !== undefined && !PILOT_SCOPE.test(corpus.pilotScope))
        || corpus.fixtureCount !== corpus.fixtures.length) {
        throw new TypeError('invalid anonymized replay corpus');
    }
    const seen = new Set();
    for (const fixture of corpus.fixtures) {
        if (fixture?.schemaVersion !== REPLAY_FIXTURE_SCHEMA_VERSION
            || !FIXTURE_ID.test(fixture.fixtureId)
            || (corpus.pilotScope !== undefined
                && fixture.pilotScope !== corpus.pilotScope)
            || (corpus.pilotScope === undefined && fixture.pilotScope !== undefined)
            || seen.has(fixture.fixtureId)
            || !PRIVACY_FLAGS.every((flag) => fixture.privacy?.[flag] === true)
            || !Array.isArray(fixture.events)
            || fixture.includedEventCount !== fixture.events.length
            || !Number.isInteger(fixture.sourceEventCount)
            || fixture.sourceEventCount < fixture.events.length
            || !fixture.events.every((event, index) => event?.seq === index + 1
                && typeof event.type === 'string'
                && event.meta !== null && typeof event.meta === 'object'
                && !Array.isArray(event.meta))) {
            throw new TypeError('invalid anonymized replay fixture');
        }
        seen.add(fixture.fixtureId);
    }
    return corpus.fixtures;
}
