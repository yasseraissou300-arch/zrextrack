import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: sessions } = await supabase
    .from('ai_chat_sessions')
    .select('template_type, channel, is_complete, sheets_sent, human_handover, extracted_data, created_at')
    .eq('user_id', user.id);

  if (!sessions) return NextResponse.json({ total: 0, conversion_rate: 0, by_template: {}, by_channel: {}, top_wilayas: [], by_day: [] });

  const total = sessions.length;
  const complete = sessions.filter(s => s.is_complete).length;
  const sheetsSent = sessions.filter(s => s.sheets_sent).length;
  const humanHandover = sessions.filter(s => s.human_handover).length;
  const conversionRate = total > 0 ? Math.round((complete / total) * 100) : 0;

  // By template
  const byTemplate: Record<string, { total: number; complete: number }> = {};
  for (const s of sessions) {
    if (!byTemplate[s.template_type]) byTemplate[s.template_type] = { total: 0, complete: 0 };
    byTemplate[s.template_type].total++;
    if (s.is_complete) byTemplate[s.template_type].complete++;
  }

  // By channel
  const byChannel: Record<string, number> = {};
  for (const s of sessions) {
    byChannel[s.channel] = (byChannel[s.channel] ?? 0) + 1;
  }

  // Top wilayas from extracted_data
  const wilayaMap: Record<string, number> = {};
  for (const s of sessions) {
    const w = s.extracted_data?.wilaya;
    if (w) wilayaMap[w] = (wilayaMap[w] ?? 0) + 1;
  }
  const topWilayas = Object.entries(wilayaMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([wilaya, count]) => ({ wilaya, count }));

  // Sessions per day (last 14 days)
  const now = Date.now();
  const dayMap: Record<string, number> = {};
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now - i * 86400000).toISOString().slice(0, 10);
    dayMap[d] = 0;
  }
  for (const s of sessions) {
    const d = s.created_at?.slice(0, 10);
    if (d && d in dayMap) dayMap[d]++;
  }
  const byDay = Object.entries(dayMap).map(([date, count]) => ({ date, count }));

  return NextResponse.json({
    total,
    complete,
    sheets_sent: sheetsSent,
    human_handover: humanHandover,
    conversion_rate: conversionRate,
    by_template: byTemplate,
    by_channel: byChannel,
    top_wilayas: topWilayas,
    by_day: byDay,
  });
}
