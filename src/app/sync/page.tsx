'use client';

import AppLayout from '@/components/ui/AppLayout';
import { useEffect, useState } from 'react';
import {
  RefreshCw, CheckCircle2, XCircle, Key, Package,
  Clock, AlertTriangle, Eye, EyeOff, MessageSquare, Save, RotateCcw
} from 'lucide-react';

const STORAGE_KEY = 'zrexpress_token';
const TENANT_KEY = 'zrexpress_tenant';
const TEMPLATES_KEY = 'zrextrack_templates';

const DEFAULT_TEMPLATES: Record<string, string> = {
  en_transit:    `📦 Bonjour {client},\n\nVotre commande *{tracking}* est maintenant *en transit* vers {wilaya}.\n\nSuivez-la ici : {lien}`,
  en_livraison:  `🚚 Bonjour {client},\n\nVotre commande *{tracking}* est *en cours de livraison* aujourd'hui !\n\nSoyez disponible. Suivi : {lien}`,
  livre:         `✅ Bonjour {client},\n\nVotre commande *{tracking}* a été *livrée avec succès* ! 🎉\n\nMerci pour votre confiance. Suivi : {lien}`,
  echec:         `⚠️ Bonjour {client},\n\nNous n'avons pas pu livrer votre commande *{tracking}*.\n\nVeuillez contacter le vendeur ou suivre : {lien}`,
  retourne:      `📦 Bonjour {client},\n\nVotre commande *{tracking}* a été *retournée*.\n\nContactez le vendeur. Suivi : {lien}`,
};

const STATUS_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  en_transit:   { label: 'En transit',       color: 'text-blue-700',   bg: 'bg-blue-50',   border: 'border-blue-200' },
  en_livraison: { label: 'En livraison',     color: 'text-amber-700',  bg: 'bg-amber-50',  border: 'border-amber-200' },
  livre:        { label: 'Livré',            color: 'text-green-700',  bg: 'bg-green-50',  border: 'border-green-200' },
  echec:        { label: 'Échec livraison',  color: 'text-red-700',    bg: 'bg-red-50',    border: 'border-red-200' },
  retourne:     { label: 'Retourné',         color: 'text-gray-600',   bg: 'bg-gray-50',   border: 'border-gray-200' },
};

interface SyncResult {
  synced?: number;
  total?: number;
  message?: string;
  error?: string;
  whatsapp_sent?: number;
  notifications?: number;
}

interface SyncHistory {
  date: string;
  synced: number;
  total: number;
  status: 'success' | 'error';
  message: string;
}

