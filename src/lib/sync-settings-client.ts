// Helper côté client pour charger/sauver les settings cross-device.
// Toutes les pages lisent et écrivent leurs settings via cette API, qui
// les stocke dans la table Supabase user_sync_settings (RLS strict).
//
// Inclut une auto-migration one-shot depuis l'ancien stockage localStorage :
// si la table est vide ET que localStorage contient encore des données
// historiques, on les pousse sur le serveur. Ça permet aux utilisateurs
// qui avaient configuré leur PC AVANT le passage en cross-device de ne
// rien perdre la première fois qu'ils chargent une page.

'use client';

export interface SyncSettings {
  zrexpress_token: string;
  zrexpress_tenant_id: string;
  templates: Record<string, string>;
  notify_enabled: Record<string, boolean>;
}

const EMPTY: SyncSettings = {
  zrexpress_token: '',
  zrexpress_tenant_id: '',
  templates: {},
  notify_enabled: {},
};

// Anciennes clés localStorage — lues UNE seule fois pour la migration auto,
// puis nettoyées. Plus aucune écriture en miroir : toutes les pages doivent
// passer par loadSyncSettings / saveSyncSettings.
const LEGACY_LS_TOKEN = 'zrexpress_token';
const LEGACY_LS_TENANT = 'zrexpress_tenant';
const LEGACY_LS_TEMPLATES = 'zrextrack_templates';
const LEGACY_LS_NOTIFY = 'zrextrack_notify_enabled';

function readLegacyLocalStorage(): SyncSettings {
  if (typeof window === 'undefined') return EMPTY;
  let templates: Record<string, string> = {};
  let notify_enabled: Record<string, boolean> = {};
  try { templates = JSON.parse(localStorage.getItem(LEGACY_LS_TEMPLATES) || '{}'); } catch {}
  try { notify_enabled = JSON.parse(localStorage.getItem(LEGACY_LS_NOTIFY) || '{}'); } catch {}
  return {
    zrexpress_token: localStorage.getItem(LEGACY_LS_TOKEN) || '',
    zrexpress_tenant_id: localStorage.getItem(LEGACY_LS_TENANT) || '',
    templates,
    notify_enabled,
  };
}

function clearLegacyLocalStorage(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(LEGACY_LS_TOKEN);
  localStorage.removeItem(LEGACY_LS_TENANT);
  localStorage.removeItem(LEGACY_LS_TEMPLATES);
  localStorage.removeItem(LEGACY_LS_NOTIFY);
}

function hasContent(s: SyncSettings): boolean {
  return !!(s.zrexpress_token || s.zrexpress_tenant_id
    || Object.keys(s.templates ?? {}).length
    || Object.keys(s.notify_enabled ?? {}).length);
}

/**
 * Charge les settings depuis l'API. Si l'API renvoie vide ET que localStorage
 * contient encore des données héritées, on les pousse sur l'API et on nettoie
 * le localStorage (migration automatique one-shot).
 *
 * Renvoie toujours une structure complète — pas de null.
 */
export async function loadSyncSettings(): Promise<SyncSettings> {
  let serverData: SyncSettings = EMPTY;
  try {
    const res = await fetch('/api/sync-settings', { cache: 'no-store' });
    if (res.ok) {
      const json = await res.json();
      const s = json.settings ?? {};
      serverData = {
        zrexpress_token: s.zrexpress_token ?? '',
        zrexpress_tenant_id: s.zrexpress_tenant_id ?? '',
        templates: s.templates ?? {},
        notify_enabled: s.notify_enabled ?? {},
      };
    }
  } catch { /* offline ou non auth — on retourne EMPTY */ }

  if (hasContent(serverData)) {
    // Au cas où d'anciennes données traînent encore en local après une
    // migration partielle, on les nettoie maintenant qu'on a le serveur.
    clearLegacyLocalStorage();
    return serverData;
  }

  // Pas de données serveur — on tente la migration depuis localStorage
  const legacy = readLegacyLocalStorage();
  if (hasContent(legacy)) {
    // Push asynchrone vers le serveur, puis cleanup local
    fetch('/api/sync-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(legacy),
    }).then(res => {
      if (res.ok) clearLegacyLocalStorage();
    }).catch(() => { /* ignore — on retentera au prochain chargement */ });
    return legacy;
  }

  return EMPTY;
}

/**
 * Sauve un sous-ensemble de settings. Le serveur préserve les champs non
 * fournis. Aucune écriture en localStorage — tout passe par l'API.
 */
export async function saveSyncSettings(patch: Partial<SyncSettings>): Promise<void> {
  const res = await fetch('/api/sync-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Erreur sauvegarde sync settings');
  }
}
