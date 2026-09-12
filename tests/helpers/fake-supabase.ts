// Client Supabase EN MÉMOIRE pour les tests d'intégration des handlers.
//
// Reproduit le sous-ensemble de l'API PostgREST réellement utilisé par
// src/lib/queue/** et ses dépendances (plan-quotas, message-builder) :
//   .schema() .from() .select() .insert() .upsert() .update()
//   .eq() .neq() .in() .gte() .lte() .lt() .gt() .is() .not()
//   .order() .limit() .range() .maybeSingle() .single()  + thenable
//
// Il applique aussi les contraintes de `autotim.jobs` déclarées dans
// db/migrations/002_autotim_queue.sql (statuts, types, attempts, cohérence du
// verrou, unicité de idempotency_key) : un test qui violerait une contrainte
// réelle échoue ici aussi.
//
// Il ne remplace PAS le test contre la vraie base (tests/integration/) — il
// permet d'exercer les handlers sans réseau, sans WhatsApp, sans ZRExpress et
// sans toucher `public`.

import { randomUUID } from 'node:crypto';

export type Row = Record<string, any>;

interface PgError {
  code: string;
  message: string;
  details?: string | null;
  hint?: string | null;
}

interface Filter {
  kind: 'eq' | 'neq' | 'in' | 'gte' | 'lte' | 'lt' | 'gt' | 'is' | 'not-is';
  col: string;
  val: any;
}

interface Order {
  col: string;
  ascending: boolean;
}

type Op = 'select' | 'insert' | 'upsert' | 'update';

const JOB_STATUSES = new Set(['pending', 'running', 'done', 'failed', 'dead']);
const JOB_TYPES = new Set(['zrexpress.sync', 'whatsapp.send', 'campaign.dispatch']);
const SYNC_SOURCES = new Set(['client', 'server', 'both']);

function key(schema: string, table: string): string {
  return `${schema}.${table}`;
}

/** Contraintes CHECK de 002_autotim_queue.sql — mêmes noms qu'en base. */
function checkConstraints(fullTable: string, row: Row): PgError | null {
  if (fullTable === 'autotim.jobs') {
    if (!JOB_STATUSES.has(row.status)) return chk('jobs_status_chk');
    if (!JOB_TYPES.has(row.type)) return chk('jobs_type_chk');
    if (!(row.attempts >= 0 && row.max_attempts >= 1 && row.attempts <= row.max_attempts + 1)) {
      return chk('jobs_attempts_chk');
    }
    if ((row.status === 'running') !== (row.locked_at != null)) {
      return chk('jobs_locked_coherence_chk');
    }
  }
  if (fullTable === 'autotim.tenant_settings') {
    if (!SYNC_SOURCES.has(row.sync_source)) return chk('tenant_settings_source_chk');
    if (!(row.consecutive_send_failures >= 0)) return chk('tenant_settings_failures_chk');
  }
  return null;
}

function chk(name: string): PgError {
  return { code: '23514', message: `new row violates check constraint "${name}"` };
}

/** Valeurs par défaut (DEFAULT ...) des tables autotim. */
function applyDefaults(fullTable: string, row: Row): Row {
  const now = new Date().toISOString();
  const base: Row = { ...row };
  if (base.id === undefined) base.id = randomUUID();
  if (base.created_at === undefined) base.created_at = now;
  if (base.updated_at === undefined) base.updated_at = now;

  if (fullTable === 'autotim.jobs') {
    base.payload ??= {};
    base.status ??= 'pending';
    base.run_after ??= now;
    base.attempts ??= 0;
    base.max_attempts ??= 5;
    base.locked_at ??= null;
    base.locked_by ??= null;
    base.last_error ??= null;
    base.idempotency_key ??= null;
  }
  if (fullTable === 'autotim.tenant_settings') {
    delete base.id; // PK = tenant_id
    base.auto_sync_enabled ??= false;
    base.sync_source ??= 'client';
    base.last_synced_at ??= null;
    base.consecutive_send_failures ??= 0;
    base.circuit_open_until ??= null;
  }
  return base;
}

function cmp(a: any, b: any): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1; // NULLS LAST
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

function matches(row: Row, f: Filter): boolean {
  const v = row[f.col];
  switch (f.kind) {
    case 'eq':
      return v === f.val;
    case 'neq':
      return v !== f.val;
    case 'in':
      return (f.val as any[]).includes(v);
    case 'gte':
      return cmp(v, f.val) >= 0 && v != null;
    case 'lte':
      return cmp(v, f.val) <= 0 && v != null;
    case 'lt':
      return cmp(v, f.val) < 0 && v != null;
    case 'gt':
      return cmp(v, f.val) > 0 && v != null;
    case 'is':
      return f.val === null ? v == null : v === f.val;
    case 'not-is':
      return f.val === null ? v != null : v !== f.val;
  }
}

