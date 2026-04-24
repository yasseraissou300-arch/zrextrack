import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const supabase = createServiceClient();
  const { data: campaign, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (error || !campaign) return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 });

  const { data: recipients } = await supabase
    .from('campaign_recipients')
    .select('*')
    .eq('campaign_id', id)
    .order('created_at', { ascending: false });

  return NextResponse.json({ campaign, recipients: recipients || [] });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const supabase = createServiceClient();
  const { error } = await supabase
    .from('campaigns')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
