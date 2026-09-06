// Phase 0 — Test D : isolation multi-tenant.
//
// CONTEXTE CRITIQUE (voir db/baseline/000_SCHEMA_REEL.md) :
// la RLS est CASSÉE en production sur `orders`, `profiles` et `messages`
// (récursion infinie 42P17), et 48 routes sur 58 utilisent `createServiceClient()`
// qui contourne la RLS de toute façon.
//
// ⇒ L'isolation entre entreprises repose ENTIÈREMENT sur le scoping applicatif
//   `.eq('user_id', ...)` dans chaque requête.
//
// Ces tests analysent le code source pour garantir qu'aucune requête sur une
// table multi-tenant n'oublie ce scoping. Ils ne remplacent PAS de vrais tests
// RLS en base (impossibles sans service_role), mais ils verrouillent la seule
// protection réellement active aujourd'hui.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const API_DIR = path.resolve(__dirname, '../src/app/api');

/** Tables portant des données propres à une entreprise. */
const TABLES_MULTI_TENANT = [
  'orders', 'messages', 'campaigns', 'campaign_recipients',
  'ai_chat_sessions', 'pending_notifications', 'whatsapp_instances',
  'chatbot_configs', 'user_api_credentials', 'user_sync_settings',
  'message_templates', 'autoswap_size_equivalences',
];

/**
 * Routes légitimement non scopées par user_id, avec la raison.
 * Toute nouvelle entrée ici doit être justifiée : c'est une dérogation à
 * l'isolation.
 */
const DEROGATIONS: Record<string, string> = {
  'track/[tracking]/route.ts':
    'Suivi public : recherche par tracking_number, volontairement inter-tenant. Nom client masqué + rate-limit.',
  'ai-chatbot/webhook/whatsapp/route.ts':
    'Webhook : résout le tenant via whatsapp_instances.instance_name puis scope tout le reste.',
  'ai-chatbot/webhook/facebook/route.ts':
    'Webhook : résout le tenant via facebook_connections.page_id.',
  'ai-chatbot/relance/route.ts':
    'Tâche planifiée protégée par CRON_SECRET : balaie volontairement tous les tenants.',
  'admin/users/route.ts':
    'Super Admin : accès inter-tenant délibéré, protégé par vérification du rôle admin.',
};

function fichiersRoute(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) fichiersRoute(p, acc);
    else if (e.name === 'route.ts') acc.push(p);
  }
  return acc;
}

const ROUTES = fichiersRoute(API_DIR);

describe('Inventaire', () => {
  it('trouve les routes API à analyser', () => {
    expect(ROUTES.length).toBeGreaterThan(40);
  });
});

describe('Isolation — toute requête multi-tenant est scopée', () => {
  const violations: string[] = [];

  for (const fichier of ROUTES) {
    const rel = path.relative(API_DIR, fichier).replace(/\\/g, '/');
    const src = fs.readFileSync(fichier, 'utf8');

    // Motif « propriété d'abord » : le handler vérifie l'appartenance de la
    // ressource parente (.eq('user_id', user.id)) et RENVOIE 404 sinon, puis
    // opère par clé primaire. Motif sûr et répandu — audité manuellement en
    // Phase 0 sur campaigns/[id], campaigns/[id]/send et sync-zrexpress.
    const verifiePropriete =
      /\.eq\(\s*['"]user_id['"]\s*,\s*user(Id)?\.?i?d?\s*\)/.test(src) ||
      /\.eq\(\s*['"]user_id['"]\s*,\s*user\.id\s*\)/.test(src);

    for (const table of TABLES_MULTI_TENANT) {
      const re = new RegExp(`\\.from\\(['"]${table}['"]\\)([\\s\\S]{0,600}?);`, 'g');
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const bloc = m[1];
        const scopeDirect =
          /\.eq\(\s*['"]user_id['"]/.test(bloc) ||
          /\.eq\(\s*['"]id['"]\s*,\s*user/.test(bloc) ||
          /user_id\s*:/.test(bloc) ||            // insert/upsert portant user_id
          /onConflict:\s*['"]user_id/.test(bloc);

        // Opération par clé primaire / clé étrangère de la ressource possédée,
        // acceptable UNIQUEMENT si le handler a vérifié la propriété avant.
        const parCleApresVerif =
          verifiePropriete &&
          (/\.eq\(\s*['"]id['"]/.test(bloc) || /\.eq\(\s*['"]campaign_id['"]/.test(bloc) ||
           /campaign_id\s*:/.test(bloc));

        if (!scopeDirect && !parCleApresVerif && !DEROGATIONS[rel]) {
          violations.push(`${rel} → ${table}`);
        }
      }
    }
  }

  it('aucune requête multi-tenant sans scoping ni vérification de propriété', () => {
    expect(violations).toEqual([]);
  });
});

describe('Dérogations à l\'isolation — inventaire figé', () => {
  it('chaque dérogation existe encore et est justifiée', () => {
    for (const [rel, raison] of Object.entries(DEROGATIONS)) {
      expect(fs.existsSync(path.join(API_DIR, rel)), `route absente : ${rel}`).toBe(true);
      expect(raison.length).toBeGreaterThan(20);
    }
  });

  it('la liste reste courte — toute nouvelle dérogation doit être délibérée', () => {
    expect(Object.keys(DEROGATIONS).length).toBeLessThanOrEqual(6);
  });
});

describe('Routes en service-role (contournement RLS)', () => {
  it('toute route service-role vérifie l\'identité, sauf webhooks authentifiés', () => {
    const AUTORISEES_SANS_GETUSER = [
      'ai-chatbot/webhook/whatsapp/route.ts',   // secret partagé (P0-1)
      'ai-chatbot/webhook/facebook/route.ts',   // verify_token Meta
      'ai-chatbot/facebook/callback/route.ts',  // OAuth state
      'ai-chatbot/relance/route.ts',            // CRON_SECRET
      'integrations/shopify/webhook/route.ts',  // HMAC
      'integrations/woocommerce/webhook/route.ts', // HMAC
      'track/[tracking]/route.ts',              // public + rate-limit
      'health/route.ts',                        // sonde publique
      'voice-calls/twiml/route.ts',             // signature Twilio (P0-3)
      'voice-calls/status/route.ts',            // signature Twilio (P0-3)
      'voice-calls/gather/route.ts',            // signature Twilio (P0-3)
    ];

    const manquantes: string[] = [];
    for (const fichier of ROUTES) {
      const rel = path.relative(API_DIR, fichier).replace(/\\/g, '/');
      const src = fs.readFileSync(fichier, 'utf8');
      if (!src.includes('createServiceClient')) continue;
      const verifie = /auth\.getUser\(\)/.test(src) || /requireAdmin/.test(src);
      if (!verifie && !AUTORISEES_SANS_GETUSER.includes(rel)) manquantes.push(rel);
    }
    expect(manquantes).toEqual([]);
  });
});
