import { NextRequest, NextResponse } from 'next/server';

const VERIFY_TOKEN = process.env.FACEBOOK_VERIFY_TOKEN || 'zrextrack_fb_verify';
const PAGE_ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://zrextrack.netlify.app';

async function sendFacebookMessage(recipientId: string, text: string): Promise<void> {
  if (!PAGE_ACCESS_TOKEN) return;
  try {
    await fetch(
      `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: { text: text.slice(0, 2000) },
        }),
      }
    );
  } catch { /* non-blocking */ }
}

// GET — webhook verification by Meta
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: 'Verification failed' }, { status: 403 });
}

// POST — incoming messages from Facebook Messenger
export async function POST(req: NextRequest) {
  const body = await req.json();

  if (body.object !== 'page') {
    return NextResponse.json({ error: 'Not a page event' }, { status: 400 });
  }

  for (const entry of body.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      if (!event.message?.text || event.message.is_echo) continue;

      const senderId: string = event.sender.id;
      const text: string = event.message.text;

      try {
        const chatRes = await fetch(`${APP_URL}/api/chatbot`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            sessionState: { intent: null, step: 'detect', data: {} },
            history: [],
            channel: 'facebook',
          }),
        });
        const { reply } = await chatRes.json();
        if (reply) {
          await sendFacebookMessage(senderId, reply);
        }
      } catch { /* continue to next message */ }
    }
  }

  return NextResponse.json({ ok: true });
}
