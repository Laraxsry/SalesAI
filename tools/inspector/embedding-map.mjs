#!/usr/bin/env node
/**
 * Embedding map: reads one product's knowledge chunks from MongoDB (READ ONLY)
 * and writes a single self-contained HTML file with an interactive 3D map.
 *
 *   node tools/inspector/embedding-map.mjs --list
 *   node tools/inspector/embedding-map.mjs                  (every product, picked in the page)
 *   node tools/inspector/embedding-map.mjs --product <productId> [--limit 1500]
 *       [--text-max 600] [--neighbors 5] [--out tools/inspector/out/map.html]
 *
 * Nothing in apps/ or packages/ imports this file, and it never writes to the
 * database. The 3D coordinates are a PCA projection (an approximation, shown
 * in the page together with the variance it keeps); the neighbour scores are
 * exact cosine similarities in the original embedding space.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
try { process.loadEnvFile(resolve(ROOT, '.env')); } catch { /* env may come from the shell */ }

const { connectDB, disconnectDB, KnowledgeChunk, KnowledgeSource, KnowledgeTopic, Product } =
    await import('@repo/database');

function parseArgs(argv) {
    const args = { limit: 1500, textMax: 600, neighbors: 5, out: null, product: null, list: false };
    for (let i = 0; i < argv.length; i++) {
        const key = argv[i];
        if (key === '--list') args.list = true;
        else if (key === '--product') args.product = argv[++i];
        else if (key === '--limit') args.limit = Number(argv[++i]);
        else if (key === '--text-max') args.textMax = Number(argv[++i]);
        else if (key === '--neighbors') args.neighbors = Number(argv[++i]);
        else if (key === '--out') args.out = argv[++i];
        else throw new Error(`Unknown argument: ${key}`);
    }
    return args;
}

// ---- math ------------------------------------------------------------------

/** Top-3 principal components by power iteration with deflation. */
function pca3(vectors) {
    const n = vectors.length;
    const d = vectors[0].length;
    const mean = new Float64Array(d);
    for (const v of vectors) for (let j = 0; j < d; j++) mean[j] += v[j] / n;
    const X = vectors.map((v) => {
        const row = new Float64Array(d);
        for (let j = 0; j < d; j++) row[j] = v[j] - mean[j];
        return row;
    });

    let totalVariance = 0;
    for (const row of X) for (let j = 0; j < d; j++) totalVariance += row[j] * row[j];

    const components = [];
    const eigenvalues = [];
    for (let c = 0; c < 3; c++) {
        let v = new Float64Array(d);
        for (let j = 0; j < d; j++) v[j] = Math.sin((j + 1) * (c + 1.7));
        let lambda = 0;
        for (let iter = 0; iter < 60; iter++) {
            const scores = X.map((row) => dot(row, v));
            const next = new Float64Array(d);
            for (let i = 0; i < n; i++) {
                const s = scores[i];
                const row = X[i];
                for (let j = 0; j < d; j++) next[j] += row[j] * s;
            }
            for (const prev of components) {
                const proj = dot(next, prev);
                for (let j = 0; j < d; j++) next[j] -= proj * prev[j];
            }
            lambda = Math.sqrt(dot(next, next));
            if (lambda === 0) break;
            for (let j = 0; j < d; j++) next[j] /= lambda;
            v = next;
        }
        components.push(v);
        eigenvalues.push(lambda);
    }

    const points = X.map((row) => components.map((comp) => dot(row, comp)));
    const explained = eigenvalues.map((lambda) => (totalVariance ? lambda / totalVariance : 0));
    return { points, explained };
}

function dot(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
    return sum;
}

function normalize(v) {
    const out = new Float32Array(v.length);
    let norm = 0;
    for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
    return out;
}

/** Exact cosine top-k per point (vectors are pre-normalised). */
function nearestNeighbors(vectors, k) {
    const unit = vectors.map(normalize);
    return unit.map((a, i) => {
        const best = [];
        for (let j = 0; j < unit.length; j++) {
            if (j === i) continue;
            const score = dot(a, unit[j]);
            if (best.length < k || score > best[best.length - 1][1]) {
                best.push([j, score]);
                best.sort((x, y) => y[1] - x[1]);
                if (best.length > k) best.pop();
            }
        }
        return best.map(([index, score]) => [index, Number(score.toFixed(4))]);
    });
}

// ---- main ------------------------------------------------------------------

