import { NextRequest, NextResponse } from 'next/server';

const INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID!;
const API_TOKEN = process.env.GREEN_API_TOKEN!;
const GEMINI_KEY = process.env.GEMINI_API_KEY!;

const SYSTEM_PROMPT = `Nta assistant livraison dial ZREXpress f l'Algérie. Jaweb 3la les clients bDarija Algérienne — mzyan, wjiz, w rassurant.

Ma ta3refch:
- ZREXpress: société livraison rapide f l'Algérie
- Waqt livraison: 24 l 72 sa3a
- F cas problème b commande: kolhom ibayno n numéro de suivi dyalhom
- F cas retour: kolhom ikhaltiw ma3a l livreur wla iconnectaw m3a l support
- F cas ma jawabch l livreur: kolhom i9adro i9olbou report men ZREXpress

IMPORTANT: Jaweb DIMA bDarija Algérienne. Wjiz — maximum 2-3 jmla.`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Only handle incoming text messages
    if (body.typeWebhook !== 'incomingMessageReceived') {
      return NextResponse.json({ ok: true });
    }

    const msgType = body.messageData?.typeMessage;
    if (msgType !== 'textMessage') {
      return NextResponse.json({ ok: true });
    }

    const message = body.messageData?.textMessageData?.textMessage as string;
    const chatId = body.senderData?.chatId as string;

    if (!message || !chatId) {
      return NextResponse.json({ ok: true });
    }

    // Skip messages from self (avoid infinite loop)
    if (chatId.includes(INSTANCE_ID)) {
      return NextResponse.json({ ok: true });
    }

    // Call Gemini 1.5 Flash (free tier)
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: SYSTEM_PROMPT + '\n\nClient: ' + message }] }],
          generationConfig: { maxOutputTokens: 150, temperature: 0.7 },
        }),
      }
    );

    if (!geminiRes.ok) {
      console.error('Gemini error:', await geminiRes.text());
      return NextResponse.json({ ok: true });
    }

    const geminiData = await geminiRes.json();
    const aiReply: string = geminiData.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    if (!aiReply) return NextResponse.json({ ok: true });

    // Send reply via Green API
    const greenApiUrl = `https://api.green-api.com/waInstance${INSTANCE_ID}/sendMessage/${API_TOKEN}`;
    await fetch(greenApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, message: aiReply }),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err);
    return NextResponse.json({ ok: true }); // Always 200 so Green API doesn't retry
  }
}
