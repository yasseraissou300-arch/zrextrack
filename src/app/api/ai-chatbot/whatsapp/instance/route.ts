import { NextRequest, NextResponse } from 'next/server';
import { internalError } from '@/lib/security/safe-error';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { resolveEvolutionCreds } from '@/lib/user-creds';
import { webhookTokenQuery } from '@/lib/security/webhook-auth';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://zrextrack.vercel.app';

interface EvCreds {
  url: string;
  key: string;
}

// Colonnes renvoyées au navigateur : jamais `instance_token`.
const INSTANCE_PUBLIC_COLUMNS =
  'id, user_id, service_type, instance_name, connected, created_at, updated_at';

type ServiceType = 'auto_confirmation' | 'sav' | 'tracking';

const SERVICE_SUFFIX: Record<ServiceType, string> = {
  auto_confirmation: 'auto',
  sav: 'sav',
  tracking: 'track',
};

function getInstanceName(userId: string, serviceType: ServiceType): string {
  return `zrex_${userId.replace(/-/g, '').slice(0, 12)}_${SERVICE_SUFFIX[serviceType]}`;
}

async function evolutionRequest(ev: EvCreds, path: string, method = 'GET', body?: object) {
  if (!ev.url || !ev.key) return null;
  try {
    const res = await fetch(`${ev.url}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', apikey: ev.key },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// GET — return all instances for the user
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // BYOK : serveur Evolution de l'utilisateur (ou fallback plateforme)
  const ev = await resolveEvolutionCreds(user.id);

  const { data: instances } = await supabase
    .from('whatsapp_instances')
    .select(INSTANCE_PUBLIC_COLUMNS)
    .eq('user_id', user.id);

  return NextResponse.json({
    instances: instances ?? [],
    evolutionConfigured: !!(ev.url && ev.key),
  });
}

// POST — create or delete a specific service instance
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const serviceSupabase = createServiceClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // BYOK : serveur Evolution de l'utilisateur (ou fallback plateforme)
  const ev = await resolveEvolutionCreds(user.id);

  const body = await req.json().catch(() => ({}));
  const action: string = body.action || 'create';
  const serviceType: ServiceType = body.service_type || 'auto_confirmation';

  if (!['auto_confirmation', 'sav', 'tracking'].includes(serviceType)) {
    return NextResponse.json({ error: 'Invalid service_type' }, { status: 400 });
  }

  const instanceName = getInstanceName(user.id, serviceType);

  if (action === 'create') {
    // PAS de `token` : Evolution en génère un aléatoire (v4). Ce jeton donne à
    // lui seul un accès complet à l'instance — envoi, lecture des discussions,
    // déconnexion (guard `apikey` d'Evolution v2 : global key OU token de
    // l'instance). L'ancien code passait `user.id`, qui n'est pas un secret :
    // il circule dans les URLs et les logs, et deux UUID réels étaient
    // committés dans le dépôt public. La plateforme n'utilise que la clé
    // globale : le jeton d'instance n'a besoin d'être ni connu ni stocké.
    await evolutionRequest(ev, '/instance/create', 'POST', {
      instanceName,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
    });

    // Set webhook separately after creation — Evolution API requires events array
    // when setting webhook (can't be done in createBody without events)
    await evolutionRequest(ev, `/webhook/set/${instanceName}`, 'POST', {
      // P0-1 : secret partagé dans l'URL (Evolution ne signe pas ses payloads).
      url: `${APP_URL}/api/ai-chatbot/webhook/whatsapp${webhookTokenQuery('WHATSAPP_WEBHOOK_SECRET')}`,
      webhook_by_events: false,
      webhook_base64: false,
      events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
    });

    const { data, error } = await serviceSupabase
      .from('whatsapp_instances')
      .upsert(
        {
          user_id: user.id,
          service_type: serviceType,
          instance_name: instanceName,
          instance_token: '', // jamais l'identifiant utilisateur (voir plus haut)
          connected: false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,service_type' }
      )
      .select(INSTANCE_PUBLIC_COLUMNS)
      .single();

    if (error) return internalError('api.ai-chatbot.whatsapp.instance', error);
    return NextResponse.json({ ok: true, instance: data });
  }

  if (action === 'delete') {
    await evolutionRequest(ev, `/instance/delete/${instanceName}`, 'DELETE');
    await serviceSupabase
      .from('whatsapp_instances')
      .delete()
      .eq('user_id', user.id)
      .eq('service_type', serviceType);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
