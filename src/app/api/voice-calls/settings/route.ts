// GET / POST des paramètres Twilio par utilisateur.

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

const ALLOWED_FIELDS = [
  'account_sid', 'auth_token', 'from_number',
  'shop_name', 'message_template', 'voice',
  'confirm_text', 'cancel_text', 'no_answer_text',
  'enabled',
];

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = createServiceClient();
  const { data } = await service
    .from('voice_call_settings')
    .select('*')
    .eq('user_id', user.id)
    .single();

  // Si pas de row, on retourne des défauts pour que la UI puisse afficher
  // les placeholders. Pas de leak — on masque l'auth_token quand il existe.
  if (!data) {
    return NextResponse.json({ settings: null, defaults: defaultSettings() });
  }
  const masked = { ...data };
  if (masked.auth_token) masked.auth_token = '••••••••' + (masked.auth_token as string).slice(-4);
  return NextResponse.json({ settings: masked });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const upd: Record<string, unknown> = { user_id: user.id, updated_at: new Date().toISOString() };
  for (const k of ALLOWED_FIELDS) {
    if (k in body) {
      // Si l'auth_token reçu est masqué (l'utilisateur n'a pas re-saisi), on
      // n'écrase pas la valeur existante.
      if (k === 'auth_token' && typeof body[k] === 'string' && body[k].startsWith('••')) continue;
      upd[k] = body[k];
    }
  }

  const service = createServiceClient();
  const { error } = await service.from('voice_call_settings').upsert(upd, { onConflict: 'user_id' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

function defaultSettings() {
  return {
    shop_name: 'notre boutique',
    message_template: 'Marhba {name}, hada call men {shop_name}. Bach tconfirmi commande dyalek b {amount} dinar, taba3 wahed. Bach tlghi, taba3 jouj.',
    voice: 'Polly.Hala-Neural',
    confirm_text: 'Chokran! Commande dyalek tta3la9at, ghadi twasel.',
    cancel_text: 'Chokran 3la l-rad. Commande dyalek tatlghat.',
    no_answer_text: 'Smahli, ma fhmtish ljawab. Chokran.',
    enabled: false,
  };
}
