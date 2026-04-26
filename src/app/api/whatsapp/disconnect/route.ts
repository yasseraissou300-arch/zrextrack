import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const BACKEND = process.env.WHATSAPP_BACKEND_URL;
const SECRET = process.env.WHATSAPP_BACKEND_SECRET;

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  if (!BACKEND || !SECRET) return NextResponse.json({ error: 'Backend non configuré' }, { status: 500 });

  try {
    await fetch(`${BACKEND}/api/disconnect/${user.id}`, {
      method: 'POST',
      headers: { 'x-backend-secret': SECRET },
    });
  } catch {}

  return NextResponse.json({ success: true });
}
