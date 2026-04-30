'use client';
import React, { useState, useEffect, useCallback } from 'react';
import AppLayout from '@/components/ui/AppLayout';
import { Plug, Copy, CheckCircle, XCircle, Loader2, Plus, Trash2, ExternalLink, ShoppingCart, Globe, Package } from 'lucide-react';
import { toast } from 'sonner';

interface Integration {
  id: string;
  platform: string;
  identifier: string;
  active: boolean;
  orders_synced: number;
  last_sync: string | null;
}

const APP_URL = typeof window !== 'undefined' ? window.location.origin : '';

const PLATFORMS = [
  {
    id: 'shopify',
    name: 'Shopify',
    icon: ShoppingCart,
    color: 'bg-green-500',
    description: 'Sync automatique des commandes Shopify via webhook',
    identifierLabel: 'Domaine boutique',
    identifierPlaceholder: 'ma-boutique.myshopify.com',
    webhookPath: '/api/integrations/shopify/webhook',
    setupSteps: [
      'Dans Shopify Admin → Paramètres → Notifications',
      'Créer un webhook pour "Création de commande" et "Mise à jour de commande"',
      'URL : coller le webhook ci-dessus',
      'Format : JSON',
    ],
  },
  {
    id: 'woocommerce',
    name: 'WooCommerce',
    icon: ShoppingCart,
    color: 'bg-purple-500',
    description: 'Sync automatique des commandes WooCommerce via webhook',
    identifierLabel: 'URL du site',
    identifierPlaceholder: 'https://monsite.com',
    webhookPath: '/api/integrations/woocommerce/webhook',
    setupSteps: [
      'Dans WooCommerce → Paramètres → Avancé → Webhooks',
      'Ajouter un webhook pour "Commande créée" et "Commande mise à jour"',
      'URL de livraison : coller le webhook ci-dessus',
      'Secret : coller votre clé secrète',
    ],
  },
  {
    id: 'google_sheets',
    name: 'Google Sheets',
    icon: Globe,
    color: 'bg-blue-500',
    description: 'Export des commandes vers Google Sheets (bientôt)',
    identifierLabel: 'ID du fichier Sheets',
    identifierPlaceholder: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms',
    webhookPath: '',
    setupSteps: ['Intégration Google Sheets disponible prochainement.'],
    comingSoon: true,
  },
];

