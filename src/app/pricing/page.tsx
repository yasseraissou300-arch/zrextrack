'use client';

import { Check, Zap } from 'lucide-react';
import Link from 'next/link';

const plans = [
  {
    id: 'basic',
    name: 'Basic',
    price: 0,
    description: 'Idéal pour démarrer',
    color: 'border-stone-200 dark:border-stone-800',
    badge: null,
    features: [
      'Jusqu\'à 200 commandes/mois',
      '1 utilisateur',
      'Tableau de bord',
      'Support email',
    ],
    cta: 'Commencer gratuitement',
    ctaStyle: 'bg-stone-900 hover:bg-stone-800 text-white dark:bg-stone-100 dark:hover:bg-white dark:text-stone-900',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 1900,
    description: 'Pour les équipes qui grandissent',
    color: 'border-violet-500 ring-2 ring-violet-500',
    badge: '⭐ Populaire',
    features: [
      'Jusqu\'à 2000 commandes/mois',
      '5 utilisateurs',
      'Messages WhatsApp automatiques',
      'Rapports avancés',
      'Export Excel/CSV',
      'Support prioritaire',
    ],
    cta: 'Choisir Pro',
    ctaStyle: 'bg-violet-600 hover:bg-violet-700 text-white',
  },
  {
    id: 'business',
    name: 'Business',
    price: 4900,
    description: 'Pour les grandes opérations',
    color: 'border-fuchsia-200 dark:border-fuchsia-500/30',
    badge: null,
    features: [
      'Commandes illimitées',
      '20 utilisateurs',
      'Intégration ZRExpress complète',
      'API access',
      'Rapports personnalisés',
      'Support dédié 24/7',
      'Formation incluse',
    ],
    cta: 'Choisir Business',
    ctaStyle: 'bg-fuchsia-600 hover:bg-fuchsia-700 text-white',
  },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-50 to-violet-50 dark:from-stone-950 dark:to-stone-900 py-16 px-4">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300 text-sm font-medium px-4 py-1.5 rounded-full mb-4">
            <Zap size={14} /> Tarifs simples et transparents
          </div>
          <h1 className="text-4xl font-bold text-stone-900 dark:text-stone-100 mb-4">
            Choisissez votre plan
          </h1>
          <p className="text-lg text-stone-600 dark:text-stone-400 max-w-2xl mx-auto">
            Commencez gratuitement, évoluez selon vos besoins. Pas de surprise, pas d'engagement.
          </p>
        </div>

        {/* Plans Grid */}
        <div className="grid md:grid-cols-3 gap-6 mb-12">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className={`bg-white dark:bg-stone-900 rounded-2xl p-6 border-2 ${plan.color} relative shadow-sm hover:shadow-md transition-shadow`}
            >
              {plan.badge && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-violet-500 text-white text-xs font-semibold px-4 py-1 rounded-full">
                  {plan.badge}
                </span>
              )}

              <div className="mb-6">
                <h3 className="text-xl font-bold text-stone-900 dark:text-stone-100 mb-1">{plan.name}</h3>
                <p className="text-stone-500 dark:text-stone-400 text-sm mb-4">{plan.description}</p>
                <div className="flex items-baseline gap-1.5">
                  {plan.price === 0 ? (
                    <>
                      <span className="text-4xl font-bold text-stone-900 dark:text-stone-100">Gratuit</span>
                      <span className="text-stone-500 dark:text-stone-400">pour toujours</span>
                    </>
                  ) : (
                    <>
                      <span className="text-4xl font-bold text-stone-900 dark:text-stone-100 tabular-nums">{plan.price.toLocaleString('fr-FR')}</span>
                      <span className="text-lg font-semibold text-stone-600 dark:text-stone-300">DA</span>
                      <span className="text-stone-500 dark:text-stone-400">/mois</span>
                    </>
                  )}
                </div>
              </div>

              <ul className="space-y-3 mb-8">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5 text-sm text-stone-700 dark:text-stone-300">
                    <Check size={16} className="text-violet-500 dark:text-violet-400 mt-0.5 shrink-0" />
                    {feature}
                  </li>
                ))}
              </ul>

              <Link
                href="/login"
                className={`block text-center py-3 px-6 rounded-xl font-medium transition-colors ${plan.ctaStyle}`}
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>

        {/* FAQ simple */}
        <div className="text-center">
          <p className="text-stone-500 dark:text-stone-400 text-sm">
            Des questions ? Contactez-nous à{' '}
            <a href="mailto:yasseraissou300@gmail.com" className="text-violet-600 dark:text-violet-400 hover:underline">
              yasseraissou300@gmail.com
            </a>
          </p>
          <Link href="/login" className="inline-block mt-4 text-sm text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 underline">
            ← Retour à la connexion
          </Link>
        </div>
      </div>
    </div>
  );
}
