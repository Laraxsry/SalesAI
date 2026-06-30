import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { WorkerOptions, cli, defineAgent, voice } from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
import { connectDB, Agent, Product, Session } from '@repo/database';
import { buildSystemPrompt, buildTools } from '@repo/agent';
import { getAvatarProvider } from '@repo/avatar';
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

        const tools = buildTools({ productId: String(product._id) });

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

        await agentSession.start({
            agent: new voice.Agent({ instructions, tools }),
            room: ctx.room
        });
    }
});

cli.runApp(new WorkerOptions({ agent: fileURLToPath(import.meta.url) }));
