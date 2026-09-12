// Phase 1 — Cycle de vie d'un job, testé sur une file en mémoire.
//
// Ces tests rejouent la mécanique de `repository.ts` (claim compare-and-swap,
// backoff, DLQ, reprise des verrous) sans base de données. Ils vérifient les
// INVARIANTS ; les tests contre la vraie base viendront après la migration.
//
// Ce qui est vérifié ici est précisément ce qui manque à l'existant :
// un job qui échoue n'est jamais perdu, un job ne peut pas être pris deux
// fois, et un worker tué ne bloque pas un job pour toujours.

import { describe, it, expect, beforeEach } from 'vitest';
import { nextRunAfter } from '@/lib/queue/backoff';
import { MAX_ATTEMPTS, type Job, type JobStatus, type JobType } from '@/lib/queue/types';

const STALE_LOCK_MS = 5 * 60_000;

/** File en mémoire reproduisant la sémantique SQL de repository.ts. */
class FileEnMemoire {
  jobs: Job[] = [];
  private seq = 0;

  enqueue(input: {
    tenantId: string;
    type: JobType;
    idempotencyKey?: string;
    runAfter?: Date;
  }): Job | null {
    // Index unique sur idempotency_key → ON CONFLICT DO NOTHING
    if (input.idempotencyKey && this.jobs.some((j) => j.idempotency_key === input.idempotencyKey)) {
      return null;
    }
    const job: Job = {
      id: `job-${++this.seq}`,
      tenant_id: input.tenantId,
      type: input.type,
      payload: {},
      status: 'pending',
      run_after: (input.runAfter ?? new Date()).toISOString(),
      attempts: 0,
      max_attempts: MAX_ATTEMPTS[input.type],
      locked_at: null,
      locked_by: null,
      last_error: null,
      idempotency_key: input.idempotencyKey ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.jobs.push(job);
    return job;
  }

  /** Compare-and-swap : UPDATE ... WHERE id=? AND status='pending'. */
  claim(limit: number, worker: string, now: Date = new Date()): Job[] {
    const dus = this.jobs
      .filter((j) => j.status === 'pending' && new Date(j.run_after) <= now)
      .sort((a, b) => a.run_after.localeCompare(b.run_after));

    const pris: Job[] = [];
    for (const j of dus) {
      if (pris.length >= limit) break;
      if (j.status !== 'pending') continue; // un autre worker l'a pris
      j.status = 'running';
      j.locked_at = now.toISOString();
      j.locked_by = worker;
      j.attempts += 1;
      pris.push(j);
    }
    return pris;
  }

  markDone(id: string): void {
    const j = this.get(id);
    j.status = 'done';
    j.locked_at = null;
    j.locked_by = null;
  }

  markFailed(id: string, error: string): JobStatus {
    const j = this.get(id);
    const epuise = j.attempts >= j.max_attempts;
    j.status = epuise ? 'dead' : 'pending';
    j.locked_at = null;
    j.locked_by = null;
    j.last_error = error;
    if (!epuise) j.run_after = nextRunAfter(j.attempts).toISOString();
    return j.status;
  }

  /** Report sans consommer de tentative. */
  markRescheduled(id: string, runAfter: Date, reason: string): void {
    const j = this.get(id);
    j.status = 'pending';
    j.locked_at = null;
    j.locked_by = null;
    j.attempts = Math.max(0, j.attempts - 1);
    j.last_error = reason;
    j.run_after = runAfter.toISOString();
  }

  recoverStaleLocks(now: Date = new Date()): number {
    let n = 0;
    for (const j of this.jobs) {
      if (
        j.status === 'running' &&
        j.locked_at &&
        now.getTime() - new Date(j.locked_at).getTime() > STALE_LOCK_MS
      ) {
        j.status = 'pending';
        j.locked_at = null;
        j.locked_by = null;
        n++;
      }
    }
    return n;
  }

  get(id: string): Job {
    const j = this.jobs.find((x) => x.id === id);
    if (!j) throw new Error(`job ${id} introuvable`);
    return j;
  }

  byStatus(s: JobStatus): Job[] {
    return this.jobs.filter((j) => j.status === s);
  }
}

const TENANT_A = '73b8e14c-97d2-4691-895d-1c7d234a51b0';
const TENANT_B = '7a74e3ca-27ac-4462-ae4b-64f667835b20';

let file: FileEnMemoire;
beforeEach(() => {
  file = new FileEnMemoire();
});

describe("Idempotence à l'enfilement", () => {
  it('un second enfilement de la même clé est un no-op', () => {
    const a = file.enqueue({
      tenantId: TENANT_A,
      type: 'zrexpress.sync',
      idempotencyKey: 'sync:A:1',
    });
    const b = file.enqueue({
      tenantId: TENANT_A,
      type: 'zrexpress.sync',
      idempotencyKey: 'sync:A:1',
    });
    expect(a).not.toBeNull();
    expect(b).toBeNull();
    expect(file.jobs).toHaveLength(1);
  });

  it('NAVIGATEUR + CRON dans le même créneau → un seul job', () => {
    // Le scénario exact de la migration progressive (sync_source = 'both').
    file.enqueue({ tenantId: TENANT_A, type: 'zrexpress.sync', idempotencyKey: 'sync:A:9999' });
    file.enqueue({ tenantId: TENANT_A, type: 'zrexpress.sync', idempotencyKey: 'sync:A:9999' });
    expect(file.jobs).toHaveLength(1);
  });

  it('deux tenants ne se bloquent pas', () => {
    file.enqueue({ tenantId: TENANT_A, type: 'zrexpress.sync', idempotencyKey: 'sync:A:1' });
    file.enqueue({ tenantId: TENANT_B, type: 'zrexpress.sync', idempotencyKey: 'sync:B:1' });
    expect(file.jobs).toHaveLength(2);
  });

  it('sans clé, plusieurs jobs coexistent (NULL distincts en PostgreSQL)', () => {
    file.enqueue({ tenantId: TENANT_A, type: 'whatsapp.send' });
    file.enqueue({ tenantId: TENANT_A, type: 'whatsapp.send' });
    expect(file.jobs).toHaveLength(2);
  });
});

describe('Claim — exclusivité', () => {
  it("un job n'est JAMAIS attribué deux fois", () => {
    file.enqueue({ tenantId: TENANT_A, type: 'zrexpress.sync' });
    const w1 = file.claim(5, 'worker-1');
    const w2 = file.claim(5, 'worker-2');
    expect(w1).toHaveLength(1);
    expect(w2).toHaveLength(0);
  });

  it('ne rend que les jobs dus', () => {
    const futur = new Date(Date.now() + 60_000);
    file.enqueue({ tenantId: TENANT_A, type: 'whatsapp.send', runAfter: futur });
    expect(file.claim(5, 'w')).toHaveLength(0);
  });

  it('respecte la limite demandée', () => {
    for (let i = 0; i < 10; i++) file.enqueue({ tenantId: TENANT_A, type: 'whatsapp.send' });
    expect(file.claim(3, 'w')).toHaveLength(3);
  });

  it('incrémente attempts à la prise', () => {
    file.enqueue({ tenantId: TENANT_A, type: 'zrexpress.sync' });
    expect(file.claim(1, 'w')[0].attempts).toBe(1);
  });

  it("pose le verrou et l'identité du worker", () => {
    file.enqueue({ tenantId: TENANT_A, type: 'zrexpress.sync' });
    const j = file.claim(1, 'worker-42')[0];
    expect(j.status).toBe('running');
    expect(j.locked_by).toBe('worker-42');
    expect(j.locked_at).not.toBeNull();
  });
});

describe('Retry et DLQ', () => {
  it('un échec replanifie sans perdre le job', () => {
    file.enqueue({ tenantId: TENANT_A, type: 'zrexpress.sync' });
    const j = file.claim(1, 'w')[0];
    expect(file.markFailed(j.id, 'Evolution HTTP 500')).toBe('pending');
    expect(file.get(j.id).last_error).toContain('500');
    expect(file.byStatus('dead')).toHaveLength(0);
  });

  it('le délai croît entre deux tentatives', () => {
    file.enqueue({ tenantId: TENANT_A, type: 'zrexpress.sync' });
    const j = file.claim(1, 'w')[0];
    file.markFailed(j.id, 'échec 1');
    const t1 = new Date(file.get(j.id).run_after).getTime();

    file.get(j.id).run_after = new Date(0).toISOString();
    const j2 = file.claim(1, 'w')[0];
    file.markFailed(j2.id, 'échec 2');
    const t2 = new Date(file.get(j.id).run_after).getTime();

    expect(t2).toBeGreaterThan(t1);
  });

  it('bascule en DLQ une fois max_attempts atteint', () => {
    file.enqueue({ tenantId: TENANT_A, type: 'zrexpress.sync' }); // max = 3
    for (let i = 0; i < 3; i++) {
      file.get('job-1').run_after = new Date(0).toISOString();
      const j = file.claim(1, 'w')[0];
      file.markFailed(j.id, `échec ${i + 1}`);
    }
    expect(file.get('job-1').status).toBe('dead');
  });

  it("un job mort n'est plus jamais réclamé", () => {
    file.enqueue({ tenantId: TENANT_A, type: 'zrexpress.sync' });
    for (let i = 0; i < 3; i++) {
      file.get('job-1').run_after = new Date(0).toISOString();
      const j = file.claim(1, 'w')[0];
      file.markFailed(j.id, 'échec');
    }
    expect(file.claim(5, 'w')).toHaveLength(0);
  });

  it('whatsapp.send part en DLQ dès le PREMIER échec (max_attempts = 1)', () => {
    // Invariant anti-ban : un envoi n'est jamais rejoué.
    file.enqueue({ tenantId: TENANT_A, type: 'whatsapp.send' });
    const j = file.claim(1, 'w')[0];
    expect(file.markFailed(j.id, 'Connection Closed')).toBe('dead');
  });

  it('aucun job ne disparaît jamais silencieusement', () => {
    for (let i = 0; i < 5; i++) file.enqueue({ tenantId: TENANT_A, type: 'whatsapp.send' });
    for (const j of file.claim(5, 'w')) file.markFailed(j.id, 'panne');
    expect(file.byStatus('dead')).toHaveLength(5);
    expect(file.jobs).toHaveLength(5); // rien de perdu
  });
});

describe('Reschedule — ne consomme pas de tentative', () => {
  it('quota épuisé : le job revient sans se rapprocher de la DLQ', () => {
    file.enqueue({ tenantId: TENANT_A, type: 'whatsapp.send' }); // max = 1
    const j = file.claim(1, 'w')[0];
    expect(j.attempts).toBe(1);

    file.markRescheduled(j.id, new Date(Date.now() + 60_000), 'plafond journalier atteint');

    const apres = file.get(j.id);
    expect(apres.status).toBe('pending');
    expect(apres.attempts).toBe(0); // ← décrémenté : l'attente n'est pas un échec
  });

  it('un report répété ne tue JAMAIS le job', () => {
    // Sinon un quota épuisé plusieurs jours de suite perdrait la notification.
    file.enqueue({ tenantId: TENANT_A, type: 'whatsapp.send' });
    for (let i = 0; i < 50; i++) {
      file.get('job-1').run_after = new Date(0).toISOString();
      const j = file.claim(1, 'w')[0];
      file.markRescheduled(j.id, new Date(), 'quota');
    }
    expect(file.get('job-1').status).toBe('pending');
    expect(file.byStatus('dead')).toHaveLength(0);
  });
});

describe('Reprise des verrous morts', () => {
  it('libère un job dont le worker a été tué', () => {
    file.enqueue({ tenantId: TENANT_A, type: 'zrexpress.sync' });
    const j = file.claim(1, 'worker-tue')[0];

    const plusTard = new Date(Date.now() + STALE_LOCK_MS + 60_000);
    expect(file.recoverStaleLocks(plusTard)).toBe(1);
    expect(file.get(j.id).status).toBe('pending');
    expect(file.get(j.id).locked_by).toBeNull();
  });

  it('ne touche PAS un job en cours depuis peu', () => {
    file.enqueue({ tenantId: TENANT_A, type: 'zrexpress.sync' });
    file.claim(1, 'worker-actif');
    expect(file.recoverStaleLocks(new Date(Date.now() + 60_000))).toBe(0);
    expect(file.byStatus('running')).toHaveLength(1);
  });

  it('un job repris est de nouveau exécutable', () => {
    file.enqueue({ tenantId: TENANT_A, type: 'zrexpress.sync' });
    file.claim(1, 'worker-tue');
    file.recoverStaleLocks(new Date(Date.now() + STALE_LOCK_MS + 60_000));
    expect(file.claim(1, 'worker-neuf')).toHaveLength(1);
  });
});

describe('Isolation entre tenants', () => {
  it('les jobs restent attribués à leur tenant', () => {
    file.enqueue({ tenantId: TENANT_A, type: 'zrexpress.sync' });
    file.enqueue({ tenantId: TENANT_B, type: 'zrexpress.sync' });

    const pris = file.claim(10, 'w');
    expect(pris.filter((j) => j.tenant_id === TENANT_A)).toHaveLength(1);
    expect(pris.filter((j) => j.tenant_id === TENANT_B)).toHaveLength(1);
    // Aucun job ne change de propriétaire au passage.
    expect(new Set(pris.map((j) => j.tenant_id)).size).toBe(2);
  });

  it("l'échec d'un tenant n'affecte pas l'autre", () => {
    file.enqueue({ tenantId: TENANT_A, type: 'whatsapp.send' });
    file.enqueue({ tenantId: TENANT_B, type: 'whatsapp.send' });

    const pris = file.claim(10, 'w');
    const a = pris.find((j) => j.tenant_id === TENANT_A)!;
    file.markFailed(a.id, 'panne A');

    const b = file.jobs.find((j) => j.tenant_id === TENANT_B)!;
    expect(b.status).toBe('running');
    expect(b.last_error).toBeNull();
  });
});
