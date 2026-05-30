import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { resolveEvolutionCreds } from '@/lib/user-creds';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://zrextrack.vercel.app';

interface EvCreds { url: string; key: string }

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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // BYOK : serveur Evolution de l'utilisateur (ou fallback plateforme)
  const ev = await resolveEvolutionCreds(user.id);

  const { data: instances } = await supabase
    .from('whatsapp_instances')
    .select('*')
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
  const { data: { user } } = await supabase.auth.getUser();
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
    await evolutionRequest(ev, '/instance/create', 'POST', {
      instanceName,
      token: user.id,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
    });

    // Set webhook separately after creation — Evolution API requires events array
    // when setting webhook (can't be done in createBody without events)
    await evolutionRequest(ev, `/webhook/set/${instanceName}`, 'POST', {
      url: `${APP_URL}/api/ai-chatbot/webhook/whatsapp`,
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
          instance_token: user.id,
          connected: false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,service_type' }
      )
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
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
