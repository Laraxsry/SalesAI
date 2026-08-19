import { KnowledgeSource, KnowledgeGapReport } from '@repo/database';
import { getLLM } from '@repo/ai';
import { publishEvent, RT_EVENTS } from '@repo/realtime';
import { Logger } from '@repo/logger';
import { mapWithConcurrency, chunk } from '@repo/utils';

/** Kaynak başına LLM'e verilen ham metnin karakter sınırı (maliyet kontrolü, map fazının girdisi). */
const EXCERPT_CHARS = Number(process.env.GAP_ANALYSIS_EXCERPT_CHARS || 1500);
/** Map fazı: bir grupta kaç kaynak birlikte özetlettirilir. */
const MAP_BATCH_SIZE = Number(process.env.GAP_ANALYSIS_MAP_BATCH_SIZE || 18);
/** Map fazı: kaç grup paralel LLM çağrısı aynı anda yapılır. */
const MAP_CONCURRENCY = Number(process.env.GAP_ANALYSIS_MAP_CONCURRENCY || 5);
/** Map fazı LLM çağrısı için timeout — bir grubun promptu (≤MAP_BATCH_SIZE kaynak) küçük ama getLLM()'in 10sn varsayılanından yine de cömert olmalı. */
const MAP_LLM_TIMEOUT_MS = Number(process.env.GAP_ANALYSIS_MAP_LLM_TIMEOUT_MS || 30_000);
/** Bir grubun LLM çağrısı başarısız olursa, o gruptaki her kaynak için ham excerpt'ten kaba bir fallback digest türetilir (kaynak reduce fazından hiç düşmesin diye) — bu fallback'in karakter sınırı. */
const FALLBACK_DIGEST_CHARS = 300;

/** Reduce fazı: en fazla kaç digest tek final çağrıya veriliyor — digest'ler ham excerpt'ten çok daha küçük olduğu için eski (tüm ham metni tek çağrıya sığdırmaya çalışan) yaklaşımdaki tavandan çok daha yüksek. */
const MAX_REDUCE_DIGESTS = Number(process.env.GAP_ANALYSIS_MAX_REDUCE_DIGESTS || 500);
/** Reduce fazı LLM çağrısı için timeout. */
const REDUCE_LLM_TIMEOUT_MS = Number(process.env.GAP_ANALYSIS_LLM_TIMEOUT_MS || 60_000);

/**
 * Map fazı: her kaynağın ham metnini (map-reduce'un "map" adımı olarak) kısa,
 * karşılaştırılabilir bir "olgu özeti"ne indirger — fiyat/adım/sayı/kural gibi
 * somut iddiaları koruyan, yorum İÇERMEYEN bir özet. Kaynaklar `MAP_BATCH_SIZE`'lık
 * gruplara bölünüp her grup PARALEL (bounded, `MAP_CONCURRENCY`) tek bir LLM
 * çağrısıyla özetleniyor — tüm kaynakların ham metnini TEK bir dev çağrıya
 * sıkıştırmak (eski yaklaşım) hem context/timeout sınırlarına takılıyordu hem
 * de kaynak sayısı arttıkça bazılarının analiz dışı bırakılmasını
 * gerektiriyordu (`truncated`). Digest'ler ham metinden çok daha küçük
 * olduğu için reduce fazı artık YÜZLERCE kaynağı tek çağrıda karşılaştırabiliyor.
 *
 * @param {{index:number, sourceId:string, title:string, type:string, excerpt:string}[]} allDigests
 * @returns {Promise<Map<number, string>>} index -> digest metni
 */
async function mapPhase(allDigests) {
    const batches = chunk(allDigests, MAP_BATCH_SIZE);
    const digestByIndex = new Map();

    const batchResults = await mapWithConcurrency(batches, MAP_CONCURRENCY, async (batch) => {
        const numbered = batch
            .map((d) => `[${d.index}] ${d.title} (${d.type})\n${d.excerpt || '(içerik boş)'}`)
            .join('\n\n');

        const systemPrompt = `Aşağıda numaralandırılmış birkaç knowledge kaynağının metni var. Her biri için, SOMUT OLGULARI (fiyat, adım, sayı, kural, kısıt gibi karşılaştırılabilir iddiaları) koruyan ama yorum eklemeyen, 2-4 cümlelik kısa bir özet çıkar. SADECE geçerli JSON ile cevap ver (markdown yok, açıklama yok).

JSON şu şemaya birebir uymalı:
{"digests": [{"index": N, "digest": "..."}]}

Kurallar:
- Her numara için tam olarak bir digest olmalı.
- Digest'ler Türkçe olmalı, kısa ve somut olmalı (genel geçer laf değil).`;

        try {
            const llm = getLLM(undefined, { timeoutMs: MAP_LLM_TIMEOUT_MS });
            const response = await llm.complete({
                model: 'gpt-4o-mini',
                system: systemPrompt,
                messages: [{ role: 'user', content: numbered }]
            });
            const parsed = JSON.parse(response.text);
            const byIndex = new Map(
                (Array.isArray(parsed.digests) ? parsed.digests : []).map((d) => [d.index, d.digest])
            );
            return batch.map((d) => ({ index: d.index, digest: byIndex.get(d.index) || null }));
        } catch (err) {
            Logger.warn('[analyze-knowledge-gaps] map grubu başarısız, ham metinden fallback digest kullanılıyor', {
                batchSize: batch.length,
                error: err?.message
            });
            return batch.map((d) => ({ index: d.index, digest: null }));
        }
    });

    for (const results of batchResults) {
        for (const { index, digest } of results) {
            if (digest) {
                digestByIndex.set(index, digest);
            } else {
                // Grup başarısız oldu veya bu kaynak için digest üretilmedi —
                // kaynak reduce fazından hiç düşmesin diye ham excerpt'ten
                // kaba bir fallback kullanılıyor (kalite düşük ama kayıp yok).
                const source = allDigests.find((d) => d.index === index);
                digestByIndex.set(index, (source?.excerpt || '').slice(0, FALLBACK_DIGEST_CHARS));
            }
        }
    }

    return digestByIndex;
}

