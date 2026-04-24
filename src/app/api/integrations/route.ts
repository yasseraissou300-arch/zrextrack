import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function GET() {
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const supabase = createServiceClient();
  const { data } = await supabase
    .from('integrations')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at');

  return NextResponse.json({ data: data || [] });
}

export async function POST(request: NextRequest) {
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const body = await request.json();
  const { platform, identifier, secret_key } = body;
  if (!platform || !identifier) return NextResponse.json({ error: 'platform et identifier requis' }, { status: 400 });

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('integrations')
    .upsert(
      { user_id: user.id, platform, identifier, secret_key: secret_key || '', active: true, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,platform' }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function DELETE(request: NextRequest) {
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { platform } = await request.json();
  const supabase = createServiceClient();
  await supabase.from('integrations').update({ active: false }).eq('user_id', user.id).eq('platform', platform);
  return NextResponse.json({ success: true });
}
