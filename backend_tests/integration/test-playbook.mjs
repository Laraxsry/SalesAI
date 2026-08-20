import '@repo/config-env/load';
import express from 'express';
import http from 'node:http';
import mongoose from 'mongoose';
import { connectDB, Agent, Product, Playbook } from '@repo/database';
import { registerRoutes } from '../../apps/api/src/routes/index.js';
import { signTokens } from '@repo/auth';


//Playbook endpoints — GET/POST /api/v1/agents/:id/playbook.


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

// The 8-step Cyberverse reference scenario.
// demo.cyberverse.example and www.cyberverse.example intentionally share one
// registrable domain — the point of step 5-7 is that no tourAllowedDomains
// entry is needed for that subdomain to be accepted.
function cyberverseNodes() {
    return [
        { id: 'n1', order: 1, directive: 'Şirketi kısaca tanıt' },
        { id: 'n2', order: 2, directive: 'Anasayfayı scroll et', url: 'https://www.cyberverse.example/landing' },
        { id: 'n3', order: 3, directive: 'KVKK anlat', url: 'https://www.cyberverse.example/kvkk' },
        { id: 'n4', order: 4, directive: 'SGRC ürününün başarısını anlat', url: 'https://www.cyberverse.example/sgrc' },
        { id: 'n5', order: 5, directive: "Dashboard'u tanıt", url: 'https://demo.cyberverse.example/home' },
        { id: 'n6', order: 6, directive: 'Rapor eklemeyi anlat', url: 'https://demo.cyberverse.example/reports' },
        {
            id: 'n7',
            order: 7,
            directive: 'Rapor ekle (örnek)',
            url: 'https://demo.cyberverse.example/reports',
            attach: 'Rapor Ekle butonu'
        },
        { id: 'n8', order: 8, directive: 'Avatara dön, ürünü yarın başlatmak ister misiniz diye sor' }
    ];
}

async function run() {
    console.log('\n🚀 Testing Playbook Endpoints (Phase 9)...\n');

    await connectDB();

    const app = express();
    app.use(express.json());
    registerRoutes(app);

    const server = http.createServer(app);
    const PORT = 5098;
    await new Promise((resolve) => server.listen(PORT, resolve));
    const BASE = `http://localhost:${PORT}/api/v1`;

    const userId = new mongoose.Types.ObjectId();
    const tokenObj = signTokens({ sub: String(userId) });
    const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenObj.accessToken}`
    };

    let productId;
    let agentId;

    try {
        // ── Setup ────────────────────────────────────────────────────────
        const workspaceId = new mongoose.Types.ObjectId();
        const product = await Product.create({
            workspaceId,
            name: 'Cyberverse',
            websiteUrl: 'https://www.cyberverse.example'
        });
        productId = product._id;

        const agent = await Agent.create({
            productId,
            name: 'Satış Asistanı',
            status: 'draft',
            persona: { tone: 'friendly', goals: [], guardrails: [] },
            avatarProvider: 'voice-only',
            screenModes: ['guided-tour']
        });
        agentId = String(agent._id);
        ok('Fixture product + agent created');

        // ── 1. GET on a fresh agent returns schema defaults, 200 not 404 ──
        const getEmpty = await fetch(`${BASE}/agents/${agentId}/playbook`, { headers });
        const emptyBody = await getEmpty.json();
        if (
            getEmpty.status === 200 &&
            Array.isArray(emptyBody.nodes) &&
            emptyBody.nodes.length === 0 &&
            emptyBody.enabled === true &&
            emptyBody.product?.websiteUrl === 'https://www.cyberverse.example'
        ) {
            ok('GET on an agent with no saved playbook returns 200 + schema defaults + product trust root');
        } else {
            fail('GET defaults', `status=${getEmpty.status} body=${JSON.stringify(emptyBody)}`);
        }

        // ── 2. POST the 8-node reference scenario ──────────────────────
        const postRes = await fetch(`${BASE}/agents/${agentId}/playbook`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ nodes: cyberverseNodes() })
        });
        const postBody = await postRes.json();
        if (postRes.status === 200 && postBody.nodes?.length === 8 && postBody.version === 1) {
            ok('POST 8-node Cyberverse scenario -> 200, version 1');
        } else {
            fail('POST 8-node scenario', `status=${postRes.status} body=${JSON.stringify(postBody)}`);
        }

        // node 5's url (demo.cyberverse.example) must have been accepted with
        // NO tourAllowedDomains entry — this is the eTLD+1 sharing behavior
        // isTourNavigableUrl/trustKey agree on.
        const node5 = postBody.nodes?.find((n) => n.id === 'n5');
        if (node5?.url === 'https://demo.cyberverse.example/home') {
            ok('Subdomain sharing the registrable domain accepted without an allowlist entry');
        } else {
            fail('Subdomain acceptance', `node5=${JSON.stringify(node5)}`);
        }

        // ── 3. GET round-trips what was saved ──────────────────────────
        const getSaved = await fetch(`${BASE}/agents/${agentId}/playbook`, { headers });
        const savedBody = await getSaved.json();
        if (
            getSaved.status === 200 &&
            savedBody.nodes?.length === 8 &&
            savedBody.nodes[6].attach === 'Rapor Ekle butonu' &&
            savedBody.version === 1
        ) {
            ok('GET round-trips the saved playbook, including attach on step 7');
        } else {
            fail('GET round-trip', `status=${getSaved.status} body=${JSON.stringify(savedBody)}`);
        }

        // ── 4. Re-POST bumps version ────────────────────────────────────
        const rePost = await fetch(`${BASE}/agents/${agentId}/playbook`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ nodes: cyberverseNodes() })
        });
        const rePostBody = await rePost.json();
        if (rePost.status === 200 && rePostBody.version === 2) {
            ok('Re-saving the same playbook bumps version to 2');
        } else {
            fail('Version bump', `status=${rePost.status} body=${JSON.stringify(rePostBody)}`);
        }

        // ── 5. Off-domain URL is rejected server-side ──────────────────
        const badRes = await fetch(`${BASE}/agents/${agentId}/playbook`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                nodes: [{ id: 'bad', order: 1, directive: 'Yanlış site', url: 'https://untrusted.example/' }]
            })
        });
        const badBody = await badRes.json();
        if (badRes.status === 422 && badBody.index === 0) {
            ok('URL outside the product\'s allowed domains is rejected with 422 + index');
        } else {
            fail('Off-domain rejection', `status=${badRes.status} body=${JSON.stringify(badBody)}`);
        }

        // ── 6. 404 for a nonexistent agent ──────────────────────────────
        const missingId = new mongoose.Types.ObjectId();
        const notFound = await fetch(`${BASE}/agents/${missingId}/playbook`, { headers });
        if (notFound.status === 404) {
            ok('GET for a nonexistent agent returns 404');
        } else {
            fail('404 on missing agent', `status=${notFound.status}`);
        }
    } catch (err) {
        fail('Unexpected exception', err.stack || err.message);
    } finally {
        if (agentId) {
            await Playbook.deleteMany({ agentId }).catch(() => { });
            await Agent.deleteOne({ _id: agentId }).catch(() => { });
        }
        if (productId) await Product.deleteOne({ _id: productId }).catch(() => { });
        await new Promise((resolve) => server.close(resolve));
        await mongoose.disconnect();
    }

    console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
    if (failed > 0) process.exit(1);
}

run();
