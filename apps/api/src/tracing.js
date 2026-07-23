/**
 * OpenTelemetry bootstrap (Phase 7). Must be the FIRST thing main.js imports —
 * auto-instrumentation patches libraries (express, mongoose, ioredis, http)
 * by wrapping their exports, which only works if this runs before anything
 * else `require`s/imports those libraries for the first time.
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

const sdk = new NodeSDK({
    resource: new Resource({ [ATTR_SERVICE_NAME]: 'salesai-api' }),
    // HTTP, not gRPC: no extra native dependency, and it's a plain POST a
    // firewall/proxy/curl can inspect if something needs debugging.
    traceExporter: new OTLPTraceExporter({
        url: process.env.OTLP_TRACES_URL || 'http://localhost:4318/v1/traces'
    }),
    instrumentations: [
        getNodeAutoInstrumentations({
            // The fs instrumentation emits a span for every file read/stat —
            // extremely noisy and rarely useful; every other default stays on.
            '@opentelemetry/instrumentation-fs': { enabled: false }
        })
    ]
});

sdk.start();

/**
 * Flushes pending spans and stops the SDK. Exported (rather than registering
 * its own `process.on('SIGTERM', ...)`) so it runs as one step of the single,
 * central shutdown sequence in shutdown.js — two independent SIGTERM
 * listeners would race, and whichever called `process.exit()` first could
 * kill the process before the HTTP server finished draining in-flight
 * requests.
 */
export function shutdownTracing() {
    return sdk.shutdown();
}
