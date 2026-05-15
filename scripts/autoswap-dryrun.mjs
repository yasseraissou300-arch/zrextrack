// AutoSwap dry-run v2 — parser à vocabulaire (couleurs + tailles).
// Appelle ZRExpress en live, scanne les variantes via dictionnaire, produit
// la liste des matchs auto-validables (STRONG) + ceux à vérifier (WEAK).
//
// Usage : node scripts/autoswap-dryrun.mjs [--json | --md]

import fs from 'node:fs';
import path from 'node:path';

// ── Env ─────────────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) { console.error('❌ .env.local introuvable.'); process.exit(1); }
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
loadEnv();
const TOKEN = process.env.ZREXPRESS_DEBUG_TOKEN;
const TENANT = process.env.ZREXPRESS_DEBUG_TENANT;
if (!TOKEN || !TENANT) { console.error('❌ creds manquants'); process.exit(1); }

// ── Vocabulaire ─────────────────────────────────────────────────────────────
const COLOR_ALIASES = {
  noir: 'noir', noire: 'noir', black: 'noir',
  blanc: 'blanc', blanche: 'blanc', white: 'blanc',
  beige: 'beige', creme: 'beige', cream: 'beige',
  bleu: 'bleu', bleue: 'bleu', blue: 'bleu', azur: 'bleu',
  vert: 'vert', verte: 'vert', green: 'vert',
  gris: 'gris', grise: 'gris', grey: 'gris', gray: 'gris',
  marron: 'marron', brown: 'marron', chocolat: 'marron',
  rouge: 'rouge', red: 'rouge',
  jaune: 'jaune', yellow: 'jaune',
  rose: 'rose', pink: 'rose',
  violet: 'violet', mauve: 'violet', purple: 'violet',
  orange: 'orange',
  kaki: 'kaki', khaki: 'kaki', olive: 'kaki',
  turquoise: 'turquoise',
};
const ALPHA_SIZES = new Set(['xs','s','m','l','xl','xxl','xxxl','xxxxl','2xl','3xl','4xl','5xl']);
const NUMERIC_SIZE_RE = /^\d{2,3}$/;
const JUNK_TOKENS = new Set(['taille','size','couleur','color','pour','avec','et','and','or','ou','de','du','des','le','la','les']);

const clean = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[{}\[\]"]/g,'').trim();
const tokenize = s => s.split(/[\s,/()\\\-]+/).map(clean).filter(t => t && !JUNK_TOKENS.has(t));

function classify(tok) {
  if (COLOR_ALIASES[tok]) return { type: 'color', v: COLOR_ALIASES[tok] };
  if (ALPHA_SIZES.has(tok)) return { type: 'size', v: tok.toUpperCase() };
  if (NUMERIC_SIZE_RE.test(tok)) return { type: 'size', v: tok };
  return null;
}

function extractNameAndSku(raw) {
  const m = raw.match(/^([^(:]+?)\(\s*([^)]+?)\s*\)/);
  if (m) return { name: m[1].trim(), sku: clean(m[2]) };
  return { name: (raw.split(/\s+:|:/)[0] || raw).trim(), sku: null };
}

function nameFingerprint(name) {
  return tokenize(name)
    .filter(t => !COLOR_ALIASES[t] && !ALPHA_SIZES.has(t) && !NUMERIC_SIZE_RE.test(t))
    .map(t => t.replace(/^p[oa]ntalon$/, 'pantalon'))
    .sort().join(' ');
}

function extractQuantity(raw) {
  const m = raw.match(/-\s*(\d+)\s*$/);
  return m ? Math.max(1, parseInt(m[1], 10)) : 1;
}

function parseDesc(raw) {
  const desc = (raw || '').trim();
  if (!desc) return { name: '', sku: null, colors: [], sizes: [], nameFp: '', uuid: null, quantity: 1 };
  const { name, sku } = extractNameAndSku(desc);
  const colors = new Set(), sizes = new Set();
  for (const t of tokenize(desc)) {
    if (sku && t === sku) continue;
    const c = classify(t);
    if (c?.type === 'color') colors.add(c.v);
    else if (c?.type === 'size') sizes.add(c.v);
  }
  return {
    name, sku,
    colors: [...colors].sort(),
    sizes: [...sizes].sort(),
    nameFp: nameFingerprint(name),
    uuid: desc.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i)?.[0] || null,
    quantity: extractQuantity(desc),
  };
}

