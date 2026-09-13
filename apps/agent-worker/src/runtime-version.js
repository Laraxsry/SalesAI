import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8')
);

/**
 * Runtime telemetry and release notes use the workspace package version as
 * their single source of truth. Keeping this out of agent.js also makes the
 * version available to health/readiness surfaces without starting a session.
 */
export const AGENT_RUNTIME_VERSION = packageJson.version;
