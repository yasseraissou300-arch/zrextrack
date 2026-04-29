import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

const EVOLUTION_URL = process.env.EVOLUTION_API_URL || '';
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY || '';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://zrextrack.netlify.app';

type ServiceType = 'auto_confirmation' | 'sav' | 'tracking';

const SERVICE_SUFFIX: Record<ServiceType, string> = {
  auto_confirmation: 'auto',
  sav: 'sav',
  tracking: 'track',
};

function getInstanceName(userId: string, serviceType: ServiceType): string {
  return `zrex_${userId.replace(/-/g, '').slice(0, 12)}_${SERVICE_SUFFIX[serviceType]}`;
}

async function evolutionRequest(path: string, method = 'GET', body?: object) {
  if (!EVOLUTION_URL || !EVOLUTION_KEY) return null;
  try {
    const res = await fetch(`${EVOLUTION_URL}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_KEY },
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

  const { data: instances } = await supabase
    .from('whatsapp_instances')
    .select('*')
    .eq('user_id', user.id);

  return NextResponse.json({
    instances: instances ?? [],
    evolutionConfigured: !!(EVOLUTION_URL && EVOLUTION_KEY),
  });
}

// POST — create or delete a specific service instance
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const serviceSupabase = createServiceClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const action: string = body.action || 'create';
  const serviceType: ServiceType = body.service_type || 'auto_confirmation';

  if (!['auto_confirmation', 'sav', 'tracking'].includes(serviceType)) {
    return NextResponse.json({ error: 'Invalid service_type' }, { status: 400 });
  }

  const instanceName = getInstanceName(user.id, serviceType);

  if (action === 'create') {
    await evolutionRequest('/instance/create', 'POST', {
      instanceName,
      token: user.id,
      qrcode: true,
      webhook: `${APP_URL}/api/ai-chatbot/webhook/whatsapp`,
      webhookByEvents: false,
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
    await evolutionRequest(`/instance/delete/${instanceName}`, 'DELETE');
    await serviceSupabase
      .from('whatsapp_instances')
      .delete()
      .eq('user_id', user.id)
      .eq('service_type', serviceType);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
