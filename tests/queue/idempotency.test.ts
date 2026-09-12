// Phase 1 — Clés d'idempotence.
//
// Enjeu : c'est la garantie qui rend sûre la coexistence navigateur + cron
// pendant la migration progressive (sync_source = 'both'). Si les deux chemins
// calculaient des clés différentes, le tenant pilote subirait deux syncs
// simultanés — et potentiellement deux fois les notifications WhatsApp.

import { describe, it, expect } from 'vitest';
import {
  syncSlot,
  syncKey,
  notificationKey,
  campaignRecipientKey,
  campaignDispatchKey,
  SYNC_SLOT_SECONDS,
} from '@/lib/queue/idempotency';

const TENANT = '73b8e14c-97d2-4691-895d-1c7d234a51b0'; // tenant pilote

describe('syncSlot — fenêtre de 5 minutes', () => {
  it('regroupe deux instants du même créneau', () => {
    const a = new Date('2026-09-10T12:00:10Z');
    const b = new Date('2026-09-10T12:04:59Z');
    expect(syncSlot(a)).toBe(syncSlot(b));
  });

  it('sépare deux créneaux consécutifs', () => {
    const a = new Date('2026-09-10T12:04:59Z');
    const b = new Date('2026-09-10T12:05:01Z');
    expect(syncSlot(a)).not.toBe(syncSlot(b));
  });

  it('avance de 1 exactement toutes les 5 minutes', () => {
    const t = new Date('2026-09-10T12:00:00Z');
    const suivant = new Date(t.getTime() + SYNC_SLOT_SECONDS * 1000);
    expect(syncSlot(suivant) - syncSlot(t)).toBe(1);
  });
});

describe('syncKey — anti-doublon navigateur / cron', () => {
  it('LE cas critique : deux déclencheurs dans le même créneau → une seule clé', () => {
    // Le navigateur déclenche à 12:00:03, le cron à 12:02:41.
    // Les deux DOIVENT produire la même clé, sinon double sync.
    const navigateur = syncKey(TENANT, new Date('2026-09-10T12:00:03Z'));
    const cron = syncKey(TENANT, new Date('2026-09-10T12:02:41Z'));
    expect(navigateur).toBe(cron);
  });

  it('deux tenants ne se bloquent jamais mutuellement', () => {
    const autre = '7a74e3ca-27ac-4462-ae4b-64f667835b20';
    const t = new Date('2026-09-10T12:00:00Z');
    expect(syncKey(TENANT, t)).not.toBe(syncKey(autre, t));
  });

  it('un nouveau créneau autorise un nouveau sync', () => {
    const a = syncKey(TENANT, new Date('2026-09-10T12:00:00Z'));
    const b = syncKey(TENANT, new Date('2026-09-10T12:05:00Z'));
    expect(a).not.toBe(b);
  });

  it('est préfixée et contient le tenant', () => {
    const k = syncKey(TENANT);
    expect(k.startsWith('sync:')).toBe(true);
    expect(k).toContain(TENANT);
  });
});

describe('notificationKey', () => {
  it('est alignée sur uniq_pending_notif (user_id, tracking, statut)', () => {
    const k = notificationKey(TENANT, 'ZR-123', 'livre');
    expect(k).toBe(`notif:${TENANT}:ZR-123:livre`);
  });

  it('distingue deux statuts du même colis', () => {
    expect(notificationKey(TENANT, 'ZR-123', 'en_transit')).not.toBe(
      notificationKey(TENANT, 'ZR-123', 'livre')
    );
  });

  it('distingue deux colis du même statut', () => {
    expect(notificationKey(TENANT, 'ZR-1', 'livre')).not.toBe(
      notificationKey(TENANT, 'ZR-2', 'livre')
    );
  });

  it('est stable — deux appels identiques donnent la même clé', () => {
    expect(notificationKey(TENANT, 'ZR-9', 'echec')).toBe(notificationKey(TENANT, 'ZR-9', 'echec'));
  });
});

describe('campaignRecipientKey — un destinataire servi une seule fois', () => {
  it('identifie campagne + téléphone', () => {
    expect(campaignRecipientKey('c1', '213556172674')).toBe('camp:c1:213556172674');
  });

  it('un même numéro dans deux campagnes reste distinct', () => {
    expect(campaignRecipientKey('c1', '213556172674')).not.toBe(
      campaignRecipientKey('c2', '213556172674')
    );
  });

  it('deux destinataires de la même campagne restent distincts', () => {
    expect(campaignRecipientKey('c1', '213111111111')).not.toBe(
      campaignRecipientKey('c1', '213222222222')
    );
  });
});

describe('campaignDispatchKey — un lot enfourné une seule fois', () => {
  it('identifie campagne + offset', () => {
    expect(campaignDispatchKey('c1', 0)).toBe('campdisp:c1:0');
    expect(campaignDispatchKey('c1', 25)).toBe('campdisp:c1:25');
  });

  it('deux offsets sont distincts — le curseur peut avancer', () => {
    expect(campaignDispatchKey('c1', 0)).not.toBe(campaignDispatchKey('c1', 25));
  });
});
