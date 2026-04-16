import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function GET() {
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const supabase = createServiceClient();
  const { data } = await supabase
    .from('whatsapp_settings')
    .select('instance_id, api_token, connected, phone')
    .eq('user_id', user.id)
    .single();

  return NextResponse.json(data || { instance_id: '', api_token: '', connected: false, phone: '' });
}

export async function POST(request: NextRequest) {
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { instance_id, api_token } = await request.json();
  if (!instance_id || !api_token) {
    return NextResponse.json({ error: 'instance_id et api_token requis' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from('whatsapp_settings')
    .upsert({ user_id: user.id, instance_id, api_token, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
