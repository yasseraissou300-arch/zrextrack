import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

const EVOLUTION_URL = process.env.EVOLUTION_API_URL || '';
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY || '';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: instance } = await supabase
    .from('whatsapp_instances')
    .select('*')
    .eq('user_id', user.id)
    .single();

  if (!instance) return NextResponse.json({ connected: false, instance: null });

  // Poll Evolution API for real connection state
  if (EVOLUTION_URL && EVOLUTION_KEY) {
    try {
      const res = await fetch(`${EVOLUTION_URL}/instance/connectionState/${instance.instance_name}`, {
        headers: { apikey: EVOLUTION_KEY },
      });
      if (res.ok) {
        const json = await res.json();
        const isOpen = json.instance?.state === 'open' || json.state === 'open';
        const phone = json.instance?.profileJid?.replace('@s.whatsapp.net', '') || instance.phone_number;

        if (isOpen !== instance.connected || phone !== instance.phone_number) {
          const serviceSupabase = createServiceClient();
          await serviceSupabase
            .from('whatsapp_instances')
            .update({ connected: isOpen, phone_number: phone, updated_at: new Date().toISOString() })
            .eq('user_id', user.id);
          instance.connected = isOpen;
          instance.phone_number = phone;
        }
      }
    } catch { /* use cached value */ }
  }

  return NextResponse.json({ connected: instance.connected, phone: instance.phone_number, instance });
}
