import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await supabase
    .from('facebook_connections')
    .select('page_id, page_name, page_picture, verify_token, connected, pending_pages')
    .eq('user_id', user.id)
    .single();

  if (!data) return NextResponse.json({ connection: null });

  const pendingPages = data.pending_pages ? JSON.parse(data.pending_pages) : null;
  return NextResponse.json({ connection: { ...data, pending_pages: undefined }, pending_pages: pendingPages });
}

// Select a page from pending_pages list (after OAuth with multiple pages)
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { page_id } = await req.json();
  if (!page_id) return NextResponse.json({ error: 'page_id requis' }, { status: 400 });

  // Fetch existing record to get pending pages
  const serviceSupabase = createServiceClient();
  const { data: existing } = await serviceSupabase
    .from('facebook_connections')
    .select('pending_pages, verify_token')
    .eq('user_id', user.id)
    .single();

  if (!existing?.pending_pages) return NextResponse.json({ error: 'Aucune page en attente' }, { status: 400 });

  const pages = JSON.parse(existing.pending_pages);
  const selected = pages.find((p: { id: string }) => p.id === page_id);
  if (!selected) return NextResponse.json({ error: 'Page introuvable' }, { status: 404 });

  const { data, error } = await serviceSupabase
    .from('facebook_connections')
    .update({
      page_id: selected.id,
      page_name: selected.name,
      page_access_token: selected.access_token,
      page_picture: selected.picture ?? '',
      connected: true,
      pending_pages: null,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', user.id)
    .select('page_id, page_name, page_picture, verify_token, connected')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, connection: data });
}

export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { error } = await supabase.from('facebook_connections').delete().eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
