import '@repo/config-env/load';
import { fileURLToPath } from 'node:url';
import { WorkerOptions, cli, defineAgent, voice } from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
import { connectDB, Agent, Product, Session, Message } from '@repo/database';
import { buildSystemPrompt, buildTools } from '@repo/agent';
import { getAvatarProvider } from '@repo/avatar';
import { GuidedTour, analyzeFrame } from '@repo/screen';
import { Logger } from '@repo/logger';

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

        // Initialize Guided Tour
        const tour = new GuidedTour({ startUrl: product.websiteUrl || 'https://salesai.dev' });
        let isTourActive = false;

        const tourControls = {
            openAt: async (url) => {
                try {
                    await tour.open();
                    if (url) await tour.goto(url);
                    isTourActive = true;
                    Logger.info('GuidedTour started', { url });
                    
                    // Start publishing loop (Mocking LiveKit video track publish for now)
                    // A real implementation would use ctx.room.localParticipant.publishTrack(LocalVideoTrack)
                    setInterval(async () => {
                        if (!isTourActive) return;
                        try {
                            const buffer = await tour.screenshot();
                            // In a full implementation, this buffer (PNG) is passed to LiveKit VideoSource
                        } catch (err) {}
                    }, 2000);

                    return { ok: true, status: 'Tour started in background. You can now use navigate_to or highlight.' };
                } catch (e) {
                    return { ok: false, error: e.message };
                }
            },
            goto: async (url) => {
                if (!isTourActive) return { ok: false, error: 'Tour not active. Call start_guided_tour first.' };
                await tour.goto(url);
                return { ok: true };
            },
            highlight: async (selector) => {
                if (!isTourActive) return { ok: false, error: 'Tour not active.' };
                await tour.highlight(selector);
                return { ok: true };
            }
        };

        // Initialize Customer Screen Vision
        let latestCustomerFrameBase64 = null;
        
        ctx.room.on('trackSubscribed', (track, pub, participant) => {
            if (track.kind === 'video' && track.source === 'screen_share') {
                Logger.info('Customer screen share detected', { participant: participant.identity });
                // In a full implementation, we'd pipe the RTC video sink to a canvas and extract PNG base64.
                // For now, we stub it to simulate reading the screen.
                latestCustomerFrameBase64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
            }
        });

        const screenControls = {
            read: async (question) => {
                if (!latestCustomerFrameBase64) return { ok: false, error: 'Customer is not sharing screen or no frame available.' };
                try {
                    const result = await analyzeFrame(latestCustomerFrameBase64, question);
                    return { ok: true, analysis: result };
                } catch (e) {
                    return { ok: false, error: e.message };
                }
            }
        };

        const tools = buildTools({ 
            productId: String(product._id),
            tour: tourControls,
            screen: screenControls
        });

        const agentSession = new voice.AgentSession({
            llm: new openai.realtime.RealtimeModel({
                model: process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2',
                voice: 'cedar'
            })
        });

        // Attach the configured avatar (developer-selected, not visitor choice).
        const avatar = getAvatarProvider(agentDoc.avatarProvider);
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
                    await Message.create({
                        sessionId: session._id,
                        role: item.role,
                        text: text.trim()
                    });
                }
            } catch (err) {
                Logger.error('failed to save message', { error: err });
            }
        });

        agentSession.on(voice.AgentSessionEventTypes.Close, async () => {
            try {
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

cli.runApp(new WorkerOptions({ agent: fileURLToPath(import.meta.url) }));
