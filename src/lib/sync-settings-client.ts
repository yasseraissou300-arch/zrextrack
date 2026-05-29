// Helper côté client pour charger/sauver les settings cross-device.
// Inclut une auto-migration depuis localStorage : si la base est vide ET que
// localStorage a des valeurs, on les pousse sur le serveur (one-shot).
// Comme ça, les utilisateurs qui ont déjà configuré sur leur PC ne perdent
// rien quand on passe en mode cross-device.

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

// Clés localStorage historiques — on les lit une fois pour migration auto,
// puis on les écrit en miroir pour éviter de casser les pages pas encore
// refactorées (DashboardHeader auto-sync, etc.) jusqu'à ce que tout soit migré.
const LS_TOKEN = 'zrexpress_token';
const LS_TENANT = 'zrexpress_tenant';
const LS_TEMPLATES = 'zrextrack_templates';
const LS_NOTIFY = 'zrextrack_notify_enabled';

function readLocalStorage(): SyncSettings {
  if (typeof window === 'undefined') return EMPTY;
  let templates: Record<string, string> = {};
  let notify_enabled: Record<string, boolean> = {};
  try { templates = JSON.parse(localStorage.getItem(LS_TEMPLATES) || '{}'); } catch {}
  try { notify_enabled = JSON.parse(localStorage.getItem(LS_NOTIFY) || '{}'); } catch {}
  return {
    zrexpress_token: localStorage.getItem(LS_TOKEN) || '',
    zrexpress_tenant_id: localStorage.getItem(LS_TENANT) || '',
    templates,
    notify_enabled,
  };
}

function writeLocalStorageMirror(s: SyncSettings): void {
  if (typeof window === 'undefined') return;
  // Miroir vers localStorage — utile pour les pages qui n'ont pas encore
  // été migrées (DashboardHeader autosync, etc.). À retirer quand tout est migré.
  if (s.zrexpress_token) localStorage.setItem(LS_TOKEN, s.zrexpress_token);
  else localStorage.removeItem(LS_TOKEN);
  if (s.zrexpress_tenant_id) localStorage.setItem(LS_TENANT, s.zrexpress_tenant_id);
  else localStorage.removeItem(LS_TENANT);
  localStorage.setItem(LS_TEMPLATES, JSON.stringify(s.templates ?? {}));
  localStorage.setItem(LS_NOTIFY, JSON.stringify(s.notify_enabled ?? {}));
}

function hasContent(s: SyncSettings): boolean {
  return !!(s.zrexpress_token || s.zrexpress_tenant_id
    || Object.keys(s.templates ?? {}).length
    || Object.keys(s.notify_enabled ?? {}).length);
}

/**
 * Charge les settings depuis l'API. Si l'API renvoie vide ET que localStorage
 * contient des données héritées, on pousse ces données sur l'API (migration
 * automatique one-shot pour ne pas perdre la config de l'utilisateur sur son PC).
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
  } catch { /* offline ou non auth — on retombera sur localStorage */ }

  if (hasContent(serverData)) {
    // On garde localStorage en miroir pour les pages non migrées
    writeLocalStorageMirror(serverData);
    return serverData;
  }

  // Pas de données serveur — on tente la migration depuis localStorage
  const local = readLocalStorage();
  if (hasContent(local)) {
    // Push asynchrone vers le serveur (best-effort, on ne bloque pas l'UI)
    fetch('/api/sync-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(local),
    }).catch(() => { /* ignore */ });
    return local;
  }

  return EMPTY;
}

/**
 * Sauve un sous-ensemble de settings. Le serveur preserve ce qui n'est pas
 * fourni. On met aussi à jour le miroir localStorage pour les pages pas
 * encore refactorées.
 */
export async function saveSyncSettings(patch: Partial<SyncSettings>): Promise<void> {
  // Met à jour le miroir localStorage immédiatement (UX rapide pour pages non migrées)
  if (typeof window !== 'undefined') {
    if (patch.zrexpress_token !== undefined) {
      if (patch.zrexpress_token) localStorage.setItem(LS_TOKEN, patch.zrexpress_token);
      else localStorage.removeItem(LS_TOKEN);
    }
    if (patch.zrexpress_tenant_id !== undefined) {
      if (patch.zrexpress_tenant_id) localStorage.setItem(LS_TENANT, patch.zrexpress_tenant_id);
      else localStorage.removeItem(LS_TENANT);
    }
    if (patch.templates !== undefined) localStorage.setItem(LS_TEMPLATES, JSON.stringify(patch.templates));
    if (patch.notify_enabled !== undefined) localStorage.setItem(LS_NOTIFY, JSON.stringify(patch.notify_enabled));
  }

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
