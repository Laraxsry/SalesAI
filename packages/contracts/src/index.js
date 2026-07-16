import { z } from 'zod';
import { isIP } from 'node:net';

/**
 * True if `host` is a literal IP in a range that's reserved for
 * internal/local use rather than the public internet.
 *
 * These aren't arbitrary numbers — they're blocks formally set aside by
 * RFC 1918 (private networks) and RFC 3927 (link-local) as "never routed on
 * the public internet". No real public website's primary address can
 * legitimately sit in one of these ranges — landing there means "this is
 * either an internal network device or localhost itself".
 *
 * 169.254.169.254 gets its own explicit check for a reason beyond being
 * link-local: it's the standardised cloud instance metadata address on
 * AWS/GCP/Azure/DigitalOcean alike. That single line catches both "link-local
 * in general" and "the specific address that leaks cloud credentials" at
 * once — it's the first thing anyone writing SSRF protection checks for.
 *
 * Only handles IP literals; a hostname that *resolves* to one of these
 * ranges (DNS rebinding) isn't caught here — that needs a request-time /
 * network-egress check, out of scope for a synchronous schema validator.
 */
function isPrivateOrReservedIp(host) {
    const version = isIP(host);
    if (version === 4) {
        const [a, b] = host.split('.').map(Number);
        if (a === 10) return true;                          // 10.0.0.0/8      — RFC1918 private network
        if (a === 127) return true;                          // 127.0.0.0/8     — loopback ("the machine itself")
        if (a === 169 && b === 254) return true;              // 169.254.0.0/16  — link-local, incl. cloud metadata (169.254.169.254)
        if (a === 172 && b >= 16 && b <= 31) return true;     // 172.16.0.0/12   — RFC1918 private network
        if (a === 192 && b === 168) return true;              // 192.168.0.0/16  — RFC1918 private network (home/office routers)
        if (a === 0) return true;                             // 0.0.0.0/8       — "this network" / unspecified
        return false;
    }
    if (version === 6) {
        const h = host.toLowerCase();
        // Same logic, IPv6's own reserved prefixes:
        return h === '::1'                                    // loopback (IPv6 equivalent of 127.0.0.1)
            || h.startsWith('fe80:')                          // link-local (IPv6 equivalent of 169.254.x.x)
            || h.startsWith('fc') || h.startsWith('fd');       // Unique Local Address — RFC4193 private network (IPv6 equivalent of 192.168.x.x)
    }
    return false; // not an IP literal (a hostname) — DNS-rebinding risk, handled at the network layer, not here
}

function isSafeProductUrl(value) {
    let url;
    try {
        url = new URL(value);
    } catch {
        return false;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const host = url.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 [] brackets
    if (host === 'localhost' || isPrivateOrReservedIp(host)) return false;
    return true;
}

// ─── Enums ────────────────────────────────────────────────────
export const KnowledgeSourceType = z.enum(['text', 'document', 'image', 'video', 'url', 'api']);
export const IngestionStatus = z.enum(['pending', 'processing', 'ready', 'failed']);
export const AgentStatus = z.enum(['draft', 'active', 'paused', 'archived']);
export const AvatarProvider = z.enum(['voice-only', 'tavus', 'simli', 'heygen', 'did']);
export const ScreenMode = z.enum(['none', 'guided-tour', 'customer-share']);

// ─── Auth ─────────────────────────────────────────────────────
export const RegisterInput = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().min(1)
});

export const LoginInput = z.object({
    email: z.string().email(),
    password: z.string().min(1)
});

// ─── Product ──────────────────────────────────────────────────
export const ProductInput = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    // Must be a public http(s) URL — the guided tour (@repo/screen) trusts
    // this as its navigation root, so file:/private-IP/cloud-metadata values
    // can't be allowed in at the source.
    websiteUrl: z.string().url().refine(isSafeProductUrl, {
        message: 'websiteUrl must be a public http(s) URL'
    }).optional(),
    // Sister/portfolio domains the guided tour is also allowed to visit.
    tourAllowedDomains: z.array(
        z.string().url().refine(isSafeProductUrl, {
            message: 'tourAllowedDomains entries must be public http(s) URLs'
        })
    ).default([])
});

// ─── Knowledge sources ────────────────────────────────────────
export const KnowledgeSourceInput = z.object({
    productId: z.string(),
    type: KnowledgeSourceType,
    title: z.string().optional(),
    // text content OR a storage/external reference depending on type
    content: z.string().optional(),
    fileKey: z.string().optional(),
    mimeType: z.string().optional(), // MIME type of the uploaded file (e.g. 'application/pdf')
    url: z.string().url().optional()
});

// ─── Agent persona / configuration ────────────────────────────
export const AgentConfigInput = z.object({
    productId: z.string(),
    name: z.string().min(1),
    persona: z
        .object({
            tone: z.string().default('friendly, expert, concise'),
            language: z.string().default('en'),
            goals: z.array(z.string()).default([]),
            guardrails: z.array(z.string()).default([])
        })
        .default({}),
    avatarProvider: AvatarProvider.default('voice-only'),
    screenModes: z.array(ScreenMode).default(['guided-tour', 'customer-share']),
    // optional live tool access to the seller's product
    toolAccess: z
        .object({
            enabled: z.boolean().default(false),
            baseUrl: z.string().url().optional(),
            openApiUrl: z.string().url().optional(),
            mcpUrl: z.string().url().optional()
        })
        .default({})
});

// ─── Realtime session ─────────────────────────────────────────
export const CreateSessionInput = z.object({
    shareToken: z.string(),
    visitorName: z.string().optional()
});

export const SessionToken = z.object({
    roomName: z.string(),
    token: z.string(),
    livekitUrl: z.string()
});

// ─── RAG retrieval ────────────────────────────────────────────
export const RetrievalQuery = z.object({
    productId: z.string(),
    query: z.string().min(1),
    topK: z.number().int().min(1).max(50).default(8)
});

export const RetrievedChunk = z.object({
    id: z.string(),
    sourceId: z.string(),
    text: z.string(),
    score: z.number(),
    metadata: z.record(z.unknown()).optional()
});