export class FakeSupabase {
  private tables = new Map<string, Row[]>();
  private pendingErrors: Array<{ table: string; op: Op; error: PgError }> = [];
  /** Journal de toutes les écritures — utile pour les assertions d'isolation. */
  readonly writes: Array<{ table: string; op: Op; rows: Row[] }> = [];

  // ── API publique de test ───────────────────────────────────────────────────

  /** Insère directement des lignes (fixture), sans passer par les contraintes. */
  seed(schema: string, table: string, rows: Row[]): Row[] {
    const k = key(schema, table);
    const out = rows.map((r) => applyDefaults(k, r));
    this.rows(k).push(...out);
    return out;
  }

  all(schema: string, table: string): Row[] {
    return [...this.rows(key(schema, table))];
  }

  /** La prochaine opération `op` sur `table` échouera avec `error`. */
  failNext(schema: string, table: string, op: Op, error: Partial<PgError> = {}): void {
    this.pendingErrors.push({
      table: key(schema, table),
      op,
      error: { code: error.code ?? 'XX000', message: error.message ?? 'injected failure' },
    });
  }

  reset(): void {
    this.tables.clear();
    this.pendingErrors = [];
    this.writes.length = 0;
  }

  // ── Surface supabase-js utilisée par le code ───────────────────────────────

  schema(name: string) {
    return { from: (table: string) => new Builder(this, key(name, table)) };
  }

  from(table: string) {
    return new Builder(this, key('public', table));
  }

  // ── Interne ────────────────────────────────────────────────────────────────

  /** @internal */
  rows(fullTable: string): Row[] {
    let r = this.tables.get(fullTable);
    if (!r) {
      r = [];
      this.tables.set(fullTable, r);
    }
    return r;
  }

  /** @internal */
  takeError(fullTable: string, op: Op): PgError | null {
    const i = this.pendingErrors.findIndex((e) => e.table === fullTable && e.op === op);
    if (i < 0) return null;
    return this.pendingErrors.splice(i, 1)[0].error;
  }
}

class Builder implements PromiseLike<{ data: any; error: PgError | null; count: number | null }> {
  private op: Op = 'select';
  private filters: Filter[] = [];
  private orders: Order[] = [];
  private lim: number | null = null;
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private payload: Row | Row[] | null = null;
  private upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  private wantRows = false; // .select() chaîné après une écriture
  private countMode = false;
  private headMode = false;
  private singleMode: 'maybe' | 'strict' | null = null;

