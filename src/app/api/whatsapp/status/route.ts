import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveEvolutionCreds } from '@/lib/user-creds';

// Route legacy utilisée par la page /messages (onglet Historique).
//
// Auparavant, cette route appelait un backend WhatsApp séparé via
// WHATSAPP_BACKEND_URL/WHATSAPP_BACKEND_SECRET — ces env vars ne sont plus
// configurées en prod parce que l'app a migré sur Evolution API (la même
// que celle utilisée par le bot AI et l'onglet Connexion).
//
// On lit donc le statut depuis l'instance Evolution « auto_confirmation »
// déclarée dans whatsapp_instances, pour rester cohérent avec ce que voit
// l'onglet Connexion. Plus de bannière « backend_not_configured » trompeuse
// alors que la connexion est en réalité opérationnelle.

const DEFAULT_SERVICE = 'auto_confirmation';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  // BYOK : serveur Evolution de l'utilisateur (ou fallback plateforme)
  const { url: EVOLUTION_URL, key: EVOLUTION_KEY } = await resolveEvolutionCreds(user.id);

  if (!EVOLUTION_URL || !EVOLUTION_KEY) {
    return NextResponse.json({ connected: false, status: 'evolution_not_configured' });
  }

  const { data: instance } = await supabase
    .from('whatsapp_instances')
    .select('instance_name, connected, phone_number')
    .eq('user_id', user.id)
    .eq('service_type', DEFAULT_SERVICE)
    .single();

  if (!instance) {
    return NextResponse.json({ connected: false, status: 'no_instance' });
  }

  // Source de vérité : on demande l'état live à Evolution, sinon on retombe
  // sur la valeur cachée en DB.
  try {
    const res = await fetch(
      `${EVOLUTION_URL}/instance/connectionState/${instance.instance_name}`,
      { headers: { apikey: EVOLUTION_KEY } }
    );
    if (res.ok) {
      const json = await res.json();
      const state = json.instance?.state || json.state || 'unknown';
      const isOpen = state === 'open';
      return NextResponse.json({
        connected: isOpen,
        status: isOpen ? 'ready' : state,
        phone: instance.phone_number || '',
        instance: instance.instance_name,
      });
    }
  } catch { /* fall through */ }

  return NextResponse.json({
    connected: !!instance.connected,
    status: instance.connected ? 'ready' : 'unreachable',
    phone: instance.phone_number || '',
    instance: instance.instance_name,
  });
}