// ── Fetch ───────────────────────────────────────────────────────────────────
async function fetchAllParcels() {
  const all = [];
  let p = 1, tp = 1;
  while (p <= tp) {
    const r = await fetch('https://api.zrexpress.app/api/v1.0/parcels/search', {
      method: 'POST',
      headers: { 'X-Api-Key': TOKEN, 'X-Tenant': TENANT, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageNumber: p, pageSize: 100 }),
    });
    const d = await r.json();
    all.push(...(d.items || []));
    tp = d.totalPages ?? 1;
    process.stderr.write(`\rFetching page ${p}/${tp}... ${all.length} colis`);
    p++;
    if (p > 50) break;
  }
  process.stderr.write('\n');
  return all;
}

function normalize(p) {
  const v = parseDesc(p.productsDescription || '');
  return {
    id: p.id, tracking: p.trackingNumber || '',
    sku: v.sku, name: v.name, nameFp: v.nameFp, uuid: v.uuid,
    colors: v.colors, sizes: v.sizes, quantity: v.quantity,
    cityId: p.deliveryAddress?.cityTerritoryId || '',
    wilayaCode: Number(p.deliveryAddress?.cityTerritoryCode ?? 0),
    cityName: p.deliveryAddress?.city || '',
    customer: p.customer?.name || '',
    phone: p.customer?.phone?.number1 || '',
    amount: Number(p.amount ?? 0),
    returnPrice: Number(p.returnPrice ?? 0),
    deliveryPrice: Number(p.deliveryPrice ?? 0),
    state: p.state?.name || '',
    swap: {
      eligible: !!p.swap?.isEligibleForSwap,
      swappedAt: p.swap?.swappedAt ?? null,
      sameCityPrice: Number(p.swap?.sameCityPrice ?? 0),
      diffCityPrice: Number(p.swap?.differentCityPrice ?? 0),
      count: Number(p.swap?.count ?? 0),
    },
  };
}

const setsEqual = (a, b) => {
  if (a.length !== b.length) return false;
  const s = new Set(b);
  return a.every(x => s.has(x));
};

// Tailles interchangeables par produit (configuration métier)
const SIZE_EQUIVALENCES = {
  mrl: [['40','42','44'], ['46','48','50']],
  'hijab miral': [['40','42','44'], ['46','48','50']],
  ayl: [['40','42','44'], ['46','48','50']],
  'ayla abaya': [['40','42','44'], ['46','48','50']],
  spt: [['S','M'], ['L','XL'], ['XXL','XXXL']],
  'pantalon lain sport': [['S','M'], ['L','XL'], ['XXL','XXXL']],
  plin: [['S','M'], ['L','XL'], ['XXL','XXXL']],
  'pantalon lain': [['S','M'], ['L','XL'], ['XXL','XXXL']],
};

function normalizeSize(productKey, size) {
  if (!productKey) return size;
  const groups = SIZE_EQUIVALENCES[productKey];
  if (!groups) return size;
  for (const g of groups) if (g.includes(size)) return g[0];
  return size;
}

function getProductKey(p) {
  if (p.sku && SIZE_EQUIVALENCES[p.sku]) return p.sku;
  if (p.nameFp && SIZE_EQUIVALENCES[p.nameFp]) return p.nameFp;
  return null;
}

