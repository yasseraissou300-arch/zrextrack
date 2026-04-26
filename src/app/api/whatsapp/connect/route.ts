import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const BACKEND = process.env.WHATSAPP_BACKEND_URL;
const SECRET = process.env.WHATSAPP_BACKEND_SECRET;

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  if (!BACKEND || !SECRET) {
    return NextResponse.json({ error: 'Backend WhatsApp non configuré (WHATSAPP_BACKEND_URL manquant)' }, { status: 500 });
  }

  const res = await fetch(`${BACKEND}/api/connect/${user.id}`, {
    method: 'POST',
    headers: { 'x-backend-secret': SECRET },
  });

  const json = await res.json();
  return NextResponse.json(json);
}
