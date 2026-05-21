import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function GET() {
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const body = await request.json();
  const { name, message_template, audience_status, audience_phones, media_url } = body as {
    name?: string;
    message_template?: string;
    audience_status?: string;
    audience_phones?: string[];
    media_url?: string;
  };

  if (!name?.trim() || !message_template?.trim()) {
    return NextResponse.json({ error: 'Nom et message requis' }, { status: 400 });
  }

  // Si une liste custom est fournie, on la nettoie et on ignore le filtre
  // audience_status. Sinon on garde le comportement historique (filtre par
  // statut sur orders).
  let phones: string[] | null = null;
  if (Array.isArray(audience_phones) && audience_phones.length > 0) {
    phones = Array.from(new Set(
      audience_phones
        .map(p => (p || '').replace(/[\s\-()+.]/g, ''))
        .filter(p => p.length >= 9)
    ));
    if (phones.length === 0) phones = null;
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('campaigns')
    .insert({
      user_id: user.id,
      name: name.trim(),
      message_template: message_template.trim(),
      audience_status: phones ? '' : (audience_status || ''),
      audience_phones: phones,
      media_url: media_url?.trim() || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
