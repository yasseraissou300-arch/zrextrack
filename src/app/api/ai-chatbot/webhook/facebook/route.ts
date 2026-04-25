import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';

const DEFAULT_PROMPT = `Nta agent IA l [NOM_BOUTIQUE].
Jme3 les informations li la7jinhom bach ntabet la commande:
Isem, Téléphone, Wilaya, Produit.
Waqt ma jme3ti kull l-ma3loumat:
<data>{"nom":"...","telephone":"...","wilaya":"...","produit":"..."}</data>
DIMA bDarija.`;

interface ClaudeMessage { role: 'user' | 'assistant'; content: string; }

async function callClaude(systemPrompt: string, messages: ClaudeMessage[]): Promise<string | null> {
  if (!ANTHROPIC_KEY) return null;
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
        max_tokens: 600,
        system: systemPrompt,
        messages: messages.slice(-10),
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.content?.[0]?.text ?? null;
  } catch {
    return null;
  }
}

function extractData(text: string): Record<string, string> | null {
  const match = text.match(/<data>([\s\S]*?)<\/data>/);
  if (!match) return null;
  try { return JSON.parse(match[1].trim()); } catch { return null; }
}

function stripDataTag(text: string): string {
  return text.replace(/<data>[\s\S]*?<\/data>/g, '').trim();
}

async function sendFBMessage(pageAccessToken: string, recipientId: string, text: string): Promise<void> {
  try {
    await fetch(`https://graph.facebook.com/v18.0/me/messages?access_token=${pageAccessToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: recipientId }, message: { text: text.slice(0, 2000) } }),
    });
  } catch { /* non-blocking */ }
}

// GET — Facebook webhook verification (per user via query param or global)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (mode !== 'subscribe' || !challenge) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Match verify token against any user's facebook_connections
  const { data } = await supabase
    .from('facebook_connections')
    .select('verify_token')
    .eq('verify_token', token)
    .single();

  if (data) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: 'Verification failed' }, { status: 403 });
}

// POST — Facebook Messenger incoming messages (multi-tenant by page_id)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (body.object !== 'page') return NextResponse.json({ error: 'Not a page event' }, { status: 400 });

    const supabase = createServiceClient();

    for (const entry of body.entry ?? []) {
      const pageId: string = entry.id || '';

      // Route to user via page_id
      const { data: fbConn } = await supabase
        .from('facebook_connections')
        .select('user_id, page_access_token')
        .eq('page_id', pageId)
        .single();

      if (!fbConn) continue;

      const userId = fbConn.user_id;
      const pageToken = fbConn.page_access_token;

      for (const event of entry.messaging ?? []) {
        if (!event.message?.text || event.message.is_echo) continue;

        const senderId: string = event.sender.id;
        const text: string = event.message.text;

        // Load active config
        const { data: configs } = await supabase
          .from('chatbot_configs')
          .select('*')
          .eq('user_id', userId)
          .eq('is_active', true)
          .limit(1);

        const config = configs?.[0];
        const rawPrompt = config?.custom_prompt?.trim() || DEFAULT_PROMPT;
        const systemPrompt = rawPrompt.replace(/\[NOM_BOUTIQUE\]/g, config?.shop_name || 'notre boutique');

        // Load or create session
        const { data: session } = await supabase
          .from('ai_chat_sessions')
          .select('*')
          .eq('user_id', userId)
          .eq('channel', 'facebook')
          .eq('contact_id', senderId)
          .single();

        const conversation: ClaudeMessage[] = session?.conversation ?? [];
        conversation.push({ role: 'user', content: text });

        const aiReply = await callClaude(systemPrompt, conversation);
        if (!aiReply) continue;

        const extracted = extractData(aiReply);
        const cleanReply = stripDataTag(aiReply);
        conversation.push({ role: 'assistant', content: aiReply });

        const newData = extracted ? { ...(session?.extracted_data ?? {}), ...extracted } : (session?.extracted_data ?? {});
        const isComplete = !!extracted && Object.keys(extracted).length >= 3;

        await supabase.from('ai_chat_sessions').upsert(
          { user_id: userId, channel: 'facebook', contact_id: senderId, template_type: config?.template_type ?? 'auto_confirmation', conversation, extracted_data: newData, is_complete: isComplete, sheets_sent: session?.sheets_sent ?? false, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,channel,contact_id' }
        );

        if (isComplete && !session?.sheets_sent && config?.google_sheets_url) {
          await fetch(config.google_sheets_url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: config.template_type, timestamp: new Date().toISOString(), source: 'facebook_ai', ...newData }) }).catch(() => {});
          await supabase.from('ai_chat_sessions').update({ sheets_sent: true }).eq('user_id', userId).eq('channel', 'facebook').eq('contact_id', senderId);
        }

        if (cleanReply) await sendFBMessage(pageToken, senderId, cleanReply);
      }
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
