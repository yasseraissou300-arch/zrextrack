import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getGoogleAccessToken } from '@/lib/google/service-account';

function extractSheetId(url: string): string | null {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match?.[1] ?? null;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { sheet_url } = await req.json();
  const sheetId = extractSheetId(sheet_url || '');
  if (!sheetId) return NextResponse.json({ error: 'URL Google Sheet invalide' }, { status: 400 });

  const token = await getGoogleAccessToken();
  if (!token) {
    return NextResponse.json(
      {
        error:
          'Service account non configuré — ajoutez GOOGLE_SERVICE_ACCOUNT_EMAIL et GOOGLE_PRIVATE_KEY',
      },
      { status: 503 }
    );
  }

  // Try to read the sheet to verify access
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1:A1`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 403 || res.status === 404) {
    return NextResponse.json({
      ok: false,
      error: 'Accès refusé — partagez le sheet avec notre adresse email',
    });
  }
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: 'Impossible de lire le Sheet' });
  }

  return NextResponse.json({ ok: true, sheet_id: sheetId });
}