async function listProducts() {
    const counts = await KnowledgeChunk.aggregate([
        { $match: { status: 'active' } },
        { $group: { _id: '$productId', chunks: { $sum: 1 }, withEmbedding: { $sum: { $cond: [{ $isArray: '$embedding' }, 1, 0] } } } }
    ]);
    const byId = new Map(counts.map((row) => [String(row._id), row]));
    const products = await Product.find({ _id: { $in: counts.map((row) => row._id) } }).select('name').lean();
    console.log('productId                 chunks  withEmbedding  name');
    for (const product of products) {
        const row = byId.get(String(product._id));
        console.log(`${product._id}  ${String(row.chunks).padStart(6)}  ${String(row.withEmbedding).padStart(13)}  ${product.name}`);
    }
}

async function productsWithEmbeddings() {
    const counts = await KnowledgeChunk.aggregate([
        { $match: { status: 'active', 'embedding.0': { $exists: true } } },
        { $group: { _id: '$productId', chunks: { $sum: 1 } } },
        { $sort: { chunks: -1 } }
    ]);
    return counts.map((row) => String(row._id));
}

async function buildMap(args) {
    const product = await Product.findById(args.product).select('name').lean();
    if (!product) throw new Error(`Product not found: ${args.product}`);

    const total = await KnowledgeChunk.countDocuments({ productId: args.product, status: 'active' });
    const rows = await KnowledgeChunk.find({ productId: args.product, status: 'active' })
        .select('text embedding sourceId topicId audience modality metadata')
        .limit(args.limit)
        .lean();
    const withVectors = rows.filter((row) => Array.isArray(row.embedding) && row.embedding.length > 0);
    const skipped = rows.length - withVectors.length;
    if (skipped) console.warn(`${skipped} chunk(s) have no embedding in Mongo (VECTOR_STORE=qdrant?) and are left out.`);
    if (withVectors.length < 4) throw new Error(`Need at least 4 chunks with embeddings, found ${withVectors.length}.`);

    const dims = withVectors[0].embedding.length;
    const consistent = withVectors.filter((row) => row.embedding.length === dims);
    if (consistent.length !== withVectors.length) {
        console.warn(`Dropped ${withVectors.length - consistent.length} chunk(s) whose dimension differs from ${dims}.`);
    }

    const sources = await KnowledgeSource.find({ productId: args.product }).select('title type url').lean();
    const sourceName = new Map(sources.map((s) => [String(s._id), s.title || s.url || s.type || String(s._id)]));
    const topicIds = [...new Set(consistent.map((row) => row.topicId).filter(Boolean).map(String))];
    const topics = topicIds.length ? await KnowledgeTopic.find({ _id: { $in: topicIds } }).select('title name').lean() : [];
    const topicName = new Map(topics.map((t) => [String(t._id), t.title || t.name || String(t._id)]));

    const vectors = consistent.map((row) => row.embedding);
    console.log(`Projecting ${vectors.length} chunks (${dims} dims) to 3D...`);
    const { points, explained } = pca3(vectors);

    let neighbors = null;
    if (args.neighbors > 0 && vectors.length <= 2000) {
        console.log('Computing exact cosine neighbours...');
        neighbors = nearestNeighbors(vectors, args.neighbors);
    } else if (args.neighbors > 0) {
        console.warn('More than 2000 chunks: skipping neighbour lists to keep this light (lower --limit to enable).');
    }

    const items = consistent.map((row, i) => {
        const url = row.metadata?.url || row.metadata?.pageUrl || row.metadata?.sourceUrl || null;
        return {
            id: String(row._id),
            x: points[i][0],
            y: points[i][1],
            z: points[i][2],
            source: row.sourceId ? sourceName.get(String(row.sourceId)) || 'source' : 'topic',
            topic: row.topicId ? topicName.get(String(row.topicId)) || 'topic' : '—',
            audience: row.audience || '—',
            modality: row.modality || '—',
            url,
            text: String(row.text || '').slice(0, args.textMax),
            truncated: String(row.text || '').length > args.textMax,
            near: neighbors ? neighbors[i] : []
        };
    });

    return {
        product: product.name,
        productId: String(product._id),
        generatedAt: new Date().toISOString(),
        dims,
        total,
        explained,
        hasNeighbors: Boolean(neighbors),
        items
    };
}

function renderHtml(datasets) {
    const json = JSON.stringify(datasets).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, '');
    return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Embedding Map</title>
