import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function GET() {
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const supabase = createServiceClient();
  const { data } = await supabase
    .from('bot_settings')
    .select('*')
    .eq('user_id', user.id)
    .single();

  return NextResponse.json(data ?? {
    ai_enabled: true,
    language: 'darija',
    system_prompt: '',
    messages_received: 0,
    ai_replies_sent: 0,
    tracking_replies_sent: 0,
  });
}

export async function POST(request: NextRequest) {
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const body = await request.json();
  const { ai_enabled, language, system_prompt } = body;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('bot_settings')
    .upsert(
      { user_id: user.id, ai_enabled, language, system_prompt, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