// Mode STRICT : produit + géo autorisée + quantité + sets de couleurs ET
// tailles IDENTIQUES. Pas d'intersection partielle.
function matchProduct(a, b) {
  if (a.uuid && b.uuid && a.uuid === b.uuid) {
    if (!isGeoSwapAllowed(a, b)) return null;
    return { conf: 'EXACT', sharedColors: a.colors, sharedSizes: a.sizes };
  }
  const sameSku = !!a.sku && a.sku === b.sku;
  const sameName = !a.sku && !b.sku && !!a.nameFp && a.nameFp === b.nameFp;
  if (!sameSku && !sameName) return null;
  if (!isGeoSwapAllowed(a, b)) return null;
  if (a.quantity !== b.quantity) return null;
  if (a.colors.length === 0 || b.colors.length === 0) return null;
  if (a.sizes.length === 0 || b.sizes.length === 0) return null;
  if (!setsEqual(a.colors, b.colors)) return null;
  // Normalisation par groupes de tailles équivalents avant comparaison
  const productKey = getProductKey(a) || getProductKey(b);
  const aSz = a.sizes.map(s => normalizeSize(productKey, s));
  const bSz = b.sizes.map(s => normalizeSize(productKey, s));
  if (!setsEqual(aSz, bSz)) return null;
  return { conf: 'STRONG', sharedColors: a.colors, sharedSizes: a.sizes };
}

const TARGET_STATES = new Set(['commande_recue', 'pret_a_expedier', 'appel_confirmation']);

// Règles métier ZRExpress (note officielle)
const MAX_SWAP_COUNT = 2;
const RESTRICTED_WILAYAS = new Set([1, 8, 11, 30, 32, 45, 49, 52, 53, 54, 58]);
const isGeoSwapAllowed = (s, t) => !RESTRICTED_WILAYAS.has(s.wilayaCode) || s.wilayaCode === t.wilayaCode;

function scorePair(s, t, m) {
  const warnings = [];
  const base = m.conf === 'EXACT' ? 100 : m.conf === 'STRONG' ? 90 : 60;
  const sameCity = !!s.cityId && s.cityId === t.cityId;
  const sameWilaya = s.wilayaCode > 0 && s.wilayaCode === t.wilayaCode;
  const geo = sameCity ? 30 : sameWilaya ? 10 : 0;
  let price = 0;
  if (s.amount > 0 && t.amount > 0) {
    const diff = Math.abs(s.amount - t.amount) / s.amount;
    if (diff < 0.1) price = 10;
    else if (diff > 0.3) warnings.push(`Écart prix : ${s.amount} → ${t.amount} DA`);
  }
  if (!sameCity && !sameWilaya) warnings.push(`Wilaya différente : ${s.cityName} → ${t.cityName}`);
  if (s.swap.count > 0) warnings.push(`Déjà swappé ${s.swap.count}×`);
  return { ...m, score: base + geo + price, sameCity, sameWilaya, warnings };
}

function savings(s, t, sameCity) {
  const fee = sameCity ? s.swap.sameCityPrice : s.swap.diffCityPrice;
  return Math.max(0, s.returnPrice + t.deliveryPrice - fee);
}

function match(parcels) {
  const norm = parcels.map(normalize);
  // Max 2 swaps par colis (règle ZRExpress)
  const sources = norm.filter(p => p.swap.eligible && p.swap.swappedAt === null && p.swap.count < MAX_SWAP_COUNT);
  const targets = norm.filter(p => TARGET_STATES.has(p.state));
  const cands = [];
  for (const s of sources) for (const t of targets) {
    const m = matchProduct(s, t);
    if (!m) continue;
    cands.push({ s, t, ...scorePair(s, t, m) });
  }
  cands.sort((a, b) => b.score - a.score);
  const usedS = new Set(), usedT = new Set();
  const props = [];
  for (const c of cands) {
    if (usedS.has(c.s.id) || usedT.has(c.t.id)) continue;
    usedS.add(c.s.id); usedT.add(c.t.id);
    const matchedColor = c.sharedColors.length ? c.sharedColors.join('/') : (c.s.colors.join('/') || null);
    const matchedSize = c.sharedSizes.length ? c.sharedSizes.join('/') : (c.s.sizes.join('/') || null);
    props.push({
      confidence: c.conf, score: c.score, sameCity: c.sameCity, sameWilaya: c.sameWilaya,
      savings: savings(c.s, c.t, c.sameCity), warnings: c.warnings,
      matchedColor, matchedSize,
      source: { tracking: c.s.tracking, customer: c.s.customer, city: c.s.cityName, product: c.s.name, colors: c.s.colors, sizes: c.s.sizes, amount: c.s.amount },
      target: { tracking: c.t.tracking, customer: c.t.customer, phone: c.t.phone, city: c.t.cityName, product: c.t.name, colors: c.t.colors, sizes: c.t.sizes, amount: c.t.amount },
    });
  }
  return { sources: sources.length, targets: targets.length, props };
}

