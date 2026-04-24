'use client';
import React, { useState, useEffect, useCallback } from 'react';
import AppLayout from '@/components/ui/AppLayout';
import {
  Megaphone, Plus, Send, Trash2, Loader2, CheckCircle, XCircle,
  Clock, Users, ChevronRight, X, AlertCircle, RefreshCw, ImageIcon,
} from 'lucide-react';
import { toast } from 'sonner';

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
  brouillon: { label: 'Brouillon', bg: 'bg-gray-100 text-gray-600', icon: Clock },
  en_cours: { label: 'En cours', bg: 'bg-blue-100 text-blue-700', icon: Loader2 },
  termine: { label: 'Terminé', bg: 'bg-green-100 text-green-700', icon: CheckCircle },
  annule: { label: 'Annulé', bg: 'bg-red-100 text-red-600', icon: XCircle },
};

function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {children}
      </div>
    </div>
  );
}

function CreateModal({ open, onClose, onCreate }: {
  open: boolean;
  onClose: () => void;
  onCreate: (c: Campaign) => void;
}) {
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('');
  const [audienceStatus, setAudienceStatus] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [saving, setSaving] = useState(false);

  const reset = () => { setName(''); setTemplate(''); setAudienceStatus(''); setMediaUrl(''); };

  const handleClose = () => { reset(); onClose(); };

  const handleCreate = async () => {
    if (!name.trim()) { toast.error('Donne un nom à la campagne'); return; }
    if (!template.trim()) { toast.error('Le message est requis'); return; }
    setSaving(true);
    const res = await fetch('/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, message_template: template, audience_status: audienceStatus, media_url: mediaUrl }),
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
            <h2 className="font-bold text-gray-900">Nouvelle campagne</h2>
          </div>
          <button onClick={handleClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
            <X size={16} className="text-gray-500" />
          </button>
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-600">Nom de la campagne</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="ex: Promo Ramadan, Relance échecs..."
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-600">Audience (statut des commandes)</label>
          <select
            value={audienceStatus}
            onChange={e => setAudienceStatus(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
          >
            {STATUS_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-600">
            <span className="flex items-center gap-1.5"><ImageIcon size={12} /> Media (optionnel — image, PDF, audio)</span>
          </label>
          <input
            value={mediaUrl}
            onChange={e => setMediaUrl(e.target.value)}
            placeholder="https://... URL publique d'une image, PDF ou audio"
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          {mediaUrl && (
            <p className="text-xs text-gray-400">Le media sera envoyé avec le message comme légende.</p>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-medium text-gray-600">Message</label>
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
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
          />
        </div>

        {template && (
          <div className="space-y-1">
            <p className="text-xs text-gray-400">Aperçu</p>
            <div className="bg-green-50 border border-green-100 rounded-xl p-4 text-sm text-gray-800 whitespace-pre-line text-right leading-relaxed" dir="rtl">
              {previewText}
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <button
            onClick={handleClose}
            className="flex-1 border border-gray-200 rounded-xl py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
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
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 truncate">{campaign.name}</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {new Date(campaign.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
          </p>
        </div>
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ${cfg.bg}`}>
          <Icon size={11} className={campaign.status === 'en_cours' ? 'animate-spin' : ''} />
          {cfg.label}
        </span>
      </div>

      <div className="bg-gray-50 rounded-xl p-3">
        <p className="text-xs text-gray-500 line-clamp-2 text-right leading-relaxed" dir="rtl">
          {campaign.message_template}
        </p>
      </div>

      <div className="flex items-center gap-3 text-xs text-gray-500">
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
              <span className="ml-auto text-gray-400">{successRate}%</span>
            )}
          </>
        )}
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={() => onView(campaign.id)}
          className="flex items-center gap-1.5 text-xs px-3 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"
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
          <h2 className="font-bold text-gray-900">Détails de la campagne</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
            <X size={16} className="text-gray-500" />
          </button>
        </div>
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-gray-400" /></div>
        ) : !data ? (
          <p className="text-center text-gray-400 py-8">Aucune donnée</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-gray-900">{data.campaign.total_count}</p>
                <p className="text-xs text-gray-500 mt-0.5">Total</p>
              </div>
              <div className="bg-green-50 rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-green-700">{data.campaign.sent_count}</p>
                <p className="text-xs text-gray-500 mt-0.5">Envoyés</p>
              </div>
              <div className="bg-red-50 rounded-xl p-3 text-center">
                <p className="text-xl font-bold text-red-600">{data.campaign.failed_count}</p>
                <p className="text-xs text-gray-500 mt-0.5">Échecs</p>
              </div>
            </div>
            <div className="max-h-80 overflow-y-auto divide-y divide-gray-50 rounded-xl border border-gray-100">
              {data.recipients.length === 0 ? (
                <p className="text-center text-gray-400 py-8 text-sm">Aucun destinataire</p>
              ) : data.recipients.map((r: any) => (
                <div key={r.id} className="p-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{r.client}</p>
                    <p className="text-xs text-gray-400">{r.phone} {r.tracking && `· ${r.tracking}`}</p>
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
              <h1 className="text-xl font-bold text-gray-900">Campagnes</h1>
              <p className="text-sm text-gray-500">Envois groupés WhatsApp ciblés</p>
            </div>
          </div>
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-2 bg-green-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-green-700 transition-colors"
          >
            <Plus size={16} />
            Nouvelle campagne
          </button>
        </div>

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
            <Loader2 size={24} className="animate-spin text-gray-400" />
          </div>
        ) : campaigns.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <Megaphone size={40} className="mb-3 opacity-20" />
            <p className="text-base font-medium text-gray-500">Aucune campagne</p>
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
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Prêtes à envoyer ({brouillons.length})</h2>
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
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Historique ({terminees.length})</h2>
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
      </div>

      <CreateModal open={createOpen} onClose={() => setCreateOpen(false)} onCreate={handleCreate} />
      <DetailModal campaignId={detailId} open={!!detailId} onClose={() => setDetailId(null)} />
    </AppLayout>
  );
}
