import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveEvolutionCreds, getUserCreds } from '@/lib/user-creds';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || '';
const EXPECTED_WEBHOOK = `${APP_URL || 'https://zrextrack.vercel.app'}/api/ai-chatbot/webhook/whatsapp`;

interface EvCreds { url: string; key: string }

type InstanceDiag = {
  service_type: string;
  instance_name: string;
  db_connected: boolean;
  evolution_state: string | null;
  webhook_url: string | null;
  webhook_events: string[] | null;
  webhook_matches_expected: boolean;
  errors: string[];
};

async function evolutionGet(ev: EvCreds, path: string): Promise<{ ok: boolean; status: number; json: unknown }> {
  if (!ev.url || !ev.key) {
    return { ok: false, status: 0, json: null };
  }
  try {
    const res = await fetch(`${ev.url}${path}`, {
      headers: { apikey: ev.key },
    });
    const text = await res.text();
    let json: unknown = null;
    try { json = JSON.parse(text); } catch { json = text; }
    return { ok: res.ok, status: res.status, json };
  } catch (e) {
    return { ok: false, status: 0, json: e instanceof Error ? e.message : String(e) };
  }
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Evolution = serveur partagé de la plateforme
  const ev = await resolveEvolutionCreds(user.id);

  // Gemini = clé propre du client (BYOK), seul modèle IA
  const geminiCreds = await getUserCreds(user.id, 'gemini');

  // Env
  const env = {
    evolutionUrlSet: !!ev.url,
    evolutionKeySet: !!ev.key,
    appUrl: APP_URL || '(not set — using fallback)',
    expectedWebhookUrl: EXPECTED_WEBHOOK,
    aiKeys: {
      // Gemini est le seul modèle IA. Ici on indique si le CLIENT a configuré
      // sa propre clé Gemini (BYOK) — c'est ce qui détermine si le bot répond.
      gemini: !!geminiCreds?.api_key,
    },
  };

  // Instances
  const { data: instances, error: instErr } = await supabase
    .from('whatsapp_instances')
    .select('service_type, instance_name, connected, phone_number')
    .eq('user_id', user.id);

  const instanceDiagnostics: InstanceDiag[] = [];

  if (instances) {
    for (const inst of instances) {
      const diag: InstanceDiag = {
        service_type: inst.service_type ?? '(null — migration missing?)',
        instance_name: inst.instance_name,
        db_connected: !!inst.connected,
        evolution_state: null,
        webhook_url: null,
        webhook_events: null,
        webhook_matches_expected: false,
        errors: [],
      };

      // 1. Connection state
      const stateRes = await evolutionGet(ev, `/instance/connectionState/${inst.instance_name}`);
      if (stateRes.ok) {
        const j = stateRes.json as Record<string, unknown>;
        const instObj = j?.instance as Record<string, unknown> | undefined;
        diag.evolution_state = (instObj?.state as string) || (j?.state as string) || null;
      } else {
        diag.errors.push(`connectionState HTTP ${stateRes.status}`);
      }

      // 2. Webhook config
      const whRes = await evolutionGet(ev, `/webhook/find/${inst.instance_name}`);
      if (whRes.ok) {
        const j = whRes.json as Record<string, unknown>;
        diag.webhook_url = (j?.url as string) ?? (j?.webhook as string) ?? null;
        const events = (j?.events as string[]) ?? null;
        diag.webhook_events = events;
        diag.webhook_matches_expected =
          diag.webhook_url === EXPECTED_WEBHOOK &&
          Array.isArray(events) &&
          events.includes('MESSAGES_UPSERT');
      } else {
        diag.errors.push(`webhook/find HTTP ${whRes.status}`);
      }

      instanceDiagnostics.push(diag);
    }
  }

  // Configs
  const { data: configs } = await supabase
    .from('chatbot_configs')
    .select('template_type, is_active, shop_name, custom_prompt, admin_whatsapp, blocked_prefixes')
    .eq('user_id', user.id);

  const configSummaries = (configs ?? []).map(c => ({
    template_type: c.template_type,
    is_active: c.is_active,
    shop_name: c.shop_name || '(empty)',
    has_custom_prompt: !!(c.custom_prompt && c.custom_prompt.trim()),
    admin_whatsapp_set: !!c.admin_whatsapp,
    blocked_prefixes_count: Array.isArray(c.blocked_prefixes) ? c.blocked_prefixes.length : 0,
  }));

  // Summary of likely issues
  const issues: string[] = [];
  if (!env.evolutionUrlSet || !env.evolutionKeySet) {
    issues.push('Evolution API non configurée (EVOLUTION_API_URL / EVOLUTION_API_KEY manquantes).');
  }
  if (!env.aiKeys.gemini) {
    issues.push('Clé Gemini non configurée — le bot ne pourra pas répondre. Ajoutez votre clé dans Paramètres → Clés API.');
  }
  if (instErr) {
    issues.push(`Erreur lecture whatsapp_instances: ${instErr.message}. La colonne service_type est-elle créée ?`);
  }
  for (const d of instanceDiagnostics) {
    if (d.evolution_state !== 'open') {
      issues.push(`Instance ${d.instance_name} (${d.service_type}) — état Evolution: ${d.evolution_state ?? 'inconnu'}, devrait être "open".`);
    }
    if (!d.webhook_matches_expected) {
      issues.push(`Instance ${d.instance_name} (${d.service_type}) — webhook NON configuré correctement. Attendu: ${EXPECTED_WEBHOOK} avec MESSAGES_UPSERT. Reçu URL=${d.webhook_url ?? 'aucun'}, events=${JSON.stringify(d.webhook_events)}.`);
    }
  }
  for (const c of configSummaries) {
    if (!c.is_active) {
      issues.push(`Template "${c.template_type}" — non activé. Active-le et clique Sauvegarder.`);
    }
  }
  // Cross-check: each instance must have a matching active config
  for (const d of instanceDiagnostics) {
    const matching = configSummaries.find(c => c.template_type === d.service_type);
    if (!matching) {
      issues.push(`Instance ${d.instance_name} (service_type=${d.service_type}) — AUCUNE config chatbot pour ce template_type. Crée-la dans l'UI.`);
    } else if (!matching.is_active) {
      issues.push(`Instance ${d.instance_name} (service_type=${d.service_type}) — config existe mais is_active=false. Active le template "${d.service_type}".`);
    }
  }

  return NextResponse.json({
    env,
    instances: instanceDiagnostics,
    configs: configSummaries,
    issues,
    summary: issues.length === 0
      ? '✅ Tout semble en ordre. Vérifie aussi les logs Vercel pour la trace [WEBHOOK IN].'
      : `⚠️ ${issues.length} problème(s) détecté(s).`,
  });
}