function ConnectModal({ platform, onClose, onConnect }: {
  platform: typeof PLATFORMS[0];
  onClose: () => void;
  onConnect: (identifier: string, secret: string) => Promise<void>;
}) {
  const [identifier, setIdentifier] = useState('');
  const [secret, setSecret] = useState('');
  const [saving, setSaving] = useState(false);

  const webhookUrl = `${APP_URL}${platform.webhookPath}`;

  const copy = (text: string) => { navigator.clipboard.writeText(text); toast.success('Copié !'); };

  const handleConnect = async () => {
    if (!identifier.trim()) { toast.error(`${platform.identifierLabel} requis`); return; }
    setSaving(true);
    await onConnect(identifier.trim(), secret.trim());
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 ${platform.color} rounded-xl flex items-center justify-center`}>
              <platform.icon size={20} className="text-white" />
            </div>
            <div>
              <h2 className="font-bold text-gray-900">Connecter {platform.name}</h2>
              <p className="text-xs text-gray-500">{platform.description}</p>
            </div>
          </div>

          {platform.webhookPath && (
            <div className="bg-gray-50 rounded-xl p-4 space-y-2">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">URL Webhook</p>
              <div className="flex gap-2">
                <code className="flex-1 text-xs text-gray-700 break-all">{webhookUrl}</code>
                <button onClick={() => copy(webhookUrl)} className="p-1.5 hover:bg-gray-200 rounded-lg shrink-0">
                  <Copy size={13} className="text-gray-500" />
                </button>
              </div>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600">{platform.identifierLabel}</label>
            <input
              value={identifier}
              onChange={e => setIdentifier(e.target.value)}
              placeholder={platform.identifierPlaceholder}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          {platform.id !== 'google_sheets' && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600">Clé secrète (optionnel)</label>
              <input
                value={secret}
                onChange={e => setSecret(e.target.value)}
                placeholder="Pour valider la signature du webhook"
                type="password"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          )}

          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 space-y-1.5">
            <p className="text-xs font-semibold text-blue-700">Guide de configuration</p>
            {platform.setupSteps.map((s, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="w-4 h-4 rounded-full bg-blue-200 text-blue-800 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                <p className="text-xs text-blue-700">{s}</p>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 border border-gray-200 rounded-xl py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50">
              Annuler
            </button>
            {!platform.comingSoon && (
              <button
                onClick={handleConnect}
                disabled={saving}
                className="flex-1 bg-green-600 text-white rounded-xl py-2.5 text-sm font-medium hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                Connecter
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalPlatform, setModalPlatform] = useState<typeof PLATFORMS[0] | null>(null);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/integrations');
    const json = await res.json();
    setIntegrations(json.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetch_(); }, [fetch_]);

  const handleConnect = async (platform: typeof PLATFORMS[0], identifier: string, secret: string) => {
    const res = await fetch('/api/integrations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: platform.id, identifier, secret_key: secret }),
    });
    const json = await res.json();
    if (json.error) { toast.error(json.error); return; }
    toast.success(`${platform.name} connecté !`);
    setModalPlatform(null);
    await fetch_();
  };

  const handleDisconnect = async (platform: string) => {
    if (!confirm('Déconnecter cette intégration ?')) return;
    await fetch('/api/integrations', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform }),
    });
    toast.success('Intégration déconnectée');
    await fetch_();
  };

  const getIntegration = (id: string) => integrations.find(i => i.platform === id && i.active);

  return (
    <AppLayout>
      <div className="max-w-screen-lg mx-auto px-6 py-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
            <Plug size={20} className="text-indigo-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Intégrations</h1>
            <p className="text-sm text-gray-500">Connectez vos plateformes e-commerce pour synchroniser les commandes automatiquement</p>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-20"><Loader2 size={24} className="animate-spin text-gray-400" /></div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {PLATFORMS.map(platform => {
              const connected = getIntegration(platform.id);
              return (
                <div key={platform.id} className={`bg-white rounded-2xl border shadow-sm p-5 space-y-4 ${connected ? 'border-green-200' : 'border-gray-100'}`}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 ${platform.color} rounded-xl flex items-center justify-center`}>
                        <platform.icon size={20} className="text-white" />
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900">{platform.name}</p>
                        {platform.comingSoon && (
                          <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">Bientôt</span>
                        )}
                      </div>
                    </div>
                    {connected ? (
                      <span className="flex items-center gap-1 text-xs font-medium text-green-700 bg-green-100 px-2 py-1 rounded-full">
                        <CheckCircle size={11} /> Connecté
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs font-medium text-gray-400 bg-gray-100 px-2 py-1 rounded-full">
                        <XCircle size={11} /> Non connecté
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-gray-500">{platform.description}</p>

                  {connected && (
                    <div className="bg-gray-50 rounded-xl p-3 space-y-1 text-xs text-gray-500">
                      <p><span className="font-medium">Boutique:</span> {connected.identifier}</p>
                      <p><span className="font-medium">Commandes sync:</span> {connected.orders_synced}</p>
                      {connected.last_sync && (
                        <p><span className="font-medium">Dernière sync:</span> {new Date(connected.last_sync).toLocaleDateString('fr-FR')}</p>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2">
                    {connected ? (
                      <button
                        onClick={() => handleDisconnect(platform.id)}
                        className="flex items-center gap-1.5 text-xs px-3 py-2 border border-red-100 text-red-500 rounded-lg hover:bg-red-50"
                      >
                        <Trash2 size={12} /> Déconnecter
                      </button>
                    ) : (
                      <button
                        onClick={() => !platform.comingSoon && setModalPlatform(platform)}
                        disabled={!!platform.comingSoon}
                        className="flex items-center gap-1.5 text-xs px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 font-medium"
                      >
                        <Plus size={12} /> Connecter
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="bg-gray-50 rounded-2xl border border-gray-100 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Package size={16} className="text-gray-500" />
            <p className="font-semibold text-gray-700">Comment ça fonctionne</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-gray-500">
            {[
              { n: '1', t: 'Connecter', d: 'Renseignez votre boutique et configurez le webhook dans votre plateforme.' },
              { n: '2', t: 'Sync automatique', d: 'Chaque nouvelle commande est automatiquement importée dans Autotim.' },
              { n: '3', t: 'Notification WhatsApp', d: 'Le client reçoit une confirmation WhatsApp dès que la commande change de statut.' },
            ].map(item => (
              <div key={item.n} className="flex items-start gap-2.5">
                <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center shrink-0">{item.n}</span>
                <div>
                  <p className="font-medium text-gray-700">{item.t}</p>
                  <p className="mt-0.5">{item.d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {modalPlatform && (
        <ConnectModal
          platform={modalPlatform}
          onClose={() => setModalPlatform(null)}
          onConnect={(id, sec) => handleConnect(modalPlatform, id, sec)}
        />
      )}
    </AppLayout>
  );
}
