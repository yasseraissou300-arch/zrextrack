import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

// État d'onboarding du user courant, dérivé des données existantes (aucune
// nouvelle colonne). L'UI cache le checklist quand tout est true.
//   1. hasZrexpressToken  → clé + tenant configurés dans user_sync_settings
//   2. hasWhatsappConnected → instance auto_confirmation connectée
//   3. hasFirstSync       → au moins une commande synchronisée

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const service = createServiceClient();

  const [settingsRes, waRes, ordersRes] = await Promise.all([
    service
      .from('user_sync_settings')
      .select('zrexpress_token, zrexpress_tenant_id')
      .eq('user_id', user.id)
      .maybeSingle(),
    service
      .from('whatsapp_instances')
      .select('connected')
      .eq('user_id', user.id)
      .eq('service_type', 'auto_confirmation')
      .maybeSingle(),
    service
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .limit(1),
  ]);

  const settings = settingsRes.data;
  const hasZrexpressToken = !!(settings?.zrexpress_token && settings?.zrexpress_tenant_id);
  const hasWhatsappConnected = !!waRes.data?.connected;
  const hasFirstSync = (ordersRes.count ?? 0) > 0;
  const completed = hasZrexpressToken && hasWhatsappConnected && hasFirstSync;

  return NextResponse.json({ hasZrexpressToken, hasWhatsappConnected, hasFirstSync, completed });
}
