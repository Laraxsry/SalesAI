import '@repo/config-env/load';
import './tracing.js';
import { fileURLToPath } from 'node:url';
import { context as otelContext, trace } from '@opentelemetry/api';
import { WorkerOptions, cli, defineAgent, voice } from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
import * as silero from '@livekit/agents-plugin-silero';
import {
    VideoSource, LocalVideoTrack, VideoBufferType, VideoStream, TrackKind, TrackSource, VideoFrame, RoomEvent
} from '@livekit/rtc-node';
import sharp from 'sharp';
import { connectDB, Agent, Product, Session, Message } from '@repo/database';
import { buildSystemPrompt, buildTools } from '@repo/agent';
import { startAvatarWithFallback } from '@repo/avatar';
import { roomService } from '@repo/livekit';
import { GuidedTour, analyzeFrame } from '@repo/screen';
import { getLogger, runWithContext } from '@repo/logger';
import { decryptField } from '@repo/utils';
import { publishEvent, publishMetric, publishUsage, RT_EVENTS, SESSION_METRICS } from '@repo/realtime';
import { extractParentContext } from './trace-context.js';
import { withToolCallMetrics } from './tool-metrics.js';
import { createSessionCostTracker } from './session-cost-tracker.js';
import { createRealtimeGate } from './realtime-gate.js';

/**
 * Chat-completions options for the conversational LLM.
 *
 * `reasoning_effort` needs a per-model decision, and getting it wrong breaks
 * every single turn (the request 400s, the framework retries four times and
 * gives up, and the visitor just never hears an answer):
 *   - gpt-5* models reject function tools on /v1/chat/completions unless the
 *     effort is exactly 'none' — "Function tools with reasoning_effort are not
 *     supported for <model> in /v1/chat/completions. To use function tools,
 *     use /v1/responses or set reasoning_effort to 'none'." This agent always
 *     has tools attached, so 'none' is the only workable value (and the right
 *     one anyway: a voice turn can't wait on a reasoning pass).
 *   - non-reasoning models (gpt-4o*, …) reject the parameter outright, so it
 *     must be omitted rather than set to 'none'.
 *
 * @param {string} model
 */
