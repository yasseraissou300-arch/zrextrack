import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

const EVOLUTION_URL = process.env.EVOLUTION_API_URL || '';
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY || '';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://zrextrack.netlify.app';

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

// GET — fetch or create the user's Evolution API instance
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: instance } = await supabase
    .from('whatsapp_instances')
    .select('*')
    .eq('user_id', user.id)
    .single();

  return NextResponse.json({ instance: instance ?? null, evolutionConfigured: !!(EVOLUTION_URL && EVOLUTION_KEY) });
}

// POST — create/reset the Evolution API instance for this user
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const serviceSupabase = createServiceClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const action: string = body.action || 'create';

  // Derive stable instance name from user ID
  const instanceName = `zrex_${user.id.replace(/-/g, '').slice(0, 12)}`;

  if (action === 'create') {
    // Try to create instance in Evolution API
    const created = await evolutionRequest('/instance/create', 'POST', {
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
        { user_id: user.id, instance_name: instanceName, instance_token: user.id, connected: false, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      )
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, instance: data, evolutionResponse: created });
  }

  if (action === 'delete') {
    await evolutionRequest(`/instance/delete/${instanceName}`, 'DELETE');
    await serviceSupabase.from('whatsapp_instances').delete().eq('user_id', user.id);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
