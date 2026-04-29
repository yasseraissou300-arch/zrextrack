import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

const EVOLUTION_URL = process.env.EVOLUTION_API_URL || '';
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY || '';

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const serviceType = req.nextUrl.searchParams.get('service') || 'auto_confirmation';

  const { data: instance } = await supabase
    .from('whatsapp_instances')
    .select('*')
    .eq('user_id', user.id)
    .eq('service_type', serviceType)
    .single();

  if (!instance) return NextResponse.json({ connected: false, instance: null });

  if (EVOLUTION_URL && EVOLUTION_KEY) {
    try {
      const res = await fetch(
        `${EVOLUTION_URL}/instance/connectionState/${instance.instance_name}`,
        { headers: { apikey: EVOLUTION_KEY } }
      );
      if (res.ok) {
        const json = await res.json();
        const isOpen = json.instance?.state === 'open' || json.state === 'open';
        const phone = json.instance?.profileJid?.replace('@s.whatsapp.net', '') || instance.phone_number;

        if (isOpen !== instance.connected || phone !== instance.phone_number) {
          createServiceClient()
            .from('whatsapp_instances')
            .update({ connected: isOpen, phone_number: phone, updated_at: new Date().toISOString() })
            .eq('user_id', user.id)
            .eq('service_type', serviceType);
          instance.connected = isOpen;
          instance.phone_number = phone;
        }
      }
    } catch { /* use cached DB value */ }
  }

  return NextResponse.json({ connected: instance.connected, phone: instance.phone_number, instance });
}
