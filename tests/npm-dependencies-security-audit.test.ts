// AUDIT SÉCURITÉ DES DÉPENDANCES NPM — tests de CONSTAT (runtime inchangé,
// package.json et package-lock.json inchangés).
//
// Ces tests ne reproduisent aucune CVE. Ils figent :
//   1. les versions réellement résolues (lockfile) au moment de l'audit ;
//   2. l'absence de bibliothèques de rendu HTML / Markdown / sanitizer dans
//      tout l'arbre ;
//   3. les PRÉCONDITIONS qui rendent la plupart des advisories Next.js non
//      atteignables (pas de Server Actions, pas de rewrites/i18n, pas de
//      beforeInteractive, pas de nonce CSP, pas de catch-all racine…).
//      Si l'une change, les advisories correspondants doivent être réévalués.
// Voir .claude/mission/npm-dependencies-security-audit.md.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
const LP: Record<string, { version: string; dev?: boolean }> = lock.packages;

function resolved(name: string): string | undefined {
  return LP[`node_modules/${name}`]?.version;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(tsx?|jsx?|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}
const SRC_FILES = walk(path.join(ROOT, 'src')).map((f) => ({
  rel: path.relative(ROOT, f).replace(/\\/g, '/'),
  text: fs.readFileSync(f, 'utf8'),
}));
const NEXT_CONFIG = fs.readFileSync(path.join(ROOT, 'next.config.mjs'), 'utf8');

describe('NPM-1 — inventaire des versions résolues (lockfile)', () => {
  it('versions exactes des paquets critiques au moment de l’audit', () => {
    expect({
      next: resolved('next'),
      react: resolved('react'),
      'react-dom': resolved('react-dom'),
      '@supabase/ssr': resolved('@supabase/ssr'),
      '@supabase/supabase-js': resolved('@supabase/supabase-js'),
      '@supabase/auth-js': resolved('@supabase/auth-js'),
      sonner: resolved('sonner'),
      cookie: resolved('cookie'),
    }).toEqual({
      next: '15.1.11',
      react: '19.0.3',
      'react-dom': '19.0.3',
      '@supabase/ssr': '0.10.2',
      '@supabase/supabase-js': '2.103.1',
      '@supabase/auth-js': '2.103.1',
      sonner: '1.7.4',
      cookie: '1.1.1',
    });
  });

  it('package.json et lockfile sont cohérents (racine du lockfile = package.json)', () => {
    const root = LP[''] as unknown as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(root.dependencies).toEqual(pkg.dependencies);
    expect(root.devDependencies).toEqual(pkg.devDependencies);
    expect(lock.lockfileVersion).toBe(3);
  });

  it('next, react et react-dom sont épinglés (pas de plage) ; React = React DOM', () => {
    expect(pkg.dependencies.next).toBe('15.1.11');
    expect(pkg.dependencies.react).toBe('19.0.3');
    expect(pkg.dependencies['react-dom']).toBe('19.0.3');
  });

  it('les paquets installés correspondent au lockfile (si node_modules est présent)', () => {
    for (const name of [
      'next',
      'react',
      'react-dom',
      '@supabase/ssr',
      '@supabase/supabase-js',
      'sonner',
    ]) {
      const p = path.join(ROOT, 'node_modules', name, 'package.json');
      if (!fs.existsSync(p)) continue;
      expect(JSON.parse(fs.readFileSync(p, 'utf8')).version).toBe(resolved(name));
    }
  });
});

describe('NPM-2 — aucune bibliothèque de rendu HTML / Markdown / sanitizer dans tout l’arbre', () => {
  it('ni directe, ni transitive (lockfile complet)', () => {
    const names = Object.keys(LP).map((k) => k.replace(/^.*node_modules\//, ''));
    const rich = names.filter((n) =>
      /dompurify|^marked$|markdown|remark|rehype|sanitize-html|html-react-parser|cheerio|jsdom|happy-dom|parse5|htmlparser2|showdown|^xss$/i.test(
        n
      )
    );
    expect(rich).toEqual([]);
  });

  it('sonner (dist) ne contient aucun sink HTML brut (si node_modules est présent)', () => {
    const dist = path.join(ROOT, 'node_modules', 'sonner', 'dist');
    if (!fs.existsSync(dist)) return;
    for (const f of fs.readdirSync(dist).filter((x) => /\.(m?js)$/.test(x))) {
      const t = fs.readFileSync(path.join(dist, f), 'utf8');
      expect(t).not.toMatch(/dangerouslySetInnerHTML|\.innerHTML|insertAdjacentHTML/);
    }
  });
});

describe('NPM-3 — préconditions qui rendent les advisories Next.js non atteignables', () => {
  it('aucune Server Action / Server Function ("use server") — m99w, 955p, 4c39, 89xv, mg66', () => {
    expect(SRC_FILES.filter((f) => /['"]use server['"]/.test(f.text)).map((f) => f.rel)).toEqual(
      []
    );
  });

  it('aucun next/script ni beforeInteractive — gx5p (XSS)', () => {
    expect(
      SRC_FILES.filter((f) => /next\/script|beforeInteractive/.test(f.text)).map((f) => f.rel)
    ).toEqual([]);
  });

  it('aucun nonce CSP — ffhc (XSS)', () => {
    expect(
      SRC_FILES.filter((f) => /\bnonce\b|Content-Security-Policy/i.test(f.text)).map((f) => f.rel)
    ).toEqual([]);
    expect(NEXT_CONFIG).not.toMatch(/\bnonce\b|Content-Security-Policy/i);
  });

  it('next.config : pas de rewrites, pas d’i18n, redirects vide, pas de formats AVIF, pas de serveur custom — ggv3, p9j2, 36qx, 2xp9', () => {
    expect(NEXT_CONFIG).not.toMatch(/rewrites\s*\(/);
    expect(NEXT_CONFIG).not.toMatch(/i18n/);
    expect(NEXT_CONFIG).toMatch(/async redirects\(\) \{\s*return \[\];\s*\}/);
    expect(NEXT_CONFIG).not.toMatch(/avif/i);
    expect(pkg.scripts.start).toMatch(/^next start/);
  });

  it('aucune route catch-all à la racine de app/ — mcj8', () => {
    const top = fs.readdirSync(path.join(ROOT, 'src', 'app'));
    expect(top.filter((d) => /^\[(\[)?\.\.\./.test(d))).toEqual([]);
  });

  it('le middleware n’appelle NextResponse.next() qu’SANS en-têtes de requête — 4342', () => {
    const mw = fs.readFileSync(path.join(ROOT, 'src', 'middleware.ts'), 'utf8');
    const calls = mw.match(/NextResponse\.next\([^)]*\)/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c === 'NextResponse.next()')).toBe(true);
  });

  it('f82v (contournement middleware, PROUVÉ LOCAL) : le middleware n’est PAS la seule autorisation — /api/ est public côté middleware, les données exigent la session dans chaque route', () => {
    const mw = fs.readFileSync(path.join(ROOT, 'src', 'middleware.ts'), 'utf8');
    expect(mw).toContain("'/api/'");
    // échantillon de routes à données : chacune vérifie elle-même la session
    for (const r of ['orders', 'integrations']) {
      const t = fs.readFileSync(path.join(ROOT, 'src', 'app', 'api', r, 'route.ts'), 'utf8');
      expect(t).toMatch(/auth\.getUser\(\)/);
    }
  });

  it('aucune route API ne sert d’image dépendant des cookies — g5qg', () => {
    const imgRoutes = SRC_FILES.filter(
      (f) => f.rel.startsWith('src/app/api/') && /Content-Type['"]?\s*:\s*['"]image\//.test(f.text)
    );
    expect(imgRoutes.map((f) => f.rel)).toEqual([]);
  });
});

describe('NPM-4 — dépendances déclarées mais non utilisées par le code', () => {
  it('socket.io-client et @dhiwise/component-tagger ne sont importés nulle part (src, next.config)', () => {
    for (const name of ['socket.io-client', '@dhiwise/component-tagger']) {
      expect(pkg.dependencies[name]).toBeDefined();
      expect(SRC_FILES.filter((f) => f.text.includes(name)).map((f) => f.rel)).toEqual([]);
      expect(NEXT_CONFIG).not.toContain(name);
    }
  });
});
