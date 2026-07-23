/**
 * OpenTelemetry bootstrap (Phase 7). Must be the FIRST thing agent.js imports —
 * auto-instrumentation patches libraries (mongoose, http) by wrapping their
 * exports, which only works if this runs before anything else imports those
 * libraries for the first time. Mirrors apps/api/src/tracing.js.
 *
 * No exported shutdown function: unlike apps/api, @livekit/agents' `cli.runApp`
 * already owns SIGTERM/SIGINT handling for this process, and a second
 * competing handler here would race it — the same class of bug fixed in
 * apps/api's own tracing.js.
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

const sdk = new NodeSDK({
    resource: new Resource({ [ATTR_SERVICE_NAME]: 'salesai-agent-worker' }),
    traceExporter: new OTLPTraceExporter({
        url: process.env.OTLP_TRACES_URL || 'http://localhost:4318/v1/traces'
    }),
    instrumentations: [
        getNodeAutoInstrumentations({
            '@opentelemetry/instrumentation-fs': { enabled: false }
        })
    ]
});

sdk.start();
