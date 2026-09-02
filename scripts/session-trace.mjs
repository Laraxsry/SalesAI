#!/usr/bin/env node
/**
 * Bir oturumu baştan sona, kronolojik olarak yeniden kurar.
 *
 *   node scripts/session-trace.mjs <sessionId | roomName>
 *   node scripts/session-trace.mjs --last          # en son oturum
 *   node scripts/session-trace.mjs --last --json   # ham JSON (agent'lar için)
 *
 * Neden var: canlı bir seansta ne olduğunu anlamak, terminal logunu elle
 * okuyup DB'deki mesajlarla zaman damgası eşleştirmeyi gerektiriyordu ve iki
 * kaynak da tek başına eksikti. `SessionEvent` artık hepsini tek sıralı akışa
 * yazıyor (apps/agent-worker/src/session-timeline.js); bu betik onu okunur
 * hale getiriyor — hem insan için hizalı metin, hem `--json` ile başka bir
 * agent'ın doğrudan yutabileceği yapı.
 *
 * Salt okunur: hiçbir şey yazmaz, değiştirmez, silmez.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(here, '..', '.env') });

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const wantLast = args.includes('--last');
const target = args.find((a) => !a.startsWith('--'));

if (!target && !wantLast) {
    console.error('kullanım: node scripts/session-trace.mjs <sessionId | roomName> | --last [--json]');
    process.exit(1);
}

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) {
    console.error('MONGODB_URI tanımlı değil (.env)');
    process.exit(1);
}

await mongoose.connect(uri);
const db = mongoose.connection.db;

// sessionId ya da roomName kabul ediyoruz: elde hangisi varsa o çalışsın —
// paylaşılan bir seans linkinden çıkan şey roomName, loglardan çıkan şey
// sessionId, ve ikisini elle çevirmek her seferinde ekstra bir sorgu demekti.
let session;
if (wantLast) {
    session = await db.collection('sessions').find({}).sort({ startedAt: -1 }).limit(1).next();
} else if (mongoose.Types.ObjectId.isValid(target)) {
    session = await db.collection('sessions').findOne({ _id: new mongoose.Types.ObjectId(target) });
}
if (!session) {
    session = await db.collection('sessions').findOne({ roomName: target });
}

if (!session) {
    console.error(`oturum bulunamadı: ${target ?? '--last'}`);
    await mongoose.disconnect();
    process.exit(1);
}

const events = await db
    .collection('sessionevents')
    .find({ sessionId: session._id })
    .sort({ seq: 1 })
    .toArray();

if (asJson) {
    console.log(JSON.stringify({ session, events }, null, 2));
    await mongoose.disconnect();
    process.exit(0);
}

const durationMs = session.endedAt && session.startedAt
    ? new Date(session.endedAt) - new Date(session.startedAt)
    : null;

console.log('═'.repeat(100));
console.log(`OTURUM  ${session._id}   oda=${session.roomName}   durum=${session.status}`);
console.log(`başlangıç=${session.startedAt?.toISOString?.() ?? '-'}   süre=${durationMs !== null ? (durationMs / 1000).toFixed(1) + 's' : '-'}`);
console.log('═'.repeat(100));

if (events.length === 0) {
    console.log('\nBu oturum için hiç SessionEvent yok.');
    console.log('Muhtemel sebep: oturum, uçtan uca zaman çizelgesi eklenmeden önce yapıldı.');
    console.log('(bkz. apps/agent-worker/src/session-timeline.js)\n');
    await mongoose.disconnect();
    process.exit(0);
}

/** `t` (ms) → okunabilir göreli zaman. Mutlak saatten çok daha kullanışlı:
 *  hata ayıklarken sorulan şey "kaçıncı saniyede" oluyor. */
function rel(t) {
    const s = t / 1000;
    return `${s.toFixed(2)}s`.padStart(9);
}

/** Olayın hangi alandan geldiğini tek bakışta ayırt etmek için — uzun bir
 *  akışta göz, ada değil hizaya/işarete tutunuyor. */
const MARK = {
    session: '◆',
    media: '🎙',
    speech: '💬',
    playbook: '▶',
    screen: '🖥',
    tool: '🔧'
};

