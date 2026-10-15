// Requêtes sortantes vers une URL choisie par un marchand (webhook Google
// Sheets / Apps Script / Make / Zapier / n8n auto-hébergé).
//
// Sans garde, le serveur POSTe vers n'importe quelle adresse : réseau interne,
// localhost, métadonnées cloud (169.254.169.254), ou une redirection vers l'un
// d'eux → SSRF aveugle. Pas de liste blanche d'hôtes : n8n est auto-hébergé
// sur des domaines arbitraires. À la place :
//   1. http(s) uniquement, pas d'identifiants dans l'URL (http et ports
//      non standard restent permis : n8n auto-hébergé écoute souvent sur
//      :5678 ; la protection SSRF repose sur l'adresse, pas sur le port) ;
//   2. l'hôte (littéral IP ou TOUTES ses résolutions DNS) doit être public ;
//   3. redirections suivies À LA MAIN, chaque saut revérifié (max 3) ;
//   4. délai borné.
// Limite connue : un rebinding DNS entre notre résolution et celle de fetch
// reste théoriquement possible (fenêtre de quelques ms) ; documenté.

import { lookup as dnsLookup } from 'node:dns/promises';
import net from 'node:net';

export type OutboundReason =
  | 'invalid_url'
  | 'bad_protocol'
  | 'credentials_in_url'
  | 'private_address'
  | 'dns_failed'
  | 'too_many_redirects'
  | 'bad_redirect'
  | 'timeout'
  | 'network_error';

export class OutboundBlocked extends Error {
  constructor(public readonly reason: OutboundReason) {
    super(reason);
  }
}

export type LookupFn = (host: string) => Promise<{ address: string; family: number }[]>;

const defaultLookup: LookupFn = (host) => dnsLookup(host, { all: true, verbatim: true });

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 8_000;

function v4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

const V4_BLOCKED: Array<[string, number]> = [
  ['0.0.0.0', 8], // « cette machine »
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local + métadonnées cloud
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // réservé + broadcast
];

function isPrivateV4(ip: string): boolean {
  const n = v4ToInt(ip);
  return V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (v4ToInt(base) & mask);
  });
}

/** Développe une IPv6 (y compris « :: » et suffixe IPv4) en 8 mots de 16 bits. */
function expandV6(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0];
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    if (!net.isIPv4(v4[1])) return null;
    const n = v4ToInt(v4[1]);
    s = s.slice(0, -v4[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const words = [...head, ...Array(fill).fill('0'), ...tail].map((w) => parseInt(w, 16));
  return words.length === 8 && words.every((w) => w >= 0 && w <= 0xffff) ? words : null;
}

function isPrivateV6(ip: string): boolean {
  const w = expandV6(ip);
  if (!w) return true; // illisible → refus
  if (w.every((x) => x === 0)) return true; // ::
  if (w.slice(0, 7).every((x) => x === 0) && w[7] === 1) return true; // ::1
  // IPv4 mappée (::ffff:a.b.c.d) ou compatible (::a.b.c.d) → règle IPv4
  if (w.slice(0, 5).every((x) => x === 0) && (w[5] === 0xffff || w[5] === 0)) {
    const v4 = `${w[6] >> 8}.${w[6] & 0xff}.${w[7] >> 8}.${w[7] & 0xff}`;
    return isPrivateV4(v4);
  }
  if (w[0] === 0x64 && w[1] === 0xff9b) {
    // NAT64 (64:ff9b::/96) → l'IPv4 embarquée décide
    return isPrivateV4(`${w[6] >> 8}.${w[6] & 0xff}.${w[7] >> 8}.${w[7] & 0xff}`);
  }
  if ((w[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((w[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((w[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (obsolète)
  if ((w[0] & 0xff00) === 0xff00) return true; // multicast
  if (w[0] === 0x2001 && w[1] === 0x0db8) return true; // documentation
  return false;
}

export function isPublicAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return !isPrivateV4(ip);
  if (net.isIPv6(ip)) return !isPrivateV6(ip);
  return false;
}

/** Contrôles statiques (aucun réseau) — utilisables à l'enregistrement. */
export function checkOutboundUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OutboundBlocked('invalid_url');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new OutboundBlocked('bad_protocol');
  if (url.username || url.password) throw new OutboundBlocked('credentials_in_url');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal'))
    throw new OutboundBlocked('private_address');
  if (net.isIP(host) && !isPublicAddress(host)) throw new OutboundBlocked('private_address');
  return url;
}

async function assertPublicHost(url: URL, lookup: LookupFn): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) return; // déjà vérifié par checkOutboundUrl
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host);
  } catch {
    throw new OutboundBlocked('dns_failed');
  }
  if (!addrs.length) throw new OutboundBlocked('dns_failed');
  if (addrs.some((a) => !isPublicAddress(a.address))) throw new OutboundBlocked('private_address');
}

/**
 * URL qu'un SERVICE TIERS ira chercher (ex. média envoyé par Evolution) : on
 * ne contrôle pas sa requête, seule la vérification à l'enregistrement est
 * possible. Contrôles statiques + TOUTES les résolutions DNS publiques.
 */
export async function assertPublicUrl(raw: string, lookup: LookupFn = defaultLookup): Promise<URL> {
  const url = checkOutboundUrl(raw);
  await assertPublicHost(url, lookup);
  return url;
}

export interface SafePostDeps {
  fetchImpl?: typeof fetch;
  lookup?: LookupFn;
  timeoutMs?: number;
}

/**
 * POST JSON vers une URL fournie par un marchand. Lève OutboundBlocked si
 * l'URL, sa résolution ou une redirection vise une adresse non publique.
 * 301/302/303 → suivi en GET sans corps (cas Apps Script : le doPost a déjà
 * tourné) ; 307/308 → nouveau POST du même corps.
 */
export async function safePostJson(
  rawUrl: string,
  body: unknown,
  deps: SafePostDeps = {}
): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const lookup = deps.lookup ?? defaultLookup;
  const payload = JSON.stringify(body);
  let url = checkOutboundUrl(rawUrl);
  let method: 'POST' | 'GET' = 'POST';

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(url, lookup);
    let res: Response;
    try {
      res = await fetchImpl(url.toString(), {
        method,
        headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
        body: method === 'POST' ? payload : undefined,
        redirect: 'manual',
        signal: AbortSignal.timeout(deps.timeoutMs ?? TIMEOUT_MS),
      });
    } catch (e) {
      const name = (e as { name?: string })?.name;
      throw new OutboundBlocked(
        name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network_error'
      );
    }
    if (![301, 302, 303, 307, 308].includes(res.status)) return res;
    if (hop === MAX_REDIRECTS) throw new OutboundBlocked('too_many_redirects');
    const loc = res.headers.get('location');
    if (!loc) throw new OutboundBlocked('bad_redirect');
    let next: string;
    try {
      next = new URL(loc, url).toString();
    } catch {
      throw new OutboundBlocked('bad_redirect');
    }
    url = checkOutboundUrl(next);
    if (res.status !== 307 && res.status !== 308) method = 'GET';
  }
  throw new OutboundBlocked('too_many_redirects');
}
