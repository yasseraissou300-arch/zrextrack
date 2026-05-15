// Inspecte les descriptions BRUTES des matchs WEAK pour comprendre pourquoi
// le parser n'identifie pas les variantes comme identiques.
import fs from 'node:fs';
import path from 'node:path';

const envPath = path.join(process.cwd(), '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}
const TOKEN = process.env.ZREXPRESS_DEBUG_TOKEN;
const TENANT = process.env.ZREXPRESS_DEBUG_TENANT;

async function fetchAll() {
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
    p++;
    if (p > 50) break;
  }
  return all;
}

const parcels = await fetchAll();

// Filtre les swappables et les targets
const TARGET_STATES = new Set(['commande_recue', 'pret_a_expedier', 'appel_confirmation']);
const swappables = parcels.filter(p => p.swap?.isEligibleForSwap === true && p.swap?.swappedAt === null);
const targets = parcels.filter(p => TARGET_STATES.has(p.state?.name));

console.log(`\n═══ ${swappables.length} SWAPPABLES (descriptions brutes) ═══\n`);
for (const p of swappables) {
  console.log(`  ${p.trackingNumber} | ${p.productsDescription}`);
}

console.log(`\n═══ ÉCHANTILLON DE 20 TARGETS (descriptions brutes) ═══\n`);
for (const p of targets.slice(0, 20)) {
  console.log(`  ${p.trackingNumber} | ${p.productsDescription}`);
}

// Regex parser actuel
const DESC_RE = /^(?<name>[^(]+?)\(\s*(?<sku>[^)]+?)\s*\)\s*(?:\(\s*(?<color>[^,)]+?)\s*(?:,\s*(?<size>[^)]+?)\s*)?\))?[^:]*(?::\s*(?<uuid>[a-f0-9-]{36}))?/i;
const normKey = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

function parse(raw) {
  const m = (raw || '').match(DESC_RE);
  if (!m?.groups) return { name: '?', sku: null, color: null, size: null };
  return {
    name: m.groups.name?.trim() || '',
    sku: m.groups.sku ? normKey(m.groups.sku) : null,
    color: m.groups.color ? normKey(m.groups.color) : null,
    size: m.groups.size ? normKey(m.groups.size) : null,
  };
}

console.log('\n═══ PARSING DES SWAPPABLES (parser actuel) ═══\n');
console.log('  Tracking            | SKU         | Color           | Size');
console.log('  ─────────────────────────────────────────────────────────');
for (const p of swappables) {
  const v = parse(p.productsDescription);
  console.log(`  ${p.trackingNumber.padEnd(19)} | ${(v.sku || '?').padEnd(11)} | ${(v.color || '?').padEnd(15)} | ${v.size || '?'}`);
}

console.log('\n═══ PARSING D\'UN ÉCHANTILLON DE TARGETS ═══\n');
console.log('  Tracking            | SKU         | Color           | Size');
console.log('  ─────────────────────────────────────────────────────────');
for (const p of targets.slice(0, 20)) {
  const v = parse(p.productsDescription);
  console.log(`  ${p.trackingNumber.padEnd(19)} | ${(v.sku || '?').padEnd(11)} | ${(v.color || '?').padEnd(15)} | ${v.size || '?'}`);
}
