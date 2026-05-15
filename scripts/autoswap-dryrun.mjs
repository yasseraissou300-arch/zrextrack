// AutoSwap dry-run : appelle l'API ZRExpress en live et produit la liste
// des matchs de swap proposés. Pure lecture, aucune écriture, aucun POST swap.
//
// Usage : node scripts/autoswap-dryrun.mjs [--json | --md]
//   --md   : sortie Markdown (défaut)
//   --json : sortie JSON brute (pour automation)

import fs from 'node:fs';
import path from 'node:path';

// ── Chargement des credentials depuis .env.local ────────────────────────────
function loadEnv() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) {
    console.error('❌ .env.local introuvable. Créez-le avec ZREXPRESS_DEBUG_TOKEN et ZREXPRESS_DEBUG_TENANT.');
    process.exit(1);
  }
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
loadEnv();

const TOKEN = process.env.ZREXPRESS_DEBUG_TOKEN;
const TENANT = process.env.ZREXPRESS_DEBUG_TENANT;
const ZR_BASE = 'https://api.zrexpress.app/api/v1.0';

if (!TOKEN || !TENANT) {
  console.error('❌ ZREXPRESS_DEBUG_TOKEN ou ZREXPRESS_DEBUG_TENANT manquant dans .env.local');
  process.exit(1);
}

