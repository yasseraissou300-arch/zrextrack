'use client';

// Page de gestion de la clé API Gemini (BYOK).
// Chaque utilisateur configure sa propre clé Gemini pour que son chatbot
// WhatsApp réponde sans consommer le quota de la plateforme. Gemini est le
// seul modèle IA. Evolution (connexion WhatsApp) est géré par la plateforme.

import React, { useState, useEffect, useCallback } from 'react';
import AppLayout from '@/components/ui/AppLayout';
import { Key, Loader2, CheckCircle2, XCircle, Eye, EyeOff, Save, Trash2, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

type Service = 'gemini';

interface CredentialStatus {
  service: string;
  configured: boolean;
  api_key_masked: string;
  api_url: string | null;
  is_active: boolean;
  updated_at?: string;
}

interface ServiceConfig {
  id: Service;
  name: string;
  description: string;
  needsUrl: boolean;
  getKeyUrl: string;
  placeholder: string;
  urlPlaceholder?: string;
}

const SERVICES: ServiceConfig[] = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    description: 'IA qui génère les réponses du chatbot WhatsApp. Meilleur modèle pour la darija algérienne. Obligatoire pour que le bot réponde. Clé gratuite sur Google AI Studio.',
    needsUrl: false,
    getKeyUrl: 'https://aistudio.google.com/app/apikey',
    placeholder: 'AIzaSy...',
  },
];

function ServiceCard({
  cfg, status, onSave, onDelete,
}: {
  cfg: ServiceConfig;
  status?: CredentialStatus;
  onSave: (service: Service, apiKey: string, apiUrl?: string) => Promise<void>;
  onDelete: (service: Service) => Promise<void>;
}) {
  const [apiKey, setApiKey] = useState('');
  const [apiUrl, setApiUrl] = useState(status?.api_url ?? '');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Synchroniser apiUrl quand le status arrive après chargement initial
  useEffect(() => {
    setApiUrl(status?.api_url ?? '');
  }, [status?.api_url]);

  const configured = !!status?.configured;

  const handleSave = async () => {
    if (!apiKey.trim()) {
      toast.error('Entrez votre clé API');
      return;
    }
    if (cfg.needsUrl && !apiUrl.trim()) {
      toast.error('Entrez l\'URL du serveur Evolution');
      return;
    }
    setSaving(true);
    try {
      await onSave(cfg.id, apiKey.trim(), apiUrl.trim() || undefined);
      setApiKey('');
      toast.success(`${cfg.name} enregistré`);
    } catch (e: any) {
      toast.error(e?.message || 'Erreur enregistrement');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Supprimer la clé ${cfg.name} ?`)) return;
    setDeleting(true);
    try {
      await onDelete(cfg.id);
      setApiKey('');
      setApiUrl('');
      toast.success(`${cfg.name} supprimé`);
    } catch (e: any) {
      toast.error(e?.message || 'Erreur suppression');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 shadow-sm p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Key size={16} className="text-violet-600 shrink-0" />
            <h3 className="font-semibold text-stone-900 dark:text-stone-100">{cfg.name}</h3>
            {configured ? (
              <span className="inline-flex items-center gap-1 text-xs bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-full">
                <CheckCircle2 size={12} /> Configuré
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 px-2 py-0.5 rounded-full">
                <XCircle size={12} /> Non configuré
              </span>
            )}
          </div>
          <p className="text-xs text-stone-500 dark:text-stone-400">{cfg.description}</p>
        </div>
        <a
          href={cfg.getKeyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-violet-600 hover:text-violet-700 dark:text-violet-400 inline-flex items-center gap-1 shrink-0"
        >
          Obtenir <ExternalLink size={12} />
        </a>
      </div>

      {configured && (
        <div className="text-xs text-stone-500 dark:text-stone-400 bg-stone-50 dark:bg-stone-800/50 px-3 py-2 rounded-lg font-mono">
          {status?.api_key_masked}
          {status?.api_url && <span className="block mt-1 text-stone-400 dark:text-stone-500">URL: {status.api_url}</span>}
        </div>
      )}

      {cfg.needsUrl && (
        <div className="space-y-1">
          <label className="text-xs font-medium text-stone-700 dark:text-stone-300">URL du serveur</label>
          <input
            type="url"
            value={apiUrl}
            onChange={e => setApiUrl(e.target.value)}
            placeholder={cfg.urlPlaceholder}
            className="w-full px-3 py-2 text-sm bg-white dark:bg-stone-950 border border-stone-200 dark:border-stone-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
        </div>
      )}

      <div className="space-y-1">
        <label className="text-xs font-medium text-stone-700 dark:text-stone-300">
          {configured ? 'Remplacer la clé' : 'Clé API'}
        </label>
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder={cfg.placeholder}
            className="w-full px-3 py-2 pr-10 text-sm bg-white dark:bg-stone-950 border border-stone-200 dark:border-stone-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 font-mono"
          />
          <button
            type="button"
            onClick={() => setShowKey(s => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
            aria-label={showKey ? 'Masquer' : 'Afficher'}
          >
            {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={saving || !apiKey.trim()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-violet-600 hover:bg-violet-700 disabled:bg-stone-300 dark:disabled:bg-stone-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Enregistrer
        </button>
        {configured && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300 rounded-lg transition-colors disabled:opacity-50"
          >
            {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            Supprimer
          </button>
        )}
      </div>
    </div>
  );
}

export default function ApiKeysPage() {
  const [statuses, setStatuses] = useState<Record<string, CredentialStatus>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/user-credentials', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Erreur');
      const map: Record<string, CredentialStatus> = {};
      for (const s of json.services || []) map[s.service] = s;
      setStatuses(map);
    } catch (e: any) {
      toast.error(e?.message || 'Erreur chargement');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onSave = async (service: Service, apiKey: string, apiUrl?: string) => {
    const res = await fetch('/api/user-credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service, api_key: apiKey, api_url: apiUrl }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Erreur enregistrement');
    await load();
  };

  const onDelete = async (service: Service) => {
    const res = await fetch(`/api/user-credentials?service=${service}`, { method: 'DELETE' });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Erreur suppression');
    await load();
  };

  return (
    <AppLayout>
      <div className="min-h-screen bg-stone-50 dark:bg-stone-950">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-100">Clé API Gemini</h1>
            <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">
              Le chatbot WhatsApp utilise votre propre clé Gemini pour répondre à vos
              clients. Sans clé configurée, le bot ne peut pas répondre automatiquement.
              La connexion du numéro WhatsApp, elle, est gérée par la plateforme — rien
              à configurer de ce côté.
            </p>
          </div>

          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-xl p-4 text-sm text-amber-800 dark:text-amber-300">
            <strong>Important :</strong> Vos clés sont stockées en clair dans la base
            de données, isolées par RLS Supabase. Elles ne quittent jamais votre
            compte et ne sont jamais renvoyées en clair au navigateur après enregistrement.
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-stone-400">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : (
            <div className="space-y-4">
              {SERVICES.map(cfg => (
                <ServiceCard
                  key={cfg.id}
                  cfg={cfg}
                  status={statuses[cfg.id]}
                  onSave={onSave}
                  onDelete={onDelete}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
