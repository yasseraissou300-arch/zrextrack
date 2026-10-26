// Recâblage des webhooks WhatsApp (Evolution) AVEC le secret partagé.
//
// POURQUOI : tant que WHATSAPP_WEBHOOK_SECRET n'est pas défini, le webhook
// entrant /api/ai-chatbot/webhook/whatsapp accepte n'importe quel appelant
// (constaté en production le 2026-10-15). Dès que le secret est défini dans
// Vercel, les URLs déjà enregistrées chez Evolution (SANS ?token=) sont
// refusées : chaque instance doit être réenregistrée avec le jeton. Ce script
// le fait pour toutes les instances de la plateforme en une passe.
//
// SÛRETÉ
//   - Aucun accès base : la liste vient d'Evolution (/instance/fetchInstances).
//   - Seules les instances de l'espace de noms AutoTim sont touchées :
//     zrex_<12 hex>[_<suffixe>] (le serveur Evolution peut être partagé).
//   - SIMULATION par défaut ; écriture uniquement avec --apply.
//   - Aucun chargement automatique de .env : variables passées explicitement.
//   - Le secret n'est jamais affiché (URL masquée).
//
// USAGE (variables copiées depuis Vercel dans VOTRE terminal, jamais ailleurs) :
//   EVOLUTION_API_URL=… EVOLUTION_API_KEY=… WHATSAPP_WEBHOOK_SECRET=… \
//   APP_URL=https://<domaine de production> node scripts/rewire-whatsapp-webhooks.mjs
//   … même commande + --apply   (après lecture de la simulation)

export const EVENTS = ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'];
const OWN_NAME = /^zrex_[0-9a-f]{12}(_[a-z]+)?$/;

export function isAutotimInstance(name) {
  return typeof name === 'string' && OWN_NAME.test(name);
}

export function webhookUrl(appUrl, secret) {
  const base = appUrl.replace(/\/+$/, '');
  return `${base}/api/ai-chatbot/webhook/whatsapp?token=${encodeURIComponent(secret)}`;
}

/** URL affichable : le jeton est masqué. */
export function maskUrl(url) {
  return typeof url === 'string' ? url.replace(/([?&]token=)[^&]*/i, '$1***') : String(url);
}

/** Noms d'instance renvoyés par Evolution (v1 et v2). */
export function instanceNames(payload) {
  const list = Array.isArray(payload) ? payload : [];
  return list
    .map((x) => x?.name ?? x?.instanceName ?? x?.instance?.instanceName ?? null)
    .filter((n) => typeof n === 'string');
}

async function call(fetchImpl, url, key, init = {}) {
  const res = await fetchImpl(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', apikey: key, ...(init.headers ?? {}) },
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

function currentUrl(json) {
  const inner = json?.webhook ?? json;
  return { url: inner?.url ?? null, events: inner?.events ?? null };
}

export async function rewire({
  evUrl,
  evKey,
  secret,
  appUrl,
  apply,
  fetchImpl = fetch,
  log = console.info,
}) {
  const target = webhookUrl(appUrl, secret);
  const all = instanceNames(
    (await call(fetchImpl, `${evUrl}/instance/fetchInstances`, evKey)).json
  );
  const ours = all.filter(isAutotimInstance);
  log(
    `Instances Evolution : ${all.length} ; AutoTim : ${ours.length} ; ignorées : ${all.length - ours.length}`
  );
  const report = [];
  for (const name of ours) {
    const before = currentUrl((await call(fetchImpl, `${evUrl}/webhook/find/${name}`, evKey)).json);
    const already = before.url === target;
    if (!apply || already) {
      report.push({
        name,
        action: already ? 'déjà à jour' : 'à recâbler',
        before: maskUrl(before.url),
      });
      continue;
    }
    // Format v1 (plat), puis v2 (imbriqué) si la vérification échoue.
    await call(fetchImpl, `${evUrl}/webhook/set/${name}`, evKey, {
      method: 'POST',
      body: JSON.stringify({
        url: target,
        webhook_by_events: false,
        webhook_base64: false,
        events: EVENTS,
      }),
    });
    let after = currentUrl((await call(fetchImpl, `${evUrl}/webhook/find/${name}`, evKey)).json);
    if (after.url !== target) {
      await call(fetchImpl, `${evUrl}/webhook/set/${name}`, evKey, {
        method: 'POST',
        body: JSON.stringify({
          webhook: { enabled: true, url: target, byEvents: false, base64: false, events: EVENTS },
        }),
      });
      after = currentUrl((await call(fetchImpl, `${evUrl}/webhook/find/${name}`, evKey)).json);
    }
    report.push({
      name,
      action: after.url === target ? 'recâblée' : 'ÉCHEC',
      after: maskUrl(after.url),
    });
  }
  for (const r of report) log(`  ${r.name} : ${r.action} (${r.before ?? r.after})`);
  return report;
}

const isMain =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
  const need = ['EVOLUTION_API_URL', 'EVOLUTION_API_KEY', 'WHATSAPP_WEBHOOK_SECRET', 'APP_URL'];
  const missing = need.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(
      `Variables manquantes : ${missing.join(', ')} (aucune lecture de .env, par sécurité)`
    );
    process.exit(2);
  }
  const apply = process.argv.includes('--apply');
  console.info(apply ? 'MODE : APPLICATION' : 'MODE : SIMULATION (ajouter --apply pour écrire)');
  const report = await rewire({
    evUrl: process.env.EVOLUTION_API_URL.replace(/\/+$/, ''),
    evKey: process.env.EVOLUTION_API_KEY,
    secret: process.env.WHATSAPP_WEBHOOK_SECRET,
    appUrl: process.env.APP_URL,
    apply,
  });
  process.exit(report.some((r) => r.action === 'ÉCHEC') ? 1 : 0);
}
