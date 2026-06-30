import { z } from 'zod';

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
    websiteUrl: z.string().url().optional()
});

// ─── Knowledge sources ────────────────────────────────────────
export const KnowledgeSourceInput = z.object({
    productId: z.string(),
    type: KnowledgeSourceType,
    title: z.string().optional(),
    // text content OR a storage/external reference depending on type
    content: z.string().optional(),
    fileKey: z.string().optional(),
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
