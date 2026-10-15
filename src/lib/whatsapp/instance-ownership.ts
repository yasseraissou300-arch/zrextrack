// Propriété d'une instance WhatsApp (Evolution) — RLS-TENANT-001.
//
// Toutes les actions Evolution partent avec la clé GLOBALE de la plateforme
// (EVOLUTION_API_KEY), qui pilote TOUTES les instances du serveur. Le nom
// d'instance est lu dans public.whatsapp_instances, filtré par user_id —
// mais la politique RLS historique de cette table (« FOR ALL USING
// (auth.uid() = user_id) », sans restriction de colonne) laisse un tenant
// réécrire SON instance_name directement via PostgREST. Sans contrôle, il
// pourrait y mettre le nom de l'instance d'un autre tenant (ou d'une instance
// Evolution absente de la table) : le serveur enverrait alors des messages
// depuis ce numéro, en obtiendrait le QR, en réécrirait le webhook…
//
// Règle : un nom n'appartient au tenant que s'il est dans SON espace de noms,
// tel que le serveur le génère — `zrex_<12 premiers hex de son user_id>`
// (format historique) ou `zrex_<…>_<suffixe>`. Le préfixe dérive de l'id
// authentifié : un tenant ne peut pas produire le préfixe d'un autre.

import { logEvent } from '@/lib/security/safe-log';

export type WhatsAppServiceType = 'auto_confirmation' | 'sav' | 'tracking';

const SERVICE_SUFFIX: Record<WhatsAppServiceType, string> = {
  auto_confirmation: 'auto',
  sav: 'sav',
  tracking: 'track',
};

function tenantPrefix(tenantId: string): string {
  return `zrex_${tenantId.replace(/-/g, '').slice(0, 12)}`;
}

/** Nom attribué par le serveur à l'instance d'un tenant pour un service. */
export function instanceNameFor(tenantId: string, service: WhatsAppServiceType): string {
  return `${tenantPrefix(tenantId)}_${SERVICE_SUFFIX[service]}`;
}

/** Le nom appartient-il à l'espace de noms de ce tenant ? */
export function isOwnedInstanceName(tenantId: string, name: unknown): name is string {
  if (typeof tenantId !== 'string' || tenantId.replace(/-/g, '').length < 12) return false;
  if (typeof name !== 'string' || !name) return false;
  const prefix = tenantPrefix(tenantId);
  if (name === prefix) return true; // format historique, sans suffixe
  return name.startsWith(`${prefix}_`) && /^[a-z]+$/.test(name.slice(prefix.length + 1));
}

/**
 * Renvoie la ligne si son instance_name appartient au tenant, sinon null
 * (journalisé sans le nom : seule la raison et le tenant).
 */
export function ownedInstance<T extends { instance_name?: string | null }>(
  tenantId: string,
  row: T | null | undefined,
  scope: string
): T | null {
  if (!row?.instance_name) return null;
  if (isOwnedInstanceName(tenantId, row.instance_name)) return row;
  logEvent('warn', scope, {
    status: 'rejected',
    reason: 'foreign_instance_name',
    tenant_id: tenantId,
  });
  return null;
}

/**
 * Webhook entrant : parmi les lignes portant ce nom, celle dont l'espace de
 * noms le possède (null sinon). Une ligne étrangère portant le même nom ne
 * capte jamais les messages ; un doublon ne bloque pas la résolution.
 */
export function ownerRowOf<T extends { user_id: string }>(
  rows: T[] | null | undefined,
  instanceName: string
): T | null {
  return (rows ?? []).find((r) => isOwnedInstanceName(r.user_id, instanceName)) ?? null;
}
