'use client';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import AppLayout from '@/components/ui/AppLayout';
import {
  Megaphone, Plus, Send, Trash2, Loader2, CheckCircle, XCircle,
  Clock, Users, ChevronRight, X, AlertCircle, RefreshCw, ImageIcon,
  Phone, MapPin, ShoppingBag, TrendingUp, Search, Target, ChevronDown, Check,
} from 'lucide-react';
import { toast } from 'sonner';
import { loadSyncSettings } from '@/lib/sync-settings-client';

interface Campaign {
  id: string;
  name: string;
  message_template: string;
  audience_status: string;
  status: 'brouillon' | 'en_cours' | 'termine' | 'annule';
  total_count: number;
  sent_count: number;
  failed_count: number;
  created_at: string;
}

const STATUS_OPTIONS = [
  { value: '', label: 'Tous les clients (avec téléphone)' },
  { value: 'en_preparation', label: 'En préparation' },
  { value: 'en_transit', label: 'En transit' },
  { value: 'en_livraison', label: 'En livraison' },
  { value: 'livre', label: 'Livré' },
  { value: 'echec', label: 'Échec' },
  { value: 'retourne', label: 'Retourné' },
];

const VARIABLE_HINTS = ['{{client}}', '{{tracking}}', '{{wilaya}}', '{{cod}}'];

const CAMPAIGN_STATUS_CONFIG = {
  brouillon: { label: 'Brouillon', bg: 'bg-gray-100 text-gray-600 dark:text-stone-300', icon: Clock },
  en_cours: { label: 'En cours', bg: 'bg-blue-100 text-blue-700', icon: Loader2 },
  termine: { label: 'Terminé', bg: 'bg-green-100 text-green-700', icon: CheckCircle },
  annule: { label: 'Annulé', bg: 'bg-red-100 text-red-600', icon: XCircle },
};

function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-stone-900 rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {children}
      </div>
    </div>
  );
}

