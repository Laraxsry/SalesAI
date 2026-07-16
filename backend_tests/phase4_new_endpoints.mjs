import '@repo/config-env/load';
import express from 'express';
import http from 'node:http';
import { connectDB, Agent, Session, Message, KnowledgeSource } from '@repo/database';
import { registerRoutes } from '../apps/api/src/routes/index.js';
import { signTokens } from '@repo/auth';
import mongoose from 'mongoose';

let passed = 0;
let failed = 0;

function ok(label) {
    console.log(`  ✅ ${label}`);
    passed++;
}
function fail(label, reason) {
    console.error(`  ❌ ${label}`);
    if (reason) console.error(`     ${reason}`);
    failed++;
}

async function run() {
    console.log('\n🚀 Testing New Backend Endpoints & Features...\n');

    await connectDB();

    // Setup an Express instance for the test
    const app = express();
    app.use(express.json());
    registerRoutes(app);

    const server = http.createServer(app);
    const PORT = 5099;
    await new Promise((resolve) => server.listen(PORT, resolve));

    // Create a dummy user and token for requireAuth
    const userId = new mongoose.Types.ObjectId();
    const tokenObj = signTokens(String(userId));
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenObj.accessToken}`
    };

    const productId = new mongoose.Types.ObjectId();
    const agentData = {
        productId,
        name: "Test Agent Extra",
        status: "draft",
        persona: { tone: "polite", goals: ["help"], guardrails: [] },
        avatarProvider: "voice-only",
        screenModes: ["guided-tour"]
    };

    let agentId;
    let sessionId;
    let sourceId;

    try {
        // ── 1. Create Agent ───────────────────────────────────────────
        const agent = await Agent.create(agentData);
        agentId = String(agent._id);
        ok("Agent created in DB");

        // ── 2. Test GET /api/v1/agents/:id ────────────────────────────
        const getRes = await fetch(`http://localhost:${PORT}/api/v1/agents/${agentId}`, { headers });
        const getBody = await getRes.json();
        if (getRes.status === 200 && getBody.name === "Test Agent Extra") {
            ok("GET /api/v1/agents/:id returned agent details successfully");
        } else {
            fail("GET /api/v1/agents/:id failed", `Status: ${getRes.status}, Body: ${JSON.stringify(getBody)}`);
        }

        // ── 3. Test POST /api/v1/agents/:id/pause ─────────────────────
        // First activate it to active
        await Agent.updateOne({ _id: agent._id }, { status: 'active' });
        const pauseRes = await fetch(`http://localhost:${PORT}/api/v1/agents/${agentId}/pause`, {
            method: 'POST',
            headers
        });
        const pauseBody = await pauseRes.json();
        if (pauseRes.status === 200 && pauseBody.status === "paused") {
            ok("POST /api/v1/agents/:id/pause updated agent status to paused");
        } else {
            fail("POST /api/v1/agents/:id/pause failed", `Status: ${pauseRes.status}, Body: ${JSON.stringify(pauseBody)}`);
        }

        // ── 4. Test DELETE /api/v1/knowledge/:id ──────────────────────
        const source = await KnowledgeSource.create({
            productId,
            type: 'text',
            title: 'Test Title',
            content: 'Test content',
            status: 'ready'
        });
        sourceId = String(source._id);

        const deleteRes = await fetch(`http://localhost:${PORT}/api/v1/knowledge/${sourceId}`, {
            method: 'DELETE',
            headers
        });
        const deleteBody = await deleteRes.json();
        if (deleteRes.status === 200 && deleteBody.ok === true) {
            const dbSource = await KnowledgeSource.findById(sourceId);
            if (!dbSource) {
                ok("DELETE /api/v1/knowledge/:id successfully deleted source and returned 200");
            } else {
                fail("DELETE /api/v1/knowledge/:id database delete failed");
            }
        } else {
            fail("DELETE /api/v1/knowledge/:id failed", `Status: ${deleteRes.status}, Body: ${JSON.stringify(deleteBody)}`);
        }

        // ── 5. Test GET /api/v1/sessions/:id/transcript ────────────────
        const session = await Session.create({
            agentId: agent._id,
            roomName: 'test-room-123',
            status: 'ended',
            startedAt: new Date(Date.now() - 60000), // 1 min ago
            endedAt: new Date()
        });
        sessionId = String(session._id);

        await Message.create({
            sessionId: session._id,
            role: 'user',
            text: 'Hello agent',
            at: new Date(Date.now() - 30000)
        });
        await Message.create({
            sessionId: session._id,
            role: 'assistant',
            text: 'Hello human',
            at: new Date()
        });

        // This is a public route, no auth header required
        const transcriptRes = await fetch(`http://localhost:${PORT}/api/v1/sessions/${sessionId}/transcript`);
        const transcriptBody = await transcriptRes.json();
        if (transcriptRes.status === 200 && Array.isArray(transcriptBody) && transcriptBody.length === 2) {
            ok("GET /api/v1/sessions/:id/transcript returned messages successfully");
        } else {
            fail("GET /api/v1/sessions/:id/transcript failed", `Status: ${transcriptRes.status}, Body: ${JSON.stringify(transcriptBody)}`);
        }

        // ── 6. Test GET /api/v1/analytics/agents/:id ───────────────────
        const analyticsRes = await fetch(`http://localhost:${PORT}/api/v1/analytics/agents/${agentId}`, { headers });
        const analyticsBody = await analyticsRes.json();
        if (analyticsRes.status === 200 && analyticsBody.totalSessions === 1 && analyticsBody.totalMessages === 2) {
            ok("GET /api/v1/analytics/agents/:id returned correct statistics successfully");
        } else {
            fail("GET /api/v1/analytics/agents/:id failed", `Status: ${analyticsRes.status}, Body: ${JSON.stringify(analyticsBody)}`);
        }

    } catch (e) {
        fail("Unexpected exception during tests", e.stack || e.message);
    } finally {
        // Cleanup created data
        if (agentId) await Agent.deleteOne({ _id: agentId });
        if (sessionId) {
            await Session.deleteOne({ _id: sessionId });
            await Message.deleteMany({ sessionId });
        }
        if (sourceId) await KnowledgeSource.deleteOne({ _id: sourceId });

        server.close();
    }

    console.log('\n' + '─'.repeat(60));
    console.log(`Results: ${passed} passed, ${failed} failed`);
    if (failed === 0) {
        console.log('🎉 All new endpoint tests completed successfully!\n');
        process.exit(0);
    } else {
        console.error('💥 Some tests failed!\n');
        process.exit(1);
    }
}

run().catch((e) => {
    console.error(e);
    process.exit(1);
});
