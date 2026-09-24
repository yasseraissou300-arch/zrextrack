// QR de connexion WhatsApp → data URL servie au navigateur.
//
// Evolution renvoie le QR en data URL, en base64 brut, ou parfois en URL
// d'image. AVANT, cette URL était transmise telle quelle : le navigateur
// chargeait l'image depuis l'hôte Evolution, qui se retrouvait dans la page,
// l'historique réseau et les outils de développement. Or l'URL Evolution est
// ce qui protège les instances existantes (HUMAN-003).
//
// MAINTENANT : une URL sur l'hôte Evolution est téléchargée CÔTÉ SERVEUR et
// intégrée en data URL. Une URL d'un autre hôte (aucun secret en jeu) reste
// inchangée, et la clé Evolution ne lui est jamais envoyée.

const MAX_QR_BYTES = 1_000_000;
const IMAGE_TYPE = /^image\/(png|jpeg|gif|webp)$/;

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

export async function qrToDataUrl(
  qr: string,
  evolutionUrl: string,
  headers: Record<string, string>
): Promise<string | null> {
  if (qr.startsWith('data:')) return qr;
  if (!/^https?:\/\//i.test(qr)) return `data:image/png;base64,${qr}`; // base64 brut
  if (!sameOrigin(qr, evolutionUrl)) return qr;

  try {
    const res = await fetch(qr, { headers, signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    if (!IMAGE_TYPE.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_QR_BYTES) return null;
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}
