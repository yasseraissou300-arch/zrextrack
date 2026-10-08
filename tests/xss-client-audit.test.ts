// AUDIT XSS CÔTÉ CLIENT — tests de CONSTAT (runtime inchangé).
//
// Ces tests ne prétendent pas « XSS impossible ». Ils figent ce qui est
// réellement prouvé :
//   1. l'inventaire des sinks HTML/URL (tout nouveau sink fait échouer le test
//      et doit être audité) ;
//   2. le comportement des protections réellement en place (échappement React,
//      blocage `javascript:` de React 19, préfixes fixes des href, escapeXml
//      TwiML) face à des charges représentatives, en isolation locale.
// Voir .claude/mission/xss-client-audit.md.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildFinalTwiml, buildInitialTwiml, fillTemplate } from '@/lib/voice-calls/twilio';

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(tsx?|jsx?|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

const FILES = walk(SRC).map((f) => ({
  rel: path.relative(ROOT, f).replace(/\\/g, '/'),
  text: fs.readFileSync(f, 'utf8'),
}));

function hits(re: RegExp): string[] {
  const out: string[] = [];
  for (const f of FILES) {
    f.text.split('\n').forEach((line, i) => {
      if (re.test(line)) out.push(`${f.rel}:${i + 1}`);
    });
  }
  return out;
}

// inventaire par fichier (robuste aux décalages de lignes)
function byFile(re: RegExp): Record<string, number> {
  const out: Record<string, number> = {};
  for (const h of hits(re)) {
    const f = h.split(':')[0];
    out[f] = (out[f] ?? 0) + 1;
  }
  return out;
}

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const PAYLOADS = [
  'x',
  '<img src=x onerror=alert(1)>',
  '<script>alert(1)</script>',
  '"><svg onload=alert(1)>',
  'javascript:alert(1)',
  'JaVaScRiPt:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  '//attacker.example',
  '/\\attacker.example',
  '../../login',
];

describe('XSS-1 — inventaire des sinks HTML bruts', () => {
  it('un seul dangerouslySetInnerHTML (layout), aucun innerHTML/outerHTML/insertAdjacentHTML/document.write/eval/new Function/timer string', () => {
    expect(byFile(/dangerouslySetInnerHTML/)).toEqual({ 'src/app/layout.tsx': 1 });
    expect(
      hits(
        /\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|\bFunction\(|set(Timeout|Interval)\(\s*['"`]|srcDoc|<iframe/
      )
    ).toEqual([]);
  });

  it('le script injecté par le layout est une constante sans interpolation', () => {
    const layout = read('src/app/layout.tsx');
    expect(layout).toMatch(/<script dangerouslySetInnerHTML=\{\{ __html: themeInitScript \}\} \/>/);
    const m = layout.match(/const themeInitScript = `([\s\S]*?)`;/);
    expect(m).not.toBeNull();
    expect(m![1]).not.toContain('${');
  });

  it("le script de thème n'utilise la valeur localStorage que dans une comparaison (charges inertes)", () => {
    const script = read('src/app/layout.tsx').match(/const themeInitScript = `([\s\S]*?)`;/)![1];
    for (const stored of [...PAYLOADS, 'dark']) {
      const added: string[] = [];
      const fn = new Function('localStorage', 'window', 'document', script);
      fn(
        { getItem: () => stored },
        { matchMedia: () => ({ matches: false }) },
        { documentElement: { classList: { add: (c: string) => added.push(c) } } }
      );
      // seule action possible : ajouter la classe littérale 'dark'
      expect(added).toEqual(stored === 'dark' ? ['dark'] : []);
    }
  });

  it("aucune bibliothèque Markdown / HTML / sanitizer n'est installée (aucun rendu de texte riche)", () => {
    const pkg = JSON.parse(read('package.json'));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    const rich = deps.filter((d) =>
      /markdown|marked|remark|rehype|showdown|dompurify|sanitize-html|html-react-parser|xss/i.test(d)
    );
    expect(rich).toEqual([]);
  });
});

describe('XSS-2 — inventaire des sinks URL dynamiques', () => {
  it('href dynamiques : liste figée (tout ajout doit être audité)', () => {
    expect(byFile(/href=\{/)).toEqual({
      'src/app/admin-dashboard/components/OrderDetailModal.tsx': 1,
      'src/app/ai-chatbot/page.tsx': 1,
      'src/app/autoswap/page.tsx': 3,
      'src/app/parametres/api-keys/page.tsx': 1,
      'src/components/OnboardingChecklist.tsx': 1,
      'src/components/QuotaBanner.tsx': 1,
      'src/components/ui/Sidebar.tsx': 1,
    });
  });

  it('src dynamiques : liste figée (images / médias uniquement, aucune iframe)', () => {
    expect(byFile(/\bsrc=\{/)).toEqual({
      'src/app/admin/page.tsx': 1,
      'src/app/ai-chatbot/page.tsx': 3,
      'src/app/campagnes/page.tsx': 4,
      'src/app/messages/page.tsx': 1,
      'src/app/mon-compte/page.tsx': 1,
      'src/components/ui/AppLogo.tsx': 1,
    });
  });

  it('navigation : aucune valeur dynamique vers window.open / location / router hors cas audités', () => {
    expect(hits(/window\.open|location\.(assign|replace)\(|document\.location/)).toEqual([]);
    // window.location.href n'est affecté qu'à des littéraux
    for (const h of hits(/location\.href\s*=/)) {
      const [file, line] = h.split(':');
      const l = read(file).split('\n')[Number(line) - 1];
      expect(l).toMatch(/location\.href\s*=\s*'\/[a-z-]+';/);
    }
    // router.push/replace : /track (encodeURIComponent) et /parametres (littéral)
    expect(byFile(/router\.(push|replace)\(/)).toEqual({
      'src/app/parametres/page.tsx': 1,
      'src/app/track/page.tsx': 1,
    });
    expect(read('src/app/track/page.tsx')).toContain(
      'router.push(`/track/${encodeURIComponent(t)}`);'
    );
  });

  it('/track : encodeURIComponent garde toute saisie dans le segment /track/', () => {
    for (const p of PAYLOADS) {
      const u = new URL(`/track/${encodeURIComponent(p)}`, 'https://app.test');
      expect(u.origin).toBe('https://app.test');
      expect(u.pathname.startsWith('/track/')).toBe(true);
      expect(u.pathname.split('/').length).toBe(3);
    }
  });

  it('OrderDetailModal : préfixe fixe /track/ → tracking_number ne peut changer ni protocole ni origine', () => {
    const src = read('src/app/admin-dashboard/components/OrderDetailModal.tsx');
    expect(src).toContain('const trackingUrl = `/track/${order.tracking_number}`;');
    for (const p of PAYLOADS) {
      const href = `/track/${p}`;
      const u = new URL(href, 'https://app.test');
      expect(u.protocol).toBe('https:');
      expect(u.origin).toBe('https://app.test');
    }
  });

  it('liens ZRExpress : préfixe https://app.zrexpress.app/ fixe → hôte et protocole non modifiables', () => {
    expect(read('src/app/autoswap/page.tsx')).toContain(
      '`https://app.zrexpress.app/parcels/default/${parcelUuid}`'
    );
    expect(read('src/app/ai-chatbot/page.tsx')).toContain(
      'href={`https://app.zrexpress.app/parcels/default/${enrich.parcel.id}`}'
    );
    for (const p of PAYLOADS) {
      const u = new URL(`https://app.zrexpress.app/parcels/default/${p}`);
      expect(u.protocol).toBe('https:');
      expect(u.host).toBe('app.zrexpress.app');
    }
  });
});

describe('XSS-3 — protections React réellement en place (react-dom 19)', () => {
  it('le texte non fiable rendu en enfant JSX est échappé', () => {
    for (const p of PAYLOADS) {
      const html = renderToStaticMarkup(React.createElement('div', null, p));
      expect(html).not.toMatch(/<(img|script|svg)\b/i);
    }
  });

  it('les messages WhatsApp / IA sont rendus en enfants JSX (texte), jamais en HTML', () => {
    expect(read('src/app/messages/page.tsx')).toMatch(/\{msg\.message\}/);
    expect(read('src/app/admin-dashboard/components/WhatsAppMessageLog.tsx')).toMatch(
      /\{msg\.message\}/
    );
    expect(read('src/components/ui/ChatbotDrawer.tsx')).toMatch(/\{msg\.content\}/);
  });

  it('React 19 neutralise javascript: dans href et src (toutes casses)', () => {
    for (const p of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)']) {
      const a = renderToStaticMarkup(React.createElement('a', { href: p }, 'x'));
      expect(a).toContain('React has blocked a javascript: URL');
      const img = renderToStaticMarkup(React.createElement('img', { src: p }));
      expect(img).toContain('React has blocked a javascript: URL');
    }
  });

  it("CONSTAT : React ne bloque PAS data: (protection = absence de href contrôlable, pas React)", () => {
    const a = renderToStaticMarkup(
      React.createElement('a', { href: 'data:text/html,<script>alert(1)</script>' }, 'x')
    );
    expect(a).toContain('href="data:text/html');
  });
});

describe('XSS-4 — TwiML (seule réponse serveur à balisage construit)', () => {
  it('escapeXml neutralise les charges dans le nom client, le tracking et les textes', () => {
    const evil = '<html:script xmlns:html="http://www.w3.org/1999/xhtml">alert(1)</html:script>';
    const msg = fillTemplate('Salam {name} {tracking}', { name: evil, tracking: '"><x>' });
    const twiml = buildInitialTwiml({
      message: msg,
      voice: 'Polly.Hala-Neural',
      gatherActionUrl: 'https://app.test/api/voice-calls/gather?cid=1"><x>',
      noAnswerText: evil,
    });
    expect(twiml).not.toContain('<html:script');
    expect(twiml).not.toContain('<x>');
    const fin = buildFinalTwiml('Polly.Hala-Neural"><x>', evil);
    expect(fin).not.toContain('<html:script');
    expect(fin).not.toContain('<x>');
  });
});
