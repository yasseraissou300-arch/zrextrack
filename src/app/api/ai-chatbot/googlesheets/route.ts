import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

function extractSheetId(url: string): string | null {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match?.[1] ?? null;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await supabase
    .from('chatbot_configs')
    .select('template_type, google_sheets_url')
    .eq('user_id', user.id);

  const serviceEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? '';

  return NextResponse.json({
    service_email: serviceEmail,
    configs: data ?? [],
  });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { template_type, sheet_url } = await req.json();
  if (!template_type) return NextResponse.json({ error: 'template_type requis' }, { status: 400 });

  const sheetId = sheet_url ? extractSheetId(sheet_url) : null;
  const googleSheetsUrl = sheetId
    ? `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Sheet1:append`
    : (sheet_url || '');

  const { error } = await supabase
    .from('chatbot_configs')
    .upsert(
      { user_id: user.id, template_type, google_sheets_url: googleSheetsUrl, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,template_type' }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, sheet_id: sheetId });
}
