/**
 * Field-level Envelope Encryption — Phase 8 Task 4.2
 *
 * Hassas veritabanı alanlarını (ör. toolAccess.baseUrl, apiKey) AES-256-GCM
 * ile şifreleyip saklarken daha güvenli bir katman ekler.
 *
 * Envelope Encryption Modeli:
 *   plaintext ──[DEK ile şifrele]──► ciphertext
 *   DEK       ──[KEK ile şifrele]──► encryptedDEK
 *   DB'ye kaydedilen: { iv, ciphertext, tag, encryptedDek }
 *
 * KEK (Key Encryption Key):
 *   FIELD_ENCRYPTION_KEY ortam değişkeninden gelir (hex, 64 karakter = 32 byte).
 *   Prod ortamında bu değer AWS Secrets Manager / Vault'tan sağlanır.
 *
 * DEV NOTU: FIELD_ENCRYPTION_KEY tanımlı değilse şifreleme atlanır
 * (plaintext olarak saklanır). Prod'da bu değer zorunludur.
 */

import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;   // GCM için önerilen 96 bit
const TAG_LENGTH = 16;  // Auth tag uzunluğu (bytes)

/**
 * Ortam değişkeninden KEK (Key Encryption Key) döndürür.
 * Tanımlı değilse null döner → şifreleme atlanır (dev mode).
 * @returns {Buffer|null}
 */
function getKek() {
    const raw = process.env.FIELD_ENCRYPTION_KEY;
    if (!raw) return null;
    const buf = Buffer.from(raw, 'hex');
    if (buf.length !== 32) {
        throw new Error('FIELD_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
    }
    return buf;
}

/**
 * Boş veya null değeri tespit eder.
 * @param {*} value
 * @returns {boolean}
 */
function isEmpty(value) {
    return value === null || value === undefined || value === '';
}

/**
 * Bir DEK (Data Encryption Key) ile plaintext'i AES-256-GCM ile şifreler.
 * @param {string} plaintext
 * @param {Buffer} dek - 32 byte data encryption key
 * @returns {{ iv: string, ciphertext: string, tag: string }}
 */
function aesEncrypt(plaintext, dek) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, dek, iv, { authTagLength: TAG_LENGTH });
    const encrypted = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final()
    ]);
    const tag = cipher.getAuthTag();
    return {
        iv: iv.toString('hex'),
        ciphertext: encrypted.toString('hex'),
        tag: tag.toString('hex')
    };
}

/**
 * AES-256-GCM ile şifrelenmiş veriyi çözer.
 * @param {{ iv: string, ciphertext: string, tag: string }} encData
 * @param {Buffer} dek
 * @returns {string} plaintext
 */
function aesDecrypt(encData, dek) {
    const decipher = crypto.createDecipheriv(
        ALGORITHM,
        dek,
        Buffer.from(encData.iv, 'hex'),
        { authTagLength: TAG_LENGTH }
    );
    decipher.setAuthTag(Buffer.from(encData.tag, 'hex'));
    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(encData.ciphertext, 'hex')),
        decipher.final()
    ]);
    return decrypted.toString('utf8');
}

/**
 * Bir alanı envelope encryption ile şifreler.
 *
 * FIELD_ENCRYPTION_KEY tanımlı değilse → plaintext olarak döner (dev mode).
 * Boş string veya null → olduğu gibi döner.
 *
 * @param {string} plaintext - Şifrelenecek değer
 * @returns {string} - JSON string (şifrelenmiş) veya orijinal plaintext (dev mode)
 */
export function encryptField(plaintext) {
    if (isEmpty(plaintext)) return plaintext;

    const kek = getKek();
    if (!kek) {
        // Dev modunda şifreleme yoktur — prod'da FIELD_ENCRYPTION_KEY zorunlu
        return plaintext;
    }

    // Rastgele DEK üret
    const dek = crypto.randomBytes(32);

    // Plaintext'i DEK ile şifrele
    const dataEnc = aesEncrypt(plaintext, dek);

    // DEK'i KEK ile şifrele (wrap)
    const dekEnc = aesEncrypt(dek.toString('hex'), kek);

    return JSON.stringify({
        __encrypted: true,
        version: 1,
        data: dataEnc,
        dek: dekEnc
    });
}

/**
 * encryptField() ile şifrelenmiş bir alanı çözer.
 *
 * Şifreli değilse (plaintext veya dev mod) → olduğu gibi döner.
 * Boş string veya null → olduğu gibi döner.
 *
 * @param {string} encryptedJson - encryptField() çıktısı veya plaintext
 * @returns {string} - Çözülmüş plaintext
 */
export function decryptField(encryptedJson) {
    if (isEmpty(encryptedJson)) return encryptedJson;

    // Şifreli mi kontrol et
    let parsed;
    try {
        parsed = JSON.parse(encryptedJson);
    } catch {
        // JSON değil → plaintext (dev mod veya eski veri)
        return encryptedJson;
    }

    if (!parsed?.__encrypted) {
        // Şifreli format değil → plaintext
        return encryptedJson;
    }

    const kek = getKek();
    if (!kek) {
        throw new Error('FIELD_ENCRYPTION_KEY required to decrypt field but not set');
    }

    // DEK'i çöz
    const dekHex = aesDecrypt(parsed.dek, kek);
    const dek = Buffer.from(dekHex, 'hex');

    // Plaintext'i çöz
    return aesDecrypt(parsed.data, dek);
}

/**
 * FIELD_ENCRYPTION_KEY ortam değişkeninin geçerli olup olmadığını kontrol eder.
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateEncryptionKey() {
    const raw = process.env.FIELD_ENCRYPTION_KEY;
    if (!raw) return { ok: true, reason: 'dev mode (no encryption)' };
    if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
        return { ok: false, reason: 'FIELD_ENCRYPTION_KEY must be 64 hex characters' };
    }
    return { ok: true };
}
