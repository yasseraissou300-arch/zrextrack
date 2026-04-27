import { NextResponse } from 'next/server';

const GREEN_HOST       = process.env.GREEN_API_HOST || '7107';
const GREEN_INSTANCE   = process.env.GREEN_API_INSTANCE_ID || '';
const GREEN_TOKEN      = process.env.GREEN_API_TOKEN || '';

function greenUrl(path: string) {
  return `https://${GREEN_HOST}.api.greenapi.com/waInstance${GREEN_INSTANCE}/${path}/${GREEN_TOKEN}`;
}

export async function GET() {
  if (!GREEN_INSTANCE || !GREEN_TOKEN) {
    return NextResponse.json({ connected: false, error: 'GREEN_API non configurée' });
  }

  try {
    const res = await fetch(greenUrl('getStateInstance'));
    if (!res.ok) return NextResponse.json({ connected: false });
    const json = await res.json();
    const isConnected = json.stateInstance === 'authorized';

    let phone = '';
    if (isConnected) {
      try {
        const infoRes = await fetch(greenUrl('getWaSettings'));
        if (infoRes.ok) {
          const info = await infoRes.json();
          phone = info.wid?.replace('@c.us', '') || '';
        }
      } catch {}
    }

    return NextResponse.json({ connected: isConnected, phone, state: json.stateInstance });
  } catch {
    return NextResponse.json({ connected: false });
  }
}
