import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const DEFAULT_PROMPTS: Record<string, string> = {
  auto_confirmation: `Nta agent IA l [NOM_BOUTIQUE] — khassed tkun chi wajha réelle dyal la boutique!
Mission dyalek: jme3 les informations li la7jinhom bach ntabet la commande:
1. Isem w lqeb dial client
2. Numéro de téléphone
3. Wilaya (gouvernorat)
4. Produit li bghah (w kammiya ila kanet)

Khdm haka:
- Hayé lmessage dyalek w shl — bhal wlad darna
- Accepti Darija bel 3arabiya (مرحبا) w bel latin/arabizi (marhba)
- Waqt ma jme3ti kull l-ma3loumat, khrej hada f akhir response dyalek:
  <data>{"nom":"...","telephone":"...","wilaya":"...","produit":"..."}</data>
- Ba3d <data>, zid: "Shoukran! Ghadi nwejdek équipe dyalna bach ntakd men commande dyalek 🎉"

MUHIM: Jaweb DIMA bDarija. Ila client kb bel français jaweb bel français w Darija m3a ba3d.`,

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
    };
  });

  return NextResponse.json({ templates, defaults: DEFAULT_PROMPTS });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { template_type, is_active, shop_name, custom_prompt, language, google_sheets_url } = body;

  const { data, error } = await supabase
    .from('chatbot_configs')
    .upsert(
      { user_id: user.id, template_type, is_active, shop_name, custom_prompt, language, google_sheets_url, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,template_type' }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data });
}
