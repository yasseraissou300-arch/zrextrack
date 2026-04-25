import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await supabase.from('facebook_connections').select('*').eq('user_id', user.id).single();
  return NextResponse.json({ connection: data ?? null });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { page_id, page_name, page_access_token } = body;

  if (!page_id || !page_access_token) {
    return NextResponse.json({ error: 'page_id et page_access_token sont requis' }, { status: 400 });
  }

  const verify_token = `zrex_fb_${user.id.slice(0, 8)}`;

  const { data, error } = await supabase
    .from('facebook_connections')
    .upsert(
      { user_id: user.id, page_id, page_name: page_name || '', page_access_token, verify_token, connected: true, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data, verify_token });
}

export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { error } = await supabase.from('facebook_connections').delete().eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