/**
 * Reduce fazı: map fazının ürettiği (küçük) digest'lerin TAMAMINI tek bir
 * final LLM çağrısına verip asıl GAP analizini (tutarsızlık/yetersiz-detay/
 * eksik-konu) yaptırır — tüm kaynaklar aynı anda görüldüğü için çapraz
 * karşılaştırma (map fazında YOK, orada her kaynak bağımsız özetleniyor)
 * sadece burada, tam görünürlükle yapılıyor.
 *
 * @param {{index:number, title:string, type:string, digest:string}[]} digests
 * @returns {Promise<{inconsistencies:any[], thin:any[], missing:any[]}>}
 */
async function reducePhase(digests) {
    const numbered = digests.map((d) => `[${d.index}] ${d.title} (${d.type})\n${d.digest}`).join('\n\n');

    const systemPrompt = `Bir satış AI asistanının bilgi tabanını denetleyen uzman bir analistsin. Aşağıda numaralandırılmış, bir ürüne ait TÜM knowledge kaynaklarının olgu özetleri var. Bunları birbiriyle karşılaştırıp SADECE geçerli JSON ile cevap ver (markdown yok, açıklama yok).

JSON şu şemaya birebir uymalı:
{
  "inconsistencies": [{"title": "kısa başlık", "description": "iki veya daha fazla kaynağın birbiriyle nasıl çeliştiğinin açıklaması", "sourceIndexes": [1, 3]}],
  "thin": [{"title": "kısa başlık", "description": "bir ziyaretçinin sorma ihtimali yüksek ama yüzeysel/eksik detaylı kalmış bir konunun açıklaması", "sourceIndexes": [2]}],
  "missing": [{"title": "kısa başlık", "description": "hiçbir kaynakta hiç bahsedilmemiş ama satış bağlamında beklenen bir konunun açıklaması"}]
}

Kurallar:
- "sourceIndexes" SADECE yukarıda verilen numaralardan oluşmalı (gerçek ID değil).
- "missing" bulgularında sourceIndexes alanını hiç ekleme veya boş dizi bırak — tanım gereği hiçbir kaynakta yok.
- Gerçekten emin olmadığın, zorlama/önemsiz bulguları ekleme — az ama isabetli bulgu, çok ama gürültülü bulgudan iyidir.
- Hiç bulgu yoksa ilgili diziyi boş bırak.
- Tüm başlık/açıklama metinlerini TÜRKÇE yaz.`;

    const llm = getLLM(undefined, { timeoutMs: REDUCE_LLM_TIMEOUT_MS });
    const response = await llm.complete({
        model: 'gpt-4o-mini',
        system: systemPrompt,
        messages: [{ role: 'user', content: numbered }]
    });
    return JSON.parse(response.text);
}

/**
 * Bir ürünün TÜM knowledge kaynaklarını (text/document/image/video/url/api)
 * map-reduce ile karşılaştırıp tutarsızlık/yetersiz-detay/eksik-konu
 * bulguları üretir:
 *  1. Map: her kaynak (gruplar hâlinde, paralel) kısa bir olgu özetine indirgenir.
 *  2. Reduce: TÜM özetler tek bir final çağrıda karşılaştırılır.
 * Bu, tek bir dev LLM çağrısına tüm ham metni sığdırmaya çalışmanın (eski
 * yaklaşım) context/timeout sınırlarına takılıp bazı kaynakları analiz dışı
 * bırakmasını önlerken, kaynakları TEK TEK (bağlamsız) analiz etmenin
 * çapraz-karşılaştırma yeteneğini kaybetmesini de önlüyor — karşılaştırma
 * sadece reduce fazında, TÜM kaynaklar aynı anda görülerek yapılıyor.
 *
 * `analyze-session.js`'le aynı genel kalıp: ucuz model, katı JSON şema
 * promptu, hata durumunda `status:'failed'` (asla asılı kalmaz), Socket.IO
 * ile non-fatal bildirim.
 *
 * `resolveKnowledgeLanguage()` KULLANILMIYOR — bu rapor ürünün ziyaretçiye
 * dönük diline değil, Console'un kendi diline (Türkçe) bağlı; satış
 * ekibine yönelik bir iç araç.
 *
 * @param {{ reportId: string, productId: string }} data
 */