for (const ev of events) {
    const domain = ev.type.split('.')[0];
    const mark = MARK[domain] ?? '·';
    const dur = ev.durationMs !== undefined && ev.durationMs !== null ? ` (${ev.durationMs}ms)` : '';

    // En anlamlı alanı öne çıkar; geri kalanı kompakt bir kuyrukta bırak.
    const m = ev.meta ?? {};
    let headline = '';
    if (m.text) headline = `"${m.text}"`;
    else if (m.directive) headline = `direktif="${m.directive}"`;
    else if (m.url) headline = m.url;
    else if (m.tool) headline = `${m.tool}${m.args ? ' ' + JSON.stringify(m.args) : ''}`;
    else if (m.from || m.to) headline = `${m.from} → ${m.to}`;

    const rest = Object.entries(m)
        .filter(([k]) => !['text', 'directive', 'url', 'tool', 'args', 'from', 'to', 'nodes'].includes(k))
        .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join(' ');

    console.log(`${rel(ev.t)}  ${mark} ${ev.type.padEnd(30)}${dur}  ${headline}`);
    if (rest) console.log(`${' '.repeat(11)}   ${' '.repeat(30)}  ${rest}`);

    // Playbook planı bir kez, en başta, açıkça dökülür: sonraki her node
    // olayı yalnızca id/order taşıyor.
    if (Array.isArray(m.nodes)) {
        for (const n of m.nodes) {
            console.log(`${' '.repeat(13)}   ${String(n.order).padStart(2)}. [${n.mode}] ${n.directive}`);
            if (n.url) console.log(`${' '.repeat(13)}       → ${n.url}`);
            if (n.attach) console.log(`${' '.repeat(13)}       ⚙ ${n.attach}`);
        }
    }
}

console.log('═'.repeat(100));

// Sık sorulan iki soruyu, akışı baştan okumaya gerek kalmadan yanıtlar.
const emptyExits = events.filter((e) => e.type === 'playbook.node.exit' && e.meta?.empty);
const ignored = events.filter((e) => e.type === 'playbook.advance.ignored');
const errors = events.filter((e) => e.type === 'session.error');
const agentTurns = events.filter((e) => e.type === 'speech.transcript.agent');
const submittedTourFrames = events.filter((e) => e.type === 'screen.tour.frame.submitted');
const tourFrameIssues = events.filter((e) => [
    'screen.tour.frame.failed',
    'screen.tour.frame.stale',
    'screen.tour.frame.superseded',
    'screen.tour.frame.abandoned'
].includes(e.type));

console.log(`olay=${events.length}  ajan-turu=${agentTurns.length}  hata=${errors.length}`);
if (emptyExits.length) {
    console.log(`⚠  hiç konuşulmadan kapanan node: ${emptyExits.map((e) => e.meta.order).join(', ')}`);
}
if (ignored.length) {
    console.log(`⚠  yok sayılan ilerleme sinyali: ${ignored.length} (node ${ignored.map((e) => e.meta.order).join(', ')})`);
}
if (submittedTourFrames.length) {
    const deliveryTimes = submittedTourFrames
        .map((event) => event.meta?.readyToFrameMs)
        .filter((value) => Number.isFinite(value));
    const average = deliveryTimes.length
        ? Math.round(deliveryTimes.reduce((sum, value) => sum + value, 0) / deliveryTimes.length)
        : null;
    const slowest = deliveryTimes.length ? Math.max(...deliveryTimes) : null;
    console.log(
        `🖥  tur karesi teslimi: ${submittedTourFrames.length}` +
        `${average !== null ? `  ready→VideoSource ort=${average}ms en-yavaş=${slowest}ms` : ''}`
    );
}
if (tourFrameIssues.length) {
    const countsByType = tourFrameIssues.reduce((counts, event) => {
        counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
        return counts;
    }, new Map());
    console.log(`⚠  tur karesi sorunları: ${[...countsByType.entries()]
        .map(([type, count]) => `${type}=${count}`)
        .join(' ')}`);
}

// Aynı cümlenin tekrarı — bu projede defalarca canlı gözlendi, elle saymak
// yerine doğrudan raporlanıyor.
const counts = new Map();
for (const e of agentTurns) {
    const key = (e.meta?.text ?? '').trim();
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
}
const repeats = [...counts.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
if (repeats.length) {
    console.log('⚠  tekrarlanan ajan cümleleri:');
    for (const [text, n] of repeats) {
        console.log(`     ${n}×  "${text.slice(0, 90)}${text.length > 90 ? '…' : ''}"`);
    }
}
console.log('═'.repeat(100));

await mongoose.disconnect();
