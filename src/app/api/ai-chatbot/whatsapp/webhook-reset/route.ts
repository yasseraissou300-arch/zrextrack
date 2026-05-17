import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const EVOLUTION_URL = process.env.EVOLUTION_API_URL || '';
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY || '';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://zrextrack.vercel.app';
const WEBHOOK_URL = `${APP_URL}/api/ai-chatbot/webhook/whatsapp`;

type ResetResult = {
  instance_name: string;
  service_type: string;
  ok: boolean;
  status: number;
  error?: string;
};

async function setWebhook(instanceName: string): Promise<ResetResult> {
  const url = `${EVOLUTION_URL}/webhook/set/${instanceName}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_KEY },
      body: JSON.stringify({
        url: WEBHOOK_URL,
        webhook_by_events: false,
        webhook_base64: false,
        events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
      }),
    });
    let errBody = '';
    if (!res.ok) {
      errBody = await res.text().catch(() => '');
    }
    return {
      instance_name: instanceName,
      service_type: '',
      ok: res.ok,
      status: res.status,
      error: res.ok ? undefined : errBody.slice(0, 200),
    };
  } catch (e) {
    return {
      instance_name: instanceName,
      service_type: '',
      ok: false,
      status: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!EVOLUTION_URL || !EVOLUTION_KEY) {
    return NextResponse.json(
      { error: 'Evolution API not configured (EVOLUTION_API_URL / EVOLUTION_API_KEY missing).' },
      { status: 503 }
    );
  }

  // Optional ?service= filter to repair a single service only
  const filterService = req.nextUrl.searchParams.get('service');

  let query = supabase
    .from('whatsapp_instances')
    .select('instance_name, service_type')
    .eq('user_id', user.id);

  if (filterService) {
    query = query.eq('service_type', filterService);
  }

  const { data: instances, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!instances || instances.length === 0) {
    return NextResponse.json({ error: 'No instances found for this user.' }, { status: 404 });
  }

  const results: ResetResult[] = [];
  for (const inst of instances) {
    const r = await setWebhook(inst.instance_name);
    r.service_type = inst.service_type;
    results.push(r);
  }

  const successCount = results.filter(r => r.ok).length;

  return NextResponse.json({
    webhook_url: WEBHOOK_URL,
    total: results.length,
    success: successCount,
    failed: results.length - successCount,
    results,
  });
}
