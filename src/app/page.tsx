'use client';

// Landing page publique — vitrine du SaaS Autotim.
// Avant, `/` redirigeait vers /login → aucune découverte possible du produit.
// Cible : e-commerçants algériens sur ZRExpress cherchant à automatiser le
// suivi de commandes et les notifications WhatsApp Darija.

import Link from 'next/link';
import {
  Truck,
  MessageCircle,
  LayoutDashboard,
  Bell,
  ArrowRight,
  Check,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white dark:bg-stone-950 text-stone-900 dark:text-stone-100">
      {/* ── NAV ─────────────────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 bg-white/80 dark:bg-stone-950/80 backdrop-blur-md border-b border-stone-100 dark:border-stone-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-xl flex items-center justify-center shadow-sm shadow-violet-500/25">
              <span className="text-white font-bold">Z</span>
            </div>
            <div className="leading-tight">
              <div className="font-bold tracking-tight">Autotim</div>
              <div className="text-[10px] text-stone-400 dark:text-stone-500 uppercase tracking-wide font-medium">
                ZRExpress
              </div>
            </div>
          </Link>
          <div className="flex items-center gap-2 sm:gap-4">
            <Link
              href="/pricing"
              className="hidden sm:inline text-sm font-medium text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-stone-100 transition-colors"
            >
              Tarifs
            </Link>
            <Link
              href="/track"
              className="hidden sm:inline-flex items-center gap-1.5 text-sm font-medium text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-stone-100 transition-colors"
            >
              <Search size={14} /> Suivre un colis
            </Link>
            <Link
              href="/login"
              className="flex items-center gap-1.5 text-sm font-medium bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-xl transition-colors shadow-sm"
            >
              Se connecter
            </Link>
          </div>
        </div>
      </nav>

      {/* ── HERO ────────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-violet-50 via-white to-fuchsia-50 dark:from-stone-950 dark:via-stone-950 dark:to-violet-950/30" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-gradient-to-br from-violet-400/20 to-fuchsia-400/20 dark:from-violet-500/10 dark:to-fuchsia-500/10 rounded-full blur-3xl -z-0" />

        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24 text-center">
          <div className="inline-flex items-center gap-2 bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300 text-xs font-semibold px-3 py-1 rounded-full mb-6">
            <Sparkles size={12} /> Pensé pour les e-commerçants algériens
          </div>
          <h1 className="text-4xl sm:text-6xl font-bold tracking-tight mb-6 leading-tight">
            Vos clients suivent leur colis,
            <br />
            <span className="bg-gradient-to-r from-violet-600 to-fuchsia-600 dark:from-violet-400 dark:to-fuchsia-400 bg-clip-text text-transparent">
              sans vous appeler.
            </span>
          </h1>
          <p className="text-lg sm:text-xl text-stone-600 dark:text-stone-400 max-w-2xl mx-auto mb-10">
            Autotim se branche à ZRExpress, envoie automatiquement les notifications WhatsApp en
            Darija à vos clients, et vous montre l'état de chaque livraison en temps réel.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/login"
              className="w-full sm:w-auto flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 text-white font-semibold px-6 py-3.5 rounded-xl shadow-lg shadow-violet-500/25 transition-all"
            >
              Essayer gratuitement <ArrowRight size={18} />
            </Link>
            <Link
              href="/pricing"
              className="w-full sm:w-auto flex items-center justify-center gap-2 bg-white dark:bg-stone-900 hover:bg-stone-50 dark:hover:bg-stone-800 text-stone-800 dark:text-stone-100 font-semibold px-6 py-3.5 rounded-xl border border-stone-200 dark:border-stone-800 transition-colors"
            >
              Voir les tarifs
            </Link>
          </div>
          <p className="text-xs text-stone-400 dark:text-stone-500 mt-4">
            Inscription en 10 secondes avec Google · Plan Basic gratuit, sans carte
          </p>
        </div>
      </section>

      {/* ── APERÇU DASHBOARD (mockup) ───────────────────────────────────────── */}
      <section className="py-16 border-t border-stone-100 dark:border-stone-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-10">
            <h2 className="text-3xl sm:text-4xl font-bold mb-3">Un tableau de bord clair</h2>
            <p className="text-stone-500 dark:text-stone-400">
              Toutes vos livraisons en un coup d'œil.
            </p>
          </div>

          {/* Mockup : cadre "navigateur" + faux dashboard en CSS/SVG (aucune image externe). */}
          <div className="relative max-w-4xl mx-auto rounded-2xl border border-stone-200 dark:border-stone-800 shadow-2xl shadow-violet-500/10 overflow-hidden bg-white dark:bg-stone-950">
            {/* Barre navigateur */}
            <div className="flex items-center gap-1.5 bg-stone-100 dark:bg-stone-900 border-b border-stone-200 dark:border-stone-800 px-3 py-2">
              <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
              <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
              <div className="ml-4 text-[10px] font-mono text-stone-400 dark:text-stone-500">
                autotim.app/admin-dashboard
              </div>
            </div>

            {/* Contenu fake dashboard */}
            <div className="p-4 sm:p-6 space-y-4 text-left">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-[10px]">Z</span>
                </div>
                <div className="text-xs font-semibold">Dashboard</div>
              </div>

              {/* KPIs */}
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: 'En prépa', value: '124', tone: 'violet' },
                  { label: 'En transit', value: '87', tone: 'blue' },
                  { label: 'Livrés', value: '542', tone: 'green' },
                  { label: 'Retours', value: '18', tone: 'red' },
                ].map((k) => (
                  <div
                    key={k.label}
                    className="bg-stone-50 dark:bg-stone-900 border border-stone-100 dark:border-stone-800 rounded-lg p-2.5"
                  >
                    <div
                      className={`text-[9px] font-semibold uppercase tracking-wide ${
                        k.tone === 'violet'
                          ? 'text-violet-500'
                          : k.tone === 'blue'
                            ? 'text-blue-500'
                            : k.tone === 'green'
                              ? 'text-green-500'
                              : 'text-red-500'
                      }`}
                    >
                      {k.label}
                    </div>
                    <div className="text-lg font-bold text-stone-900 dark:text-stone-100 tabular-nums">
                      {k.value}
                    </div>
                  </div>
                ))}
              </div>

              {/* Graphique */}
              <div className="bg-stone-50 dark:bg-stone-900 border border-stone-100 dark:border-stone-800 rounded-lg p-3">
                <div className="text-[10px] font-semibold text-stone-500 dark:text-stone-400 mb-2">
                  Livraisons 7 derniers jours
                </div>
                <svg viewBox="0 0 400 80" className="w-full h-16">
                  <defs>
                    <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="rgb(139,92,246)" stopOpacity="0.4" />
                      <stop offset="100%" stopColor="rgb(139,92,246)" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M0,60 L60,45 L120,50 L180,30 L240,35 L300,15 L360,20 L400,10"
                    fill="none"
                    stroke="rgb(139,92,246)"
                    strokeWidth="2"
                  />
                  <path
                    d="M0,60 L60,45 L120,50 L180,30 L240,35 L300,15 L360,20 L400,10 L400,80 L0,80 Z"
                    fill="url(#grad)"
                  />
                </svg>
              </div>

              {/* Table simplifiée */}
              <div className="bg-stone-50 dark:bg-stone-900 border border-stone-100 dark:border-stone-800 rounded-lg overflow-hidden">
                <div className="grid grid-cols-[1fr_1fr_auto] gap-2 px-3 py-1.5 border-b border-stone-100 dark:border-stone-800 text-[9px] font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
                  <span>Client</span>
                  <span>Wilaya</span>
                  <span>Statut</span>
                </div>
                {[
                  { c: 'Ahmed B.', w: 'Alger', s: 'Livré', tone: 'green' },
                  { c: 'Sara M.', w: 'Oran', s: 'En transit', tone: 'blue' },
                  { c: 'Karim L.', w: 'Blida', s: 'En livraison', tone: 'amber' },
                ].map((r, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-[1fr_1fr_auto] gap-2 px-3 py-2 border-b border-stone-100/50 dark:border-stone-800/50 last:border-0 items-center"
                  >
                    <span className="text-xs font-medium text-stone-800 dark:text-stone-100">
                      {r.c}
                    </span>
                    <span className="text-xs text-stone-500 dark:text-stone-400">{r.w}</span>
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        r.tone === 'green'
                          ? 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300'
                          : r.tone === 'blue'
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
                      }`}
                    >
                      {r.s}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── COMMENT ÇA MARCHE (3 étapes) ────────────────────────────────────── */}
      <section className="py-20 border-t border-stone-100 dark:border-stone-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold mb-3">Simple comme trois étapes</h2>
            <p className="text-stone-500 dark:text-stone-400">
              Configurez une fois, laissez tourner.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                n: 1,
                icon: Truck,
                tone: 'from-violet-500 to-violet-600',
                title: 'Connectez ZRExpress',
                desc: 'Collez votre clé API ZRExpress une seule fois. Autotim synchronise vos commandes en continu.',
              },
              {
                n: 2,
                icon: MessageCircle,
                tone: 'from-fuchsia-500 to-fuchsia-600',
                title: 'Connectez WhatsApp',
                desc: 'Scannez le QR code depuis votre téléphone. Les messages partent depuis votre propre numéro, en Darija.',
              },
              {
                n: 3,
                icon: Bell,
                tone: 'from-violet-500 to-fuchsia-500',
                title: 'Vos clients sont informés',
                desc: 'À chaque changement de statut ZRExpress, une notification WhatsApp part automatiquement — vous ne touchez à rien.',
              },
            ].map(({ n, icon: Icon, tone, title, desc }) => (
              <div
                key={n}
                className="relative bg-white dark:bg-stone-900 border border-stone-100 dark:border-stone-800 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow"
              >
                <div
                  className={`w-11 h-11 bg-gradient-to-br ${tone} rounded-xl flex items-center justify-center mb-4 shadow-sm`}
                >
                  <Icon size={20} className="text-white" />
                </div>
                <div className="text-xs font-bold text-violet-500 dark:text-violet-400 mb-1">
                  ÉTAPE {n}
                </div>
                <h3 className="text-lg font-bold mb-2">{title}</h3>
                <p className="text-sm text-stone-500 dark:text-stone-400 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES ────────────────────────────────────────────────────────── */}
      <section className="py-20 bg-stone-50 dark:bg-stone-900/50 border-t border-stone-100 dark:border-stone-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold mb-3">Ce qui rend Autotim différent</h2>
            <p className="text-stone-500 dark:text-stone-400">
              Conçu pour l'e-commerce algérien, pas une adaptation d'un outil étranger.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-5">
            {[
              {
                icon: MessageCircle,
                tone: 'violet',
                title: 'WhatsApp en Darija',
                desc: "Templates prêts à l'emploi en Arabe algérien. Vos clients reçoivent un message qui sonne humain, pas un robot.",
              },
              {
                icon: Search,
                tone: 'fuchsia',
                title: 'Page de suivi publique',
                desc: "Chaque client reçoit un lien pour suivre son colis en temps réel. Fini les appels « c'est où ma commande ? ».",
              },
              {
                icon: LayoutDashboard,
                tone: 'violet',
                title: 'Dashboard temps réel',
                desc: "Voyez d'un coup d'œil : combien en préparation, en livraison, livrés, retournés. KPIs, graphiques, tout.",
              },
              {
                icon: Bell,
                tone: 'fuchsia',
                title: 'Anti-suspension WhatsApp',
                desc: "Rythme d'envoi contrôlé, variation automatique, warm-up progressif — votre numéro reste en vie.",
              },
            ].map(({ icon: Icon, tone, title, desc }, i) => (
              <div
                key={i}
                className="flex gap-4 p-5 bg-white dark:bg-stone-900 rounded-2xl border border-stone-100 dark:border-stone-800"
              >
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    tone === 'violet'
                      ? 'bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300'
                      : 'bg-fuchsia-100 text-fuchsia-600 dark:bg-fuchsia-500/15 dark:text-fuchsia-300'
                  }`}
                >
                  <Icon size={18} />
                </div>
                <div>
                  <h3 className="font-bold mb-1">{title}</h3>
                  <p className="text-sm text-stone-500 dark:text-stone-400">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TARIFS (aperçu) ─────────────────────────────────────────────────── */}
      <section className="py-20 border-t border-stone-100 dark:border-stone-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold mb-3">Un prix simple, en dinars</h2>
            <p className="text-stone-500 dark:text-stone-400">
              Commencez gratuitement. Pas de carte requise, pas d'engagement.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-5 max-w-4xl mx-auto">
            {[
              {
                name: 'Basic',
                priceText: 'Gratuit',
                badge: null,
                features: ['200 commandes/mois', 'Suivi client public', 'Support email'],
              },
              {
                name: 'Pro',
                priceText: '1 900 DA',
                period: '/mois',
                badge: '⭐ Populaire',
                features: ['2 000 commandes/mois', 'WhatsApp automatique', 'Rapports avancés'],
                featured: true,
              },
              {
                name: 'Business',
                priceText: '4 900 DA',
                period: '/mois',
                badge: null,
                features: ['Commandes illimitées', 'Intégrations complètes', 'Support prioritaire'],
              },
            ].map((plan) => (
              <div
                key={plan.name}
                className={`relative bg-white dark:bg-stone-900 rounded-2xl p-6 border-2 shadow-sm transition-all ${
                  plan.featured
                    ? 'border-violet-500 shadow-violet-500/10 md:scale-105'
                    : 'border-stone-100 dark:border-stone-800'
                }`}
              >
                {plan.badge && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-violet-500 text-white text-xs font-semibold px-3 py-1 rounded-full">
                    {plan.badge}
                  </span>
                )}
                <h3 className="text-lg font-bold mb-2">{plan.name}</h3>
                <div className="flex items-baseline gap-1 mb-5">
                  <span className="text-3xl font-bold">{plan.priceText}</span>
                  {plan.period && (
                    <span className="text-stone-500 dark:text-stone-400 text-sm">
                      {plan.period}
                    </span>
                  )}
                </div>
                <ul className="space-y-2 mb-6">
                  {plan.features.map((f) => (
                    <li
                      key={f}
                      className="flex items-start gap-2 text-sm text-stone-600 dark:text-stone-300"
                    >
                      <Check size={15} className="text-violet-500 mt-0.5 shrink-0" /> {f}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/pricing"
                  className="block text-center text-sm font-medium text-violet-600 dark:text-violet-400 hover:underline"
                >
                  Voir tous les détails →
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────────────────── */}
      <section className="py-20 bg-stone-50 dark:bg-stone-900/50 border-t border-stone-100 dark:border-stone-800">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-10">
            <h2 className="text-3xl sm:text-4xl font-bold mb-3">Questions fréquentes</h2>
            <p className="text-stone-500 dark:text-stone-400">
              Les réponses avant que vous les posiez.
            </p>
          </div>

          <div className="space-y-3">
            {[
              {
                q: 'Est-ce que je risque de faire suspendre mon numéro WhatsApp ?',
                a: "Autotim applique un rythme d'envoi contrôlé (délai aléatoire entre chaque message), varie automatiquement chaque texte, et propose un mode « warm-up » qui monte le plafond progressivement sur 2 semaines quand vous connectez un nouveau numéro. C'est la meilleure protection possible côté outil — WhatsApp reste imprévisible, mais vous partez avec toutes les précautions.",
              },
              {
                q: "Combien coûte l'envoi WhatsApp ?",
                a: 'Rien de plus que votre abonnement Autotim. Vous utilisez votre propre numéro WhatsApp (personnel ou Business), pas un service payant à côté. Le prix affiché est tout compris.',
              },
              {
                q: 'Ça marche avec Yalidine, Anderson, ZR Express… ?',
                a: 'Autotim est actuellement branché sur ZRExpress. Les intégrations Yalidine et Anderson sont sur la feuille de route — écrivez-nous si vous en avez besoin, ça peut faire remonter la priorité.',
              },
              {
                q: 'Y a-t-il un engagement ?',
                a: 'Aucun. Vous êtes en Basic gratuit tant que vous voulez, et vous pouvez upgrader ou downgrader mois par mois. Pas de contrat.',
              },
              {
                q: "Mes clients sont-ils obligés d'installer une application ?",
                a: 'Non. Ils reçoivent un lien WhatsApp classique qui ouvre une page web mobile-friendly. Aucune installation, aucune inscription côté client.',
              },
              {
                q: 'Quelles données Autotim stocke-t-il ?',
                a: 'Uniquement les commandes ZRExpress que vous synchronisez (tracking, nom, wilaya, statut) et les messages envoyés. Les données restent isolées par compte — aucun autre client ne peut voir vos commandes.',
              },
            ].map((item, i) => (
              <details
                key={i}
                className="group bg-white dark:bg-stone-900 border border-stone-100 dark:border-stone-800 rounded-xl overflow-hidden"
              >
                <summary className="flex items-center justify-between gap-3 p-5 cursor-pointer list-none hover:bg-stone-50 dark:hover:bg-stone-800/50 transition-colors">
                  <span className="font-semibold text-stone-900 dark:text-stone-100 text-sm">
                    {item.q}
                  </span>
                  <span className="text-violet-500 font-bold text-lg shrink-0 group-open:rotate-45 transition-transform">
                    +
                  </span>
                </summary>
                <div className="px-5 pb-5 text-sm text-stone-600 dark:text-stone-400 leading-relaxed">
                  {item.a}
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA FINAL ───────────────────────────────────────────────────────── */}
      <section className="py-20 border-t border-stone-100 dark:border-stone-800">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <div className="bg-gradient-to-br from-violet-600 to-fuchsia-600 rounded-3xl p-10 sm:p-14 shadow-xl shadow-violet-500/20">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">Prêt à automatiser ?</h2>
            <p className="text-violet-100 mb-8 text-lg">
              Créez votre compte gratuit et commencez à envoyer des notifications aujourd'hui.
            </p>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 bg-white text-violet-700 font-semibold px-6 py-3.5 rounded-xl shadow-lg hover:bg-violet-50 transition-colors"
            >
              Commencer gratuitement <ArrowRight size={18} />
            </Link>
          </div>
        </div>
      </section>

      {/* ── FOOTER ──────────────────────────────────────────────────────────── */}
      <footer className="border-t border-stone-100 dark:border-stone-800 py-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-xs">Z</span>
            </div>
            <span className="font-semibold text-sm">Autotim</span>
            <span className="text-stone-400 dark:text-stone-500 text-xs">· ZRExpress</span>
          </div>
          <div className="flex items-center gap-5 text-sm text-stone-500 dark:text-stone-400">
            <Link
              href="/pricing"
              className="hover:text-stone-900 dark:hover:text-stone-100 transition-colors"
            >
              Tarifs
            </Link>
            <Link
              href="/track"
              className="hover:text-stone-900 dark:hover:text-stone-100 transition-colors"
            >
              Suivre un colis
            </Link>
            <a
              href="mailto:yasseraissou300@gmail.com"
              className="hover:text-stone-900 dark:hover:text-stone-100 transition-colors"
            >
              Contact
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