function CreateModal({ open, onClose, onCreate, preselectedPhones }: {
  open: boolean;
  onClose: () => void;
  onCreate: (c: Campaign) => void;
  preselectedPhones?: string[] | null;
}) {
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('');
  const [audienceStatus, setAudienceStatus] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  // Métadonnées du media uploadé — sert à l'affichage (taille, type) et au
  // delete si l'utilisateur change d'avis avant de créer la campagne.
  const [mediaType, setMediaType] = useState('');
  const [mediaName, setMediaName] = useState('');
  const [mediaPath, setMediaPath] = useState('');  // path dans le bucket pour le delete
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setName(''); setTemplate(''); setAudienceStatus('');
    setMediaUrl(''); setMediaType(''); setMediaName(''); setMediaPath('');
  };

  const handleClose = () => { reset(); onClose(); };

  // Suppression d'un fichier uploadé (best-effort — on tolère les échecs)
  const removeMedia = async () => {
    if (mediaPath) {
      await fetch(`/api/campaigns/media/upload?path=${encodeURIComponent(mediaPath)}`, { method: 'DELETE' }).catch(() => {});
    }
    setMediaUrl(''); setMediaType(''); setMediaName(''); setMediaPath('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Si un upload précédent existe, on le supprime pour ne pas accumuler
    if (mediaPath) {
      await fetch(`/api/campaigns/media/upload?path=${encodeURIComponent(mediaPath)}`, { method: 'DELETE' }).catch(() => {});
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/campaigns/media/upload', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) {
        toast.error(`${json.error}${json.hint ? ' — ' + json.hint : ''}`);
        if (fileInputRef.current) fileInputRef.current.value = '';
      } else {
        setMediaUrl(json.url);
        setMediaType(json.type);
        setMediaName(json.name);
        setMediaPath(json.path);
        toast.success(`Fichier uploadé : ${(json.size / 1024).toFixed(0)} KB`);
      }
    } catch (err: any) {
      toast.error(err?.message || 'Upload échoué');
    } finally {
      setUploading(false);
    }
  };

  const handleCreate = async () => {
    if (!name.trim()) { toast.error('Donne un nom à la campagne'); return; }
    if (!template.trim()) { toast.error('Le message est requis'); return; }
    setSaving(true);
    const res = await fetch('/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        message_template: template,
        // Si on a une liste pré-sélectionnée (depuis « Clients livrés »), on
        // l'envoie comme audience custom — ignore audience_status.
        audience_status: preselectedPhones?.length ? '' : audienceStatus,
        audience_phones: preselectedPhones?.length ? preselectedPhones : undefined,
        media_url: mediaUrl,
      }),
    });
    const json = await res.json();
    if (json.error) { toast.error(json.error); }
    else { toast.success('Campagne créée !'); onCreate(json.data); handleClose(); }
    setSaving(false);
  };

  const insertVar = (v: string) => setTemplate(t => t + v);

  const previewText = template
    .replace(/\{\{client\}\}/g, 'محمد')
    .replace(/\{\{tracking\}\}/g, 'ZR-123456')
    .replace(/\{\{wilaya\}\}/g, 'الجزائر')
    .replace(/\{\{cod\}\}/g, '2500');

  return (
    <Modal open={open} onClose={handleClose}>
      <div className="p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
              <Megaphone size={16} className="text-green-600" />
            </div>
            <h2 className="font-bold text-gray-900 dark:text-stone-100">Nouvelle campagne</h2>
          </div>
          <button onClick={handleClose} className="p-1.5 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-lg">
            <X size={16} className="text-gray-500 dark:text-stone-400" />
          </button>
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-600 dark:text-stone-300">Nom de la campagne</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="ex: Promo Ramadan, Relance échecs..."
            className="w-full border border-stone-200 dark:border-stone-700 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
        </div>

        {preselectedPhones && preselectedPhones.length > 0 ? (
          <div className="bg-violet-50 dark:bg-violet-500/10 border border-violet-200 dark:border-violet-500/30 rounded-xl p-3 flex items-start gap-2.5">
            <Target size={14} className="text-violet-600 dark:text-violet-300 shrink-0 mt-0.5" />
            <div className="text-xs text-violet-900 dark:text-violet-200">
              <p className="font-semibold">Audience pré-sélectionnée : {preselectedPhones.length} client{preselectedPhones.length > 1 ? 's' : ''} livré{preselectedPhones.length > 1 ? 's' : ''}</p>
              <p className="text-violet-700 dark:text-violet-300 mt-0.5">Ces numéros viennent de l'explorateur ZRExpress. Le filtre par statut est ignoré.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-600 dark:text-stone-300">Audience (statut des commandes)</label>
            <select
              value={audienceStatus}
              onChange={e => setAudienceStatus(e.target.value)}
              className="w-full border border-stone-200 dark:border-stone-700 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white dark:bg-stone-900"
            >
              {STATUS_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        )}

        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-gray-600 dark:text-stone-300">
            <span className="flex items-center gap-1.5"><ImageIcon size={12} /> Media (optionnel — photo, vidéo, audio, PDF — max 16 MB)</span>
          </label>

          {/* Input file caché — déclenché par le bouton ou la drop zone */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,audio/mpeg,audio/ogg,application/pdf"
            onChange={handleFileSelect}
            className="hidden"
          />

          {!mediaUrl ? (
            // État vide : drop zone cliquable
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full border-2 border-dashed border-stone-200 dark:border-stone-700 rounded-xl px-3 py-5 text-center hover:border-violet-400 hover:bg-violet-50/30 dark:hover:bg-violet-500/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading ? (
                <div className="flex items-center justify-center gap-2 text-sm text-stone-500">
                  <Loader2 size={14} className="animate-spin" />
                  Upload en cours…
                </div>
              ) : (
                <div className="text-sm text-stone-500 dark:text-stone-400">
                  <ImageIcon size={20} className="mx-auto mb-1 text-stone-400" />
                  <span className="font-medium text-violet-600">Cliquer pour choisir un fichier</span>
                  <p className="text-[10px] text-stone-400 mt-0.5">JPG · PNG · GIF · MP4 · MOV · MP3 · PDF</p>
                </div>
              )}
            </button>
          ) : (
            // Aperçu du fichier uploadé
            <div className="border border-stone-200 dark:border-stone-700 rounded-xl overflow-hidden bg-stone-50 dark:bg-stone-800">
              {mediaType.startsWith('image/') && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={mediaUrl} alt="aperçu" className="w-full max-h-48 object-contain bg-black/5" />
              )}
              {mediaType.startsWith('video/') && (
                <video src={mediaUrl} controls className="w-full max-h-48 bg-black" />
              )}
              {mediaType.startsWith('audio/') && (
                <audio src={mediaUrl} controls className="w-full" />
              )}
              {mediaType === 'application/pdf' && (
                <div className="py-4 text-center text-sm text-stone-600 dark:text-stone-300">
                  📄 PDF prêt à envoyer
                </div>
              )}
              <div className="px-3 py-2 flex items-center gap-2 text-xs border-t border-stone-200 dark:border-stone-700">
                <span className="text-stone-600 dark:text-stone-300 truncate flex-1" title={mediaName}>{mediaName}</span>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-violet-600 hover:text-violet-700 font-medium"
                  disabled={uploading}
                >
                  Changer
                </button>
                <button
                  type="button"
                  onClick={removeMedia}
                  className="text-red-500 hover:text-red-700"
                  title="Retirer le média"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-medium text-gray-600 dark:text-stone-300">Message</label>
            <div className="flex gap-1.5">
              {VARIABLE_HINTS.map(v => (
                <button
                  key={v}
                  onClick={() => insertVar(v)}
                  className="text-[10px] font-mono bg-green-50 text-green-700 px-1.5 py-0.5 rounded border border-green-200 hover:bg-green-100"
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          <textarea
            value={template}
            onChange={e => setTemplate(e.target.value)}
            placeholder="السلام عليكم {{client}} 👋&#10;طردك رقم {{tracking}} وصل!&#10;شكرا على ثقتك 🙏"
            rows={5}
            dir="rtl"
            className="w-full border border-stone-200 dark:border-stone-700 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
          />
        </div>

        {template && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-gray-600 dark:text-stone-300 flex items-center gap-1.5">
                <Phone size={11} />
                Aperçu — comment ton client va le recevoir sur WhatsApp
              </p>
              {preselectedPhones && preselectedPhones.length > 0 && (
                <span className="text-[10px] text-violet-600 font-semibold">
                  → {preselectedPhones.length} destinataire{preselectedPhones.length > 1 ? 's' : ''}
                </span>
              )}
            </div>

            {/* Mockup style discussion WhatsApp */}
            <div className="rounded-2xl overflow-hidden border border-stone-200 dark:border-stone-700 shadow-inner">
              {/* En-tête WhatsApp */}
              <div className="bg-[#075E54] text-white px-3 py-2 flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">
                  {(name || 'B')[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate">{name || 'Ma boutique'}</p>
                  <p className="text-[9px] text-white/70">en ligne</p>
                </div>
              </div>

              {/* Fond conversation */}
              <div
                className="px-3 py-4 min-h-[140px]"
                style={{
                  backgroundColor: '#ECE5DD',
                  backgroundImage:
                    'radial-gradient(rgba(0,0,0,0.04) 1px, transparent 1px)',
                  backgroundSize: '12px 12px',
                }}
              >
                {/* Bulle reçue (vert WhatsApp clair, côté gauche = comme reçue) */}
                <div className="flex justify-end">
                  <div className="bg-[#DCF8C6] rounded-xl rounded-tr-sm shadow-sm px-2.5 py-1.5 max-w-[85%] relative">
                    {/* Media en haut de la bulle si fourni */}
                    {mediaUrl && (
                      <div className="mb-1.5 rounded-lg overflow-hidden bg-white/40 border border-black/5">
                        {/\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(mediaUrl) ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={mediaUrl} alt="media" className="w-full max-h-40 object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                        ) : (
                          <div className="px-3 py-4 text-center text-[10px] text-gray-600">
                            <ImageIcon size={20} className="mx-auto mb-1 text-gray-400" />
                            Pièce jointe : {mediaUrl.slice(0, 40)}{mediaUrl.length > 40 ? '…' : ''}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Texte du message */}
                    <p className="text-sm text-[#111] whitespace-pre-line leading-relaxed text-right" dir="rtl">
                      {previewText}
                    </p>

                    {/* Heure + double check WhatsApp */}
                    <div className="flex items-center justify-end gap-1 mt-1 -mb-0.5">
                      <span className="text-[10px] text-gray-500">{new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                      <svg viewBox="0 0 16 11" className="w-3.5 h-3 text-[#4FC3F7]" fill="currentColor">
                        <path d="M11.071.653a.457.457 0 00-.304-.13c-.146 0-.286.063-.379.18l-5.846 7.43-2.405-2.516a.456.456 0 00-.66.005l-.61.625a.5.5 0 00-.005.692l3.354 3.504c.1.105.243.166.387.166.142 0 .284-.061.385-.166L12.166 1.94a.5.5 0 00.014-.692l-.61-.612a.518.518 0 00-.5-.04zM7.385 9.32l-.61-.611a.5.5 0 00-.014.692l3.354 3.504c.1.105.243.166.387.166.142 0 .284-.061.385-.166L16.166 5.94a.5.5 0 00.014-.692l-.61-.612a.518.518 0 00-.5-.04.457.457 0 00-.304-.13c-.146 0-.286.063-.379.18l-5.846 7.43-1.156-1.21z" />
                      </svg>
                    </div>
                  </div>
                </div>

                {/* Note métadonnée discrète */}
                <p className="text-[9px] text-stone-500 text-center mt-3 italic">
                  Variables remplacées : <code>{`{{client}}`}</code> = « محمد » (exemple)
                </p>
              </div>
            </div>

            <p className="text-[10px] text-stone-400">
              ⚠️ Le message réel utilisera les vraies données du client (nom, tracking, wilaya, COD).
            </p>
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <button
            onClick={handleClose}
            className="flex-1 border border-stone-200 dark:border-stone-700 rounded-xl py-2.5 text-sm font-medium text-gray-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800"
          >
            Annuler
          </button>
          <button
            onClick={handleCreate}
            disabled={saving}
            className="flex-1 bg-green-600 text-white rounded-xl py-2.5 text-sm font-medium hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Créer
          </button>
        </div>
      </div>
    </Modal>
  );
}

function CampaignCard({ campaign, onDelete, onSend, onView }: {
  campaign: Campaign;
  onDelete: (id: string) => void;
  onSend: (id: string) => void;
  onView: (id: string) => void;
}) {
  const cfg = CAMPAIGN_STATUS_CONFIG[campaign.status];
  const Icon = cfg.icon;
  const audienceLabel = STATUS_OPTIONS.find(o => o.value === campaign.audience_status)?.label || 'Tous';
  const successRate = campaign.total_count > 0
    ? Math.round((campaign.sent_count / campaign.total_count) * 100)
    : null;

  return (
    <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-100 dark:border-stone-800 shadow-sm p-5 space-y-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 dark:text-stone-100 truncate">{campaign.name}</h3>
          <p className="text-xs text-gray-400 dark:text-stone-500 mt-0.5">
            {new Date(campaign.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
          </p>
        </div>
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ${cfg.bg}`}>
          <Icon size={11} className={campaign.status === 'en_cours' ? 'animate-spin' : ''} />
          {cfg.label}
        </span>
      </div>

      <div className="bg-gray-50 rounded-xl p-3">
        <p className="text-xs text-gray-500 dark:text-stone-400 line-clamp-2 text-right leading-relaxed" dir="rtl">
          {campaign.message_template}
        </p>
      </div>

      <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-stone-400">
        <span className="flex items-center gap-1">
          <Users size={12} />
          {audienceLabel}
        </span>
        {campaign.status === 'termine' && (
          <>
            <span className="text-gray-200">|</span>
            <span className="flex items-center gap-1 text-green-600 font-medium">
              <CheckCircle size={11} /> {campaign.sent_count} envoyés
            </span>
            {campaign.failed_count > 0 && (
              <span className="flex items-center gap-1 text-red-500 font-medium">
                <XCircle size={11} /> {campaign.failed_count} échecs
              </span>
            )}
            {successRate !== null && (
              <span className="ml-auto text-gray-400 dark:text-stone-500">{successRate}%</span>
            )}
          </>
        )}
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={() => onView(campaign.id)}
          className="flex items-center gap-1.5 text-xs px-3 py-2 border border-stone-200 dark:border-stone-700 rounded-lg hover:bg-stone-50 dark:hover:bg-stone-800 text-gray-600 dark:text-stone-300"
        >
          Détails <ChevronRight size={12} />
        </button>
        {campaign.status === 'brouillon' && (
          <button
            onClick={() => onSend(campaign.id)}
            className="flex items-center gap-1.5 text-xs px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium"
          >
            <Send size={12} /> Envoyer maintenant
          </button>
        )}
        {campaign.status === 'termine' && (
          <button
            onClick={() => onSend(campaign.id)}
            className="flex items-center gap-1.5 text-xs px-4 py-2 border border-green-200 text-green-700 bg-green-50 rounded-lg hover:bg-green-100 font-medium"
          >
            <RefreshCw size={12} /> Renvoyer
          </button>
        )}
        <button
          onClick={() => onDelete(campaign.id)}
          className="ml-auto flex items-center gap-1.5 text-xs px-3 py-2 text-red-500 border border-red-100 rounded-lg hover:bg-red-50"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

function DetailModal({ campaignId, open, onClose }: { campaignId: string | null; open: boolean; onClose: () => void }) {
  const [data, setData] = useState<{ campaign: Campaign; recipients: any[] } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!campaignId || !open) { setData(null); return; }
    setLoading(true);
    fetch(`/api/campaigns/${campaignId}`)
      .then(r => r.json())
      .then(j => setData(j))
      .finally(() => setLoading(false));
  }, [campaignId, open]);

  const statusCfg: Record<string, string> = {
    envoye: 'bg-green-100 text-green-700',
    echec: 'bg-red-100 text-red-600',
    en_attente: 'bg-amber-100 text-amber-700',
  };

  return (
    <Modal open={open} onClose={onClose}>
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-gray-900 dark:text-stone-100">Détails de la campagne</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-lg">
            <X size={16} className="text-gray-500 dark:text-stone-400" />
          </button>
        </div>
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-gray-400 dark:text-stone-500" /></div>
        ) : !data ? (
          <p className="text-center text-gray-400 dark:text-stone-500 py-8">Aucune donnée</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-gray-900 dark:text-stone-100">{data.campaign.total_count}</p>
                <p className="text-xs text-gray-500 dark:text-stone-400 mt-0.5">Total</p>
              </div>
              <div className="bg-green-50 rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-green-700">{data.campaign.sent_count}</p>
                <p className="text-xs text-gray-500 dark:text-stone-400 mt-0.5">Envoyés</p>
              </div>
              <div className="bg-red-50 rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-red-600">{data.campaign.failed_count}</p>
                <p className="text-xs text-gray-500 dark:text-stone-400 mt-0.5">Échecs</p>
              </div>
            </div>
            <div className="max-h-80 overflow-y-auto divide-y divide-stone-50 dark:divide-stone-800 rounded-xl border border-stone-100 dark:border-stone-800">
              {data.recipients.length === 0 ? (
                <p className="text-center text-gray-400 dark:text-stone-500 py-8 text-sm">Aucun destinataire</p>
              ) : data.recipients.map((r: any) => (
                <div key={r.id} className="p-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-stone-100 truncate">{r.client}</p>
                    <p className="text-xs text-gray-400 dark:text-stone-500">{r.phone} {r.tracking && `· ${r.tracking}`}</p>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${statusCfg[r.status] || statusCfg.en_attente}`}>
                    {r.status === 'envoye' ? 'Envoyé' : r.status === 'echec' ? 'Échec' : 'Attente'}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

export default function CampagnesPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  // Onglet actif : campagnes existantes ou explorateur de clients livrés
  const [tab, setTab] = useState<'campaigns' | 'delivered'>('campaigns');
  // Liste pré-remplie de téléphones quand on crée une campagne depuis « Clients livrés »
  const [preselectedPhones, setPreselectedPhones] = useState<string[] | null>(null);

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/campaigns');
    const json = await res.json();
    setCampaigns(json.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchCampaigns(); }, [fetchCampaigns]);

  const handleCreate = (c: Campaign) => setCampaigns(prev => [c, ...prev]);

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer cette campagne ?')) return;
    const res = await fetch(`/api/campaigns/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setCampaigns(prev => prev.filter(c => c.id !== id));
      toast.success('Campagne supprimée');
    } else {
      toast.error('Erreur lors de la suppression');
    }
  };

  const handleSend = async (id: string) => {
    setSendingId(id);
    setCampaigns(prev => prev.map(c => c.id === id ? { ...c, status: 'en_cours' } : c));
    const res = await fetch(`/api/campaigns/${id}/send`, { method: 'POST' });
    const json = await res.json();
    if (json.error) {
      toast.error(json.error);
      setCampaigns(prev => prev.map(c => c.id === id ? { ...c, status: 'brouillon' } : c));
    } else {
      toast.success(`${json.sent} messages envoyés sur ${json.total}`);
      await fetchCampaigns();
    }
    setSendingId(null);
  };

  const brouillons = campaigns.filter(c => c.status === 'brouillon');
  const terminees = campaigns.filter(c => c.status !== 'brouillon');

  const onLaunchCampaignFromList = (phones: string[]) => {
    setPreselectedPhones(phones);
    setCreateOpen(true);
  };

  return (
    <AppLayout>
      <div className="max-w-screen-xl mx-auto px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
              <Megaphone size={20} className="text-green-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-stone-100">Campagnes</h1>
              <p className="text-sm text-gray-500 dark:text-stone-400">Envois groupés WhatsApp ciblés</p>
            </div>
          </div>
          <button
            onClick={() => { setPreselectedPhones(null); setCreateOpen(true); }}
            className="flex items-center gap-2 bg-green-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-green-700 transition-colors"
          >
            <Plus size={16} />
            Nouvelle campagne
          </button>
        </div>

        {/* Onglets */}
        <div className="flex gap-1 bg-stone-100 dark:bg-stone-800 p-1 rounded-xl w-fit">
          <button
            onClick={() => setTab('campaigns')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === 'campaigns'
                ? 'bg-white dark:bg-stone-900 text-gray-900 dark:text-stone-100 shadow-sm'
                : 'text-gray-500 dark:text-stone-400 hover:text-gray-700'
            }`}
          >
            <Megaphone size={14} />
            Mes campagnes
          </button>
          <button
            onClick={() => setTab('delivered')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === 'delivered'
                ? 'bg-white dark:bg-stone-900 text-gray-900 dark:text-stone-100 shadow-sm'
                : 'text-gray-500 dark:text-stone-400 hover:text-gray-700'
            }`}
          >
            <Target size={14} />
            Clients livrés (ZRExpress)
          </button>
        </div>

        {tab === 'delivered' ? (
          <DeliveredCustomersTab onCreateCampaign={onLaunchCampaignFromList} />
        ) : (
          <>
        {/* Info variables */}
        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 flex items-start gap-3">
          <AlertCircle size={16} className="text-blue-500 shrink-0 mt-0.5" />
          <div className="text-sm text-blue-700">
            <span className="font-medium">Variables disponibles dans les messages :</span>
            <span className="ml-2">
              {VARIABLE_HINTS.map(v => (
                <code key={v} className="mx-1 bg-blue-100 px-1.5 py-0.5 rounded text-blue-800 text-xs font-mono">{v}</code>
              ))}
            </span>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={24} className="animate-spin text-gray-400 dark:text-stone-500" />
          </div>
        ) : campaigns.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400 dark:text-stone-500">
            <Megaphone size={40} className="mb-3 opacity-20" />
            <p className="text-base font-medium text-gray-500 dark:text-stone-400">Aucune campagne</p>
            <p className="text-sm mt-1">Crée ta première campagne WhatsApp</p>
            <button
              onClick={() => setCreateOpen(true)}
              className="mt-4 flex items-center gap-2 bg-green-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-green-700"
            >
              <Plus size={15} /> Créer une campagne
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {brouillons.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-gray-500 dark:text-stone-400 uppercase tracking-wide">Prêtes à envoyer ({brouillons.length})</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {brouillons.map(c => (
                    <CampaignCard
                      key={c.id}
                      campaign={sendingId === c.id ? { ...c, status: 'en_cours' } : c}
                      onDelete={handleDelete}
                      onSend={handleSend}
                      onView={id => setDetailId(id)}
                    />
                  ))}
                </div>
              </div>
            )}
            {terminees.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-gray-500 dark:text-stone-400 uppercase tracking-wide">Historique ({terminees.length})</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {terminees.map(c => (
                    <CampaignCard
                      key={c.id}
                      campaign={c}
                      onDelete={handleDelete}
                      onSend={handleSend}
                      onView={id => setDetailId(id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
          </>
        )}
      </div>

      <CreateModal
        open={createOpen}
        onClose={() => { setCreateOpen(false); setPreselectedPhones(null); }}
        onCreate={handleCreate}
        preselectedPhones={preselectedPhones}
      />
      <DetailModal campaignId={detailId} open={!!detailId} onClose={() => setDetailId(null)} />
    </AppLayout>
  );
}

// ─── Explorateur de clients livrés depuis ZRExpress ─────────────────────────
// Fetch on-demand de /api/campaigns/delivered-customers — agrège les colis
// livrés par téléphone client. Permet sélection multi puis « Créer campagne ».

interface DeliveredCustomer {
  phone: string;
  name: string;
  wilaya: string;
  wilaya_code: number;
  order_count: number;
  total_spent: number;
  last_delivery: string;
  trackings: string[];
  products: string[];
  gender: 'F' | 'M' | 'unknown';
}

interface DeliveredStats {
  total_customers: number;
  total_orders: number;
  total_revenue: number;
  repeat_customers: number;
  by_gender: { female: number; male: number; unknown: number };
}

function DeliveredCustomersTab({ onCreateCampaign }: { onCreateCampaign: (phones: string[]) => void }) {
  const [customers, setCustomers] = useState<DeliveredCustomer[]>([]);
  const [stats, setStats] = useState<DeliveredStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [onlyRepeat, setOnlyRepeat] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [credentialsReady, setCredentialsReady] = useState(false);
  // Diagnostic : breakdown des états ZRExpress et liste des états reconnus
  // comme « livré ». Permet d'identifier rapidement un état manquant.
  const [stateBreakdown, setStateBreakdown] = useState<Record<string, number> | null>(null);
  const [countedAsDelivered, setCountedAsDelivered] = useState<string[]>([]);
  const [showBreakdown, setShowBreakdown] = useState(false);
  // Filtres avancés
  const [wilayas, setWilayas] = useState<string[]>([]);
  const [products, setProducts] = useState<string[]>([]);
  const [filterWilaya, setFilterWilaya] = useState('');
  // Multi-sélection produits (Set vide = aucun filtre, tous les produits passent)
  const [filterProducts, setFilterProducts] = useState<Set<string>>(new Set());
  const [filterGender, setFilterGender] = useState<'all' | 'F' | 'M' | 'unknown'>('all');

  useEffect(() => {
    loadSyncSettings().then(s => {
      setCredentialsReady(!!s.zrexpress_token && !!s.zrexpress_tenant_id);
    });
  }, []);

  const fetchData = useCallback(async () => {
    const s = await loadSyncSettings();
    const token = s.zrexpress_token;
    const tenantId = s.zrexpress_tenant_id;
    if (!token || !tenantId) {
      setError('Clé API ZRExpress non configurée. Va sur /sync pour la saisir.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/campaigns/delivered-customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, tenantId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setCustomers(json.customers ?? []);
      setStats(json.stats ?? null);
      setStateBreakdown(json.state_breakdown ?? null);
      setCountedAsDelivered(json.counted_as_delivered ?? []);
      setWilayas(json.wilayas ?? []);
      setProducts(json.products ?? []);
    } catch (e: any) {
      setError(e?.message || 'Erreur ZRExpress');
    } finally {
      setLoading(false);
    }
  }, []);

  const filtered = useMemo(() => {
    let list = customers;
    if (onlyRepeat) list = list.filter(c => c.order_count >= 2);
    if (filterWilaya) list = list.filter(c => c.wilaya === filterWilaya);
    // Multi-produit : OR logique — le client passe si AU MOINS un de ses
    // produits est dans la sélection. Filtre inactif quand Set vide.
    if (filterProducts.size > 0) {
      list = list.filter(c => c.products.some(p => filterProducts.has(p)));
    }
    if (filterGender !== 'all') list = list.filter(c => c.gender === filterGender);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        c.wilaya.toLowerCase().includes(q) ||
        c.products.some(p => p.toLowerCase().includes(q))
      );
    }
    return list;
  }, [customers, search, onlyRepeat, filterWilaya, filterProducts, filterGender]);

  const toggleOne = (phone: string) => {
    setSelected(s => {
      const n = new Set(s);
      if (n.has(phone)) n.delete(phone); else n.add(phone);
      return n;
    });
  };

  const toggleAllVisible = () => {
    const visiblePhones = filtered.map(c => c.phone);
    const allSelected = visiblePhones.every(p => selected.has(p));
    setSelected(s => {
      const n = new Set(s);
      if (allSelected) visiblePhones.forEach(p => n.delete(p));
      else visiblePhones.forEach(p => n.add(p));
      return n;
    });
  };

  const exportCSV = () => {
    const target = selected.size > 0 ? filtered.filter(c => selected.has(c.phone)) : filtered;
    if (target.length === 0) { toast.error('Rien à exporter'); return; }
    const header = ['Téléphone', 'Nom', 'Genre', 'Wilaya', 'Produits', 'Nb livraisons', 'Total dépensé (DA)', 'Dernière livraison'];
    const genderLabel: Record<DeliveredCustomer['gender'], string> = { F: 'Femme', M: 'Homme', unknown: '?' };
    const rows = target.map(c => [
      c.phone,
      c.name,
      genderLabel[c.gender],
      c.wilaya,
      c.products.join(' | '),
      String(c.order_count),
      String(c.total_spent),
      new Date(c.last_delivery).toLocaleString('fr-FR'),
    ]);
    const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map(r => r.map(esc).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clients-livres-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`${target.length} client${target.length > 1 ? 's' : ''} exporté${target.length > 1 ? 's' : ''}`);
  };

  const launchCampaign = () => {
    const phones = Array.from(selected);
    if (phones.length === 0) {
      toast.error('Sélectionne au moins un client');
      return;
    }
    onCreateCampaign(phones);
  };

  return (
    <div className="space-y-4">
      {/* Banner explication */}
      <div className="bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30 rounded-2xl p-4 flex items-start gap-3">
        <Target size={16} className="text-green-600 dark:text-green-300 shrink-0 mt-0.5" />
        <div className="text-sm text-green-900 dark:text-green-200">
          <p className="font-medium">Cible tes vrais clients</p>
          <p className="text-xs text-green-700 dark:text-green-300 mt-0.5">
            Cette liste vient directement de ZRExpress et ne contient que les clients ayant reçu leur livraison (status « livré »). Idéal pour les campagnes de fidélisation, lancement de nouveaux produits, ou récompense de clients fidèles.
          </p>
        </div>
      </div>

      {!credentialsReady && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          <AlertCircle className="inline-block mr-2" size={16} />
          Clé API ZRExpress manquante. Configure-la sur la page <a href="/sync" className="underline font-medium">Sync</a>.
        </div>
      )}

      {/* Bouton fetch + stats */}
      {customers.length === 0 && !loading && credentialsReady && !error && (
        <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-100 dark:border-stone-800 p-6 text-center">
          <Target size={32} className="mx-auto text-stone-300 mb-3" />
          <p className="text-sm text-gray-700 dark:text-stone-200 mb-3">Charge la liste de tes clients livrés depuis ZRExpress.</p>
          <button
            onClick={fetchData}
            disabled={loading}
            className="inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white font-medium px-4 py-2 rounded-xl disabled:opacity-50"
          >
            <RefreshCw size={14} />
            Charger les clients livrés
          </button>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
          <strong>Erreur :</strong> {error}
          <button onClick={fetchData} className="ml-3 underline">Réessayer</button>
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-12">
          <Loader2 size={24} className="animate-spin text-stone-400" />
        </div>
      )}

      {stats && customers.length > 0 && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatBox icon={<Users size={14} />} label="Clients uniques" value={stats.total_customers} color="text-green-700 bg-green-50" />
            <StatBox icon={<ShoppingBag size={14} />} label="Commandes livrées" value={stats.total_orders} color="text-blue-700 bg-blue-50" />
            <StatBox icon={<TrendingUp size={14} />} label="Total facturé" value={`${stats.total_revenue.toFixed(0)} DA`} color="text-violet-700 bg-violet-50" />
            <StatBox icon={<RefreshCw size={14} />} label="Clients fidèles (≥2)" value={stats.repeat_customers} color="text-amber-700 bg-amber-50" />
          </div>

          {/* Diagnostic : breakdown des états ZRExpress trouvés */}
          {stateBreakdown && (
            <details className="bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-700 rounded-xl text-xs" open={showBreakdown} onToggle={e => setShowBreakdown((e.target as HTMLDetailsElement).open)}>
              <summary className="cursor-pointer px-3 py-2 text-stone-600 dark:text-stone-300 flex items-center gap-2 select-none">
                <AlertCircle size={12} />
                <span>Voir les états ZRExpress comptabilisés</span>
                <span className="ml-auto text-stone-400 text-[10px]">Diagnostique</span>
              </summary>
              <div className="px-3 pb-3 pt-1 space-y-2">
                <p className="text-stone-500 dark:text-stone-400">
                  AutoTim compte comme « livré » tous les colis dont l'état ZRExpress fait partie de cette liste :
                </p>
                <div className="flex flex-wrap gap-1">
                  {countedAsDelivered.map(s => (
                    <code key={s} className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded text-[10px] font-mono">{s}</code>
                  ))}
                </div>
                <p className="text-stone-500 dark:text-stone-400 mt-2">Répartition de TOUS les états trouvés dans tes colis :</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
                  {Object.entries(stateBreakdown).map(([s, n]) => {
                    const counted = countedAsDelivered.includes(s);
                    return (
                      <div key={s} className={`flex items-center justify-between gap-2 px-2 py-1 rounded ${counted ? 'bg-green-50 border border-green-200' : 'bg-stone-100 dark:bg-stone-800 border border-stone-200 dark:border-stone-700'}`}>
                        <code className="text-[10px] font-mono text-stone-700 dark:text-stone-200 truncate">{s}</code>
                        <span className={`text-[10px] font-bold shrink-0 ${counted ? 'text-green-700' : 'text-stone-500'}`}>{n}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[10px] text-stone-400 mt-2 italic">
                  Si un état que tu considères comme « livré » est ici en gris (non comptabilisé), envoie-moi un screenshot pour qu'on l'ajoute.
                </p>
              </div>
            </details>
          )}

          {/* Toolbar */}
          <div className="bg-white dark:bg-stone-900 border border-stone-100 dark:border-stone-800 rounded-2xl p-3 space-y-2.5">
            {/* Ligne 1 : recherche + actions */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Chercher par nom, téléphone, wilaya, produit…"
                  className="w-full pl-9 pr-3 py-2 text-sm border border-stone-200 dark:border-stone-700 rounded-xl bg-white dark:bg-stone-900 focus:outline-none focus:ring-2 focus:ring-green-500/30"
                />
              </div>
              <button onClick={fetchData} className="p-2 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-lg" title="Recharger">
                <RefreshCw size={14} className="text-stone-500" />
              </button>
              <button
                onClick={exportCSV}
                className="text-xs px-3 py-2 border border-stone-200 dark:border-stone-700 rounded-xl hover:bg-stone-50 dark:hover:bg-stone-800 font-medium text-stone-700 dark:text-stone-200"
              >
                Exporter CSV
              </button>
              <button
                onClick={launchCampaign}
                disabled={selected.size === 0}
                className="flex items-center gap-1.5 text-xs px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl font-medium disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Send size={12} />
                Créer campagne ({selected.size})
              </button>
            </div>

            {/* Ligne 2 : filtres dropdowns */}
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span className="text-stone-500 dark:text-stone-400 font-medium">Filtres :</span>

              <select
                value={filterWilaya}
                onChange={e => setFilterWilaya(e.target.value)}
                className="px-2 py-1.5 border border-stone-200 dark:border-stone-700 rounded-lg bg-white dark:bg-stone-900 text-stone-700 dark:text-stone-200"
              >
                <option value="">Toutes wilayas ({wilayas.length})</option>
                {wilayas.map(w => <option key={w} value={w}>{w}</option>)}
              </select>

              <ProductsMultiSelect
                allProducts={products}
                selected={filterProducts}
                onChange={setFilterProducts}
              />


              <select
                value={filterGender}
                onChange={e => setFilterGender(e.target.value as 'all' | 'F' | 'M' | 'unknown')}
                className="px-2 py-1.5 border border-stone-200 dark:border-stone-700 rounded-lg bg-white dark:bg-stone-900 text-stone-700 dark:text-stone-200"
              >
                <option value="all">Tous genres</option>
                <option value="F">♀ Femmes ({stats?.by_gender?.female ?? 0})</option>
                <option value="M">♂ Hommes ({stats?.by_gender?.male ?? 0})</option>
                <option value="unknown">? Non identifié ({stats?.by_gender?.unknown ?? 0})</option>
              </select>

              <label className="flex items-center gap-1.5 text-stone-600 dark:text-stone-300 cursor-pointer select-none ml-1">
                <input type="checkbox" checked={onlyRepeat} onChange={e => setOnlyRepeat(e.target.checked)} />
                Fidèles (≥ 2)
              </label>

              {(filterWilaya || filterProducts.size > 0 || filterGender !== 'all' || onlyRepeat) && (
                <button
                  onClick={() => { setFilterWilaya(''); setFilterProducts(new Set()); setFilterGender('all'); setOnlyRepeat(false); }}
                  className="text-stone-500 hover:text-stone-700 underline ml-2"
                >
                  Réinitialiser
                </button>
              )}

              <span className="ml-auto text-stone-500 dark:text-stone-400">
                {filtered.length} client{filtered.length > 1 ? 's' : ''} affichés
              </span>
            </div>
          </div>

          {/* Table */}
          <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-100 dark:border-stone-800 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 dark:bg-stone-800 border-b border-stone-100 dark:border-stone-700">
                  <tr>
                    <th className="px-3 py-3 text-left w-8">
                      <input
                        type="checkbox"
                        checked={filtered.length > 0 && filtered.every(c => selected.has(c.phone))}
                        onChange={toggleAllVisible}
                        title="Tout sélectionner / désélectionner"
                      />
                    </th>
                    {['Client', 'Wilaya', 'Produits', 'Livraisons', 'Total dépensé', 'Dernière livraison'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 dark:text-stone-400 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                  {filtered.map(c => {
                    const isSelected = selected.has(c.phone);
                    return (
                      <tr
                        key={c.phone}
                        onClick={() => toggleOne(c.phone)}
                        className={`cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-800 ${isSelected ? 'bg-green-50/50 dark:bg-green-500/5' : ''}`}
                      >
                        <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                          <input type="checkbox" checked={isSelected} onChange={() => toggleOne(c.phone)} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            {/* Pastille genre — visible si inféré, sinon vide */}
                            <span
                              className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold shrink-0 ${
                                c.gender === 'F' ? 'bg-pink-100 text-pink-700' :
                                c.gender === 'M' ? 'bg-blue-100 text-blue-700' :
                                'bg-stone-100 text-stone-400'
                              }`}
                              title={c.gender === 'F' ? 'Cliente femme' : c.gender === 'M' ? 'Client homme' : 'Genre non identifié'}
                            >
                              {c.gender === 'F' ? '♀' : c.gender === 'M' ? '♂' : '?'}
                            </span>
                            <p className="font-medium text-gray-900 dark:text-stone-100 text-xs truncate">{c.name || <span className="text-stone-400">(sans nom)</span>}</p>
                          </div>
                          <p className="text-[10px] text-stone-500 font-mono flex items-center gap-1 mt-0.5 ml-5">
                            <Phone size={9} />
                            +{c.phone}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-1 text-xs text-stone-600 dark:text-stone-300">
                            <MapPin size={10} />
                            {c.wilaya || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {c.products.length === 0 ? (
                            <span className="text-[10px] text-stone-400">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1 max-w-[200px]">
                              {c.products.slice(0, 2).map(p => (
                                <span key={p} className="text-[10px] bg-violet-50 text-violet-700 px-1.5 py-0.5 rounded font-medium truncate">{p}</span>
                              ))}
                              {c.products.length > 2 && (
                                <span className="text-[10px] text-stone-500" title={c.products.join(', ')}>+{c.products.length - 2}</span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${c.order_count >= 2 ? 'bg-amber-100 text-amber-700' : 'bg-stone-100 text-stone-600'}`}>
                            {c.order_count}× livré{c.order_count > 1 ? 's' : ''}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs font-medium text-gray-900 dark:text-stone-100">
                          {c.total_spent.toFixed(0)} DA
                        </td>
                        <td className="px-4 py-3 text-[11px] text-stone-500">
                          {new Date(c.last_delivery).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filtered.length === 0 && (
                <div className="py-12 text-center text-sm text-stone-400">
                  Aucun client ne correspond aux filtres.
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StatBox({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number | string; color: string }) {
  return (
    <div className={`rounded-2xl p-3 ${color}`}>
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide opacity-80">{icon}{label}</div>
      <p className="text-xl font-bold mt-1">{value}</p>
    </div>
  );
}

// ─── Multi-sélection produits avec popover de checkboxes ─────────────────────
// Trigger : bouton qui montre l'état (« Tous », « X », « N produits »).
// Popover : recherche interne + liste à cocher + actions « tout / aucun ».
// Ferme sur clic en dehors ou touche Escape.
function ProductsMultiSelect({
  allProducts,
  selected,
  onChange,
}: {
  allProducts: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  // Fermeture sur clic en dehors
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggleOne = (p: string) => {
    const next = new Set(selected);
    if (next.has(p)) next.delete(p); else next.add(p);
    onChange(next);
  };

  const filtered = query.trim()
    ? allProducts.filter(p => p.toLowerCase().includes(query.toLowerCase()))
    : allProducts;

  const allFilteredSelected = filtered.length > 0 && filtered.every(p => selected.has(p));

  const triggerLabel =
    selected.size === 0
      ? `Tous produits (${allProducts.length})`
      : selected.size === 1
        ? Array.from(selected)[0]
        : `${selected.size} produits sélectionnés`;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`px-2.5 py-1.5 border rounded-lg bg-white dark:bg-stone-900 text-stone-700 dark:text-stone-200 flex items-center gap-1.5 min-w-[160px] max-w-[260px] ${
          selected.size > 0 ? 'border-violet-300 bg-violet-50 dark:bg-violet-500/10' : 'border-stone-200 dark:border-stone-700'
        }`}
      >
        <span className="truncate text-left flex-1">{triggerLabel}</span>
        <ChevronDown size={12} className="shrink-0 text-stone-400" />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-72 max-w-[90vw] bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-xl shadow-lg z-30 overflow-hidden">
          {/* Header avec recherche + actions */}
          <div className="p-2 border-b border-stone-100 dark:border-stone-800 space-y-2">
            <div className="relative">
              <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Filtrer la liste…"
                className="w-full pl-7 pr-2 py-1.5 text-xs border border-stone-200 dark:border-stone-700 rounded-md bg-stone-50 dark:bg-stone-800 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
              />
            </div>
            <div className="flex items-center justify-between text-[10px]">
              <button
                onClick={() => {
                  const next = new Set(selected);
                  if (allFilteredSelected) filtered.forEach(p => next.delete(p));
                  else filtered.forEach(p => next.add(p));
                  onChange(next);
                }}
                className="text-violet-600 hover:text-violet-700 font-medium"
              >
                {allFilteredSelected ? 'Tout décocher' : 'Tout cocher'}
              </button>
              {selected.size > 0 && (
                <button
                  onClick={() => onChange(new Set())}
                  className="text-stone-500 hover:text-stone-700"
                >
                  Effacer ({selected.size})
                </button>
              )}
            </div>
          </div>

          {/* Liste des produits */}
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="text-center py-4 text-xs text-stone-400">Aucun produit</p>
            ) : (
              filtered.map(p => {
                const isChecked = selected.has(p);
                return (
                  <button
                    key={p}
                    onClick={() => toggleOne(p)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-stone-50 dark:hover:bg-stone-800 ${isChecked ? 'bg-violet-50/50 dark:bg-violet-500/5' : ''}`}
                  >
                    <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${isChecked ? 'bg-violet-600 border-violet-600' : 'border-stone-300 dark:border-stone-600'}`}>
                      {isChecked && <Check size={10} className="text-white" />}
                    </span>
                    <span className="truncate text-stone-700 dark:text-stone-200">{p}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