<script src="https://cdn.jsdelivr.net/npm/plotly.js-dist-min@2.35.2/plotly.min.js"></script>
<style>
  :root { --bg:#0e1420; --panel:#151d2e; --line:#26324a; --text:#e6ebf5; --muted:#8c99b3; --accent:#6ea8ff; }
  @media (prefers-color-scheme: light) { :root { --bg:#f4f6fb; --panel:#fff; --line:#d9dfec; --text:#1b2333; --muted:#5d6b86; --accent:#2b6cdf; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
  header { padding:14px 20px; border-bottom:1px solid var(--line); display:flex; flex-wrap:wrap; gap:12px 24px; align-items:center; }
  header h1 { font-size:16px; margin:0; }
  header .meta { color:var(--muted); font-size:12px; }
  .controls { display:flex; flex-wrap:wrap; gap:10px; margin-left:auto; }
  select, input { background:var(--panel); color:var(--text); border:1px solid var(--line); border-radius:8px; padding:6px 10px; font:inherit; }
  main { display:grid; grid-template-columns: 1fr 380px; height:calc(100vh - 62px); }
  #plot { min-width:0; }
  aside { border-left:1px solid var(--line); background:var(--panel); padding:16px; overflow:auto; }
  aside h2 { font-size:13px; margin:0 0 6px; color:var(--muted); font-weight:600; text-transform:uppercase; letter-spacing:.04em; }
  .tag { display:inline-block; background:var(--bg); border:1px solid var(--line); border-radius:999px; padding:1px 9px; margin:0 6px 6px 0; font-size:12px; }
  pre { white-space:pre-wrap; word-break:break-word; margin:8px 0 16px; font-family:inherit; font-size:13px; line-height:1.55; }
  .nb { display:block; width:100%; text-align:left; background:var(--bg); color:var(--text); border:1px solid var(--line); border-radius:8px; padding:8px 10px; margin-bottom:8px; cursor:pointer; font:inherit; }
  .nb:hover { border-color:var(--accent); }
  .nb b { color:var(--accent); font-variant-numeric:tabular-nums; }
  .note { color:var(--muted); font-size:12px; margin-top:20px; }
  @media (max-width: 900px) { main { grid-template-columns:1fr; height:auto; } #plot { height:60vh; } aside { border-left:0; border-top:1px solid var(--line); } }
</style>
</head>
<body>
<header>
  <h1>Embedding Map</h1>
  <select id="product" aria-label="Ürün"></select>
  <span class="meta" id="meta"></span>
  <div class="controls">
    <select id="colorBy" aria-label="Renklendirme">
      <option value="source">Renk: kaynak</option>
      <option value="audience">Renk: hedef kitle</option>
      <option value="modality">Renk: tür</option>
      <option value="topic">Renk: konu</option>
    </select>
    <input id="search" type="search" placeholder="Metinde ara…" aria-label="Metinde ara">
  </div>
</header>
<main>
  <div id="plot"></div>
  <aside id="side"><h2>Chunk</h2><p class="meta">Haritada bir noktaya tıkla.</p></aside>
</main>
<script id="data" type="application/json">${json}</script>
<script>
const datasets = JSON.parse(document.getElementById('data').textContent);
let data = datasets[0];
let items = data.items;
const pct = (v) => (v * 100).toFixed(1) + '%';
function updateMeta() {
  const kept = data.explained.reduce((a, b) => a + b, 0);
  const partial = data.total > items.length ? ' (toplam ' + data.total + ', ilk ' + items.length + ' gösteriliyor)' : '';
  document.getElementById('meta').textContent =
    items.length + ' chunk' + partial + ' · ' + data.dims + ' boyut · 3 eksen toplam varyansın ' + pct(kept) +
    ' kadarını koruyor · ' + new Date(data.generatedAt).toLocaleString('tr-TR');
}

const palette = ['#6ea8ff','#ff8a65','#7bd88f','#e0b84c','#c792ea','#4dd0e1','#f06292','#a1887f','#90a4ae','#dce775'];
let selected = -1;

function groups(key) {
  const names = [...new Set(items.map((it) => it[key]))];
  return names.map((name, i) => ({ name, color: palette[i % palette.length], idx: items.map((it, n) => it[key] === name ? n : -1).filter((n) => n >= 0) }));
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

function draw() {
  const key = document.getElementById('colorBy').value;
  const query = document.getElementById('search').value.trim().toLowerCase();
  const matches = (it) => !query || it.text.toLowerCase().includes(query);
  const traces = groups(key).map((g) => ({
    type: 'scatter3d', mode: 'markers', name: g.name + ' (' + g.idx.length + ')',
    x: g.idx.map((n) => items[n].x), y: g.idx.map((n) => items[n].y), z: g.idx.map((n) => items[n].z),
    customdata: g.idx,
    text: g.idx.map((n) => esc(items[n].text.slice(0, 140)) + (items[n].text.length > 140 ? '…' : '')),
    hovertemplate: '%{text}<extra>' + esc(g.name) + '</extra>',
    marker: {
      size: g.idx.map((n) => n === selected ? 11 : 5),
      color: g.color,
      opacity: g.idx.map((n) => matches(items[n]) ? 0.95 : 0.12),
      line: { width: g.idx.map((n) => n === selected ? 2 : 0), color: '#fff' }
    }
  }));
  const axis = { showgrid: true, zeroline: false, showticklabels: false, title: '' };
  Plotly.react('plot', traces, {
    paper_bgcolor: 'rgba(0,0,0,0)', font: { color: getComputedStyle(document.body).color },
    margin: { l: 0, r: 0, t: 0, b: 0 }, legend: { x: 0.01, y: 0.99, bgcolor: 'rgba(0,0,0,0.25)' },
    scene: { xaxis: axis, yaxis: axis, zaxis: axis, bgcolor: 'rgba(0,0,0,0)' }
  }, { responsive: true, displaylogo: false });
  document.getElementById('plot').on('plotly_click', (ev) => select(ev.points[0].customdata));
}

function select(n) {
  selected = n;
  const it = items[n];
  const near = it.near.map(([j, score]) =>
    '<button class="nb" data-j="' + j + '"><b>' + score.toFixed(3) + '</b> · ' + esc(items[j].source) + '<br>' +
    esc(items[j].text.slice(0, 110)) + (items[j].text.length > 110 ? '…' : '') + '</button>').join('');
  document.getElementById('side').innerHTML =
    '<h2>Chunk</h2>' +
    '<span class="tag">' + esc(it.source) + '</span><span class="tag">' + esc(it.audience) + '</span><span class="tag">' + esc(it.modality) + '</span>' +
    (it.topic !== '—' ? '<span class="tag">konu: ' + esc(it.topic) + '</span>' : '') +
    (it.url ? '<p class="meta">' + esc(it.url) + '</p>' : '') +
    '<pre>' + esc(it.text) + (it.truncated ? ' …' : '') + '</pre>' +
    (data.hasNeighbors ? '<h2>En yakın komşular (gerçek cosine)</h2>' + near : '<p class="meta">Komşu listesi üretilmedi.</p>') +
    '<p class="note">Konumlar 3 boyuta indirgenmiş yaklaşık bir görünümdür; yakın görünen iki nokta her zaman benzer olmayabilir. Kesin benzerlik için yukarıdaki cosine skorlarına bak.</p>';
  document.querySelectorAll('.nb').forEach((b) => b.addEventListener('click', () => select(Number(b.dataset.j))));
  draw();
}

function applyDefaultColor() {
  const distinct = (key) => new Set(items.map((it) => it[key])).size;
  document.getElementById('colorBy').value = distinct('source') < 2 && distinct('topic') > 1 ? 'topic' : 'source';
}

const productSelect = document.getElementById('product');
datasets.forEach((d, i) => {
  const option = document.createElement('option');
  option.value = String(i);
  option.textContent = d.product + ' (' + d.items.length + ')';
  productSelect.appendChild(option);
});
productSelect.hidden = datasets.length < 2;
productSelect.addEventListener('change', () => {
  data = datasets[Number(productSelect.value)];
  items = data.items;
  selected = -1;
  document.getElementById('search').value = '';
  document.getElementById('side').innerHTML = '<h2>Chunk</h2><p class="meta">Haritada bir noktaya tıkla.</p>';
  updateMeta();
  applyDefaultColor();
  draw();
});

const distinct = (key) => new Set(items.map((it) => it[key])).size;
document.getElementById('colorBy').addEventListener('change', draw);
document.getElementById('search').addEventListener('input', draw);
updateMeta();
applyDefaultColor();
draw();
</script>
</body>
</html>
`;
}

const args = parseArgs(process.argv.slice(2));
try {
    await connectDB();
    if (args.list) {
        await listProducts();
    } else {
        const ids = args.product ? [args.product] : await productsWithEmbeddings();
        if (!ids.length) throw new Error('No product has chunks with embeddings.');
        const datasets = [];
        for (const id of ids) {
            try {
                datasets.push(await buildMap({ ...args, product: id }));
            } catch (error) {
                if (args.product) throw error;
                console.warn(`Skipping ${id}: ${error.message}`);
            }
        }
        if (!datasets.length) throw new Error('Nothing to render.');
        const out = resolve(ROOT, args.out || (args.product
            ? `tools/inspector/out/embedding-map-${args.product}.html`
            : 'tools/inspector/out/embedding-map.html'));
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, renderHtml(datasets));
        console.log(`Wrote ${out} (${datasets.length} product${datasets.length > 1 ? 's' : ''})`);
    }
} catch (error) {
    console.error(`[inspector] ${error.message}`);
    process.exitCode = 1;
} finally {
    await disconnectDB();
}
