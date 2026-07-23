import '@repo/config-env/load';
import './tracing.js';
import { fileURLToPath } from 'node:url';
import { context as otelContext, trace } from '@opentelemetry/api';
import { WorkerOptions, cli, defineAgent, voice } from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
import {
    VideoSource, LocalVideoTrack, VideoBufferType, VideoStream, TrackKind, TrackSource, VideoFrame
} from '@livekit/rtc-node';
import sharp from 'sharp';
import { connectDB, Agent, Product, Session, Message } from '@repo/database';
import { buildSystemPrompt, buildTools } from '@repo/agent';
import { startAvatarWithFallback } from '@repo/avatar';
import { GuidedTour, analyzeFrame } from '@repo/screen';
import { getLogger, runWithContext } from '@repo/logger';
import { publishEvent, publishMetric, publishUsage, RT_EVENTS, SESSION_METRICS } from '@repo/realtime';
import { extractParentContext } from './trace-context.js';
import { withToolCallMetrics } from './tool-metrics.js';
import { createSessionCostTracker } from './session-cost-tracker.js';

/**
 * Runs the session with the trace context extracted from the LiveKit dispatch
 * metadata already active (see `extractParentContext`) and a `traceId`-bound
 * logger already installed (see `entry` below) — every span this function's
 * calls produce nests under the API request that created the session, and
 * every `log.*` call carries the same `traceId`.
 */
