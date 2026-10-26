// Preuve locale (PGlite, aucune base réelle) de la migration 009 et de MIGRATION-009-PROOF.sql.
// Usage : npm i --no-save @electric-sql/pglite@0.2.17 && node docs/sql/proof-009-pglite.mjs db/proposed docs/sql/MIGRATION-009-PROOF.sql
// Attendu : AVANT 009 → étapes 3 et 5 FAIL (faille) ; APRÈS 009 → tout PASS ; données inchangées (ROLLBACK).
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
const [migDir, proofPath] = process.argv.slice(2);
const mig = fs.readFileSync(`${migDir}/009_whatsapp_instances_rls.sql`, 'utf8').replace(/ROLLBACK;\s*(-- ── 5[\s\S]*)?$/, 'COMMIT;');
const proof = fs.readFileSync(proofPath, 'utf8');
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
for (const apply of [false, true]) {
  const db = new PGlite();
  await db.exec(`
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub'))::uuid $$;
  create role anon; create role authenticated;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  create table public.whatsapp_instances(id serial primary key, user_id uuid not null, service_type text, instance_name text not null unique, connected bool default false);
  grant select, insert, update, delete on public.whatsapp_instances to anon, authenticated;
  grant usage on sequence public.whatsapp_instances_id_seq to authenticated, anon;
  alter table public.whatsapp_instances enable row level security;
  create policy "whatsapp_instances_user_isolation" on public.whatsapp_instances for all using (auth.uid() = user_id);
  insert into public.whatsapp_instances(user_id, service_type, instance_name) values ('${A}','auto_confirmation','zrex_111111111111_auto'), ('${B}','auto_confirmation','zrex_222222222222_auto');`);
  if (apply) await db.exec(mig);
  const res = await db.exec(proof);
  const rows = res.flatMap((r) => r.rows).filter((r) => r.check_id);
  console.log(`== ${apply ? 'APRÈS 009' : 'AVANT 009 (politique historique)'}`);
  for (const r of rows) console.log(`  ${r.check_id} : ${r.resultat}`);
  const after = await db.query(`select user_id, instance_name from public.whatsapp_instances order by user_id`);
  console.log(`  état final inchangé (ROLLBACK) : ${JSON.stringify(after.rows.map((r) => r.instance_name))}`);
}
