import { describe, it, expect } from 'vitest';
import nextConfig from '../next.config.mjs';

// L'ancien alias zrextrack.vercel.app ne sert plus de pages : tout renvoie vers
// autotim.vercel.app, sauf /api/* (webhooks et cron peuvent encore viser l'alias).
describe('domaine unique autotim', () => {
  it('redirige les pages de zrextrack.vercel.app vers autotim, jamais /api', async () => {
    const rules = (await nextConfig.redirects?.()) ?? [];
    const rule = rules.find((r: { has?: { value?: string }[] }) =>
      r.has?.some((h) => h.value === 'zrextrack.vercel.app')
    );
    if (!rule) throw new Error('règle de redirection absente');
    expect(rule.destination).toBe('https://autotim.vercel.app/:path');
    expect(rule.permanent).toBe(false);

    const re = new RegExp('^/' + rule.source.slice('/:path'.length).replace(/^\(|\)$/g, '') + '$');
    for (const p of ['', 'login', 'commandes', 'track/ZR123', 'apiary'])
      expect(re.test('/' + p), p).toBe(true);
    for (const p of ['api/ai-chatbot/webhook/whatsapp', 'api/cron/tick', 'api/'])
      expect(re.test('/' + p), p).toBe(false);
  });
});
