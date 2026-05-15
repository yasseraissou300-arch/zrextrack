// Debug : liste tous les états ZRExpress présents dans le compte + détail des colis swappables.
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
  let pageNumber = 1, totalPages = 1;
  while (pageNumber <= totalPages) {
    const res = await fetch('https://api.zrexpress.app/api/v1.0/parcels/search', {
      method: 'POST',
      headers: { 'X-Api-Key': TOKEN, 'X-Tenant': TENANT, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageNumber, pageSize: 100 }),
    });
    const data = await res.json();
    const items = data.items || [];
    all.push(...items);
    totalPages = data.totalPages ?? 1;
    pageNumber++;
    if (pageNumber > 50) break;
  }
  return all;
}

const parcels = await fetchAll();

// Liste des états uniques avec count
const stateCounts = {};
for (const p of parcels) {
  const key = `${p.state?.name || '?'}  |  ${p.state?.description || '?'}`;
  stateCounts[key] = (stateCounts[key] || 0) + 1;
}

console.log('\n═══ ÉTATS PRÉSENTS DANS LE COMPTE ═══\n');
const sorted = Object.entries(stateCounts).sort((a, b) => b[1] - a[1]);
for (const [state, count] of sorted) {
  console.log(`  ${count.toString().padStart(5)}  ${state}`);
}

// Détail des colis swappables
const swappables = parcels.filter(p => p.swap?.isEligibleForSwap === true && p.swap?.swappedAt === null);
console.log(`\n═══ ${swappables.length} COLIS SWAPPABLES ═══\n`);
for (const p of swappables.slice(0, 15)) {
  console.log(`  ${p.trackingNumber.padEnd(18)} | ${(p.state?.description || '?').padEnd(30)} | ${(p.deliveryAddress?.city || '?').padEnd(15)} | ${p.productsDescription?.slice(0, 80) || '?'}`);
}
if (swappables.length > 15) console.log(`  ... et ${swappables.length - 15} autres`);

// Cherche d'éventuels états proches de "confirmation"
console.log('\n═══ ÉTATS CONTENANT "confirm" ou "attente" OU "appel" ═══\n');
const candidates = sorted.filter(([s]) => /confirm|attente|appel|preparation|nouveau|new|pending/i.test(s));
for (const [s, c] of candidates) console.log(`  ${c.toString().padStart(5)}  ${s}`);
