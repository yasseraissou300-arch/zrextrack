import { NextResponse } from 'next/server';

const GREEN_HOST       = process.env.GREEN_API_HOST || '7107';
const GREEN_INSTANCE   = process.env.GREEN_API_INSTANCE_ID || '';
const GREEN_TOKEN      = process.env.GREEN_API_TOKEN || '';

function greenUrl(path: string) {
  return `https://${GREEN_HOST}.api.greenapi.com/waInstance${GREEN_INSTANCE}/${path}/${GREEN_TOKEN}`;
}

export async function GET() {
  if (!GREEN_INSTANCE || !GREEN_TOKEN) {
    return NextResponse.json({ error: 'GREEN_API non configurée (GREEN_API_INSTANCE_ID, GREEN_API_TOKEN)' }, { status: 503 });
  }

  try {
    // Check if already connected
    const stateRes = await fetch(greenUrl('getStateInstance'));
    if (stateRes.ok) {
      const state = await stateRes.json();
      if (state.stateInstance === 'authorized') {
        return NextResponse.json({ connected: true });
      }
    }

    // Get QR code
    const qrRes = await fetch(greenUrl('qr'));
    if (!qrRes.ok) {
      return NextResponse.json({ error: 'Impossible d\'obtenir le QR code' }, { status: 502 });
    }

    const json = await qrRes.json();

    // type = 'qrCode' → message contains base64 image
    if (json.type === 'alreadyLogged') {
      return NextResponse.json({ connected: true });
    }

    if (json.type === 'qrCode' && json.message) {
      // message is already "data:image/png;base64,..."
      return NextResponse.json({ qr: json.message, connected: false });
    }

    return NextResponse.json({ error: json.message || 'QR non disponible' }, { status: 502 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