// ── Fetch paginé de tous les colis ──────────────────────────────────────────
async function fetchAllParcels() {
  const all = [];
  let pageNumber = 1;
  const pageSize = 100;
  let totalPages = 1;

  while (pageNumber <= totalPages) {
    const res = await fetch(`${ZR_BASE}/parcels/search`, {
      method: 'POST',
      headers: { 'X-Api-Key': TOKEN, 'X-Tenant': TENANT, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageNumber, pageSize }),
    });
    if (!res.ok) throw new Error(`ZRExpress ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    const items = data.items || data.content || data.data || data.parcels || (Array.isArray(data) ? data : []);
    all.push(...items);
    totalPages = data.totalPages ?? data.total_pages ?? 1;
    process.stderr.write(`\rFetching page ${pageNumber}/${totalPages}... ${all.length} colis récupérés`);
    pageNumber++;
    if (pageNumber > 50) break;
  }
  process.stderr.write('\n');
  return all;
}

// ── Matcher (port JS du src/lib/autoswap/matcher.ts) ────────────────────────
const DESC_RE = /^(?<name>[^(]+?)\(\s*(?<sku>[^)]+?)\s*\)\s*(?:\(\s*(?<color>[^,)]+?)\s*(?:,\s*(?<size>[^)]+?)\s*)?\))?[^:]*(?::\s*(?<uuid>[a-f0-9-]{36}))?/i;
const UUID_RE = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i;

const normKey = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

function parseDesc(raw) {
  const desc = (raw || '').trim();
  if (!desc) return { name: '', sku: null, color: null, size: null, uuid: null };
  const m = desc.match(DESC_RE);
  const fallbackUuid = desc.match(UUID_RE)?.[0] || null;
  if (!m?.groups) return { name: desc.split('(')[0]?.trim() || desc, sku: null, color: null, size: null, uuid: fallbackUuid };
  return {
    name: m.groups.name?.trim() || '',
    sku: m.groups.sku ? normKey(m.groups.sku) : null,
    color: m.groups.color ? normKey(m.groups.color) : null,
    size: m.groups.size ? normKey(m.groups.size) : null,
    uuid: m.groups.uuid || fallbackUuid,
  };
}

function normalizeParcel(p) {
  const parsed = parseDesc(p.productsDescription || '');
  return {
    id: p.id || '',
    tracking: p.trackingNumber || '',
    externalId: p.externalId || '',
    uuid: parsed.uuid, sku: parsed.sku, name: parsed.name, color: parsed.color, size: parsed.size,
    cityId: p.deliveryAddress?.cityTerritoryId || '',
    wilayaCode: Number(p.deliveryAddress?.cityTerritoryCode ?? 0),
    cityName: p.deliveryAddress?.city || '',
    customer: p.customer?.name || '',
    phone: p.customer?.phone?.number1 || '',
    amount: Number(p.amount ?? 0),
    returnPrice: Number(p.returnPrice ?? 0),
    deliveryPrice: Number(p.deliveryPrice ?? 0),
    state: p.state?.name || '',
    stateDesc: p.state?.description || '',
    swap: {
      eligible: !!p.swap?.isEligibleForSwap,
      swappedAt: p.swap?.swappedAt ?? null,
      sameCityPrice: Number(p.swap?.sameCityPrice ?? 0),
      diffCityPrice: Number(p.swap?.differentCityPrice ?? 0),
      count: Number(p.swap?.count ?? 0),
    },
  };
}

function confidence(a, b) {
  if (a.uuid && b.uuid && a.uuid === b.uuid) return 'EXACT';
  if (a.sku && b.sku && a.sku === b.sku && a.color === b.color && a.size === b.size && a.color && a.size) return 'STRONG';
  if (a.sku && b.sku && a.sku === b.sku) return 'WEAK';
  return null;
}

function scorePair(s, t, conf) {
  const warnings = [];
  const base = conf === 'EXACT' ? 100 : conf === 'STRONG' ? 90 : 60;
  const sameCity = !!s.cityId && s.cityId === t.cityId;
  const sameWilaya = s.wilayaCode > 0 && s.wilayaCode === t.wilayaCode;
  let geo = sameCity ? 30 : sameWilaya ? 10 : 0;
  let price = 0;
  if (s.amount > 0 && t.amount > 0) {
    const diff = Math.abs(s.amount - t.amount) / s.amount;
    if (diff < 0.1) price = 10;
    else if (diff > 0.3) warnings.push(`Écart prix : ${s.amount} → ${t.amount} DA`);
  }
  if (conf === 'WEAK') warnings.push('Variante non confirmée');
  if (!sameCity && !sameWilaya) warnings.push(`Wilaya différente : ${s.cityName} → ${t.cityName}`);
  if (s.swap.count > 0) warnings.push(`Déjà swappé ${s.swap.count}×`);
  return { score: base + geo + price, sameCity, sameWilaya, warnings };
}

function estimateSavings(s, t, sameCity) {
  const fee = sameCity ? s.swap.sameCityPrice : s.swap.diffCityPrice;
  return Math.max(0, s.returnPrice + t.deliveryPrice - fee);
}

// États ZRExpress considérés comme "commande confirmée en attente d'expédition".
// `appel_confirmation` (URL UI) n'existe pas côté API → on cible commande_recue + pret_a_expedier.
const TARGET_STATES = new Set(['commande_recue', 'pret_a_expedier', 'appel_confirmation']);

function matchSwappables(parcels) {
  const norm = parcels.map(normalizeParcel);
  const sources = norm.filter(p => p.swap.eligible && p.swap.swappedAt === null);
  const targets = norm.filter(p => TARGET_STATES.has(p.state));

  const candidates = [];
  for (const s of sources) {
    for (const t of targets) {
      const conf = confidence(s, t);
      if (!conf) continue;
      const sc = scorePair(s, t, conf);
      candidates.push({ s, t, conf, ...sc });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const usedS = new Set(), usedT = new Set();
  const props = [];
  for (const c of candidates) {
    if (usedS.has(c.s.id) || usedT.has(c.t.id)) continue;
    usedS.add(c.s.id); usedT.add(c.t.id);
    props.push({
      confidence: c.conf, score: c.score, sameCity: c.sameCity, sameWilaya: c.sameWilaya,
      savings: estimateSavings(c.s, c.t, c.sameCity), warnings: c.warnings,
      source: { tracking: c.s.tracking, customer: c.s.customer, city: c.s.cityName, product: c.s.name, color: c.s.color, size: c.s.size, amount: c.s.amount, state: c.s.stateDesc },
      target: { tracking: c.t.tracking, customer: c.t.customer, phone: c.t.phone, city: c.t.cityName, product: c.t.name, color: c.t.color, size: c.t.size, amount: c.t.amount },
    });
  }
  return { sources: sources.length, targets: targets.length, props };
}

// ── Sortie ──────────────────────────────────────────────────────────────────
function fmtMd(stats, props) {
  const byConf = props.reduce((a, p) => (a[p.confidence] = (a[p.confidence] || 0) + 1, a), { EXACT: 0, STRONG: 0, WEAK: 0 });
  const totalSavings = props.reduce((sum, p) => sum + p.savings, 0);

  const lines = [];
  lines.push('# AutoSwap — Liste des swaps proposés');
  lines.push('');
  lines.push(`**Date** : ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`);
  lines.push('');
  lines.push('## Statistiques');
  lines.push('');
  lines.push(`- **Colis total scannés** : ${stats.total}`);
  lines.push(`- **Colis swappables (annulés, encore en route)** : ${stats.sources}`);
  lines.push(`- **Commandes confirmées en attente d'expédition** : ${stats.targets}`);
  lines.push(`- **Matchs proposés** : ${props.length}`);
  lines.push(`  - 🟢 EXACT (variante UUID identique) : ${byConf.EXACT}`);
  lines.push(`  - 🔵 STRONG (SKU + couleur + taille) : ${byConf.STRONG}`);
  lines.push(`  - 🟡 WEAK (SKU seul, variante différente) : ${byConf.WEAK}`);
  lines.push(`- **Économies totales estimées** : ${totalSavings.toFixed(0)} DA`);
  lines.push('');
  if (props.length === 0) {
    lines.push('## Aucun match trouvé');
    lines.push('');
    lines.push('Soit aucun colis n\'est éligible au swap actuellement (`isEligibleForSwap=true`), soit aucune commande confirmée en attente ne correspond aux produits annulés.');
    return lines.join('\n');
  }

  lines.push('## Propositions (triées par score)');
  lines.push('');
  lines.push('| # | Conf | Score | Colis annulé | → Nouveau client | Produit | Variante | Wilaya | Économie | Warnings |');
  lines.push('|---|------|-------|--------------|------------------|---------|----------|--------|----------|----------|');
  props.forEach((p, i) => {
    const conf = p.confidence === 'EXACT' ? '🟢' : p.confidence === 'STRONG' ? '🔵' : '🟡';
    const variant = [p.source.color, p.source.size && `T.${p.source.size}`].filter(Boolean).join(' / ');
    const wilaya = p.sameCity ? `${p.source.city} ✓` : p.sameWilaya ? `${p.source.city} (même wilaya)` : `${p.source.city} → ${p.target.city}`;
    const warn = p.warnings.length ? p.warnings.join(' · ') : '—';
    lines.push(`| ${i + 1} | ${conf} ${p.confidence} | ${p.score} | \`${p.source.tracking}\` ${p.source.customer || ''} | ${p.target.customer || ''} \`${p.target.tracking}\` | ${p.source.product} | ${variant || '—'} | ${wilaya} | **${p.savings.toFixed(0)} DA** | ${warn} |`);
  });
  return lines.join('\n');
}

// ── Main ────────────────────────────────────────────────────────────────────
const mode = process.argv.includes('--json') ? 'json' : 'md';
console.error('🔄 AutoSwap dry-run — fetching ZRExpress…');
const parcels = await fetchAllParcels();
console.error(`✅ ${parcels.length} colis récupérés. Lancement du matcher…`);
const { sources, targets, props } = matchSwappables(parcels);
console.error(`✅ ${sources} swappables, ${targets} targets, ${props.length} matchs.\n`);

if (mode === 'json') {
  console.log(JSON.stringify({ stats: { total: parcels.length, sources, targets, matches: props.length }, proposals: props }, null, 2));
} else {
  const md = fmtMd({ total: parcels.length, sources, targets }, props);
  console.log(md);
  // Sauvegarde aussi en fichier
  const outPath = path.join(process.cwd(), 'autoswap-proposals.md');
  fs.writeFileSync(outPath, md, 'utf8');
  console.error(`\n📄 Rapport sauvegardé : ${outPath}`);
}
