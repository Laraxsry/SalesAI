/* global __ENV, __VU, __ITER */
// __ENV/__VU/__ITER are k6 runtime globals, injected by the k6 binary
// itself — not Node/browser globals, hence the eslint hint above.
//
// Load test (Phase 7, Task 6 — "load test session creation + concurrent
// rooms"). Runs under k6 (a standalone binary, not an npm package — see
// https://k6.io/docs/get-started/installation/), not Node:
//
//   k6 run scripts/load-test.js
//   VUS=10 ITERATIONS=15 k6 run scripts/load-test.js   # override concurrency/total requests
//
// `setup()` creates one real workspace/product/agent and activates it
// (mirroring scripts/create-demo-room.sh's exact flow) — a fixed number of
// virtual users then race to open ITERATIONS sessions total against that one
// real share link, simulating concurrent visitors starting conversations.
//
// Run this with apps/agent-worker NOT running. POST /sessions dispatches a
// real agent-worker into a real LiveKit room per call; if a real agent-worker
// is listening, every session would trigger a real, billed OpenAI Realtime
// session. `mintSession()` already treats a failed dispatch as non-fatal
// (logged, session creation still succeeds) specifically so this load test
// can isolate the API layer's own throughput/latency under concurrent
// session-creation load — which is what this test measures — without a real
// realtime voice pipeline behind it.
//
// Watch apps/api's /metrics (Grafana) during the run: RED rates, whether
// backpressure sheds requests (503s) under load, queue depth — all wired up
// in earlier Phase 7 work.
//
// ITERATIONS defaults to 15, deliberately under 20: POST /sessions is itself
// rate-limited to 20 requests/minute per IP (apps/api/src/main.js's
// sessionRateLimit, Phase 8). Every k6 virtual user shares this machine's one
// IP, so pushing the total past 20 mostly measures our own abuse-prevention
// kicking in (real 429s, by design) rather than the API's raw session-
// creation throughput — a correct, expected result, not a bug, but not what
// this test is trying to isolate. To load-test past that ceiling on purpose,
// you need multiple real source IPs (several machines, a distributed k6
// run) — raising VUS/ITERATIONS on one host just demonstrates the rate
// limiter, which chaos-test.js-style verification, not this script, is for.
import http from 'k6/http';
import { check } from 'k6';

const API = __ENV.API_BASE || 'http://localhost:5001/api/v1';

export const options = {
    scenarios: {
        concurrent_sessions: {
            executor: 'shared-iterations',
            vus: Number(__ENV.VUS || 10),
            iterations: Number(__ENV.ITERATIONS || 15),
            maxDuration: '1m'
        }
    },
    thresholds: {
        http_req_failed: ['rate<0.05'], // fewer than 5% of requests error
        http_req_duration: ['p(95)<2000'] // 95% of requests complete under 2s
    }
};

const JSON_HEADERS = { headers: { 'Content-Type': 'application/json' } };

export function setup() {
    const email = `loadtest-${Date.now()}@salesai.example`;
    const registerRes = http.post(`${API}/auth/register`, JSON.stringify({
        email,
        password: 'loadtest-password-123',
        name: 'Load Test Seller'
    }), JSON_HEADERS);
    check(registerRes, { 'setup: register succeeded': (r) => r.status === 201 });

    const { accessToken, workspace } = registerRes.json();
    const authHeaders = { headers: { ...JSON_HEADERS.headers, Authorization: `Bearer ${accessToken}` } };

    const productRes = http.post(`${API}/products`, JSON.stringify({
        workspaceId: workspace.id,
        name: 'Load Test Product',
        description: 'A throwaway product used only to load-test session creation.'
    }), authHeaders);
    check(productRes, { 'setup: product created': (r) => r.status === 201 });
    const productId = productRes.json().id;

    const agentRes = http.post(`${API}/agents`, JSON.stringify({
        productId,
        name: 'Load Test Agent',
        avatarProvider: 'voice-only',
        persona: { tone: 'friendly', language: 'en', goals: [], guardrails: [] }
    }), authHeaders);
    check(agentRes, { 'setup: agent created': (r) => r.status === 201 });
    const agentId = agentRes.json()._id;

    const activateRes = http.post(`${API}/agents/${agentId}/activate`, null, authHeaders);
    check(activateRes, { 'setup: agent activated': (r) => r.status === 200 });

    return { shareToken: activateRes.json().token };
}

/** Every virtual user repeatedly opens a new session — simulating concurrent visitors. */
export default function (data) {
    const res = http.post(`${API}/sessions`, JSON.stringify({
        shareToken: data.shareToken,
        visitorName: `LoadTest VU ${__VU} iter ${__ITER}`
    }), JSON_HEADERS);

    check(res, {
        'session created (200)': (r) => r.status === 200,
        'response has roomName': (r) => !!r.json('roomName'),
        'response has token': (r) => !!r.json('token')
    });
}
