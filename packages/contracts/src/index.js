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

// ─── Integrations / Webhooks ──────────────────────────────────
// Supported event types for webhook filtering
export const WEBHOOK_EVENTS = /** @type {const} */ ([
    'lead.captured',
    'session.started',
    'session.ended',
    'session.summary'
]);

export const WebhookInput = z.object({
    /** Public HTTPS endpoint. Private/loopback IPs are blocked (SSRF guard). */
    url: z.string().url().refine(isSafeProductUrl, {
        message: 'url must be a public http(s) URL (no private IPs or localhost)'
    }),
    /** Optional custom HMAC-SHA256 signing secret. Auto-generated if omitted. */
    secret: z.string().min(8).optional(),
    /** Specific event types to subscribe to. Empty array = subscribe to all. */
    events: z.array(z.enum(WEBHOOK_EVENTS)).default([]),
    active: z.boolean().default(true)
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

/**
 * Partial update schema for PATCH /agents/:id.
 * All fields optional — only provided fields are updated.
 */
export const AgentUpdateInput = z.object({
    name: z.string().min(1).optional(),
    persona: z
        .object({
            tone: z.string().optional(),
            language: z.string().optional(),
            goals: z.array(z.string()).optional(),
            guardrails: z.array(z.string()).optional()
        })
        .optional(),
    avatarProvider: AvatarProvider.optional(),
    screenModes: z.array(ScreenMode).optional(),
    toolAccess: z
        .object({
            enabled: z.boolean().optional(),
            baseUrl: z.string().url().optional(),
            openApiUrl: z.string().url().optional(),
            mcpUrl: z.string().url().optional()
        })
        .optional()
}).refine(data => Object.keys(data).length > 0, {
    message: 'En az bir alan güncellenmeli'
});

/**
 * Partial update schema for PATCH /products/:id.
 * All fields optional — only provided fields are updated.
 */
export const ProductUpdateInput = z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    websiteUrl: z.string().url().refine(isSafeProductUrl, {
        message: 'websiteUrl must be a public http(s) URL'
    }).optional(),
    tourAllowedDomains: z.array(
        z.string().url().refine(isSafeProductUrl, {
            message: 'tourAllowedDomains entries must be public http(s) URLs'
        })
    ).optional()
}).refine(data => Object.keys(data).length > 0, {
    message: 'En az bir alan güncellenmeli'
});

// ─── Realtime session ─────────────────────────────────────────
export const AuthMaterial = z.object({
    cookies: z.array(z.any()).optional(),
    localStorage: z.record(z.string()).optional()
});

export const CreateSessionInput = z.object({
    shareToken: z.string(),
    visitorName: z.string().optional(),
    transientAuth: AuthMaterial.optional()
});

// Body for POST /embed/:token/session — the share token itself travels in the
// URL (set by the origin-checked embed route), not in the body.
export const EmbedSessionInput = z.object({
    visitorName: z.string().optional(),
    // The loader knows its own SPA route better than the Referer header does;
    // still optional since a plain page load has nothing more specific to send.
    pageUrl: z.string().url().optional(),
    transientAuth: AuthMaterial.optional()
});

export const SessionToken = z.object({
    roomName: z.string(),
    token: z.string(),
    livekitUrl: z.string()
});

// ─── Embed widget (Phase 5) ───────────────────────────────────

const HOSTNAME_LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/**
 * True if `value` is a valid embed-domain pattern: a lowercase hostname with
 * an optional leading `*.` wildcard (e.g. `acme.com`, `*.acme.com`).
 *
 * Deliberately rejects IP literals — the allowlist names *who the seller is*
 * (their web properties), and legitimate customer sites are reached by name,
 * not by address. Accepting IPs would only widen the surface the runtime
 * origin check has to reason about. Single-label hosts (`localhost`) are
 * valid *patterns* so dev setups can be stored; whether localhost is honoured
 * at request time is the origin middleware's call (dev only, per the md).
 */
export function isValidEmbedDomainPattern(value) {
    if (typeof value !== 'string') return false;
    const host = value.startsWith('*.') ? value.slice(2) : value;
    if (!host || host.length > 253) return false;
    if (isIP(host) !== 0) return false;
    return host.split('.').every((label) => label.length <= 63 && HOSTNAME_LABEL.test(label));
}

/**
 * True if `hostname` (from a request's Origin header, already parsed and
 * lowercased by the caller) is covered by allowlist `pattern`.
 *
 * Exact patterns match only themselves. Wildcard patterns match subdomains
 * only — `*.acme.com` covers `app.acme.com` but neither the apex `acme.com`
 * (sellers add both entries when they want both) nor lookalikes like
 * `evilacme.com`: the comparison keeps the leading dot of the suffix, so a
 * hostname can't satisfy it without a real label boundary.
 */
export function matchesEmbedDomain(hostname, pattern) {
    if (typeof hostname !== 'string' || !isValidEmbedDomainPattern(pattern)) return false;
    const host = hostname.toLowerCase();
    if (pattern.startsWith('*.')) {
        const suffix = pattern.slice(1); // '.acme.com' — dot kept on purpose
        return host.length > suffix.length && host.endsWith(suffix);
    }
    return host === pattern;
}

export const EmbedDomainPattern = z
    .string()
    .trim()
    .toLowerCase()
    .refine(isValidEmbedDomainPattern, {
        message: 'must be a hostname, optionally with a leading *. wildcard (e.g. acme.com, *.acme.com)'
    });

export const EmbedConfigInput = z.object({
    theme: z
        .object({
            primaryColor: z
                .string()
                .regex(/^#[0-9a-f]{6}$/i, 'must be a #rrggbb hex color')
                .default('#4f46e5'),
            mode: z.enum(['light', 'dark', 'auto']).default('auto')
        })
        .default({}),
    launcher: z
        .object({
            position: z.enum(['bottom-right', 'bottom-left']).default('bottom-right'),
            label: z.string().min(1).max(40).default('Talk to sales')
        })
        .default({}),
    greeting: z.string().max(300).optional(),
    micAutoPrompt: z.boolean().default(false),
    rateCaps: z
        .object({
            sessionsPerIpPerHour: z.number().int().min(1).max(1000).default(6),
            sessionsPerOriginPerHour: z.number().int().min(1).max(10000).default(60)
        })
        .default({}),
    domains: z.array(EmbedDomainPattern).max(20).default([])
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