async function runSession(ctx) {
    let log = getLogger();
    // `agentSession.on(...)` callbacks below fire later, driven by realtime
    // events rather than by a continuation of this call — plain EventEmitter
    // listeners don't inherit the active OpenTelemetry context across that
    // gap. Captured here and bound onto those two listeners so their
    // Mongoose/publish spans still nest under this session's trace.
    const parentContext = otelContext.active();

    await connectDB();

    // Phase 7 — session join time: how long it takes the agent to join the
    // visitor's LiveKit room. No labels: roomName/sessionId are unbounded
    // per-session identifiers and would blow up Prometheus cardinality.
    const joinStart = Date.now();
    await ctx.connect();
    publishMetric(SESSION_METRICS.SESSION_JOIN_MS, Date.now() - joinStart);

    // Phase 7 — cost tracking: accumulates estimated USD cost as the session
    // runs (realtime-model tokens + vision calls) and flags a runaway
    // tour/vision loop the moment it crosses SESSION_COST_ALERT_USD.
    const sessionStartedAt = Date.now();
    const costTracker = createSessionCostTracker();

    const roomName = ctx.room.name;
    const session = await Session.findOne({ roomName });
    const agentDoc = session ? await Agent.findById(session.agentId) : null;
    const product = agentDoc ? await Product.findById(agentDoc.productId) : null;

    if (!agentDoc || !product) {
        log.error('agent-worker: missing agent/product for room', { roomName });
        return;
    }

    // Re-bind with sessionId now that it's known, so every remaining log line
    // in this session carries both identifiers.
    log = log.child({ sessionId: String(session._id) });

    const instructions = buildSystemPrompt({
        name: agentDoc.name,
        product: { name: product.name, description: product.description },
        persona: agentDoc.persona
    });

    // screenModes defined on the agent doc govern which tools are available
    const screenModes = Array.isArray(agentDoc.screenModes) ? agentDoc.screenModes : [];

    // ── Guided Tour (Mode A) ────────────────────────────────────────────────
    // Streams agent-driven browser navigation as a LiveKit video track.
    // COBROWSE_PROVIDER=browserbase opts into the Stagehand/Browserbase
    // cloud backend; default stays local Playwright.
    const backend = process.env.COBROWSE_PROVIDER === 'browserbase' ? 'stagehand' : 'playwright';
    const startUrl = product.websiteUrl || 'https://salesai.dev';

    // Phase 3: Session Handover
    // If the visitor passed their active session (transientAuth), use it
    // and IMMEDIATELY delete it from the database so it cannot be read again.
    let tourAuth = product.demoSession || null;
    if (session.transientAuth) {
        tourAuth = session.transientAuth;
        log.info('Using transientAuth for session handover, deleting from DB for security', { sessionId: String(session._id) });
        await Session.updateOne({ _id: session._id }, { $unset: { transientAuth: 1 } });
    }

    const tour = new GuidedTour({
        startUrl,
        backend,
        allowedDomains: product.tourAllowedDomains || [],
        auth: tourAuth
    });

    let isTourActive = false;
    let tourPublishInterval = null;
    let tourVideoSource = null;
    let tourVideoTrack = null;

    const tourControls = {
        openAt: async (url) => {
            if (!screenModes.includes('guided-tour')) {
                return { ok: false, error: 'Guided tour is not enabled for this agent (screenModes).' };
            }
            if (isTourActive) {
                return { ok: false, error: 'Tour already active. Use navigate_to to move within the current tour.' };
            }
            try {
                await tour.open();
                if (url) {
                    await tour.goto(url);
                }
                isTourActive = true;
                log.info('GuidedTour started', { url });

                // Create a LiveKit VideoSource and publish it as a screen-share track
                tourVideoSource = new VideoSource(1280, 720);
                try {
                    tourVideoTrack = LocalVideoTrack.createVideoTrack('tour', tourVideoSource);
                    await ctx.room.localParticipant.publishTrack(tourVideoTrack, { name: 'screen_share', source: TrackSource.SOURCE_SCREENSHARE });
                    log.info('Tour video track published to LiveKit room');
                } catch (e) {
                    console.error('Could not publish tour track to LiveKit:', e);
                }

                // Capture Playwright frames and push to LiveKit at ~1 FPS
                tourPublishInterval = setInterval(async () => {
                    if (!isTourActive || !tourVideoSource) return;
                    try {
                        const pngBuffer = await tour.screenshot();
                        // Convert PNG → raw ARGB buffer via sharp
                        const { data, info } = await sharp(pngBuffer)
                            .resize({ width: 1280, height: 720, fit: 'contain', background: '#000' })
                            .ensureAlpha()
                            .raw()
                            .toBuffer({ resolveWithObject: true });

                        // Push to LiveKit VideoSource
                        const frame = new VideoFrame(data, info.width, info.height, VideoBufferType.RGBA);
                        const timestampUs = BigInt(Date.now()) * 1000n;
                        tourVideoSource.captureFrame(frame, timestampUs);
                    } catch (frameErr) {
                        // Non-fatal: log and skip this frame
                        log.warn('Tour frame capture failed', { error: frameErr.message });
                    }
                }, 1000); // ~1 FPS keeps CPU and bandwidth manageable

                // Log screen action to messages meta
                await Message.create({
                    sessionId: session._id,
                    role: 'system',
                    text: `[screen:tour_started] url=${url || ''}`,
                    meta: { action: 'tour_started', url: url || '' }
                }).catch(() => {});

                return { ok: true, status: 'Tour started. Visitor can now see the browser. Use navigate_to or highlight next.' };
            } catch (e) {
                log.error('GuidedTour open failed: ' + e.message, { error: e.message });
                await tour.close().catch(() => {});
                isTourActive = false;
                return { ok: false, error: e.message };
            }
        },
        goto: async (url) => {
            if (!isTourActive) return { ok: false, error: 'Tour not active. Call start_guided_tour first.' };
            try {
                await tour.goto(url);
                await Message.create({
                    sessionId: session._id,
                    role: 'system',
                    text: `[screen:navigate_to] url=${url}`,
                    meta: { action: 'navigate_to', url }
                }).catch(() => {});
                return { ok: true };
            } catch (e) {
                log.error('GuidedTour navigate failed', { error: e.message });
                return { ok: false, error: e.message };
            }
        },
        highlight: async (selector) => {
            if (!isTourActive) return { ok: false, error: 'Tour not active.' };
            try {
                await tour.highlight(selector);
                await Message.create({
                    sessionId: session._id,
                    role: 'system',
                    text: `[screen:highlight] selector=${selector}`,
                    meta: { action: 'highlight', selector }
                }).catch(() => {});
                return { ok: true };
            } catch (e) {
                log.error('GuidedTour highlight failed', { error: e.message });
                return { ok: false, error: e.message };
            }
        },
        click: async (selector) => {
            if (!isTourActive) return { ok: false, error: 'Tour not active.' };
            try {
                await tour.click(selector);
                await Message.create({
                    sessionId: session._id,
                    role: 'system',
                    text: `[screen:click] selector=${selector}`,
                    meta: { action: 'click', selector }
                }).catch(() => {});
                return { ok: true };
            } catch (e) {
                log.error('GuidedTour click failed', { error: e.message });
                return { ok: false, error: e.message };
            }
        }
    };

    // ── Customer Screen Vision (Mode B) ────────────────────────────────────
    // Samples the customer's screen-share track at ~1 FPS, downscales to
    // 1024px wide before passing to the vision model to control token cost.
    let latestCustomerFrameBase64 = null;
    let customerSampleInterval = null;

    ctx.room.on('trackSubscribed', (track, pub, participant) => {
        console.log('TRACK SUBSCRIBED:', { kind: track.kind, source: track.source, trackObj: track });
        if (track.kind !== TrackKind.KIND_VIDEO) return;
        log.info('Customer screen share detected', { participant: participant.identity });

        // Stop any previous sampling loop
        if (customerSampleInterval) clearInterval(customerSampleInterval);

        const videoStream = new VideoStream(track);

        // Drain the stream continuously (a ReadableStream allows only one
        // reader; per-tick iterators would throw), keep only the newest frame.
        let latestRawFrame = null;
        (async () => {
            // The stream yields VideoFrameEvent ({ frame, timestampUs, rotation })
            for await (const event of videoStream) {
                latestRawFrame = event.frame;
            }
        })().catch(err => log.warn('Customer video stream ended', { error: err.message }));

        // Convert at ~1 FPS to keep sharp/vision cost bounded
        customerSampleInterval = setInterval(async () => {
            if (!screenModes.includes('customer-share')) return;
            try {
                const frame = latestRawFrame;
                if (!frame) return;

                // Frames arrive as I420; convert to RGBA so sharp can read raw pixels
                const { data, width, height } = frame.convert(VideoBufferType.RGBA);
                const jpegBuffer = await sharp(Buffer.from(data), {
                    raw: { width, height, channels: 4 }
                })
                    .resize({ width: 1024, withoutEnlargement: true })
                    .jpeg({ quality: 80 })
                    .toBuffer();

                latestCustomerFrameBase64 = `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;
            } catch (err) {
                log.warn('Customer frame sample failed', { error: err.message });
            }
        }, 1000); // ~1 FPS

        // Clean up when the customer stops sharing
        track.on('ended', () => {
            if (customerSampleInterval) {
                clearInterval(customerSampleInterval);
                customerSampleInterval = null;
            }
            latestCustomerFrameBase64 = null;
            log.info('Customer screen share ended');
        });
    });

    const screenControls = {
        read: async (question) => {
            if (!screenModes.includes('customer-share')) {
                return { ok: false, error: 'Screen vision is not enabled for this agent (screenModes).' };
            }
            if (!latestCustomerFrameBase64) {
                return { ok: false, error: 'Customer is not sharing screen or no frame available yet.' };
            }
            try {
                const result = await analyzeFrame(latestCustomerFrameBase64, question);

                costTracker.addVisionFrame();
                if (costTracker.checkThreshold()) {
                    log.error('session cost exceeded alert threshold', costTracker.snapshot());
                }

                // Log the screen read to transcript
                await Message.create({
                    sessionId: session._id,
                    role: 'system',
                    text: `[screen:vision_read] question=${question}`,
                    meta: { action: 'vision_read', question }
                }).catch(() => {});
                return { ok: true, analysis: result };
            } catch (e) {
                return { ok: false, error: e.message };
            }
        }
    };

    const { llm } = await import('@livekit/agents');
    const tools = withToolCallMetrics(buildTools({
        productId: String(product._id),
        tour: tourControls,
        screen: screenControls
    })).map(t => llm.tool({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
        execute: t.handler
    }));

    const agentSession = new voice.AgentSession({
        llm: new openai.realtime.RealtimeModel({
            model: process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2',
            voice: 'cedar'
        })
    });

    // Attach the configured avatar (developer-selected, not visitor choice).
    // Falls back to voice-only automatically on failure (Phase 7 —
    // circuit breaker + retry live in @repo/resilience); this call
    // cannot itself throw, so no try/catch is needed here anymore.
    await startAvatarWithFallback({
        name: agentDoc.avatarProvider,
        agentSession,
        room: ctx.room
    });

    // Phase 7 — first-audio latency: the framework's own realtime-model
    // metrics already measure time-to-first-audio-token per turn (`ttftMs`,
    // -1 when a turn produced no audio at all — skipped, not a latency
    // sample). Reusing this built-in instrumentation instead of
    // approximating it with our own wall-clock timers around an opaque
    // provider call.
    agentSession.on(voice.AgentSessionEventTypes.MetricsCollected, (ev) => {
        const metrics = ev.metrics;
        if (metrics.type !== 'realtime_model_metrics') return;

        if (metrics.ttftMs >= 0) {
            publishMetric(SESSION_METRICS.FIRST_AUDIO_MS, metrics.ttftMs, {
                provider: metrics.metadata?.modelProvider || 'unknown'
            });
        }

        costTracker.addRealtimeTurn(metrics);
        if (costTracker.checkThreshold()) {
            log.error('session cost exceeded alert threshold', costTracker.snapshot());
        }
    });

    agentSession.on(voice.AgentSessionEventTypes.ConversationItemAdded, otelContext.bind(parentContext, async (ev) => {
        const item = ev.item;
        if (item.type !== 'message') return;

        try {
            // Determine text based on content array
            let text = '';
            for (const part of item.content) {
                if (typeof part === 'string') text += part;
                else if (part.type === 'text') text += part.text;
            }

            if (text || item.role === 'tool') {
                const msg = await Message.create({
                    sessionId: session._id,
                    role: item.role,
                    text: text.trim()
                });

                await publishEvent(RT_EVENTS.SESSION_TRANSCRIPT, {
                    sessionId: session._id,
                    messageId: msg._id,
                    role: msg.role,
                    text: msg.text,
                    createdAt: msg.createdAt
                });
            }
        } catch (err) {
            log.error('failed to save message', { error: err });
        }
    }));

    agentSession.on(voice.AgentSessionEventTypes.Close, otelContext.bind(parentContext, async () => {
        try {
            // Cleanup: stop tour publish loop and close browser
            if (tourPublishInterval) clearInterval(tourPublishInterval);
            if (customerSampleInterval) clearInterval(customerSampleInterval);
            try { await tour.close(); } catch { /* best-effort cleanup */ }

            await Session.updateOne({ _id: session._id }, { status: 'ended' });
            log.info('session ended', { sessionId: session._id });
        } catch (err) {
            log.error('failed to update session status on close', { error: err });
        }

        // Phase 7 — flush this session's usage into the real Phase 6 billing
        // ledger (via apps/api's usage-bridge.js -> recordUsage()) and
        // publish the total as a cost-dashboard metric. product.workspaceId
        // (not agent.workspaceId — Agent has no such field) is already
        // loaded from earlier in this function.
        const workspaceId = product.workspaceId ? String(product.workspaceId) : null;
        const { realtimeCostUsd, visionCostUsd, visionFrameCount, totalCostUsd } = costTracker.snapshot();
        const sessionMinutes = (Date.now() - sessionStartedAt) / 60_000;

        if (workspaceId) {
            publishUsage({
                workspaceId,
                meter: 'agent_voice_minutes',
                quantity: sessionMinutes,
                estCost: realtimeCostUsd,
                sessionId: String(session._id),
                agentId: String(agentDoc._id)
            });
            if (visionFrameCount > 0) {
                publishUsage({
                    workspaceId,
                    meter: 'vision_frames',
                    quantity: visionFrameCount,
                    estCost: visionCostUsd,
                    sessionId: String(session._id),
                    agentId: String(agentDoc._id)
                });
            }
        } else {
            log.warn('skipping usage flush: product has no workspaceId', { productId: String(product._id) });
        }

        publishMetric(SESSION_METRICS.SESSION_COST_USD, totalCostUsd);
    }));

    await agentSession.start({
        agent: new voice.Agent({ instructions, tools }),
        room: ctx.room
    });
}

/**
 * The realtime brain. LiveKit dispatches this worker into a visitor's room.
 * It loads the agent config, builds the persona + tools, attaches the chosen
 * avatar, and runs a speech-to-speech session backed by the OpenAI Realtime API.
 */
export default defineAgent({
    entry: (ctx) => {
        const parentContext = extractParentContext(ctx.job);
        const traceId = trace.getSpanContext(parentContext)?.traceId;
        return otelContext.with(parentContext, () => runWithContext({ traceId }, () => runSession(ctx)));
    }
});

cli.runApp(new WorkerOptions({
    agent: fileURLToPath(import.meta.url),
    // Named agent: LiveKit dispatch will route rooms to this worker by name.
    // The name must match the agentName passed to dispatchAgent() in sessions.js.
    agentName: process.env.LIVEKIT_AGENT_NAME || 'salesai-agent'
}));
