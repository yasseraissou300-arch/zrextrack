'use client';

import { Check, Zap } from 'lucide-react';
import Link from 'next/link';

const plans = [
  {
    id: 'basic',
    name: 'Basic',
    price: 0,
    description: 'Idéal pour démarrer',
    color: 'border-slate-200',
    badge: null,
    features: [
      'Jusqu\'à 200 commandes/mois',
      '1 utilisateur',
      'Tableau de bord',
      'Support email',
    ],
    cta: 'Commencer gratuitement',
    ctaStyle: 'bg-slate-900 hover:bg-slate-800 text-white',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 29,
    description: 'Pour les équipes qui grandissent',
    color: 'border-blue-500 ring-2 ring-blue-500',
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
    ctaStyle: 'bg-blue-600 hover:bg-blue-700 text-white',
  },
  {
    id: 'business',
    name: 'Business',
    price: 79,
    description: 'Pour les grandes opérations',
    color: 'border-purple-200',
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
    ctaStyle: 'bg-purple-600 hover:bg-purple-700 text-white',
  },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 py-16 px-4">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 bg-green-100 text-green-700 text-sm font-medium px-4 py-1.5 rounded-full mb-4">
            <Zap size={14} /> Tarifs simples et transparents
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Choisissez votre plan
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Commencez gratuitement, évoluez selon vos besoins. Pas de surprise, pas d'engagement.
          </p>
        </div>

        {/* Plans Grid */}
        <div className="grid md:grid-cols-3 gap-6 mb-12">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className={`bg-white rounded-2xl p-6 border-2 ${plan.color} relative shadow-sm hover:shadow-md transition-shadow`}
            >
              {plan.badge && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-500 text-white text-xs font-semibold px-4 py-1 rounded-full">
                  {plan.badge}
                </span>
              )}

              <div className="mb-6">
                <h3 className="text-xl font-bold text-gray-900 mb-1">{plan.name}</h3>
                <p className="text-gray-500 text-sm mb-4">{plan.description}</p>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold text-gray-900">{plan.price}€</span>
                  {plan.price > 0 && <span className="text-gray-500">/mois</span>}
                  {plan.price === 0 && <span className="text-gray-500">pour toujours</span>}
                </div>
              </div>

              <ul className="space-y-3 mb-8">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5 text-sm text-gray-700">
                    <Check size={16} className="text-green-500 mt-0.5 shrink-0" />
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
          <p className="text-gray-500 text-sm">
            Des questions ? Contactez-nous à{' '}
            <a href="mailto:yasseraissou300@gmail.com" className="text-blue-600 hover:underline">
              yasseraissou300@gmail.com
            </a>
          </p>
          <Link href="/login" className="inline-block mt-4 text-sm text-gray-600 hover:text-gray-900 underline">
            ← Retour à la connexion
          </Link>
        </div>
      </div>
    </div>
  );
}
