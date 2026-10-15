// CSRF-1 — /api/ai-chatbot/whatsapp/qr et /status sont des GET à effet de bord
// (création / connexion d'instance Evolution, synchro de `connected`). Le
// cookie de session (SameSite=Lax) est envoyé sur une navigation GET de premier
// niveau venant d'un autre site : ces routes doivent refuser Sec-Fetch-Site
// cross-site / same-site AVANT toute lecture de session ni appel externe, et
// rester inchangées pour les appels de l'app (same-origin) ou sans en-tête.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { isForeignSiteRequest } from '@/lib/security/same-site';

const getUser = vi.fn();
const createClient = vi.fn(async () => ({ auth: { getUser } }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => createClient(),
  createServiceClient: () => {
    throw new Error('createServiceClient ne doit pas être appelé dans ces tests');
  },
}));

import { GET as qrGET } from '@/app/api/ai-chatbot/whatsapp/qr/route';
import { GET as statusGET } from '@/app/api/ai-chatbot/whatsapp/status/route';

function req(path: string, site?: string): NextRequest {
  return new NextRequest(`https://app.test${path}`, {
    headers: site ? { 'sec-fetch-site': site } : {},
  });
}

const fetchMock = vi.fn(async () => {
  throw new Error('aucun appel réseau attendu');
});

beforeEach(() => {
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: null } });
  createClient.mockClear();
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

const ROUTES = [
  ['qr', qrGET, '/api/ai-chatbot/whatsapp/qr?service=auto_confirmation&number=213555000111'],
  ['status', statusGET, '/api/ai-chatbot/whatsapp/status'],
] as const;

describe.each(ROUTES)('GET /api/ai-chatbot/whatsapp/%s', (_name, handler, path) => {
  it.each(['cross-site', 'same-site', 'CROSS-SITE'])(
    'Sec-Fetch-Site: %s → 403, sans lire la session ni appeler Evolution',
    async (site) => {
      const res = await handler(req(path, site));
      expect(res.status).toBe(403);
      expect(createClient).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it.each([['same-origin'], ['none'], [undefined]])(
    'Sec-Fetch-Site: %s → passe au contrôle de session (401 sans session)',
    async (site) => {
      const res = await handler(req(path, site));
      expect(res.status).toBe(401);
      expect(createClient).toHaveBeenCalledTimes(1);
    }
  );
});

describe('isForeignSiteRequest', () => {
  it('ne refuse que cross-site et same-site', () => {
    expect(isForeignSiteRequest(req('/', 'cross-site'))).toBe(true);
    expect(isForeignSiteRequest(req('/', 'same-site'))).toBe(true);
    expect(isForeignSiteRequest(req('/', 'same-origin'))).toBe(false);
    expect(isForeignSiteRequest(req('/', 'none'))).toBe(false);
    expect(isForeignSiteRequest(req('/'))).toBe(false);
  });
});
