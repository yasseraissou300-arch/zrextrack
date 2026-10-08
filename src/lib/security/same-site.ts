// Garde anti-CSRF pour les rares routes GET à effet de bord (CSRF-1).
//
// Le cookie de session Supabase est SameSite=Lax : le navigateur l'envoie sur
// une navigation GET de premier niveau venant d'un autre site (lien, redirection).
// Une route GET qui écrit (création d'instance Evolution, synchro d'état) est
// donc déclenchable depuis un site tiers. Les navigateurs modernes signalent
// l'origine de la requête dans `Sec-Fetch-Site` (relevé dans Chromium :
// `cross-site` sur un lien venant d'un autre site, `same-origin` sur les fetch
// de l'app, `none` sur une URL tapée à la main).
//
// On refuse `cross-site` et `same-site` (sous-domaine frère). En-tête absent
// (ancien navigateur, curl, serveur) → accepté : ces clients n'emportent pas
// le cookie de la victime, il n'y a pas de CSRF possible.

const REJECTED = new Set(['cross-site', 'same-site']);

export function isForeignSiteRequest(req: Request): boolean {
  const site = req.headers.get('sec-fetch-site');
  return site !== null && REJECTED.has(site.toLowerCase());
}
