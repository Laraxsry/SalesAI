import { Schema, model } from 'mongoose';
import crypto from 'node:crypto';

/**
 * Phase 8 Task 4.2: Field-level AES-256-GCM Envelope Encryption
 *
 * @repo/database → @repo/utils circular import'u önlemek için
 * encryption logic burada inline edilmiştir.
 *
 * FIELD_ENCRYPTION_KEY tanımlı değilse (dev mod) şifreleme atlanır.
 */
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKek() {
    const raw = process.env.FIELD_ENCRYPTION_KEY;
    if (!raw) return null;
    const buf = Buffer.from(raw, 'hex');
    if (buf.length !== 32) return null; // Geçersiz key — sessizce atla
    return buf;
}

function _aesEncrypt(plaintext, key) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return { iv: iv.toString('hex'), ciphertext: enc.toString('hex'), tag: cipher.getAuthTag().toString('hex') };
}

function _aesDecrypt(encData, key) {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(encData.iv, 'hex'), { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(Buffer.from(encData.tag, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(encData.ciphertext, 'hex')), decipher.final()]).toString('utf8');
}

/**
 * Hassas alan için setter — DB'ye yazmadan önce şifreler.
 * FIELD_ENCRYPTION_KEY yoksa dev modunda plaintext döner.
 */
function encryptSetter(val) {
    if (val === null || val === undefined || val === '') return val;
    try {
        const kek = getKek();
        if (!kek) return val; // dev mod
        const dek = crypto.randomBytes(32);
        const dataEnc = _aesEncrypt(val, dek);
        const dekEnc = _aesEncrypt(dek.toString('hex'), kek);
        return JSON.stringify({ __encrypted: true, version: 1, data: dataEnc, dek: dekEnc });
    } catch {
        return val; // Hata durumunda plaintext'e geri dön
    }
}

/**
 * Hassas alan için getter — DB'den okurken çözer.
 * Şifrelenmemiş veya bozuk değerlerde olduğu gibi döner.
 */
function decryptGetter(val) {
    if (val === null || val === undefined || val === '') return val;
    try {
        let parsed;
        try { parsed = JSON.parse(val); } catch { return val; }
        if (!parsed?.__encrypted) return val;
        const kek = getKek();
        if (!kek) return val;
        const dekHex = _aesDecrypt(parsed.dek, kek);
        const dek = Buffer.from(dekHex, 'hex');
        return _aesDecrypt(parsed.data, dek);
    } catch {
        return val;
    }
}

const AgentSchema = new Schema(
    {
        productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
        name: { type: String, required: true },
        status: {
            type: String,
            enum: ['draft', 'active', 'paused', 'archived'],
            default: 'draft',
            index: true
        },
        persona: {
            tone: { type: String, default: 'friendly, expert, concise' },
            language: { type: String, default: 'en' },
            goals: { type: [String], default: [] },
            guardrails: { type: [String], default: [] }
        },
        avatarProvider: {
            type: String,
            enum: ['voice-only', 'tavus', 'simli', 'heygen', 'did'],
            default: 'voice-only'
        },
        screenModes: {
            type: [String],
            enum: ['none', 'guided-tour', 'customer-share'],
            default: ['guided-tour', 'customer-share']
        },
        toolAccess: {
            enabled: { type: Boolean, default: false },
            // Phase 8 Task 4.2: Hassas alanlar at-rest şifreleme ile korunur.
            // FIELD_ENCRYPTION_KEY ayarlanmışsa AES-256-GCM envelope encryption.
            baseUrl: {
                type: String,
                set: encryptSetter,
                get: decryptGetter
            },
            openApiUrl: {
                type: String,
                set: encryptSetter,
                get: decryptGetter
            },
            mcpUrl: {
                type: String,
                set: encryptSetter,
                get: decryptGetter
            }
        },
        // Phase 8: PII & Data Retention
        // false (varsayılan): transcript PII-redacted olarak saklanır (GDPR uyumu)
        // true: ham transcript saklanır (workspace OWNER/ADMIN onayı gerektirir)
        rawTranscriptEnabled: { type: Boolean, default: false }
    },
    {
        timestamps: true,
        // Getter'ların JSON.stringify / toObject'te görünmesi için
        toJSON: { getters: true },
        toObject: { getters: true }
    }
);

export const Agent = model('Agent', AgentSchema);


