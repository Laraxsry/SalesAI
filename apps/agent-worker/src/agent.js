import '@repo/config-env/load';
import { fileURLToPath } from 'node:url';
import { WorkerOptions, cli, defineAgent, voice } from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
import {
    VideoSource, LocalVideoTrack, VideoBufferType, VideoStream, TrackKind, TrackSource, VideoFrame
} from '@livekit/rtc-node';
import sharp from 'sharp';
import { connectDB, Agent, Product, Session, Message } from '@repo/database';
import { buildSystemPrompt, buildTools } from '@repo/agent';
import { getAvatarProvider } from '@repo/avatar';
import { GuidedTour, analyzeFrame } from '@repo/screen';
import { Logger } from '@repo/logger';
import { publishEvent, RT_EVENTS } from '@repo/realtime';

/**
 * The realtime brain. LiveKit dispatches this worker into a visitor's room.
 * It loads the agent config, builds the persona + tools, attaches the chosen
 * avatar, and runs a speech-to-speech session backed by the OpenAI Realtime API.
 */
export default defineAgent({
    entry: async (ctx) => {
        await connectDB();
        await ctx.connect();

        const roomName = ctx.room.name;
        const session = await Session.findOne({ roomName });
        const agentDoc = session ? await Agent.findById(session.agentId) : null;
        const product = agentDoc ? await Product.findById(agentDoc.productId) : null;

        if (!agentDoc || !product) {
            Logger.error('agent-worker: missing agent/product for room', { roomName });
            return;
        }

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
        // Seller-provided demo session (cookies/localStorage) so the tour can
        // land on authenticated screens. No fallback fake credentials — an
        // unconfigured product just tours unauthenticated, same as before.
        const tour = new GuidedTour({
            startUrl,
            backend,
            allowedDomains: product.tourAllowedDomains || [],
            auth: product.demoSession || null
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
                    Logger.info('GuidedTour started', { url });

                    // Create a LiveKit VideoSource and publish it as a screen-share track
                    tourVideoSource = new VideoSource(1280, 720);
                    try {
                        tourVideoTrack = LocalVideoTrack.createVideoTrack('tour', tourVideoSource);
                        await ctx.room.localParticipant.publishTrack(tourVideoTrack, { name: 'screen_share', source: TrackSource.SOURCE_SCREENSHARE });
                        Logger.info('Tour video track published to LiveKit room');
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
                            Logger.warn('Tour frame capture failed', { error: frameErr.message });
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
                    Logger.error('GuidedTour open failed', { error: e.message });
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
                    Logger.error('GuidedTour navigate failed', { error: e.message });
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
                    Logger.error('GuidedTour highlight failed', { error: e.message });
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
            Logger.info('Customer screen share detected', { participant: participant.identity });

            // Stop any previous sampling loop
            if (customerSampleInterval) clearInterval(customerSampleInterval);

            const videoStream = new VideoStream(track);

            // Sample the stream at ~1 FPS using setInterval
            customerSampleInterval = setInterval(async () => {
                if (!screenModes.includes('customer-share')) return;
                try {
                    // Get the next frame from the stream
                    const { value: frame } = await videoStream[Symbol.asyncIterator]().next();
                    if (!frame) return;

                    const { data, width, height } = frame;
                    // ARGB (LiveKit default) → PNG → resize to max 1024px wide → JPEG base64
                    const jpegBuffer = await sharp(Buffer.from(data), {
                        raw: { width, height, channels: 4 }
                    })
                        .resize({ width: 1024, withoutEnlargement: true })
                        .jpeg({ quality: 80 })
                        .toBuffer();

                    latestCustomerFrameBase64 = `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;
                } catch (err) {
                    Logger.warn('Customer frame sample failed', { error: err.message });
                }
            }, 1000); // ~1 FPS

            // Clean up when the customer stops sharing
            track.on('ended', () => {
                if (customerSampleInterval) {
                    clearInterval(customerSampleInterval);
                    customerSampleInterval = null;
                }
                latestCustomerFrameBase64 = null;
                Logger.info('Customer screen share ended');
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
        const tools = buildTools({ 
            productId: String(product._id),
            tour: tourControls,
            screen: screenControls
        }).map(t => llm.tool({
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
        const avatar = getAvatarProvider('voice-only');
        try {
            await avatar.start({ agentSession, room: ctx.room });
        } catch (err) {
            Logger.warn('avatar attach failed, falling back to voice-only', { error: err });
        }

        agentSession.on(voice.AgentSessionEventTypes.ConversationItemAdded, async (ev) => {
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
                Logger.error('failed to save message', { error: err });
            }
        });

        agentSession.on(voice.AgentSessionEventTypes.Close, async () => {
            try {
                // Cleanup: stop tour publish loop and close browser
                if (tourPublishInterval) clearInterval(tourPublishInterval);
                if (customerSampleInterval) clearInterval(customerSampleInterval);
                try { await tour.close(); } catch { /* best-effort cleanup */ }

                await Session.updateOne({ _id: session._id }, { status: 'ended' });
                Logger.info('session ended', { sessionId: session._id });
            } catch (err) {
                Logger.error('failed to update session status on close', { error: err });
            }
        });

        await agentSession.start({
            agent: new voice.Agent({ instructions, tools }),
            room: ctx.room
        });
    }
});

cli.runApp(new WorkerOptions({
    agent: fileURLToPath(import.meta.url),
    // Named agent: LiveKit dispatch will route rooms to this worker by name.
    // The name must match the agentName passed to dispatchAgent() in sessions.js.
    agentName: process.env.LIVEKIT_AGENT_NAME || 'salesai-agent'
}));
