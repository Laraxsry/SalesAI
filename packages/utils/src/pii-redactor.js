/**
 * PII Redactor — Phase 8 Task 2.1
 *
 * Transcript metinlerinden kişisel tanımlayıcı bilgileri (PII) kaldırır.
 * Varsayılan olarak tüm agent transcript'lerine uygulanır; rawTranscriptEnabled:true
 * olan agent'larda atlanır (bkz. Agent modeli).
 *
 * Kapsanan PII türleri:
 * - Email adresleri
 * - Türkiye formatında telefon numaraları (+90 veya 05xx)
 * - Uluslararası telefon numaraları
 * - Kredi/banka kartı numaraları (16 hane, boşluklu veya tireli)
 * - TC Kimlik numaraları (11 hane sayı)
 * - IBAN numaraları
 *
 * Güvenlik notu: Bu regex tabanlı redaction, açık metin PII'yı yakalar.
 * "Benim telefon numaram elli olarak başlıyor" gibi sözel ifadeler yakalanmaz —
 * bu LLM classifier'ın kapsamında olacak (Phase 8+ iyileştirme).
 */

const PII_PATTERNS = [
    // Email adresleri
    {
        name: 'email',
        pattern: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
        replacement: '[REDACTED-EMAIL]'
    },
    // Türkiye telefon: +90 5xx veya 05xx formatları
    {
        name: 'phone_tr',
        pattern: /(\+90|0)[\s\-]?5\d{2}[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/g,
        replacement: '[REDACTED-PHONE]'
    },
    // Uluslararası telefon numaraları (+XX ile başlayan)
    {
        name: 'phone_intl',
        pattern: /\+\d{1,3}[\s\-]?\(?\d{1,4}\)?[\s\-]?\d{1,4}[\s\-]?\d{1,9}/g,
        replacement: '[REDACTED-PHONE]'
    },
    // Kredi kartı numaraları (16 hane, boşluklu veya tireli gruplar)
    {
        name: 'credit_card',
        pattern: /\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/g,
        replacement: '[REDACTED-CARD]'
    },
    // TC Kimlik Numarası (11 haneli, 0 ile başlamaz)
    {
        name: 'tcno',
        pattern: /\b[1-9]\d{10}\b/g,
        replacement: '[REDACTED-ID]'
    },
    // IBAN (TR ile başlayan)
    {
        name: 'iban',
        pattern: /\bTR\d{2}[\s]?\d{4}[\s]?\d{4}[\s]?\d{4}[\s]?\d{4}[\s]?\d{4}[\s]?\d{2}\b/gi,
        replacement: '[REDACTED-IBAN]'
    }
];

/**
 * Verilen metinden PII pattern'lerini redact eder.
 *
 * @param {string} text - Redact edilecek metin
 * @returns {string} - PII'lar [REDACTED-TYPE] ile değiştirilmiş metin
 */
export function redactPII(text) {
    if (!text || typeof text !== 'string') return text;

    let result = text;
    for (const { pattern, replacement } of PII_PATTERNS) {
        // Her pattern için yeni bir RegExp instance oluştur (global flag stateful)
        result = result.replace(new RegExp(pattern.source, pattern.flags), replacement);
    }
    return result;
}

/**
 * Birden fazla alanı içeren bir nesnenin belirtilen string alanlarını redact eder.
 *
 * @param {object} obj - Kaynak nesne
 * @param {string[]} fields - Redact edilecek alan isimleri
 * @returns {object} - Aynı nesne; belirtilen alanlar redact edilmiş
 */
export function redactFields(obj, fields) {
    if (!obj || typeof obj !== 'object') return obj;
    const result = { ...obj };
    for (const field of fields) {
        if (typeof result[field] === 'string') {
            result[field] = redactPII(result[field]);
        }
    }
    return result;
}
