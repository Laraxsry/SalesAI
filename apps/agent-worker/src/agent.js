import '@repo/config-env/load';
import './tracing.js';
import { fileURLToPath } from 'node:url';
import { context as otelContext, trace } from '@opentelemetry/api';
import { WorkerOptions, cli, defineAgent, voice, tool } from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
import {
    VideoSource, LocalVideoTrack, VideoBufferType, VideoStream, TrackKind, TrackSource, VideoFrame, RoomEvent
} from '@livekit/rtc-node';
import sharp from 'sharp';
import {
    connectDB,
    Agent,
    Product,
    Session,
    Message,
    Playbook,
    KnowledgeSource,
    FollowUpTask,
    SessionEvent
} from '@repo/database';
import {
    buildSystemPrompt,
    buildTools,
    buildIdleNudgeInstructions,
    buildGreetingInstructions,
    classifyStartIntent,
    shouldStartMeeting,
    buildWaitingRoomPrompt,
    buildRosterNote,
    buildTurnResponseInstruction,
    resolveSpeaker,
    planToPlaybookNodes
} from '@repo/agent';
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
import { createSilenceDriver } from './silence-driver.js';
import { createSessionTimeline, withToolCallTimeline, TIMELINE_EVENTS } from './session-timeline.js';
import { createTourFrameObserver } from './tour-frame-observer.js';
import { isDirectivelessAdvanceStepFollowup } from './followup-guard.js';
import { createPlaybookCursor } from './playbook-cursor.js';
import { createPlaybookRuntime } from './playbook-runtime.js';
import { createUtteranceMemory } from './utterance-memory.js';
import { createQuestionQueue } from './question-queue.js';
import { createHandQueue } from './hand-queue.js';
import { matchReturningParticipant } from './returning-participant.js';
import { pickActiveSpeaker, chooseAttribution } from './active-speaker.js';

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

    // Görev #1 — multi-participant meeting. Pinned on the session at mint
    // (Agent.maxParticipants, agent NOT counted). 1 = the original
    // single-visitor path, unchanged end to end. >1 turns on the waiting gate
    // (agent joins, waits for the room to fill or a "shall we start?" answer)
    // and active-speaker following.
    const maxParticipants = Math.max(1, Number(session.maxParticipants) || 1);
    const isMultiParty = maxParticipants > 1;
    const MEETING_MAX_WAIT_MS = Number(process.env.AGENT_MEETING_MAX_WAIT_MS ?? 600_000);
    let presentationStarted = false;
    let meetingJoinedAt = 0;
    let meetingWaitInterval = null;
    let meetingSafetyTimer = null;
    let lastStartIntent = null;
    // Identity of the visitor the realtime model is currently listening to
    // (RoomIO links one participant at a time); updated on ActiveSpeakersChanged.
    let currentSpeakerIdentity = null;
    // Group-session state (Görev #11): the raised-hand queue, whose "turn" it
    // is (floor), who the agent last addressed, and the buffer of things said
    // while the agent was talking.
    const questionQueue = createQuestionQueue();
    const handQueue = createHandQueue();
    let currentFloorIdentity = null;
    let lastAddressedIdentity = null;
    let meetingPhase = 'waiting';
    // In-memory roster history — seeded from the session doc, kept current on
    // connect/disconnect, used to recognise a returning visitor and to resolve
    // identities to names for the broadcast.
    const rosterHistory = (session?.participants || []).map((p) => ({
        identity: p.identity,
        name: p.name || null,
        visitorKey: p.visitorKey || null,
        leftAt: p.leftAt || null
    }));
    const nameOfIdentity = (id) => rosterHistory.find((r) => r.identity === id)?.name || null;

    /** Broadcast the full meeting state to the room (visitor UI reads this). */
    function broadcastMeetingState() {
        if (!isMultiParty) return;
        const toEntry = (id) => ({ identity: id, name: nameOfIdentity(id) });
        const payload = new TextEncoder().encode(
            JSON.stringify({
                type: 'salesai:meeting',
                phase: meetingPhase,
                visitorCount: countVisitors(),
                maxParticipants,
                floor: currentFloorIdentity ? toEntry(currentFloorIdentity) : null,
                hands: handQueue.list().map(toEntry)
            })
        );
        ctx.room.localParticipant
            .publishData(payload, { reliable: true, topic: 'salesai' })
            .catch(() => {});
    }

    /** `next_participant` tool handler — hand the floor to the next raised hand. */
    function advanceToNextParticipant() {
        const next = handQueue.shift();
        currentFloorIdentity = next || null;
        broadcastMeetingState();
        return { ok: true, next: next ? nameOfIdentity(next) : null };
    }

    function countVisitors() {
        let n = 0;
        for (const p of ctx.room.remoteParticipants.values()) {
            if (p.identity?.startsWith('visitor_')) n++;
        }
        return n;
    }

    /** Whether a participant has an unmuted microphone track published. */
    function micOn(participant) {
        if (!participant?.trackPublications) return false;
        for (const pub of participant.trackPublications.values()) {
            if (pub?.source === TrackSource.SOURCE_MICROPHONE) return pub.muted === false;
        }
        return false;
    }

    /** Current in-room roster as {identity, name} for name resolution. */
    function rosterList() {
        const out = [];
        for (const p of ctx.room.remoteParticipants.values()) {
            if (p.identity?.startsWith('visitor_')) out.push({ identity: p.identity, name: p.name });
        }
        return out;
    }

    function flushQuestionQueue() {
        if (questionQueue.isEmpty()) return;
        const items = questionQueue.flush();
        const turn = buildTurnResponseInstruction({
            floor: currentFloorIdentity
                ? { identity: currentFloorIdentity, name: nameOfIdentity(currentFloorIdentity) }
                : null,
            items,
            hands: handQueue.list().map((id) => ({ identity: id, name: nameOfIdentity(id) }))
        });
        const instructions = [buildRosterNote(rosterList()), turn].filter(Boolean).join('\n\n');
        if (!instructions) return;
        agentSession
            .generateReply({ instructions, allowInterruptions: false })
            .catch((err) => log.warn('meeting: queued-questions reply failed', { error: err.message }));
    }

    // Playbook — the presentation route this agent follows, if the marketer
    // configured one (md/backend/agent_flow.md). Snapshotted into a plain
    // array right here and never re-read: that snapshot IS the version pin,
    // so a marketer editing a live playbook mid-call can never change what
    // this session does. `playbookCursor` is pure and can be built
    // immediately; `playbookRuntime` needs agentSession/tourControls, which
    // don't exist yet, so it's constructed further down and referenced here
    // only through closures (tools, silence.onIdle) that don't run until
    // well after everything is initialized.
    // Görev #7 — a pre-call survey plan, when present, IS this session's
    // playbook (pinned at mint, runs instead of any static Playbook doc).
    const generatedPlan =
        session.generatedPlan && Array.isArray(session.generatedPlan.steps)
            ? session.generatedPlan
            : null;
    const preCallIntent = session.preCallIntent && typeof session.preCallIntent === 'object'
        ? session.preCallIntent
        : null;

    const playbookDoc = generatedPlan ? null : await Playbook.findOne({ agentId: agentDoc._id });
    const playbookNodes = generatedPlan
        ? planToPlaybookNodes(generatedPlan)
        : (playbookDoc?.enabled ? playbookDoc.nodes : []).map((n) =>
              typeof n.toObject === 'function' ? n.toObject() : n
          );
    const playbookActive = playbookNodes.length > 0;
    const playbookCursor = playbookActive ? createPlaybookCursor(playbookNodes) : null;
    /** @type {ReturnType<typeof createPlaybookRuntime>|null} */
    let playbookRuntime = null;
    // Real session logs (outside a playbook, so playbookRuntime.busy is
    // always false) repeatedly showed the silence driver firing an idle
    // nudge WHILE the visitor's own turn was still being generated — before
    // it had even issued its first tool call, so a per-tool-call counter
    // (tried first) saw nothing in flight and let the nudge through anyway.
    // Bumping idleMs (tried second, 500ms -> 1200ms) only narrowed the
    // window, it never closed it — the model can legitimately take longer
    // than any fixed guess to decide what to call first. Both were guessing
    // at "is a turn still going" from the outside; this instead asks the
    // SDK directly via `SpeechCreated`'s `SpeechHandle.addDoneCallback()` —
    // see `silence` below.
    let activeSpeechCount = 0;

    // Everything that happens from here on is also written to a single
    // ordered stream, so a session can be reconstructed afterwards without
    // having to be watching the terminal at the time — see
    // session-timeline.js. Persisting is fire-and-forget and can never
    // interrupt the call.
    const timeline = createSessionTimeline({
        sessionId: session._id,
        log,
        persist: (doc) => SessionEvent.create(doc)
    });

    timeline.emit(TIMELINE_EVENTS.SESSION_START, {
        agentId: String(agentDoc._id),
        productId: String(product._id),
        roomName: ctx.room?.name ?? null,
        agentName: agentDoc.name,
        language: agentDoc.persona?.language ?? null,
        archetype: agentDoc.persona?.archetype ?? null
    });

    // Logged unconditionally, including the inactive case: "was a playbook
    // even running?" is otherwise unanswerable from the logs, and every
    // silent-agent report starts with that question.
    log.info('playbook loaded', {
        active: playbookActive,
        nodeCount: playbookNodes.length,
        version: playbookDoc?.version ?? null,
        enabled: playbookDoc?.enabled ?? null,
        firstNodeHasUrl: Boolean(playbookNodes[0]?.url)
    });
    timeline.emit(TIMELINE_EVENTS.PLAYBOOK_LOADED, {
        active: playbookActive,
        nodeCount: playbookNodes.length,
        version: playbookDoc?.version ?? null,
        enabled: playbookDoc?.enabled ?? null,
        // The whole plan, once, at the top of the stream: every later node
        // event carries only an id/order, and correlating those back to what
        // the marketer actually wrote otherwise means a second DB lookup
        // against a Playbook that may have been edited since.
        nodes: playbookNodes.map((n) => ({
            id: n.id,
            order: n.order,
            mode: n.mode,
            url: n.url ?? null,
            directive: n.directive,
            attach: n.attach ?? null
        }))
    });

    const instructions = buildSystemPrompt({
        name: agentDoc.name,
        product: { name: product.name, description: product.description },
        persona: agentDoc.persona,
        playbookActive,
        multiParticipant: isMultiParty,
        preCallIntent
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

    // Prewarm only when this session is guaranteed to use a guided-tour URL.
    // Browser lifecycle belongs to GuidedTour; the playbook layer contributes
    // only the policy decision and the first future demo-domain target. This
    // keeps speculative resource use out of free-form sessions while hiding
    // Chromium/context/login latency behind the opening conversation.
    const shouldPrewarmTour = playbookActive
        && screenModes.includes('guided-tour')
        && playbookNodes.some((node) => Boolean(node.url));
    const hasDemoCredentials = Boolean((tourAuth?.username || tourAuth?.email) && tourAuth?.password);
    const prewarmLoginTargetUrl = hasDemoCredentials
        ? playbookNodes.find((node) => node.url && tour.requiresDemoLogin(node.url))?.url ?? null
        : null;
    let tourPrewarmStarted = false;

    const startTourPrewarm = () => {
        if (!shouldPrewarmTour || tourPrewarmStarted) return;
        tourPrewarmStarted = true;
        const startedAt = Date.now();
        const endPrewarm = timeline.span(
            TIMELINE_EVENTS.SCREEN_TOUR_PREPARE_BEGIN,
            TIMELINE_EVENTS.SCREEN_TOUR_PREPARE_END,
            { includesDemoLogin: Boolean(prewarmLoginTargetUrl) }
        );
        log.info('GuidedTour prewarm scheduled', {
            includesDemoLogin: Boolean(prewarmLoginTargetUrl)
        });
        // Deliberately detached from the realtime start path: browser/login
        // failure must not prevent the agent from greeting the visitor. A later
        // open() reuses successful preparation or retries failed work normally.
        tour.prepare({ loginTargetUrl: prewarmLoginTargetUrl })
            .then(() => {
                endPrewarm({ status: 'ok' });
                log.info('GuidedTour prewarm complete', {
                    durationMs: Date.now() - startedAt,
                    includesDemoLogin: Boolean(prewarmLoginTargetUrl)
                });
            })
            .catch((error) => {
                endPrewarm({ status: 'error', error: error.message });
                log.warn('GuidedTour prewarm failed; will retry on demand', {
                    error: error.message,
                    durationMs: Date.now() - startedAt
                });
            });
    };

    let isTourActive = false;
    let tourPublishTimer = null;
    let tourVideoSource = null;
    let tourVideoTrack = null;
    // True while a screenshot/sharp/captureFrame cycle is between its initial
    // isTourActive check and actually touching the native track — stopScreenShare
    // waits for this to clear before unpublishing (see the COST/CRASH note there).
    let tourCaptureInFlight = false;
    let tourCapturePromise = null;
    let tourCaptureVersion = -1;
    let tourViewVersion = 0;
    const tourFrameObserver = createTourFrameObserver({ timeline });
    // Latest tour frame as a downscaled JPEG data URL, kept in memory only
    // (never persisted) so `read_tour_screen` can hand the agent's own
    // guided-tour browser to the vision model on demand — mirrors the
    // customer-share sampling below, just fed from Playwright instead of a
    // LiveKit video track.
    let latestTourFrameBase64 = null;

    // Capture a frame and push it to the LiveKit VideoSource. Defined at
    // tourControls scope (not inside openAt) so goto/highlight/click/scroll
    // can trigger an immediate frame too — they each reference it right after
    // acting so the visitor sees the result without waiting for the next
    // scheduled poll.
    const captureAndPublishTourFrame = async (requiredViewVersion = null) => {
        if (!isTourActive || !tourVideoSource) return Promise.resolve(false);
        // Immediate captures and the periodic loop can be requested at the
        // same time. Reuse the active operation instead of racing two native
        // captureFrame() calls. If navigation changed the page after that
        // operation started, serialize one fresh capture behind it so callers
        // never mistake the previous page's frame for the action they await.
        if (tourCapturePromise) {
            const activeVersion = tourCaptureVersion;
            const result = await tourCapturePromise;
            if (
                requiredViewVersion !== null
                && activeVersion < requiredViewVersion
                && isTourActive
                && tourVideoSource
            ) {
                return captureAndPublishTourFrame(requiredViewVersion);
            }
            return result;
        }

        tourCaptureVersion = tourViewVersion;
        tourCapturePromise = (async () => {
            tourCaptureInFlight = true;
            const captureStartedAt = Date.now();
            let captureStage = 'screenshot';
            try {
                const pngBuffer = await tour.screenshot();
                const screenshotFinishedAt = Date.now();

                captureStage = 'transform';
                const { data, info } = await sharp(pngBuffer)
                    .resize({ width: 1280, height: 720, fit: 'contain', background: '#000' })
                    .ensureAlpha()
                    .raw()
                    .toBuffer({ resolveWithObject: true });
                const transformFinishedAt = Date.now();

                // *** CRASH WARNING — re-check right before touching the native
                // track. stopScreenShare() may have unpublished it while we were
                // awaiting the screenshot/resize above; calling captureFrame() on a
                // source whose track is concurrently being unpublished is a native
                // Rust panic in livekit-ffi (unwrap() on Err), which kills the whole
                // agent-worker process — not a catchable JS error. ***
                if (!isTourActive || !tourVideoSource) return false;

                captureStage = 'capture_frame';
                const frame = new VideoFrame(data, info.width, info.height, VideoBufferType.RGBA);
                const submitStartedAt = Date.now();
                const timestampUs = BigInt(submitStartedAt) * 1000n;
                tourVideoSource.captureFrame(frame, timestampUs);
                const submittedAt = Date.now();
                tourFrameObserver.frameSubmitted({
                    captureStartedAt,
                    submittedAt,
                    screenshotMs: screenshotFinishedAt - captureStartedAt,
                    transformMs: transformFinishedAt - screenshotFinishedAt,
                    submitMs: submittedAt - submitStartedAt,
                    width: info.width,
                    height: info.height,
                    trackSid: tourVideoTrack?.sid ?? null
                });

                // Also keep a downscaled JPEG copy for read_tour_screen — cheap
                // (just re-encoding the same PNG we already have), the actual
                // vision-model cost only happens when the tool is called.
                captureStage = 'vision_copy';
                try {
                    const jpegBuffer = await sharp(pngBuffer)
                        .resize({ width: 1024, withoutEnlargement: true })
                        .jpeg({ quality: 80 })
                        .toBuffer();
                    latestTourFrameBase64 = `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;
                } catch (visionCopyErr) {
                    // The visitor frame was already submitted successfully.
                    // A secondary vision-cache failure must not report that
                    // delivery as failed or trigger another screen capture.
                    log.warn('Tour vision copy failed (visitor frame was still submitted)', {
                        error: visionCopyErr.message
                    });
                }
                return true;
            } catch (frameErr) {
                // Non-fatal: log and skip this frame, while retaining enough
                // stage data to distinguish page, image and native failures.
                log.warn('Tour frame capture failed', { error: frameErr.message });
                tourFrameObserver.frameFailed({
                    captureStartedAt,
                    stage: captureStage,
                    error: frameErr.message
                });
                return false;
            } finally {
                tourCaptureInFlight = false;
                tourCapturePromise = null;
            }
        })();
        return await tourCapturePromise;
    };

    // Schedule the next capture only after the current one finishes.
    // Overlapping Playwright/sharp work can starve LiveKit heartbeats.
    const scheduleTourFrame = (delayMs = 800) => {
        if (tourPublishTimer) clearTimeout(tourPublishTimer);
        tourPublishTimer = setTimeout(async () => {
            tourPublishTimer = null;
            if (!isTourActive || !tourVideoSource) return;
            await captureAndPublishTourFrame();
            if (isTourActive && tourVideoSource) scheduleTourFrame(800);
        }, delayMs);
    };

    const tourControls = {
        openAt: async (url) => {
            if (!screenModes.includes('guided-tour')) {
                return { ok: false, error: 'Guided tour is not enabled for this agent (screenModes).' };
            }
            if (isTourActive) {
                return { ok: false, error: 'Tour already active. Use navigate_to to move within the current tour.' };
            }
            // Set BEFORE awaiting tour.open(), not after: open() takes real
            // wall-clock time (browser launch), and isTourActive staying
            // false for that whole window let a second call — whether a
            // duplicate model tool-call or (with a playbook running) the
            // runtime's own automatic navigation racing the model's own
            // start_guided_tour call — slip past this guard and reach
            // tour.open() concurrently. GuidedTour's own internal guard then
            // throws "Already open" for whichever call loses the race, and
            // its catch's tour.close() tears down the OTHER call's still-
            // in-flight browser, producing a second, differently-worded
            // failure right after. Rolled back in the catch below on failure.
            isTourActive = true;
            const openStartedAt = Date.now();
            log.info('GuidedTour opening', { url: url || null });
            try {
                // If configured demo authentication fails, fail loudly instead
                // of silently showing the public site as if login succeeded.
                // open() now navigates directly to this target exactly once;
                // browser/context/login work may already be complete via the
                // session-start prewarm above.
                await tour.open(url);
                const navigationReadyAt = Date.now();
                const viewVersion = ++tourViewVersion;
                const openedUrl = url || startUrl;
                log.info('GuidedTour started', { url: openedUrl, durationMs: navigationReadyAt - openStartedAt });
                // This now measures only the visible remainder after any
                // successful session-start preparation: normally one real page
                // navigation plus readiness, or the full cold path on fallback.
                timeline.emit(
                    TIMELINE_EVENTS.SCREEN_TOUR_OPENED,
                    { url: openedUrl },
                    navigationReadyAt - openStartedAt
                );
                tourFrameObserver.navigationReady({
                    url: openedUrl,
                    kind: 'initial',
                    navigationStartedAt: openStartedAt,
                    navigationReadyAt
                });

                // Create a LiveKit VideoSource and publish it as a screen-share track
                tourVideoSource = new VideoSource(1280, 720);
                try {
                    tourVideoTrack = LocalVideoTrack.createVideoTrack('tour', tourVideoSource);
                    await ctx.room.localParticipant.publishTrack(tourVideoTrack, { name: 'screen_share', source: TrackSource.SOURCE_SCREENSHARE });
                    log.info('Tour video track published to LiveKit room');
                } catch (e) {
                    log.error('Could not publish tour track to LiveKit', { error: e.message });
                    tourFrameObserver.frameFailed({
                        captureStartedAt: navigationReadyAt,
                        stage: 'track_publish',
                        error: e.message,
                        terminal: true
                    });
                    tourVideoTrack = null;
                    tourVideoSource = null;
                    throw e;
                }

                scheduleTourFrame();

                // Capture initial frame immediately
                await captureAndPublishTourFrame(viewVersion);

                // Log screen action to messages meta
                await Message.create({
                    sessionId: session._id,
                    role: 'system',
                    text: `[screen:tour_started] url=${url || ''}`,
                    meta: { action: 'tour_started', url: url || '' }
                }).catch(() => {});

                return { ok: true, status: 'Tour started. Visitor can now see the browser. Use navigate_to or highlight next.' };
            } catch (e) {
                log.error('GuidedTour open failed: ' + e.message, { error: e.message, durationMs: Date.now() - openStartedAt });
                tourFrameObserver.abandonPending('tour_open_failed');
                await tour.close().catch(() => {});
                isTourActive = false;
                latestTourFrameBase64 = null;
                return { ok: false, error: e.message };
            }
        },
        goto: async (url) => {
            if (!isTourActive) return { ok: false, error: 'Tour not active. Call start_guided_tour first.' };
            const navigationStartedAt = Date.now();
            try {
                await tour.goto(url);
                const navigationReadyAt = Date.now();
                const viewVersion = ++tourViewVersion;
                tourFrameObserver.navigationReady({
                    url,
                    kind: 'navigation',
                    navigationStartedAt,
                    navigationReadyAt
                });
                await captureAndPublishTourFrame(viewVersion);
                scheduleTourFrame(800);
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
                const viewVersion = ++tourViewVersion;
                await captureAndPublishTourFrame(viewVersion);
                scheduleTourFrame(800);
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
                const viewVersion = ++tourViewVersion;
                await captureAndPublishTourFrame(viewVersion);
                scheduleTourFrame(800);
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
        scroll: async (direction, amount, target) => {
            if (!isTourActive) return { ok: false, error: 'Tour not active. Call start_guided_tour first.' };
            try {
                const position = await tour.scroll(direction, amount, target);
                // Immediately capture and push the new scrolled frame before returning to LLM!
                const viewVersion = ++tourViewVersion;
                await captureAndPublishTourFrame(viewVersion);
                scheduleTourFrame(800);

                await Message.create({
                    sessionId: session._id,
                    role: 'system',
                    text: `[screen:scroll_page] direction=${direction}${target ? ` target=${target}` : ''}`,
                    meta: { action: 'scroll_page', direction, amount, target }
                }).catch(() => {});
                // atTop/atBottom + visibleHeadings go back to the model so it knows what is in view.
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
        timeline.emit(TIMELINE_EVENTS.SCREEN_SHARE_START, { participant: participant.identity });

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
            timeline.emit(TIMELINE_EVENTS.SCREEN_SHARE_END);
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
                tourFrameObserver.abandonPending('tour_stopped');
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

    // What the agent actually said out loud, so "do not repeat yourself" has a
    // referent instead of being a blind instruction — see utterance-memory.js.
    const utterances = createUtteranceMemory();

    // Site Bilgisi — Site Yapı Ağacı: flattened `meta.crawlIndex.pages` from
    // every url/api KnowledgeSource this product has, so the `find_page`
    // tool (packages/agent/src/tools.js) can resolve a semantic query
    // ("İletişim") to a real URL/selector instead of the model guessing
    // one. Best-effort — a lookup failure just means find_page returns no
    // candidates this session, never blocks the call from starting.
    //
    // Deliberately NOT filtered by status:'ready' — `meta.crawlIndex.pages`
    // is only overwritten at the end of a successful crawl (see
    // ingest-source.js), so it holds the last known-good page/button map
    // even while a re-crawl of the same source is currently 'processing'
    // (or even if that re-crawl later ends in 'failed'). Requiring 'ready'
    // meant the site map — and therefore find_page and on-site
    // navigation — went completely empty for the whole duration of any
    // re-ingestion, which for an 8+ page site is minutes, not seconds.
    const siteMap = [];
    try {
        const urlSources = await KnowledgeSource.find({
            productId: product._id,
            type: { $in: ['url', 'api'] },
            'meta.crawlIndex.pages': { $exists: true }
        }).select('meta.crawlIndex');
        for (const src of urlSources) {
            const pages = src.meta?.crawlIndex?.pages || {};
            for (const [url, page] of Object.entries(pages)) {
                siteMap.push({
                    url,
                    parentUrl: page.parentUrl ?? null,
                    links: page.links || [],
                    // Absent on pages reused from a pre-component-discovery
                    // crawl cache (see extractPageComponents) — find_element
                    // just returns no candidates for those, same posture as
                    // `links || []` above.
                    components: page.components ?? {}
                });
            }
        }
    } catch (err) {
        log.warn('site map load failed (non-fatal, find_page will return no candidates)', { error: err.message });
    }

    // Written only when the visitor has explicitly agreed to have a
    // knowledge-gap question forwarded (see persona.js) — never a substitute
    // for search_knowledge, and never fired just because a question was hard.
    // Deliberately its own model, not folded into save_contact_info or Lead:
    // Lead is one engagement score per session (unique sessionId), this is
    // one row per unresolved question — a visitor can raise several in one
    // call. `department` stays null until the routing infra referenced in
    // md/backend/playbook_session_log.md exists; this write doesn't wait on it.
    const flagFollowup = async (question) => {
        await FollowUpTask.create({ sessionId: session._id, agentId: agentDoc._id, question: question.trim() });
        await Message.create({
            sessionId: session._id,
            role: 'system',
            text: `[followup:flagged] ${question}`,
            meta: { action: 'followup_flagged', question }
        }).catch(() => {});
        return { ok: true };
    };

    // `click_element` succeeding used to also close out the current playbook
    // node (via withPlaybookProgress, now removed) whenever that node had an
    // `attach` target — the idea being "the one concrete action happened, so
    // the node is done". Live testing proved this wrong: a node whose
    // `attach` describes several elements (a marketer writing "click X, then
    // Y, then Z" into one field — see md/backend/playbook_session_log.md
    // item 6/15) closed the instant the FIRST click landed, before the
    // model had said a word of the actual directive — the topic was silently
    // never narrated. `advance_step` is the only thing that closes a node
    // now, exactly as its own description already promised ("the moment you
    // have finished saying everything you were just asked to cover") —
    // clicking is something the model does WHILE covering the topic, not a
    // substitute for having covered it.
    // Two independent concerns, deliberately not merged (SRP): the metrics
    // wrapper publishes a labelled duration to Prometheus and knows nothing
    // about this session; the timeline wrapper writes this session's own
    // narrative, arguments included. Neither alters the tool's return value.
    const buildSessionTools = (playbookMode) =>
        withToolCallTimeline(
            withToolCallMetrics(buildTools({
                productId: String(product._id),
                tour: tourControls,
                screen: screenControls,
                stopScreenShare,
                saveContactInfo,
                siteMap,
                playbookActive: playbookMode,
                multiParticipant: isMultiParty,
                // Group session: hand the floor to the next raised hand.
                nextParticipant: advanceToNextParticipant,
                flagFollowup,
                // Not yet awaitable at this point in the source (playbookRuntime
                // is constructed further down, once agentSession exists) — this
                // closure only reads it, and by the time the model can actually
                // call the tool the runtime is assigned. buildTools exposes it
                // only while playbookMode is true.
                // MUST return a defined value — see the comment on the
                // advance_step tool in packages/agent/src/tools.js. A
                // suppressed reply here once left the SDK's agentState stuck
                // in 'thinking' forever (@livekit/agents only clears it on
                // the reply path), which also silently disarmed
                // silence-driver.js.
                advanceStep: () => {
                    playbookRuntime?.signal('advance_step');
                    return { ok: true };
                },
                // Referenced before `silence` is declared further down this
                // function — safe: this closure only runs when the model
                // actually calls the tool, long after `silence` is
                // initialized (same pattern as `advanceStep`/`playbookRuntime`
                // above). 7s: within the customer-requested 5-10s window for
                // a genuine "I asked something, give them time to answer" wait.
                expectResponse: () => {
                    silence.expectResponse(7000);
                    return { ok: true };
                }
            })),
            timeline
        ).map(t => tool({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
        execute: t.handler
    }));

    let tools = buildSessionTools(playbookActive);

    // Speech-to-speech via the OpenAI Realtime API — one round trip per turn
    // instead of a chained STT -> LLM -> TTS pipeline, which is what keeps
    // turn-taking latency low. `gpt-realtime-2` is not a `gpt-5*` reasoning
    // model, so it isn't subject to the /v1/chat/completions
    // reasoning_effort/function-tools restriction that a chained
    // chat-completions LLM call would hit.
    const agentSession = new voice.AgentSession({
        llm: new openai.realtime.RealtimeModel({
            model: process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2',
            voice: 'cedar'
        }),
        // Disables the SDK's own quiet-detector so it doesn't run on a second,
        // differently-timed clock against the same silence our driver is
        // watching. Its 15s timeout fires at most once per visitor utterance
        // (it flips userState to 'away' and only re-arms on the next final
        // transcript), which is not what a proactive agent needs — see
        // silence-driver.js.
        userAwayTimeout: null
    });

    // Now that agentSession/tourControls/stopScreenShare all exist, build the
    // actual runtime the tool decorator and silence driver above were only
    // holding a reference to. `screen` is deliberately just these two
    // methods, not the full tourControls surface — navigation is data the
    // runtime can act on by itself; clicking/highlighting/scrolling stay the
    // model's judgment call (ISP, see md/backend/agent_flow.md).
    if (playbookActive) {
        playbookRuntime = createPlaybookRuntime({
            cursor: playbookCursor,
            lastSpoken: () => utterances.last(),
            screen: {
                // Timed and logged on both sides: the pump awaits this before
                // it can speak, so a slow navigation is indistinguishable from
                // a dead agent unless the duration is visible.
                showUrl: async (url) => {
                    const startedAt = Date.now();
                    log.info('playbook showUrl: begin', { url, reusingOpenTour: isTourActive });
                    // `reusingOpenTour` is the single most useful field here:
                    // it distinguishes a cheap in-page goto() from a full
                    // browser launch, which is the difference between a
                    // sub-second transition and a ~9s one.
                    const endSpan = timeline.span(
                        TIMELINE_EVENTS.SCREEN_NAVIGATE_BEGIN,
                        TIMELINE_EVENTS.SCREEN_NAVIGATE_END,
                        { url, reusingOpenTour: isTourActive }
                    );
                    const result = isTourActive ? await tourControls.goto(url) : await tourControls.openAt(url);
                    log.info('playbook showUrl: end', {
                        url,
                        ok: result?.ok !== false,
                        error: result?.error,
                        durationMs: Date.now() - startedAt
                    });
                    endSpan({ ok: result?.ok !== false, error: result?.error });
                    return result;
                },
                hideScreen: async () => {
                    const startedAt = Date.now();
                    log.info('playbook hideScreen: begin');
                    const endSpan = timeline.span(
                        TIMELINE_EVENTS.SCREEN_HIDE_BEGIN,
                        TIMELINE_EVENTS.SCREEN_HIDE_END
                    );
                    const result = await stopScreenShare();
                    log.info('playbook hideScreen: end', { durationMs: Date.now() - startedAt });
                    endSpan();
                    return result;
                }
            },
            speak: (instructions) => agentSession.generateReply({ instructions }),
            onNodeEvent: (node, phase, meta) => {
                // What was actually on screen for this event — folded into the
                // human-readable `text` (what the console transcript renders),
                // not left as a separate [screen:...] line the reader has to
                // correlate by hand. `failed` reports the URL that DIDN'T open
                // (screenVisible is always false there); every other phase
                // reports what's genuinely showing right now, or 'avatar' when
                // nothing is.
                const screenPart = phase === 'failed'
                    ? `attemptedUrl=${meta?.url ?? '-'}`
                    : `screen=${meta?.screenVisible && meta?.url ? meta.url : 'avatar'}`;

                // Logged as well as persisted: the Message write goes to Mongo
                // for the transcript timeline, which is invisible while
                // debugging a live call from the terminal.
                log.info(`playbook node: ${phase}`, {
                    order: node.order,
                    nodeId: node.id,
                    mode: node.mode,
                    hasUrl: Boolean(node.url),
                    hasAttach: Boolean(node.attach),
                    ...meta
                });
                Message.create({
                    sessionId: session._id,
                    role: 'system',
                    text: `[playbook:${phase}] order=${node.order} ${screenPart}`,
                    meta: { action: `playbook_node_${phase}`, nodeId: node.id, order: node.order, ...meta }
                }).catch(() => {});

                const timelineType = {
                    enter: TIMELINE_EVENTS.PLAYBOOK_NODE_ENTER,
                    redeliver: TIMELINE_EVENTS.PLAYBOOK_NODE_REDELIVER,
                    exit: TIMELINE_EVENTS.PLAYBOOK_NODE_EXIT,
                    failed: TIMELINE_EVENTS.PLAYBOOK_NODE_FAILED
                }[phase];
                if (timelineType) {
                    timeline.emit(timelineType, {
                        order: node.order,
                        nodeId: node.id,
                        mode: node.mode,
                        // Carried on every node event, not just the plan dump
                        // at the top: when reading a timeline you want to see
                        // what the model was ASKED to cover right next to what
                        // it actually said, without scrolling back.
                        directive: node.directive,
                        hasAttach: Boolean(node.attach),
                        ...meta
                    });
                }
            },
            onCompleted: () => {
                log.info('playbook completed', { sessionId: session._id });
                timeline.emit(TIMELINE_EVENTS.PLAYBOOK_COMPLETED);
                // `silence`'s consecutive-fire counter is shared between
                // playbook advance signals and post-playbook idle nudges
                // (see silence-driver.js's isCapExempt note) — whatever count
                // accumulated advancing this playbook's nodes must not eat
                // into the fresh nudge budget the rest of the call gets now
                // that it isn't exempt from the cap anymore.
                silence.resetConsecutive();
                // playbookActive was baked into `instructions` once, at session
                // start, and never revisited (see md/backend/playbook_session_log.md
                // item 13) — the model stayed forbidden from calling
                // `start_guided_tour`/`navigate_to` on its own initiative for the
                // rest of the call, even after the scripted route was long over.
                // `updateAgent` (confirmed present on this SDK version — see
                // node_modules/@livekit/agents/src/voice/agent_session.ts) swaps
                // the live agent's instructions without tearing down the
                // session; rebuilding with playbookActive:false lifts that
                // restriction the moment there's no more script for the model
                // to race against. The tool list must switch at the same time:
                // buildTools intentionally removes advance_step outside a
                // playbook so ordinary answers cannot look like script nodes.
                try {
                    const postPlaybookInstructions = buildSystemPrompt({
                        name: agentDoc.name,
                        product: { name: product.name, description: product.description },
                        persona: agentDoc.persona,
                        playbookActive: false,
                        multiParticipant: isMultiParty,
                        preCallIntent
                    });
                    const postPlaybookTools = buildSessionTools(false);
                    agentSession.updateAgent(new voice.Agent({
                        instructions: postPlaybookInstructions,
                        tools: postPlaybookTools
                    }));
                    tools = postPlaybookTools;
                    log.info('post-playbook instructions and tools applied; model may now drive the screen on its own initiative', { sessionId: session._id });
                } catch (err) {
                    log.error('failed to apply post-playbook instructions (model stays playbook-restricted for the rest of the call)', { error: err.message, sessionId: session._id });
                }
            },
            onError: (message, meta) => {
                log.error('playbook runtime error', { error: message, ...meta });
                timeline.emit(TIMELINE_EVENTS.ERROR, { source: 'playbook_runtime', error: message, ...meta });
            },
            onSignalIgnored: (node, kind, reason) => {
                log.warn('playbook signal ignored', { order: node.order, nodeId: node.id, kind, reason });
                timeline.emit(TIMELINE_EVENTS.PLAYBOOK_ADVANCE_IGNORED, {
                    order: node.order,
                    nodeId: node.id,
                    kind,
                    reason
                });
            }
        });
    }

    // A provider error is emitted as an event, not thrown: a `recoverable`
    // one (e.g. the model rejecting every request) then leaves the session
    // running and listening forever while never producing a single reply.
    // Without this listener that failure mode is completely silent — the
    // visitor just gets no answer and the transcript holds only their own
    // turns.
    agentSession.on(voice.AgentSessionEventTypes.Error, (ev) => {
        const detail = {
            type: ev.error?.type,
            label: ev.error?.label,
            recoverable: ev.error?.recoverable,
            error: ev.error?.error?.message || String(ev.error?.error)
        };
        log.error('agent session error', detail);
        // On the timeline too: a provider outage (quota exhausted, model
        // rejecting every request) presents to the visitor as pure silence,
        // and the only way to tell that apart from a logic bug afterwards is
        // seeing the error sitting inline where the speech should have been.
        timeline.emit(TIMELINE_EVENTS.ERROR, { source: 'agent_session', ...detail });
    });

    // *** WHY THIS EXISTS — read md/backend/playbook_session_log.md before
    // touching it ***
    // @livekit/agents auto-generates a follow-up speech turn after any tool
    // call whose output is defined (voice/generation.ts:
    // `replyRequired: toolOutput !== undefined`), and that follow-up carries
    // NO per-response instructions — only the base system prompt
    // (agent_activity.ts:~3987). When the turn that triggered it called
    // nothing but `advance_step` (a bookkeeping-only tool with nothing to
    // say), that follow-up has no topic to draw from and falls back on
    // whatever was last genuinely said — verbatim, node after node. Live
    // evidence: the same sentence repeating 4-6 times in one session.
    //
    // `emit()` runs listeners synchronously, so `interrupt(true)` here lands
    // before @livekit/agents' own `createSpeechTask` for this handle has
    // even started — the task's own first line (`if (speechHandle.
    // interrupted) return;`) then skips calling `generateReply()` entirely:
    // no audio, no API request, no cost. A bare interrupt alone would leave
    // agentState stuck in 'thinking' forever (only a completed reply clears
    // it — the exact regression a prior attempt at this fix produced), so
    // this always follows through by asking playbookRuntime to redeliver the
    // same node with its real directive: a genuine turn that completes
    // normally and lets the SDK's own state cycle resolve itself.
    //
    // Deliberately narrow — see followup-guard.js's own warning — this must
    // NOT fire for `search_knowledge`'s follow-up, which is the actual RAG
    // answer, not noise.
    agentSession.on(voice.AgentSessionEventTypes.SpeechCreated, (ev) => {
        if (!playbookActive || !playbookRuntime) return;
        if (!isDirectivelessAdvanceStepFollowup(ev)) return;
        const nodeId = playbookRuntime.activeNode()?.id ?? null;
        ev.speechHandle.interrupt(true);
        log.info('suppressed directive-less advance_step follow-up; redelivering node', { nodeId });
        timeline.emit(TIMELINE_EVENTS.PLAYBOOK_FOLLOWUP_SUPPRESSED, { nodeId });
        playbookRuntime.signal('followup_suppressed');
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

            // Recorded synchronously, before the first await below: the
            // playbook pump's waitForPlayout() resolves off this same emit, so
            // recording after an await would race whoever reads the memory.
            // For an interrupted speech the SDK reports only the transcript
            // that actually played — which is exactly the referent a resumed
            // step needs.
            if (item.role === 'assistant' && text.trim()) {
                utterances.record(text, { interrupted: item.interrupted === true });
            }

            if (text || item.role === 'tool') {
                // Diagnostic only for now (md/backend/playbook_session_log.md —
                // "sözü kesilince altyazıda tam cümle kalıyor"): the SDK's own
                // truncate-on-interrupt protocol (conversation.item.truncate)
                // is supposed to make `item.content` already reflect only the
                // audio that actually played, but we had no way to tell
                // whether a given saved message was ever interrupted at all —
                // this flag alone doesn't fix a mistimed truncation, it just
                // makes affected messages visible so the real question (is it
                // a race between this event and the truncate round-trip, or
                // something else) can be investigated from real transcripts
                // instead of guessed at.
                const msg = await Message.create({
                    sessionId: session._id,
                    role: item.role,
                    text: text.trim(),
                    meta: { interrupted: !!item.interrupted }
                });

                await publishEvent(RT_EVENTS.SESSION_TRANSCRIPT, {
                    sessionId: session._id,
                    messageId: msg._id,
                    role: msg.role,
                    text: msg.text,
                    createdAt: msg.createdAt,
                    interrupted: !!item.interrupted
                });

                // Also on the timeline, even though Message already holds it:
                // the whole point of the timeline is that ONE ordered stream
                // answers "what happened", so what was said has to sit inline
                // between the navigation and state events surrounding it,
                // not in a second collection to be merged by timestamp.
                timeline.emit(
                    item.role === 'user' ? TIMELINE_EVENTS.TRANSCRIPT_USER : TIMELINE_EVENTS.TRANSCRIPT_AGENT,
                    { role: item.role, text: text.trim(), interrupted: !!item.interrupted }
                );

                // Publish to LiveKit data channel for realtime mobile/web captions
                if (text && (item.role === 'assistant' || item.role === 'agent')) {
                    try {
                        const payload = new TextEncoder().encode(JSON.stringify({ type: 'agent_chat', text: text.trim() }));
                        await ctx.room.localParticipant.publishData(payload, { reliable: true });
                    } catch (publishErr) {
                        log.warn('Failed to publish data message to room:', { error: publishErr?.message });
                    }
                }
            }
        } catch (err) {
            log.error('failed to save message', { error: err });
        }
    }));

    // ── Proactive turn-taking ───────────────────────────────────────────────
    // Without this the agent is purely reactive: after the opening greeting it
    // never speaks again unless spoken to, so a visitor who goes quiet — the
    // normal case while they read a page we just showed them — is left with
    // silence indefinitely. The driver only ever arms once the agent has
    // stopped speaking and the visitor isn't speaking either, so it cannot
    // talk over anyone; see silence-driver.js for the two SDK behaviours it
    // depends on.
    //
    // idleMs was set to literal 0 on customer request (no perceptible wait —
    // barge-in already works on its own regardless of this timer). That
    // turned out to be a genuine bug, not just "too short": a real session
    // log showed TWO speech handles created 3ms apart right at the greeting
    // (the idle-nudge firing on a transient 'listening' blip that exists
    // for a few microtasks *before* the greeting's own generateReply() call
    // lands), and later a "Conversation already has an active response in
    // progress" API error right after an interruption (same transient blip
    // between the cancelled response tearing down and the visitor's new
    // turn actually starting). 500ms dodges those microtask-scale blips.
    // A LONGER version of the same race (AgentState reading 'listening' for
    // several hundred ms while the model is still deciding what to call
    // first) kept recurring in real sessions no matter how far idleMs was
    // pushed out (1200ms still wasn't enough) — see `activeSpeechCount`'s
    // declaration above for why that's now handled by a real SDK signal
    // instead of a bigger guess, which is what makes 500ms safe to use here
    // again.
    const silence = createSilenceDriver({
        idleMs: Number(process.env.AGENT_IDLE_NUDGE_MS ?? 500),
        onIdle: ({ consecutive }) => {
            // While a playbook is running and hasn't finished, silence is the
            // presentation's own advance signal — see md/backend/agent_flow.md,
            // "Adım ilerlemesi" — not a generic re-engagement nudge. Once the
            // playbook completes, this falls through to the ordinary nudge so
            // the agent stays proactive for the rest of the conversation.
            if (playbookActive && playbookRuntime && !playbookRuntime.completed) {
                playbookRuntime.signal('silence');
                return;
            }
            try {
                agentSession.generateReply({
                    instructions: buildIdleNudgeInstructions({
                        consecutive,
                        lastUtterance: utterances.last()?.text
                    })
                });
                log.info('idle nudge sent', { consecutive });
                timeline.emit(TIMELINE_EVENTS.NUDGE_SENT, { consecutive });
            } catch (err) {
                // generateReply THROWS synchronously (it does not reject) when
                // the session isn't running yet or is already closing — the
                // latter happens on essentially every teardown, so this is an
                // expected path, not an error.
                log.warn('idle nudge skipped', { error: err.message, consecutive });
            }
        },
        // Vetoes the timer while the playbook is mid-navigate-or-narrate (see
        // playbook-runtime.js's `busy` getter and hazard #2 in the plan) OR
        // while a speech turn is still active (activeSpeechCount, declared
        // above — outside a playbook this was the real gap: a nudge could
        // fire before the visitor's own turn had even issued its first tool
        // call, producing a second concurrent turn that independently
        // re-did the same lookup and repeated "still loading" filler in a
        // real session).
        // A multi-party waiting room has its own explicit start gate. Treat it
        // as busy so the generic silence driver cannot advance a playbook or
        // send an ordinary nudge before the meeting has actually begun.
        isBusy: () => !presentationStarted || activeSpeechCount > 0 || (playbookRuntime?.busy ?? false),
        // silence-driver.js's own default (3) assumes each fire follows a
        // genuinely long silence — with idleMs≈0 each fire is just "one more
        // self-driven turn", so a real continuous walkthrough would hit the
        // default ceiling (and the closing/goodbye instructions) after only
        // ~30-45s of talking. Matches buildIdleNudgeInstructions' own
        // `consecutive >= 20` threshold for when it switches to that closing
        // message.
        maxConsecutive: 20,
        // Playbook-driven advances should not consume the later free-form
        // re-engagement budget. onCompleted resets the shared counter as an
        // additional boundary between those two phases.
        isCapExempt: () => Boolean(playbookActive && playbookRuntime && !playbookRuntime.completed)
    });

    // Closes the startup race at its source: `agentSession.start()` briefly
    // reports 'listening' before the greeting/playbook's own first
    // generateReply() call actually lands (a few microtasks later), and the
    // driver has no way to tell that transient blip apart from a genuinely
    // quiet visitor. Ignoring state events entirely until the greeting/
    // playbook has actually been kicked off means the driver's first-ever
    // read of `agentState` is already past that blip.
    let greetingSent = false;
    agentSession.on(voice.AgentSessionEventTypes.AgentStateChanged, (ev) => {
        timeline.emit(TIMELINE_EVENTS.AGENT_STATE, { from: ev.oldState, to: ev.newState });
        if (greetingSent) silence.handleAgentState(ev.newState);
    });
    agentSession.on(voice.AgentSessionEventTypes.UserStateChanged, (ev) => {
        timeline.emit(TIMELINE_EVENTS.USER_STATE, { from: ev.oldState, to: ev.newState });
        if (greetingSent) silence.handleUserState(ev.newState);
    });
    // Ground truth for `activeSpeechCount` (declared above): every
    // generateReply()/say() call — the greeting, a real reply, an idle
    // nudge, a playbook step — creates a SpeechHandle and fires this event.
    // `addDoneCallback` is the SDK's own signal that the WHOLE turn (tool
    // calls, audio playout, everything) has actually finished, not just
    // that AgentState happened to read 'listening' for a moment.
    agentSession.on(voice.AgentSessionEventTypes.SpeechCreated, (ev) => {
        activeSpeechCount++;
        ev.speechHandle.addDoneCallback(() => {
            activeSpeechCount = Math.max(0, activeSpeechCount - 1);
            // Group session: the agent just finished a turn — answer anything
            // that piled up in the room while it was talking.
            if (activeSpeechCount === 0 && isMultiParty && presentationStarted && !questionQueue.isEmpty()) {
                flushQuestionQueue();
            }
        });
    });

    // Mic on/off was completely invisible before: a visitor who muted, spoke
    // to nobody, then unmuted looked identical in the logs to one who sat
    // silently the whole time. `TrackMuted`/`TrackUnmuted` fire the instant
    // the state flips, which is exactly when it needs recording.
    ctx.room.on(RoomEvent.TrackMuted, (publication, participant) => {
        if (publication?.kind !== TrackKind.KIND_AUDIO) return;
        timeline.emit(TIMELINE_EVENTS.MIC_OFF, {
            participant: participant?.identity,
            trackSid: publication?.sid ?? null
        });
    });
    ctx.room.on(RoomEvent.TrackUnmuted, (publication, participant) => {
        if (publication?.kind !== TrackKind.KIND_AUDIO) return;
        timeline.emit(TIMELINE_EVENTS.MIC_ON, {
            participant: participant?.identity,
            trackSid: publication?.sid ?? null
        });
    });
    ctx.room.on(RoomEvent.ParticipantConnected, (participant) => {
        timeline.emit(TIMELINE_EVENTS.PARTICIPANT_JOIN, { participant: participant?.identity });
    });
    ctx.room.on(RoomEvent.ParticipantDisconnected, (participant) => {
        timeline.emit(TIMELINE_EVENTS.PARTICIPANT_LEAVE, { participant: participant?.identity });
    });
    // A completed visitor utterance is the clearest sign someone is still
    // there, so the nudge budget starts over.
    agentSession.on(voice.AgentSessionEventTypes.UserInputTranscribed, (ev) => {
        if (!ev.isFinal) return;
        silence.resetConsecutive();
        // While the multi-party room is still filling, a visitor's answer to
        // the "shall we start?" check decides whether to begin now.
        if (isMultiParty && !presentationStarted && ev.transcript) {
            lastStartIntent = classifyStartIntent(ev.transcript);
            evaluateMeetingStart('answer');
            return;
        }
        // Group session in progress: queue every question (tagged with who
        // asked), and answer the whole batch once the agent stops talking.
        if (isMultiParty && presentationStarted && ev.transcript) {
            const attributedId = chooseAttribution({
                eventSpeakerId: ev.speakerId,
                fallbackIdentity: currentSpeakerIdentity,
                micOnFor: (id) => {
                    const p = ctx.room.remoteParticipants.get(id);
                    return p ? micOn(p) : false;
                }
            });
            if (attributedId) lastAddressedIdentity = attributedId;
            const speaker = resolveSpeaker(rosterList(), attributedId);
            questionQueue.enqueue({ speaker, text: ev.transcript });
            if (activeSpeechCount === 0) flushQuestionQueue();
        }
    });

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
        // Emitted before the teardown below, not after: `tour.close()` and
        // the DB update can both throw, and a timeline that just stops
        // mid-stream tells you nothing about why the call ended.
        timeline.emit(TIMELINE_EVENTS.SESSION_END, { reason, eventCount: timeline.count });
        try {
            // Cleanup: stop tour publish loop, heartbeat, and close browser
            silence.dispose();
            playbookRuntime?.stop();
            tourFrameObserver.abandonPending('session_ended');
            if (tourPublishTimer) {
                clearTimeout(tourPublishTimer);
                tourPublishTimer = null;
            }
            if (customerSampleInterval) clearInterval(customerSampleInterval);
            if (meetingWaitInterval) clearInterval(meetingWaitInterval);
            if (meetingSafetyTimer) clearTimeout(meetingSafetyTimer);
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

    // ── Presentation start (shared by the single-party path and the
    //    multi-party waiting gate) ─────────────────────────────────────────
    function startPresentation() {
        if (presentationStarted) return;
        presentationStarted = true;
        if (meetingWaitInterval) clearInterval(meetingWaitInterval);
        if (meetingSafetyTimer) clearTimeout(meetingSafetyTimer);
        if (isMultiParty) {
            meetingPhase = 'live';
            broadcastMeetingState();
            Session.updateOne({ _id: session._id }, { status: 'live' }).catch((err) =>
                log.warn('meeting: status->live write failed (non-fatal)', { error: err.message })
            );
        }
        // No synthetic "step 0": the editor seeds a playbook's first row with
        // the greeting itself (AgentGoals.jsx), so starting the runtime IS the
        // greeting — the worker holds no special case for it.
        if (playbookActive && playbookRuntime) {
            // The session-level prepare() has already warmed Chromium/context
            // without navigating. Let the runtime own the one real first-page
            // navigation: a detached openAt() here races showUrl() (openAt marks
            // the tour active before its await), causing goto() to run against
            // a browser that is still opening and reintroducing double nav.
            const firstUrl = generatedPlan?.screenMode === 'guided-tour' && playbookNodes[0]?.url;
            log.info('playbook: starting run', { generated: Boolean(generatedPlan), firstUrl: firstUrl || null });
            timeline.emit(TIMELINE_EVENTS.PLAYBOOK_START, {
                generated: Boolean(generatedPlan),
                firstUrl: firstUrl || null
            });
            playbookRuntime.start();
        } else {
            log.info('no playbook; sending plain greeting');
            // Identifies itself as an AI demo assistant FOR THE PRODUCT (not a
            // human name — a customer flagged an invented first name as
            // off-putting), and not a generic "hi, how can I help" — the
            // visitor arrives cold via a shared link with no context. No
            // open-ended question: there's no wait after this turn.
            agentSession.generateReply({
                instructions: buildGreetingInstructions({
                    productName: product.name,
                    productDescription: product.description
                }),
                toolChoice: 'none'
            });
        }
    }

    // ── Multi-party waiting gate ─────────────────────────────────────────
    function evaluateMeetingStart(via) {
        if (presentationStarted) return;
        const visitorCount = countVisitors();
        const go = shouldStartMeeting({
            visitorCount,
            maxParticipants,
            waitedMs: Date.now() - meetingJoinedAt,
            maxWaitMs: MEETING_MAX_WAIT_MS,
            lastIntent: lastStartIntent
        });
        log.info('meeting: evaluate start', { via, visitorCount, maxParticipants, lastStartIntent, go });
        if (go) startPresentation();
    }

    function enterWaitingRoom() {
        meetingJoinedAt = Date.now();
        meetingPhase = 'waiting';
        broadcastMeetingState();
        log.info('meeting: entering waiting room', { maxParticipants, visitorCount: countVisitors() });
        // Ask "shall we start, or wait for more?" once a minute.
        meetingWaitInterval = setInterval(() => {
            if (presentationStarted) return;
            agentSession
                .generateReply({
                    instructions: buildWaitingRoomPrompt({
                        visitorCount: countVisitors(),
                        maxParticipants
                    }),
                    toolChoice: 'none'
                })
                .catch((err) => log.warn('meeting: waiting-room prompt failed', { error: err.message }));
        }, 60_000);
        // Safety: never wait forever.
        meetingSafetyTimer = setTimeout(() => evaluateMeetingStart('max-wait'), MEETING_MAX_WAIT_MS);
        evaluateMeetingStart('enter');
    }

    // The only thing that actually spends money is `agentSession.start()` —
    // it opens a persistent websocket to the OpenAI Realtime API. See
    // realtime-gate.js for why this is gated on real visitor audio (COST
    // WARNING documented there) instead of firing as soon as we join the room.
    const realtimeGate = createRealtimeGate({
        onStart: () => {
            log.info('realtime gate opened; starting agent session');
            // The moment billing starts — and the boundary before which no
            // model output is possible at all, which makes it the first thing
            // to check when a session "produced nothing".
            timeline.emit(TIMELINE_EVENTS.REALTIME_GATE_OPEN);
            startTourPrewarm();
            agentSession.start({
                agent: new voice.Agent({ instructions, tools }),
                room: ctx.room,
                // Multi-party: the linked participant changes constantly
                // (active-speaker following), so the SDK must NOT end the
                // session when whoever is currently linked leaves — the
                // participant-left watchdog below owns "nobody is in the room".
                ...(isMultiParty ? { inputOptions: { closeOnDisconnect: false } } : {})
            }).then(() => {
                // Opens the silence driver's eyes — see `greetingSent`'s
                // declaration above for why this must happen right here,
                // synchronously, before either branch below issues its own
                // first generateReply()/playbook start.
                greetingSent = true;

                if (isMultiParty) {
                    // Group session: a question from a non-speaking visitor must
                    // not barge in — it's queued and answered as a batch when
                    // the agent finishes (see flushQuestionQueue).
                    try {
                        agentSession.updateOptions({ allowInterruptions: false });
                    } catch (err) {
                        log.warn('meeting: updateOptions(allowInterruptions) failed', { error: err.message });
                    }
                    enterWaitingRoom();
                } else {
                    startPresentation();
                }
            }).catch((err) => log.error('failed to start realtime session', { error: err.message }));
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

    // Handle text chat messages sent over data channel
    ctx.room.on('dataReceived', async (payload, participant) => {
        if (participant?.identity === ctx.room.localParticipant?.identity) return;
        try {
            const raw = new TextDecoder().decode(payload);
            const data = JSON.parse(raw);
            if (data.type === 'salesai:hand' && isMultiParty) {
                const id = participant?.identity;
                if (id?.startsWith('visitor_')) {
                    if (data.raised) {
                        handQueue.raise(id);
                        // First hand while nobody has the floor: whoever the
                        // agent was last helping keeps it and this person waits.
                        currentFloorIdentity = currentFloorIdentity || lastAddressedIdentity || null;
                    } else {
                        handQueue.lower(id);
                    }
                    log.info('meeting: hand', { identity: id, raised: !!data.raised, queue: handQueue.size });
                    broadcastMeetingState();
                }
                return;
            }
            if (data.type === 'chat' && data.text) {
                log.info('Chat message received from visitor', { text: data.text });
                if (!realtimeGate.started) {
                    realtimeGate.handleTrackSubscribed({ kind: 1 });
                }
                agentSession.generateReply({ userInput: data.text }).catch((err) => {
                    log.warn('generateReply with user input failed:', { error: err?.message });
                });
            }
        } catch {
            // Ignore non-json messages
        }
    });

    // *** COST + STALE-SESSION WARNING — see realtime-gate.js for the opening
    // half of the cost concern ***
    // RoomIO's own closeOnDisconnect only reacts to "clean" disconnect reasons
    // (CLIENT_INITIATED/ROOM_DELETED/USER_REJECTED — see room_io.js in
    // @livekit/agents). An unclean disconnect (closed tab, dropped network)
    // never reaches that check, so without this watchdog: (a) if the paid
    // OpenAI Realtime websocket was already open, it stays connected —
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
        const identity = participant?.identity;
        if (!identity?.startsWith('visitor_')) return;

        if (participantLeftTimer) {
            clearTimeout(participantLeftTimer);
            participantLeftTimer = null;
            log.info('visitor reconnected; cancelled pending force-close');
        }

        if (!isMultiParty) return;

        const name = participant?.name || null;
        let visitorKey = null;
        try {
            visitorKey = JSON.parse(participant?.metadata || '{}')?.visitorKey || null;
        } catch { /* no/invalid metadata */ }

        const returning = matchReturningParticipant(rosterHistory, { visitorKey, name });
        if (returning) {
            // Same person, new identity — update the existing roster entry in
            // place and welcome them back rather than treating them as new.
            const priorIdentity = returning.identity;
            returning.identity = identity;
            returning.name = name || returning.name;
            returning.leftAt = null;
            if (currentFloorIdentity === priorIdentity) currentFloorIdentity = identity;
            if (lastAddressedIdentity === priorIdentity) lastAddressedIdentity = identity;
            handQueue.lower(priorIdentity);
            Session.updateOne(
                { _id: session._id, 'participants.identity': priorIdentity },
                {
                    $set: { 'participants.$.identity': identity, 'participants.$.name': returning.name },
                    $unset: { 'participants.$.leftAt': 1 }
                }
            ).catch((err) => log.warn('meeting: roster rejoin write failed (non-fatal)', { error: err.message }));
            log.info('meeting: participant rejoined', { name: returning.name, priorIdentity, identity });
            broadcastMeetingState();
            if (presentationStarted) {
                agentSession
                    .generateReply({
                        instructions: `${returning.name || 'A visitor'} has rejoined this session — you were already talking with them earlier. Say a short "welcome back" by name and continue naturally; do not restart or recap. Do not call any tools.`,
                        toolChoice: 'none'
                    })
                    .catch(() => {});
            }
            return;
        }

        if (!rosterHistory.some((r) => r.identity === identity)) {
            rosterHistory.push({ identity, name, visitorKey, leftAt: null });
        }
        Session.updateOne(
            { _id: session._id, 'participants.identity': { $ne: identity } },
            { $push: { participants: { identity, name, visitorKey, joinedAt: new Date() } } }
        ).catch((err) => log.warn('meeting: roster add failed (non-fatal)', { error: err.message }));
        broadcastMeetingState();

        if (presentationStarted) {
            // Latecomer during a live meeting — a short, single welcome line.
            agentSession
                .generateReply({
                    instructions: `A new visitor${name ? ` (${name})` : ''} just joined the ongoing session. Greet them by name in one short line and briefly say what you're currently showing, then carry on — do not restart, do not recap everything, do not call any tools.`,
                    toolChoice: 'none'
                })
                .catch(() => {});
        } else {
            evaluateMeetingStart('participant-joined');
        }
    });

    ctx.room.on(RoomEvent.ParticipantDisconnected, (participant) => {
        const identity = participant?.identity;
        if (!isMultiParty || !identity?.startsWith('visitor_')) return;
        const entry = rosterHistory.find((r) => r.identity === identity);
        if (entry) entry.leftAt = new Date();
        handQueue.lower(identity);
        if (currentFloorIdentity === identity) currentFloorIdentity = null;
        broadcastMeetingState();
        Session.updateOne(
            { _id: session._id, 'participants.identity': identity },
            { $set: { 'participants.$.leftAt': new Date() } }
        ).catch((err) => log.warn('meeting: roster leftAt failed (non-fatal)', { error: err.message }));
    });

    // Active-speaker following: the realtime model (RoomIO) listens to one
    // participant at a time, so point it at whoever is currently speaking —
    // but ONLY a visitor whose mic is actually on, so a "unmute → talk → mute"
    // blip doesn't leave the agent stuck on someone it can no longer hear.
    ctx.room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        if (!isMultiParty) return;
        const id = pickActiveSpeaker(
            (speakers || []).map((p) => ({ identity: p.identity, micOn: micOn(p) }))
        );
        if (!id || id === currentSpeakerIdentity) return;
        currentSpeakerIdentity = id;
        try {
            agentSession._roomIO?.setParticipant(id);
        } catch (err) {
            log.warn('meeting: setParticipant failed (non-fatal)', { error: err.message });
        }
    });

    // A visitor muting mid-conversation clears them as the "current speaker"
    // so the next un-attributed utterance isn't pinned to a muted mic.
    const onMuteChange = (_pub, participant) => {
        const p = participant || _pub?.participant;
        if (isMultiParty && p?.identity === currentSpeakerIdentity && !micOn(p)) {
            currentSpeakerIdentity = null;
        }
    };
    ctx.room.on(RoomEvent.TrackMuted, onMuteChange);
    ctx.room.on(RoomEvent.TrackUnmuted, onMuteChange);

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
    const avatarStartedAt = Date.now();
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
                    timeline.emit(
                        TIMELINE_EVENTS.AVATAR_FAILED,
                        { avatarProvider: agentDoc.avatarProvider, reason: 'timeout' },
                        AVATAR_ATTACH_TIMEOUT_MS
                    );
                    resolve();
                }, AVATAR_ATTACH_TIMEOUT_MS);
            })
        ]);
        timeline.emit(
            TIMELINE_EVENTS.AVATAR_READY,
            { avatarProvider: agentDoc.avatarProvider },
            Date.now() - avatarStartedAt
        );
    } finally {
        clearTimeout(avatarTimeoutTimer);
    }
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
