// Refine prompt via Gemini (Claude / Anthropic retiré de la plateforme).
// La clé Gemini est lue depuis la table user_api_credentials (BYOK).

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveGeminiKey, missingCredentialsResponse } from '@/lib/user-creds';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { prompt, template_type, shop_name } = await req.json();
  if (!prompt?.trim()) return NextResponse.json({ error: 'Prompt vide' }, { status: 400 });

  const geminiKey = await resolveGeminiKey(user.id);
  if (!geminiKey) {
    return NextResponse.json(missingCredentialsResponse('gemini'), { status: 400 });
  }

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
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 800, temperature: 0.7 },
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error('[refine-prompt][Gemini]', res.status, errText);
      return NextResponse.json({ error: 'Erreur Gemini' }, { status: 502 });
    }

    const json = await res.json();
    const refined = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    return NextResponse.json({ refined });
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
