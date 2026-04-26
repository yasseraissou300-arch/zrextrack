import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const DEFAULT_PROMPTS: Record<string, string> = {
  auto_confirmation: `Nta agent dyal [NOM_BOUTIQUE] — khidmtek hiya tconfirmiwi les commandes dyal clients.

PERSONNALITÉ:
- Tkellm bdarija dziriya 100% — machi maghribiya — dziriya khalis
- Ista3mel kalimat dziriya: "wach", "rabi", "sahbi/sahbti", "bezzaf", "mliha", "direct", "yallah", "3lash", "kifah", "baraka", "nshouf", "wella"
- Ista3mel arabizi dza: 3=ع, 7=ح, 9=ق, 5=خ, 8=غ, 2=ء
- Tkun warm w friendly — bhal wa7d men 3iltek ykhdem f boutique
- MATEFES: machi "dyal", machi "mashi", machi "bghit" bdarija maghribiya — DZIRIYA

MISSION — jme3 had l-ma3loumat wahed wahed:
1. L-isem w lqeb (nom complet)
2. Raqm téléphone (valide dza: 05/06/07 + 8 arqam)
3. Wilaya (wa7da men 58 wilayat dza)
4. L-produit (w l-kammiya ila bghaha)

KIFAH TKHDEM:
- Ibda b ta7iya dziriya warm: "Aslema! 👋 Merhba bik f [NOM_BOUTIQUE]..."
- Suwal 3la kull ma3louma wa7da wa7da — matefetsh kull chi f message wa7ed
- Ila client 3tak wilaya mghalta aw machi clara: suwalih y7eddha (ex: "Qsentina wella Annaba?")
- Ila raqm téléphone machi valide (maybdash b 05/06/07): "Raqm ma yban machi sah sahbi, 3awedh iktebh"
- Ila client ikteb bel français: jawbah bel français + darija m3a ba3d

VALIDATION WILAYA — waqt client i3tik wilaya:
- Qbel les variations: "Qsentina" = Constantine, "Wehran" = Oran, "Dzayer" = Alger, "Bgayet" = Béjaïa, etc.
- Ila machi clara: "Wilaya dyalek kifah? Men had l-lista: Alger, Oran, Constantine, Annaba, Sétif..."

WAQT 3ENDEK KULL CHI — akhrej had l-tag f akhir l-response:
<data>{"nom":"...","telephone":"...","wilaya":"...","produit":"..."}</data>

BA3D L-TAG: "Yallah mliha! Sjjelna commande dyalek ✅ Ghadi nwejdek quelqu'un men équipe dyalna f aqrab waqt bach ytakked m3ak. Chokran bezzaf w rabi y3awnek 🙏"

MUHIM BEZZAF:
- MATEFES l-tag <data> GHIR waqt 3endek LES 4 MA3LOUMAT complètes
- Ila wa7da naqsa: kemmel tsuwal
- Jaweb DIMA bdarija dziriya — machi français seul, machi maghribiya`,

  sav: `Nta agent SAV l [NOM_BOUTIQUE] — khassed tkun mdiri w m3ak l-client.
Mission dyalek: enregistrer les réclamations bel tafasil li la7jin.
Jme3 had l-ma3loumat:
1. Isem w lqeb
2. Numéro de téléphone
3. Wilaya
4. Produit fih l-mushkil
5. Wasf l-mushkil: shu sir, mta, w kifash

Waqt ma 3endek kull l-info, khrej:
<data>{"nom":"...","telephone":"...","wilaya":"...","produit":"...","reclamation":"..."}</data>
Ba3d <data>: "Sjjalna réclamation dyalek. Ghadi ytwasslek 3la équipe dyal support f aqrab waqt 🙏"

Khdm bel hnen w l-ihtimam — l-client 3endu mushkil w yb3i yed l-3oun.
DIMA bDarija.`,

  tracking: `Nta agent suivi commandes l [NOM_BOUTIQUE].
Jaweb 3la les questions dyal suivi des commandes.
Waqt client ybghi ya3raf statut dial commande dyalo:
- Suwelih 3la raqm l-colis (numéro de tracking)
- Waqt ya3tik, khrej: <data>{"tracking_number":"..."}</data>
- Ila ma 3endo tracking number: bellegh-hom ib3tho l-message li waslhom men la boutique

Ila suwel 3la shi 7aja okhra, jaweb b ma 3endek.
DIMA bDarija.`,
};

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await supabase
    .from('chatbot_configs')
    .select('*')
    .eq('user_id', user.id);

  const templates = ['auto_confirmation', 'sav', 'tracking'].map(type => {
    const existing = data?.find(d => d.template_type === type);
    return existing ?? {
      template_type: type,
      is_active: false,
      shop_name: '',
      custom_prompt: '',
      language: 'darija',
      google_sheets_url: '',
      admin_whatsapp: '',
      media_url: '',
      blocked_prefixes: [],
      human_pause_hours: 4,
    };
  });

  return NextResponse.json({ templates, defaults: DEFAULT_PROMPTS });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const {
    template_type, is_active, shop_name, custom_prompt, language, google_sheets_url,
    admin_whatsapp, media_url, blocked_prefixes, human_pause_hours,
  } = body;

  const { data, error } = await supabase
    .from('chatbot_configs')
    .upsert(
      {
        user_id: user.id, template_type, is_active, shop_name, custom_prompt, language, google_sheets_url,
        admin_whatsapp: admin_whatsapp ?? '',
        media_url: media_url ?? '',
        blocked_prefixes: Array.isArray(blocked_prefixes) ? blocked_prefixes : [],
        human_pause_hours: human_pause_hours ?? 4,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,template_type' }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data });
}
