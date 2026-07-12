import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { warmupState } from '@/lib/whatsapp/anti-spam';

// Warm-up WhatsApp — gestion côté user.
//   GET   → renvoie l'état courant (phase, plafond, jours écoulés)
//   POST  { action: 'start' | 'stop' }
//         start : (re)démarre le warm-up MAINTENANT — utilise-le quand tu
//                 connectes un nouveau numéro WhatsApp pour reconstruire une
//                 réputation propre.
//         stop  : coupe le warm-up (repasse au plafond normal 40/24h). À faire
//                 seulement une fois que ton numéro est bien établi.

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const service = createServiceClient();
  const { data: prof } = await service
    .from('profiles')
    .select('whatsapp_warmup_started_at')
    .eq('id', user.id)
    .single();

  return NextResponse.json(warmupState(prof?.whatsapp_warmup_started_at ?? null));
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const action = body?.action;
  if (action !== 'start' && action !== 'stop') {
    return NextResponse.json({ error: 'action doit être "start" ou "stop"' }, { status: 400 });
  }

  const service = createServiceClient();
  const value = action === 'start' ? new Date().toISOString() : null;
  const { error } = await service
    .from('profiles')
    .update({ whatsapp_warmup_started_at: value })
    .eq('id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(warmupState(value));
}