export default function SyncPage() {
  const [token, setToken] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [history, setHistory] = useState<SyncHistory[]>([]);
  const [tokenSaved, setTokenSaved] = useState(false);

  // Templates
  const [templates, setTemplates] = useState<Record<string, string>>(DEFAULT_TEMPLATES);
  const [templatesSaved, setTemplatesSaved] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState<string>('en_transit');

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) { setToken(saved); setTokenSaved(true); }
    const savedTenant = localStorage.getItem(TENANT_KEY);
    if (savedTenant) setTenantId(savedTenant);
    const hist = localStorage.getItem('zrexpress_sync_history');
    if (hist) setHistory(JSON.parse(hist));
    const savedTemplates = localStorage.getItem(TEMPLATES_KEY);
    if (savedTemplates) setTemplates({ ...DEFAULT_TEMPLATES, ...JSON.parse(savedTemplates) });
  }, []);

  const saveToken = () => {
    if (!token.trim() || !tenantId.trim()) return;
    localStorage.setItem(STORAGE_KEY, token.trim());
    localStorage.setItem(TENANT_KEY, tenantId.trim());
    setTokenSaved(true);
  };

  const clearToken = () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(TENANT_KEY);
    setToken(''); setTenantId(''); setTokenSaved(false);
  };

  const saveTemplates = () => {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
    setTemplatesSaved(true);
    setTimeout(() => setTemplatesSaved(false), 2000);
  };

  const resetTemplate = (status: string) => {
    setTemplates(prev => ({ ...prev, [status]: DEFAULT_TEMPLATES[status] }));
  };

  const runSync = async () => {
    if (!token.trim() || !tenantId.trim()) return;
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch('/api/sync-zrexpress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim(), tenantId: tenantId.trim(), templates }),
      });
      const data: SyncResult = await res.json();
      setResult(data);

      const entry: SyncHistory = {
        date: new Date().toISOString(),
        synced: data.synced ?? 0,
        total: data.total ?? 0,
        status: data.error ? 'error' : 'success',
        message: data.error || data.message || '',
      };
      const newHistory = [entry, ...history].slice(0, 10);
      setHistory(newHistory);
      localStorage.setItem('zrexpress_sync_history', JSON.stringify(newHistory));
    } catch (err: any) {
      setResult({ error: err.message });
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

  // Prévisualisation du template actif avec données fictives
  const previewTemplate = (tpl: string) =>
    tpl
      .replace(/{client}/g, 'Ahmed Benali')
      .replace(/{tracking}/g, 'ZRX789012')
      .replace(/{wilaya}/g, 'Alger')
      .replace(/{lien}/g, 'zrextrack.vercel.app/track/ZRX789012');

  return (
    <AppLayout>
      <div className="max-w-screen-xl mx-auto px-6 py-6 space-y-6">

        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
            <RefreshCw size={20} className="text-green-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Sync ZREXpress</h1>
            <p className="text-sm text-gray-500">Importez vos commandes et configurez vos messages automatiques</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-5">

            {/* Clé API */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Key size={18} className="text-gray-500" />
                <h2 className="font-semibold text-gray-900">Clé API ZREXpress</h2>
                {tokenSaved && (
                  <span className="ml-auto text-xs bg-green-100 text-green-700 font-medium px-2 py-0.5 rounded-full">✓ Enregistrée</span>
                )}
              </div>
              <p className="text-sm text-gray-500 mb-4">
                Collez votre <strong>secretKey</strong> et <strong>tenantId</strong> depuis{' '}
                <a href="https://app.zrexpress.app/api-rest/tokens" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                  app.zrexpress.app → API Rest → Jetons API
                </a>
              </p>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Secret Key</label>
                  <div className="relative">
                    <input type={showToken ? 'text' : 'password'} value={token} onChange={e => setToken(e.target.value)}
                      placeholder="zZhWCuWz..."
                      className="w-full border border-gray-200 rounded-xl px-4 py-3 pr-12 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-400" />
                    <button onClick={() => setShowToken(!showToken)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Tenant ID</label>
                  <input type="text" value={tenantId} onChange={e => setTenantId(e.target.value)}
                    placeholder="3da412b7-5c9e-..."
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-400" />
                </div>
              </div>
              <div className="flex gap-3 mt-4">
                <button onClick={saveToken} disabled={!token.trim() || !tenantId.trim()}
                  className="flex-1 bg-gray-900 text-white text-sm font-medium py-2.5 rounded-xl hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  Enregistrer les clés
                </button>
                {tokenSaved && (
                  <button onClick={clearToken} className="text-sm text-red-500 hover:text-red-700 px-4 transition-colors">Supprimer</button>
                )}
              </div>
            </div>

            {/* Sync */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Package size={18} className="text-gray-500" />
                <h2 className="font-semibold text-gray-900">Synchronisation</h2>
              </div>
              <p className="text-sm text-gray-500 mb-4">
                Importe toutes vos commandes ZREXpress. Les statuts sont mis à jour et les messages WhatsApp envoyés automatiquement à chaque changement.
              </p>
              <button onClick={runSync} disabled={loading || !token.trim() || !tenantId.trim()}
                className="w-full flex items-center justify-center gap-3 bg-green-500 hover:bg-green-600 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold py-4 rounded-xl transition-colors text-base disabled:cursor-not-allowed">
                <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
                {loading ? 'Synchronisation en cours...' : 'Synchroniser maintenant'}
              </button>
              {result && (
                <div className={`mt-4 rounded-xl p-4 flex items-start gap-3 ${result.error ? 'bg-red-50 border border-red-100' : 'bg-green-50 border border-green-100'}`}>
                  {result.error ? <XCircle size={20} className="text-red-500 flex-shrink-0 mt-0.5" /> : <CheckCircle2 size={20} className="text-green-500 flex-shrink-0 mt-0.5" />}
                  <div>
                    {result.error ? (
                      <><p className="font-medium text-red-700 text-sm">Erreur de synchronisation</p><p className="text-red-600 text-sm mt-0.5">{result.error}</p></>
                    ) : (
                      <>
                        <p className="font-medium text-green-700 text-sm">Synchronisation réussie !</p>
                        <p className="text-green-600 text-sm mt-0.5">
                          {result.synced} commandes importées sur {result.total}
                          {result.whatsapp_sent ? ` · ${result.whatsapp_sent} WhatsApp envoyés` : ''}
                        </p>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Templates WhatsApp */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center gap-2 mb-1">
                <MessageSquare size={18} className="text-green-500" />
                <h2 className="font-semibold text-gray-900">Templates WhatsApp</h2>
                <span className="ml-auto text-xs text-gray-400">Envoyés automatiquement à chaque changement de statut</span>
              </div>
              <p className="text-xs text-gray-400 mb-4">
                Variables disponibles : <code className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">{'{client}'}</code>{' '}
                <code className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">{'{tracking}'}</code>{' '}
                <code className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">{'{wilaya}'}</code>{' '}
                <code className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">{'{lien}'}</code>
              </p>

              {/* Onglets statuts */}
              <div className="flex gap-2 flex-wrap mb-4">
                {Object.entries(STATUS_META).map(([key, meta]) => (
                  <button key={key} onClick={() => setActiveTemplate(key)}
                    className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-all ${
                      activeTemplate === key
                        ? `${meta.bg} ${meta.color} ${meta.border}`
                        : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
                    }`}>
                    {meta.label}
                  </button>
                ))}
              </div>

              {/* Éditeur */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">✏️ Modifier le message</label>
                  <textarea
                    value={templates[activeTemplate] || ''}
                    onChange={e => setTemplates(prev => ({ ...prev, [activeTemplate]: e.target.value }))}
                    rows={8}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-400 resize-none leading-relaxed"
                    placeholder="Entrez votre message..."
                  />
                  <button onClick={() => resetTemplate(activeTemplate)}
                    className="mt-2 flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors">
                    <RotateCcw size={11} />
                    Réinitialiser par défaut
                  </button>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">👁 Aperçu (données test)</label>
                  <div className="border border-gray-200 rounded-xl px-4 py-3 text-sm bg-gray-50 whitespace-pre-wrap leading-relaxed min-h-[180px] text-gray-700 font-sans">
                    {previewTemplate(templates[activeTemplate] || '')}
                  </div>
                </div>
              </div>

              <div className="flex justify-end mt-4">
                <button onClick={saveTemplates}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                    templatesSaved
                      ? 'bg-green-100 text-green-700 border border-green-200'
                      : 'bg-green-500 text-white hover:bg-green-600'
                  }`}>
                  <Save size={14} />
                  {templatesSaved ? '✓ Sauvegardé !' : 'Sauvegarder les templates'}
                </button>
              </div>
            </div>

          </div>

          {/* Colonne droite */}
          <div className="space-y-4">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <h2 className="font-semibold text-gray-900 mb-4">Comment ça marche</h2>
              <div className="space-y-3">
                {[
                  { step: '1', text: 'Entrez votre secretKey et tenantId' },
                  { step: '2', text: 'Personnalisez vos templates WhatsApp' },
                  { step: '3', text: 'Lancez une sync — les commandes s\'importent' },
                  { step: '4', text: 'À chaque changement de statut, le client reçoit un WhatsApp automatique' },
                ].map(s => (
                  <div key={s.step} className="flex items-start gap-3">
                    <span className="w-6 h-6 rounded-full bg-green-100 text-green-700 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{s.step}</span>
                    <span className="text-sm text-gray-600">{s.text}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Clock size={16} className="text-gray-400" />
                <h2 className="font-semibold text-gray-900">Historique</h2>
              </div>
              {history.length === 0 ? (
                <div className="text-center py-6">
                  <Clock size={28} className="mx-auto mb-2 text-gray-200" />
                  <p className="text-sm text-gray-400">Aucune sync effectuée</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {history.map((h, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs py-2 border-b border-gray-50 last:border-0">
                      {h.status === 'success'
                        ? <CheckCircle2 size={14} className="text-green-500 flex-shrink-0 mt-0.5" />
                        : <AlertTriangle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-gray-700 font-medium truncate">
                          {h.status === 'success' ? `${h.synced} commandes` : 'Erreur'}
                        </p>
                        <p className="text-gray-400">{formatDate(h.date)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
