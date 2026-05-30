import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveEvolutionCreds } from '@/lib/user-creds';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://zrextrack.vercel.app';
const WEBHOOK_URL = `${APP_URL}/api/ai-chatbot/webhook/whatsapp`;

const EVENTS = ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'];

type AttemptResult = {
  format: 'flat_snake' | 'nested_camel';
  endpoint: string;
  status: number;
  response_snippet: string;
};

type InstanceReset = {
  instance_name: string;
  service_type: string;
  attempts: AttemptResult[];
  final_url: string | null;
  final_events: string[] | null;
  verified: boolean;
};

async function postJson(url: string, body: object, evKey: string): Promise<{ status: number; text: string }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: evKey },
      body: JSON.stringify(body),
    });
    const text = await res.text().catch(() => '');
    return { status: res.status, text };
  } catch (e) {
    return { status: 0, text: e instanceof Error ? e.message : String(e) };
  }
}

async function findWebhook(evUrl: string, evKey: string, instanceName: string): Promise<{ url: string | null; events: string[] | null }> {
  try {
    const res = await fetch(`${evUrl}/webhook/find/${instanceName}`, {
      headers: { apikey: evKey },
    });
    if (!res.ok) return { url: null, events: null };
    const j = (await res.json()) as Record<string, unknown>;
    // v1: flat { url, events, ... }
    // v2: nested { webhook: { url, events, ... } } OR same flat
    const inner = (j?.webhook as Record<string, unknown>) || j;
    const url = (inner?.url as string) || null;
    const events = (inner?.events as string[]) || null;
    return { url, events };
  } catch {
    return { url: null, events: null };
  }
}

async function resetOne(evUrl: string, evKey: string, instanceName: string): Promise<Omit<InstanceReset, 'service_type'>> {
  const attempts: AttemptResult[] = [];
  const setUrl = `${evUrl}/webhook/set/${instanceName}`;

  // Format A — flat snake_case (Evolution v1.x)
  const bodyA = {
    url: WEBHOOK_URL,
    webhook_by_events: false,
    webhook_base64: false,
    events: EVENTS,
  };
  const a = await postJson(setUrl, bodyA, evKey);
  attempts.push({
    format: 'flat_snake',
    endpoint: setUrl.replace(evUrl, '<base>'),
    status: a.status,
    response_snippet: a.text.slice(0, 300),
  });

  // Verify
  let check = await findWebhook(evUrl, evKey, instanceName);
  let verified = check.url === WEBHOOK_URL && Array.isArray(check.events) && check.events.includes('MESSAGES_UPSERT');

  // Format B — nested camelCase (Evolution v2.x) if A didn't take effect
  if (!verified) {
    const bodyB = {
      webhook: {
        enabled: true,
        url: WEBHOOK_URL,
        byEvents: false,
        base64: false,
        events: EVENTS,
      },
    };
    const b = await postJson(setUrl, bodyB, evKey);
    attempts.push({
      format: 'nested_camel',
      endpoint: setUrl.replace(evUrl, '<base>'),
      status: b.status,
      response_snippet: b.text.slice(0, 300),
    });

    check = await findWebhook(evUrl, evKey, instanceName);
    verified = check.url === WEBHOOK_URL && Array.isArray(check.events) && check.events.includes('MESSAGES_UPSERT');
  }

  return {
    instance_name: instanceName,
    attempts,
    final_url: check.url,
    final_events: check.events,
    verified,
  };
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // BYOK : serveur Evolution de l'utilisateur (ou fallback plateforme)
  const { url: EVOLUTION_URL, key: EVOLUTION_KEY } = await resolveEvolutionCreds(user.id);
  if (!EVOLUTION_URL || !EVOLUTION_KEY) {
    return NextResponse.json(
      { error: 'Evolution API not configured (EVOLUTION_API_URL / EVOLUTION_API_KEY missing).' },
      { status: 503 }
    );
  }

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

  const results: InstanceReset[] = [];
  for (const inst of instances) {
    const r = await resetOne(EVOLUTION_URL, EVOLUTION_KEY, inst.instance_name);
    results.push({ ...r, service_type: inst.service_type });
  }

  const verifiedCount = results.filter(r => r.verified).length;

  return NextResponse.json({
    webhook_url_sent: WEBHOOK_URL,
    app_url_used: APP_URL,
    app_url_from_env: process.env.NEXT_PUBLIC_APP_URL || null,
    total: results.length,
    verified: verifiedCount,
    failed: results.length - verifiedCount,
    results,
  });
}