function buildLLMOptions(model) {
    return /^gpt-5/.test(model) ? { model, reasoningEffort: 'none' } : { model };
}

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

    // Heartbeat: keeps Session.lastActivityAt fresh while this worker is
    // attached to the room, so close-stale-sessions (worker-general) can tell
    // a genuinely long call apart from one whose worker process died without
    // a clean disconnect — see the participant-left watchdog below for the
    // (separate) concern of not leaving the paid OpenAI connection open.
    const heartbeatInterval = setInterval(() => {
        Session.updateOne({ _id: session._id }, { lastActivityAt: new Date() }).catch((err) =>
            log.warn('heartbeat write failed (non-fatal)', { error: err.message })
        );
    }, 60_000);

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
    let tourAuth = null;
    if (product.demoSession) {
        try {
            tourAuth = JSON.parse(decryptField(product.demoSession));
        } catch (err) {
            log.warn('Failed to decrypt product.demoSession, tour will be unauthenticated', { productId: String(product._id), error: err.message });
        }
    }
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
    let tourPublishTimer = null;
    let tourVideoSource = null;
    let tourVideoTrack = null;
    // True while a screenshot/sharp/captureFrame cycle is between its initial
    // isTourActive check and actually touching the native track — stopScreenShare
    // waits for this to clear before unpublishing (see the COST/CRASH note there).
    let tourCaptureInFlight = false;
    // Latest tour frame as a downscaled JPEG data URL, kept in memory only
    // (never persisted) so `read_tour_screen` can hand the agent's own
    // guided-tour browser to the vision model on demand — mirrors the
    // customer-share sampling below, just fed from Playwright instead of a
    // LiveKit video track.
    let latestTourFrameBase64 = null;

    const tourControls = {
        openAt: async (url) => {
            if (!screenModes.includes('guided-tour')) {
                return { ok: false, error: 'Guided tour is not enabled for this agent (screenModes).' };
            }
            if (isTourActive) {
                return { ok: false, error: 'Tour already active. Use navigate_to to move within the current tour.' };
            }
            try {
                // If configured demo authentication fails, fail loudly instead
                // of silently showing the public site as if login succeeded.
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

                // Schedule the next capture only after the current one finishes.
                // Overlapping Playwright/sharp work can starve LiveKit heartbeats.
                const scheduleTourFrame = () => {
                    tourPublishTimer = setTimeout(async () => {
                        tourPublishTimer = null;
                        if (!isTourActive || !tourVideoSource) return;
                        tourCaptureInFlight = true;
                        try {
                            const pngBuffer = await tour.screenshot();
                            // Convert PNG → raw ARGB buffer via sharp
                            const { data, info } = await sharp(pngBuffer)
                                .resize({ width: 1280, height: 720, fit: 'contain', background: '#000' })
                                .ensureAlpha()
                                .raw()
                                .toBuffer({ resolveWithObject: true });

                            // *** CRASH WARNING — re-check right before touching the
                            // native track. stopScreenShare() may have unpublished
                            // it while we were awaiting the screenshot/resize above;
                            // calling captureFrame() on a source whose track is
                            // concurrently being unpublished is a native Rust panic
                            // in livekit-ffi (unwrap() on Err), which kills the whole
                            // agent-worker process — not a catchable JS error. ***
                            if (!isTourActive || !tourVideoSource) return;

                            // Push to LiveKit VideoSource
                            const frame = new VideoFrame(data, info.width, info.height, VideoBufferType.RGBA);
                            const timestampUs = BigInt(Date.now()) * 1000n;
                            tourVideoSource.captureFrame(frame, timestampUs);

                            // Also keep a downscaled JPEG copy for read_tour_screen —
                            // cheap (just re-encoding the same PNG we already have),
                            // the actual vision-model cost only happens when the
                            // tool is called.
                            const jpegBuffer = await sharp(pngBuffer)
                                .resize({ width: 1024, withoutEnlargement: true })
                                .jpeg({ quality: 80 })
                                .toBuffer();
                            latestTourFrameBase64 = `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;
                        } catch (frameErr) {
                            // Non-fatal: log and skip this frame
                            log.warn('Tour frame capture failed', { error: frameErr.message });
                        } finally {
                            tourCaptureInFlight = false;
                            if (isTourActive && tourVideoSource) scheduleTourFrame();
                        }
                    }, 1500);
                };
                scheduleTourFrame();

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
                latestTourFrameBase64 = null;
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
        },
        scroll: async (direction, amount) => {
            if (!isTourActive) return { ok: false, error: 'Tour not active. Call start_guided_tour first.' };
            try {
                const position = await tour.scroll(direction, amount);
                await Message.create({
                    sessionId: session._id,
                    role: 'system',
                    text: `[screen:scroll_page] direction=${direction}`,
                    meta: { action: 'scroll_page', direction, amount }
                }).catch(() => {});
                // atTop/atBottom go back to the model so it knows whether
                // there is anything left to scroll to.
                return { ok: true, ...position };
            } catch (e) {
                log.error('GuidedTour scroll failed', { error: e.message });
                return { ok: false, error: e.message };
            }
        },
        readScreen: async (question) => {
            if (!screenModes.includes('guided-tour')) {
                return { ok: false, error: 'Guided tour is not enabled for this agent (screenModes).' };
            }
            if (!isTourActive) {
                return { ok: false, error: 'Tour not active. Call start_guided_tour first.' };
            }
            if (!latestTourFrameBase64) {
                return { ok: false, error: 'No tour frame available yet — try again in a second.' };
            }
            try {
                const result = await analyzeFrame(latestTourFrameBase64, question);

                costTracker.addVisionFrame();
                if (costTracker.checkThreshold()) {
                    log.error('session cost exceeded alert threshold', costTracker.snapshot());
                }

                await Message.create({
                    sessionId: session._id,
                    role: 'system',
                    text: `[screen:tour_vision_read] question=${question}`,
                    meta: { action: 'tour_vision_read', question }
                }).catch(() => {});
                return { ok: true, analysis: result };
            } catch (e) {
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

    // Stops whatever screen is currently visible. Mode A (guided tour) is a
    // track this worker owns, so it's closed and unpublished directly. Mode B
    // (the customer's own screen) is owned by the visitor's client — the
    // agent has no way to stop that track itself, so it sends a data-channel
    // request and relies on the visitor app to act on it.
    const stopScreenShare = async () => {
        const results = {};

        if (isTourActive) {
            try {
                // Flips first, synchronously, so any capture cycle currently awaiting
                // screenshot/sharp work re-checks this and bails before touching the
                // native track (see the CRASH WARNING in scheduleTourFrame above).
                isTourActive = false;
                if (tourPublishTimer) {
                    clearTimeout(tourPublishTimer);
                    tourPublishTimer = null;
                }

                // Wait for a capture cycle that was already past the isTourActive
                // check when we flipped it above — calling unpublishTrack() while
                // captureFrame() is still in flight on the same track is a native
                // Rust panic in livekit-ffi, not a catchable JS error, and it takes
                // the whole agent-worker process down (audio + transcript both cut
                // instantly). Bounded so a stuck capture can't hang stopScreenShare.
                const waitStart = Date.now();
                while (tourCaptureInFlight && Date.now() - waitStart < 3000) {
                    await new Promise((r) => setTimeout(r, 50));
                }

                if (tourVideoTrack) {
                    try {
                        // unpublishTrack() takes the track SID (string), not the
                        // track object — passing the object coerces to the literal
                        // string "[object Object]", which the native livekit-ffi
                        // layer can't resolve to a real track and panics on
                        // (`unwrap()` on `Err`), crashing the whole agent-worker
                        // process. This was the actual root cause of the crash on
                        // stop_screen_share, not the capture-cycle race above
                        // (that race is still worth guarding against separately).
                        if (tourVideoTrack.sid) {
                            await ctx.room.localParticipant.unpublishTrack(tourVideoTrack.sid);
                        } else {
                            log.warn('Tour track has no sid yet; skipping unpublishTrack');
                        }
                    } catch (e) {
                        log.warn('Failed to unpublish tour track', { error: e.message });
                    }
                    tourVideoTrack = null;
                }
                tourVideoSource = null;
                await tour.close();
                results.tour = 'stopped';

                await Message.create({
                    sessionId: session._id,
                    role: 'system',
                    text: '[screen:tour_stopped]',
                    meta: { action: 'tour_stopped' }
                }).catch(() => {});
            } catch (e) {
                log.error('Failed to stop guided tour', { error: e.message });
                results.tour = `error: ${e.message}`;
            }
        }

        if (screenModes.includes('customer-share') && latestCustomerFrameBase64) {
            try {
                const payload = new TextEncoder().encode(JSON.stringify({ type: 'salesai:stop_screen_share' }));
                await ctx.room.localParticipant.publishData(payload, { reliable: true, topic: 'salesai' });
                results.customerShare = 'stop_requested';
            } catch (e) {
                log.warn('Failed to send stop-screen-share signal to visitor', { error: e.message });
                results.customerShare = `error: ${e.message}`;
            }
        }

        if (!results.tour && !results.customerShare) {
            return { ok: false, error: 'No active screen share to stop.' };
        }
        return { ok: true, ...results };
    };

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

    // Written only once the agent has read a field back to the visitor and
    // gotten explicit confirmation (see the instruction in persona.js) — a
    // higher-confidence source than extract-lead's post-call regex parse of
    // the raw transcript, and what drives the visitor identity shown live in
    // Console (Sessions list) instead of "Anonim ziyaretçi".
    const saveContactInfo = async (field, value) => {
        if (!['name', 'email', 'phone'].includes(field)) {
            return { ok: false, error: 'Invalid field. Use name, email, or phone.' };
        }
        const update = { [`confirmedContact.${field}`]: value };
        if (field === 'name') update.visitorName = value; // existing UI/analytics already read visitorName
        await Session.updateOne({ _id: session._id }, { $set: update });
        await Message.create({
            sessionId: session._id,
            role: 'system',
            text: `[contact:confirmed] ${field}=${value}`,
            meta: { action: 'contact_confirmed', field, value }
        }).catch(() => {});
        return { ok: true };
    };

    const { llm } = await import('@livekit/agents');
    const tools = withToolCallMetrics(buildTools({
        productId: String(product._id),
        tour: tourControls,
        screen: screenControls,
        stopScreenShare,
        saveContactInfo
    })).map(t => llm.tool({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
        execute: t.handler
    }));

    // ── Voice pipeline (chained STT -> LLM -> TTS) ──────────────────────────
    // The speech language is the agent's own configured persona language, not
    // a per-provider default: OpenAI's transcription models default to
    // `language: 'en'`, and an English-pinned transcription of Turkish speech
    // comes back *translated into English* ("Konuşabilir misin?" ->
    // "Can we talk?") rather than mis-transcribed, which silently destroys
    // both the transcript and everything the LLM reasons over.
    const speechLanguage = agentDoc.persona?.language || 'en';

    const vad = await silero.VAD.load();
    const stt = new openai.STT({
        model: process.env.OPENAI_STT_MODEL || 'gpt-4o-transcribe',
        language: speechLanguage
    });
    const llmClient = new openai.LLM(buildLLMOptions(process.env.OPENAI_LLM_MODEL || 'gpt-5.1'));
    const tts = new openai.TTS({
        model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
        voice: process.env.OPENAI_TTS_VOICE || 'alloy'
    });
    const agentSession = new voice.AgentSession({ vad, stt, llm: llmClient, tts });

    // A provider error in any pipeline stage is emitted as an event, not
    // thrown: a `recoverable` one (e.g. the LLM rejecting every request) then
    // leaves the session running and listening forever while never producing
    // a single reply. Without this listener that failure mode is completely
    // silent — the visitor just gets no answer and the transcript holds only
    // their own turns.
    agentSession.on(voice.AgentSessionEventTypes.Error, (ev) => {
        log.error('agent session error', {
            type: ev.error?.type,
            label: ev.error?.label,
            recoverable: ev.error?.recoverable,
            error: ev.error?.error?.message || String(ev.error?.error)
        });
    });

    // Phase 7 — first-audio latency + cost. The framework reports per-turn
    // metrics for whichever pipeline is in use: one `realtime_model_metrics`
    // event per turn for a speech-to-speech model, or separate
    // `llm_metrics`/`tts_metrics`/`stt_metrics` events for the chained
    // pipeline. Both are handled so switching pipelines doesn't silently
    // zero out the cost dashboard and the latency histogram. Time-to-first-
    // audio is `ttftMs` for realtime and TTS `ttfbMs` for chained (`-1`/
    // negative means the turn produced no audio at all — skipped, not a
    // latency sample).
    agentSession.on(voice.AgentSessionEventTypes.MetricsCollected, (ev) => {
        const metrics = ev.metrics;
        const provider = metrics.metadata?.modelProvider || 'unknown';

        if (metrics.type === 'realtime_model_metrics') {
            if (metrics.ttftMs >= 0) publishMetric(SESSION_METRICS.FIRST_AUDIO_MS, metrics.ttftMs, { provider });
            costTracker.addRealtimeTurn(metrics);
        } else if (metrics.type === 'llm_metrics' || metrics.type === 'stt_metrics' || metrics.type === 'tts_metrics') {
            if (metrics.type === 'tts_metrics' && metrics.ttfbMs >= 0) {
                publishMetric(SESSION_METRICS.FIRST_AUDIO_MS, metrics.ttfbMs, { provider });
            }
            costTracker.addChainedStep(metrics);
        } else {
            return;
        }

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

    // Idempotent — may be triggered by agentSession's own Close event OR
    // directly by the no-participant watchdog below. Deliberately does the
    // critical DB update FIRST and unconditionally, not nested inside/gated
    // by an `agentSession.shutdown()` call: that call can itself hang
    // indefinitely (observed: neither resolves nor rejects) when the
    // realtime session was never actually start()ed — e.g. the visitor never
    // got detected at all — which would otherwise leave Session.status
    // 'live' forever with no trace of why.
    let sessionEnded = false;
    async function endSession(reason) {
        if (sessionEnded) return;
        sessionEnded = true;
        try {
            // Cleanup: stop tour publish loop, heartbeat, and close browser
            if (tourPublishTimer) clearTimeout(tourPublishTimer);
            if (customerSampleInterval) clearInterval(customerSampleInterval);
            clearInterval(heartbeatInterval);
            latestTourFrameBase64 = null;
            try { await tour.close(); } catch { /* best-effort cleanup */ }
            if (participantLeftTimer) clearTimeout(participantLeftTimer);
            if (participantPollTimer) clearInterval(participantPollTimer);

            await Session.updateOne({ _id: session._id }, { status: 'ended' });
            log.info('session ended', { sessionId: session._id, reason });
        } catch (err) {
            log.error('failed to update session status on close', { error: err, reason });
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
    }

    agentSession.on(
        voice.AgentSessionEventTypes.Close,
        otelContext.bind(parentContext, () => endSession('agent-session-close'))
    );

    // The only thing that actually spends money is `agentSession.start()` —
    // it opens the persistent OpenAI transcription websocket and starts
    // billing every LLM/TTS call it drives. See realtime-gate.js for why this
    // is gated on real visitor audio (COST WARNING documented there) instead
    // of firing as soon as we join the room.
    const realtimeGate = createRealtimeGate({
        onStart: () => {
            log.info('realtime gate opened; starting agent session');
            agentSession.start({
                agent: new voice.Agent({ instructions, tools }),
                room: ctx.room
            }).then(() => {
                agentSession.generateReply({
                    instructions: 'Greet the visitor warmly in one short sentence and ask how you can help. Do not call any tools.',
                    toolChoice: 'none'
                });
            }).catch((err) => log.error('failed to start agent session', { error: err.message }));
        }
    });
    ctx.room.on('trackSubscribed', (track, publication, participant) => {
        log.info('track subscribed', {
            participantIdentity: participant?.identity,
            participantName: participant?.name,
            trackKind: track?.kind,
            trackSource: publication?.source,
            trackSid: publication?.trackSid
        });
        realtimeGate.handleTrackSubscribed(track);
    });
    log.info('checking existing subscribed audio tracks before opening realtime gate', {
        remoteParticipantCount: ctx.room.remoteParticipants.size
    });
    realtimeGate.checkAlreadySubscribed(ctx.room);

    // *** COST + STALE-SESSION WARNING — see realtime-gate.js for the opening
    // half of the cost concern ***
    // RoomIO's own closeOnDisconnect only reacts to "clean" disconnect reasons
    // (CLIENT_INITIATED/ROOM_DELETED/USER_REJECTED — see room_io.js in
    // @livekit/agents). An unclean disconnect (closed tab, dropped network)
    // never reaches that check, so without this watchdog: (a) if the paid
    // OpenAI transcription websocket was already open, it stays connected —
    // reconnecting itself every maxSessionDuration — until this worker
    // process is restarted; (b) either way, `Session.status` stays 'live'
    // forever, blocking agent/product deletion. Deliberately NOT gated on
    // realtimeGate.started — a visitor can disconnect (or the job can get
    // stuck attaching an avatar, see the hard timeout above) before the gate
    // ever opens, and the session must still be closed out cleanly, cost or
    // not. Any disconnect reason that leaves zero remote participants means
    // the visitor is gone, so we force-close regardless of the reason code.
    //
    // A grace period is required: LiveKit's own client-side reconnect (a
    // network blip, tab resuming, etc.) can itself surface as this exact
    // event — the old participant object disconnects a moment before the new
    // one connects — so closing immediately would kill a genuinely ongoing
    // call out from under the visitor. We only close if nobody has
    // reconnected by the time the grace period elapses.
    //
    // Checked by identity, not just "any remote participant" — an attached
    // avatar (Tavus etc.) joins the room as its own separate remote
    // participant and stays connected independently of the visitor's
    // browser, so `remoteParticipants.size > 0` alone would never reach zero
    // once an avatar is present and mask a real visitor disconnect.
    const PARTICIPANT_LEFT_GRACE_MS = 10_000;
    const PARTICIPANT_POLL_INTERVAL_MS = 15_000;
    let participantLeftTimer = null;
    let participantAbsentSince = null;
    let closingForNoParticipant = false;

    function hasVisitorParticipant(room) {
        for (const p of room.remoteParticipants.values()) {
            if (p.identity?.startsWith('visitor_')) return true;
        }
        return false;
    }

    async function forceCloseForNoParticipant(via) {
        if (closingForNoParticipant) return;
        closingForNoParticipant = true;
        log.warn('no visitor participant present past grace period; force-closing agent session', { via });

        // The critical action (marking the session ended, freeing agent for
        // deletion) happens directly via endSession() — NOT nested inside
        // agentSession.shutdown(), which can hang indefinitely if the
        // realtime session was never start()ed (observed in production: the
        // call neither resolves nor rejects, silently leaving the session
        // 'live' forever with a misleading "force-closing" log line and no
        // further trace).
        await endSession(`no-participant:${via}`);

        // Best-effort, non-blocking: also tear down the SDK-level realtime
        // connection if one exists. Time-boxed so a hang here can never
        // affect the outcome above.
        Promise.race([
            agentSession.shutdown({ reason: voice.CloseReason.PARTICIPANT_DISCONNECTED }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('shutdown timed out')), 5_000))
        ]).catch((err) => log.warn('agentSession.shutdown did not complete cleanly (non-fatal)', { error: err.message }));
    }

    // Event-driven fast path — cheap, fires immediately when it works.
    ctx.room.on(RoomEvent.ParticipantDisconnected, () => {
        if (hasVisitorParticipant(ctx.room)) return;
        if (participantLeftTimer) return; // already counting down
        log.info('all remote participants left the room; will force-close if nobody reconnects', {
            graceMs: PARTICIPANT_LEFT_GRACE_MS
        });
        participantLeftTimer = setTimeout(() => {
            participantLeftTimer = null;
            if (hasVisitorParticipant(ctx.room)) {
                log.info('participant reconnected within grace period; not closing');
                return;
            }
            forceCloseForNoParticipant('room-event');
        }, PARTICIPANT_LEFT_GRACE_MS);
    });

    ctx.room.on(RoomEvent.ParticipantConnected, (participant) => {
        if (participantLeftTimer && participant?.identity?.startsWith('visitor_')) {
            clearTimeout(participantLeftTimer);
            participantLeftTimer = null;
            log.info('visitor reconnected; cancelled pending force-close');
        }
    });

    // REST poll backstop — asks the LiveKit server directly instead of
    // trusting this worker's own local room mirror. Observed in practice:
    // a visitor's tab closing can leave `ctx.room.remoteParticipants` (and
    // therefore the ParticipantDisconnected event above) stale/never firing
    // even though the server's own participant list already reflects them as
    // gone — this poll is the authoritative fallback so a session can never
    // stay 'live' forever just because the event-driven path didn't fire.
    const participantPollTimer = setInterval(async () => {
        if (closingForNoParticipant) return;
        let visitorPresent;
        try {
            const participants = await roomService().listParticipants(ctx.room.name);
            visitorPresent = participants.some((p) => p.identity?.startsWith('visitor_'));
        } catch (err) {
            log.warn('participant poll failed (non-fatal)', { error: err.message });
            return;
        }
        if (visitorPresent) {
            participantAbsentSince = null;
            return;
        }
        if (participantAbsentSince === null) {
            participantAbsentSince = Date.now();
            return;
        }
        if (Date.now() - participantAbsentSince < PARTICIPANT_LEFT_GRACE_MS) return;
        await forceCloseForNoParticipant('rest-poll');
    }, PARTICIPANT_POLL_INTERVAL_MS);

    // Attach the configured avatar (developer-selected, not visitor choice).
    // Falls back to voice-only automatically on failure (Phase 7 —
    // circuit breaker + retry live in @repo/resilience). That said, a
    // provider SDK's own internal "wait for the remote avatar participant to
    // join" loop (observed hanging indefinitely with the Tavus plugin, no
    // error/log ever surfaces) can defeat @repo/resilience's per-attempt
    // timeout if the hang isn't a well-behaved rejected/resolved promise on
    // the expected schedule. A hard outer timeout here is defense in depth —
    // the whole session must never be stuck waiting on avatar attachment,
    // since voice-only is always a safe, working fallback.
    //
    // Deliberately placed AFTER the Close handler and the participant-left
    // watchdog above (not right after `agentSession` is constructed) — a
    // visitor closing the tab *during* this potentially slow/hanging call
    // needs those listeners already attached, or the disconnect event fires
    // with nobody listening and the session never gets closed out.
    //
    // The timer is cleared once the race settles: `Promise.race` only decides
    // which result wins, it does not cancel the loser, so an uncleared
    // setTimeout still fires 20s later and logs this error on *every* session
    // — including the overwhelmingly common one where voice-only attached
    // instantly — which is exactly the kind of permanent false alarm that
    // trains everyone to ignore the log when a real attach failure happens.
    const AVATAR_ATTACH_TIMEOUT_MS = 20_000;
    let avatarTimeoutTimer = null;
    try {
        await Promise.race([
            startAvatarWithFallback({
                name: agentDoc.avatarProvider,
                agentSession,
                room: ctx.room
            }),
            new Promise((resolve) => {
                avatarTimeoutTimer = setTimeout(() => {
                    log.error('avatar attach exceeded hard timeout; continuing voice-only', {
                        avatarProvider: agentDoc.avatarProvider,
                        timeoutMs: AVATAR_ATTACH_TIMEOUT_MS
                    });
                    resolve();
                }, AVATAR_ATTACH_TIMEOUT_MS);
            })
        ]);
    } finally {
        clearTimeout(avatarTimeoutTimer);
    }
}

/**
 * The realtime brain. LiveKit dispatches this worker into a visitor's room.
 * It loads the agent config, builds the persona + tools, attaches the chosen
 * avatar, and runs the voice conversation as a chained OpenAI pipeline
 * (silero VAD -> transcription -> chat completions -> TTS).
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
