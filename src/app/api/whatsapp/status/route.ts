import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const BACKEND = process.env.WHATSAPP_BACKEND_URL;
const SECRET = process.env.WHATSAPP_BACKEND_SECRET;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  if (!BACKEND || !SECRET) {
    return NextResponse.json({ connected: false, status: 'backend_not_configured' });
  }

  try {
    const res = await fetch(`${BACKEND}/api/status/${user.id}`, {
      headers: { 'x-backend-secret': SECRET },
    });
    const json = await res.json();
    return NextResponse.json({ ...json, connected: json.status === 'ready' });
  } catch {
    return NextResponse.json({ connected: false, status: 'backend_unreachable' });
  }
}
