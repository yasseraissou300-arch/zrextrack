import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { prompt, template_type, shop_name } = await req.json();
  if (!prompt?.trim()) return NextResponse.json({ error: 'Prompt vide' }, { status: 400 });
  if (!ANTHROPIC_KEY) return NextResponse.json({ error: 'API non configurée' }, { status: 500 });

  const system = `Tu es un expert en prompts pour chatbots WhatsApp en Algérie.
L'utilisateur te donne un brouillon de prompt pour son bot (type: ${template_type ?? 'auto_confirmation'}, boutique: ${shop_name ?? 'boutique'}).
Réécris ce prompt de façon claire, structurée et efficace en:
- Gardant le ton darija dziriya (arabizi: 3=ع, 7=ح, 9=ق)
- Ajoutant des règles de validation claires
- Structurant la collecte d'informations étape par étape
- Incluant le format <data>{...}</data> pour extraire les données
- Restant concis (max 400 tokens)
Réponds UNIQUEMENT avec le prompt amélioré, sans explications.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 800,
        system,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) return NextResponse.json({ error: 'Erreur Claude' }, { status: 502 });
    const json = await res.json();
    const refined = json.content?.[0]?.text ?? '';
    return NextResponse.json({ refined });
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
