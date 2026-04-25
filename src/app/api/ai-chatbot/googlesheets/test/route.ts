import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

function extractSheetId(url: string): string | null {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match?.[1] ?? null;
}

async function getGoogleAccessToken(): Promise<string | null> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !rawKey) return null;

  try {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: email,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })).toString('base64url');

    const { createSign } = await import('crypto');
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${payload}`);
    const sig = signer.sign(rawKey, 'base64url');
    const jwt = `${header}.${payload}.${sig}`;

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
    });
    const json = await res.json();
    return json.access_token ?? null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { sheet_url } = await req.json();
  const sheetId = extractSheetId(sheet_url || '');
  if (!sheetId) return NextResponse.json({ error: 'URL Google Sheet invalide' }, { status: 400 });

  const token = await getGoogleAccessToken();
  if (!token) {
    return NextResponse.json({ error: 'Service account non configuré — ajoutez GOOGLE_SERVICE_ACCOUNT_EMAIL et GOOGLE_PRIVATE_KEY' }, { status: 503 });
  }

  // Try to read the sheet to verify access
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1:A1`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (res.status === 403 || res.status === 404) {
    return NextResponse.json({ ok: false, error: 'Accès refusé — partagez le sheet avec notre adresse email' });
  }
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: 'Impossible de lire le Sheet' });
  }

  return NextResponse.json({ ok: true, sheet_id: sheetId });
}