function fmtMd(stats, props) {
  const byConf = props.reduce((a, p) => (a[p.confidence] = (a[p.confidence] || 0) + 1, a), { EXACT: 0, STRONG: 0 });
  const totalSavings = props.reduce((s, p) => s + p.savings, 0);

  const L = [];
  L.push('# AutoSwap — Liste des swaps proposés (mode strict)');
  L.push('');
  L.push(`**Date** : ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`);
  L.push('');
  L.push('## Statistiques');
  L.push('');
  L.push(`- Colis totaux : ${stats.total}`);
  L.push(`- Swappables : **${stats.sources}**`);
  L.push(`- Cibles confirmées : **${stats.targets}**`);
  L.push(`- Matchs proposés (produit + couleur + taille identiques) : **${props.length}**`);
  L.push(`  - 🟢 EXACT (UUID variante) : ${byConf.EXACT}`);
  L.push(`  - 🔵 STRONG (même nom + couleur + taille) : ${byConf.STRONG}`);
  L.push(`- 💰 Économies totales : **${totalSavings.toFixed(0)} DA**`);
  L.push('');

  if (props.length === 0) {
    L.push('## Aucun match strict trouvé');
    L.push('');
    L.push('Aucune commande confirmée en attente n\'a exactement le même produit + couleur + taille qu\'un colis swappable.');
    return L.join('\n');
  }

  L.push('## Propositions de swap (tous auto-validés)');
  L.push('');
  L.push('| # | Ancien colis | → Nouveau client | Produit · Couleur · Taille | Wilaya | Économie |');
  L.push('|---|--------------|------------------|----------------------------|--------|----------|');
  props.forEach((p, i) => {
    const v = [p.matchedColor, p.matchedSize && `T.${p.matchedSize}`].filter(Boolean).join(' · ') || '—';
    const wil = p.sameCity ? `${p.source.city} ✓` : p.sameWilaya ? `${p.source.city} (même wil)` : `${p.source.city} → ${p.target.city}`;
    L.push(`| ${i + 1} | \`${p.source.tracking}\` ${p.source.customer} | ${p.target.customer} \`${p.target.tracking}\` | ${p.source.product} · ${v} | ${wil} | **${p.savings.toFixed(0)} DA** |`);
  });
  return L.join('\n');
}

const mode = process.argv.includes('--json') ? 'json' : 'md';
console.error('🔄 AutoSwap dry-run v2 — fetching ZRExpress…');
const parcels = await fetchAllParcels();
console.error(`✅ ${parcels.length} colis. Matching…`);
const { sources, targets, props } = match(parcels);
console.error(`✅ ${sources} sources, ${targets} targets, ${props.length} matchs.\n`);

if (mode === 'json') {
  console.log(JSON.stringify({ stats: { total: parcels.length, sources, targets, matches: props.length }, proposals: props }, null, 2));
} else {
  const md = fmtMd({ total: parcels.length, sources, targets }, props);
  console.log(md);
  fs.writeFileSync(path.join(process.cwd(), 'autoswap-proposals.md'), md, 'utf8');
  console.error(`\n📄 Rapport : autoswap-proposals.md`);
}