  constructor(
    private db: FakeSupabase,
    private table: string
  ) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.op === 'select') {
      this.countMode = opts?.count === 'exact';
      this.headMode = !!opts?.head;
    } else {
      this.wantRows = true;
    }
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = 'insert';
    this.payload = rows;
    return this;
  }
  upsert(rows: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.op = 'upsert';
    this.payload = rows;
    this.upsertOpts = opts;
    return this;
  }
  update(patch: Row) {
    this.op = 'update';
    this.payload = patch;
    return this;
  }
  eq(col: string, val: any) {
    this.filters.push({ kind: 'eq', col, val });
    return this;
  }
  neq(col: string, val: any) {
    this.filters.push({ kind: 'neq', col, val });
    return this;
  }
  in(col: string, val: any[]) {
    this.filters.push({ kind: 'in', col, val });
    return this;
  }
  gte(col: string, val: any) {
    this.filters.push({ kind: 'gte', col, val });
    return this;
  }
  lte(col: string, val: any) {
    this.filters.push({ kind: 'lte', col, val });
    return this;
  }
  lt(col: string, val: any) {
    this.filters.push({ kind: 'lt', col, val });
    return this;
  }
  gt(col: string, val: any) {
    this.filters.push({ kind: 'gt', col, val });
    return this;
  }
  is(col: string, val: any) {
    this.filters.push({ kind: 'is', col, val });
    return this;
  }
  not(col: string, operator: string, val: any) {
    if (operator !== 'is') throw new Error(`fake-supabase: .not('${operator}') non supporté`);
    this.filters.push({ kind: 'not-is', col, val });
    return this;
  }
  order(col: string, opts: { ascending?: boolean } = {}) {
    this.orders.push({ col, ascending: opts.ascending !== false });
    return this;
  }
  limit(n: number) {
    this.lim = n;
    return this;
  }
  range(from: number, to: number) {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }
  maybeSingle() {
    this.singleMode = 'maybe';
    return this;
  }
  single() {
    this.singleMode = 'strict';
    return this;
  }

  then<R1 = any, R2 = never>(
    onfulfilled?:
      | ((v: { data: any; error: PgError | null; count: number | null }) => R1 | PromiseLike<R1>)
      | null,
    onrejected?: ((reason: any) => R2 | PromiseLike<R2>) | null
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  // ── Exécution ──────────────────────────────────────────────────────────────

  private execute(): { data: any; error: PgError | null; count: number | null } {
    const injected = this.db.takeError(this.table, this.op);
    if (injected) return { data: null, error: injected, count: null };

    switch (this.op) {
      case 'select':
        return this.runSelect();
      case 'insert':
        return this.finish(this.runInsert(false));
      case 'upsert':
        return this.finish(this.runInsert(true));
      case 'update':
        return this.finish(this.runUpdate());
    }
  }

  private filtered(): Row[] {
    return this.db.rows(this.table).filter((r) => this.filters.every((f) => matches(r, f)));
  }

  private runSelect() {
    let rows = this.filtered();
    if (this.orders.length) {
      rows = [...rows].sort((a, b) => {
        for (const o of this.orders) {
          const c = cmp(a[o.col], b[o.col]);
          if (c !== 0) return o.ascending ? c : -c;
        }
        return 0;
      });
    }
    if (this.rangeFrom != null && this.rangeTo != null) {
      rows = rows.slice(this.rangeFrom, this.rangeTo + 1);
    }
    if (this.lim != null) rows = rows.slice(0, this.lim);

    if (this.countMode && this.headMode) return { data: null, error: null, count: rows.length };
    return this.shape(rows.map((r) => ({ ...r })));
  }

  private runInsert(upsert: boolean): { rows: Row[]; error: PgError | null } {
    const input = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
    const store = this.db.rows(this.table);
    const conflictCols =
      upsert && this.upsertOpts.onConflict
        ? this.upsertOpts.onConflict.split(',').map((s) => s.trim())
        : null;
    const out: Row[] = [];

    for (const raw of input) {
      const row = applyDefaults(this.table, raw);

      // Unicité — index jobs_idempotency_uniq (non partiel) + clé de conflit.
      const conflictIdx = this.findConflict(store, row, conflictCols);
      if (conflictIdx >= 0) {
        if (!upsert || !conflictCols) {
          return {
            rows: [],
            error: { code: '23505', message: 'duplicate key value violates unique constraint' },
          };
        }
        if (this.upsertOpts.ignoreDuplicates) continue; // ON CONFLICT DO NOTHING
        const merged = { ...store[conflictIdx], ...raw, updated_at: new Date().toISOString() };
        const err = checkConstraints(this.table, merged);
        if (err) return { rows: [], error: err };
        store[conflictIdx] = merged;
        out.push(merged);
        continue;
      }

      const err = checkConstraints(this.table, row);
      if (err) return { rows: [], error: err };
      store.push(row);
      out.push(row);
    }
    this.db.writes.push({ table: this.table, op: upsert ? 'upsert' : 'insert', rows: out });
    return { rows: out, error: null };
  }

  private findConflict(store: Row[], row: Row, conflictCols: string[] | null): number {
    // Index unique implicite de autotim.jobs sur idempotency_key (NULL exclus).
    if (this.table === 'autotim.jobs' && row.idempotency_key != null) {
      const i = store.findIndex((r) => r.idempotency_key === row.idempotency_key);
      if (i >= 0) return i;
    }
    if (conflictCols) {
      return store.findIndex((r) => conflictCols.every((c) => r[c] === row[c]));
    }
    return -1;
  }

  private runUpdate(): { rows: Row[]; error: PgError | null } {
    const patch = this.payload as Row;
    const store = this.db.rows(this.table);
    const targets = this.filtered();
    const out: Row[] = [];
    for (const t of targets) {
      const idx = store.indexOf(t);
      const merged = { ...t, ...patch };
      const err = checkConstraints(this.table, merged);
      if (err) return { rows: [], error: err };
      store[idx] = merged;
      out.push(merged);
    }
    this.db.writes.push({ table: this.table, op: 'update', rows: out });
    return { rows: out, error: null };
  }

  private finish(r: { rows: Row[]; error: PgError | null }) {
    if (r.error) return { data: null, error: r.error, count: null };
    if (!this.wantRows) return { data: null, error: null, count: null };
    return this.shape(r.rows.map((x) => ({ ...x })));
  }

  private shape(rows: Row[]) {
    if (this.singleMode === 'maybe') {
      if (rows.length > 1) {
        return {
          data: null,
          error: { code: 'PGRST116', message: 'multiple rows returned' },
          count: null,
        };
      }
      return { data: rows[0] ?? null, error: null, count: null };
    }
    if (this.singleMode === 'strict') {
      if (rows.length !== 1) {
        return {
          data: null,
          error: { code: 'PGRST116', message: `${rows.length} rows returned` },
          count: null,
        };
      }
      return { data: rows[0], error: null, count: null };
    }
    return { data: rows, error: null, count: this.countMode ? rows.length : null };
  }
}