export async function analyzeKnowledgeGaps({ reportId, productId }) {
    Logger.info('[analyze-knowledge-gaps] başlıyor', { reportId, productId });

    try {
        // zip container satırlarının kendi içeriği yok (her dosyası ayrı bir
        // çocuk KnowledgeSource) — meta.zipSummary bunun işareti, hariç tutuluyor.
        const allSources = await KnowledgeSource.find({ productId, status: 'ready' })
            .select('title type content meta updatedAt')
            .sort({ updatedAt: -1 })
            .lean();
        const sources = allSources.filter((s) => !s.meta?.zipSummary);

        if (!sources.length) {
            await KnowledgeGapReport.findByIdAndUpdate(reportId, {
                status: 'ready',
                sourceCount: 0,
                truncated: false,
                findings: []
            });
            Logger.info('[analyze-knowledge-gaps] analiz edilecek kaynak yok', { reportId, productId });
            return;
        }

        const allDigestInputs = sources.map((s, i) => ({
            index: i + 1,
            sourceId: String(s._id),
            title: s.title || `(başlıksız #${i + 1})`,
            type: s.type,
            excerpt: (s.meta?.extractedText || s.content || '').slice(0, EXCERPT_CHARS)
        }));

        let parsed;
        let selected;
        let truncated;
        try {
            const digestByIndex = await mapPhase(allDigestInputs);

            const withDigests = allDigestInputs.map((d) => ({ ...d, digest: digestByIndex.get(d.index) || '' }));
            truncated = withDigests.length > MAX_REDUCE_DIGESTS;
            selected = truncated ? withDigests.slice(0, MAX_REDUCE_DIGESTS) : withDigests;

            parsed = await reducePhase(selected);
        } catch (err) {
            Logger.error('[analyze-knowledge-gaps] LLM analizi başarısız', { reportId, error: err?.message });
            await KnowledgeGapReport.findByIdAndUpdate(reportId, {
                status: 'failed',
                error: err?.message || 'LLM analizi başarısız'
            });
            return;
        }

        const indexToSourceId = new Map(allDigestInputs.map((d) => [d.index, d.sourceId]));
        const mapIndexes = (indexes) =>
            (Array.isArray(indexes) ? indexes : [])
                .map((i) => indexToSourceId.get(i))
                .filter(Boolean);

        const findings = [
            ...(Array.isArray(parsed.inconsistencies) ? parsed.inconsistencies : []).map((f) => ({
                type: 'inconsistency',
                title: f.title || '',
                description: f.description || '',
                sourceIds: mapIndexes(f.sourceIndexes)
            })),
            ...(Array.isArray(parsed.thin) ? parsed.thin : []).map((f) => ({
                type: 'thin',
                title: f.title || '',
                description: f.description || '',
                sourceIds: mapIndexes(f.sourceIndexes)
            })),
            ...(Array.isArray(parsed.missing) ? parsed.missing : []).map((f) => ({
                type: 'missing',
                title: f.title || '',
                description: f.description || '',
                sourceIds: []
            }))
        ].filter((f) => f.title && f.description);

        await KnowledgeGapReport.findByIdAndUpdate(reportId, {
            status: 'ready',
            sourceCount: selected.length,
            truncated,
            findings
        });

        Logger.info('[analyze-knowledge-gaps] rapor kaydedildi', {
            reportId,
            productId,
            sourceCount: selected.length,
            truncated,
            findingCount: findings.length
        });

        try {
            await publishEvent(RT_EVENTS.GAP_REPORT_READY, { reportId, productId, status: 'ready' });
        } catch (err) {
            Logger.warn('[analyze-knowledge-gaps] publishEvent başarısız (non-fatal)', { error: err?.message });
        }
    } catch (err) {
        Logger.error('[analyze-knowledge-gaps] beklenmeyen hata', { reportId, productId, error: err?.message });
        await KnowledgeGapReport.findByIdAndUpdate(reportId, {
            status: 'failed',
            error: err?.message || 'Beklenmeyen hata'
        }).catch(() => {});
        await publishEvent(RT_EVENTS.GAP_REPORT_READY, { reportId, productId, status: 'failed' }).catch(() => {});
    }
}
