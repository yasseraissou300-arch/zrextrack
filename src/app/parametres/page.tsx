'use client';
import React, { useState, useEffect, useCallback } from 'react';
import AppLayout from '@/components/ui/AppLayout';
import { Settings, Globe, MessageSquare, Loader2, CheckCircle, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';

interface Template {
  id: string | null;
  key: string;
  name: string;
  content_darija: string;
  content_arabic: string;
  content_french: string;
  is_active: boolean;
}

const LANG_TABS = [
  { id: 'content_darija', label: 'Darija 🇩🇿', dir: 'rtl' },
  { id: 'content_arabic', label: 'العربية', dir: 'rtl' },
  { id: 'content_french', label: 'Français 🇫🇷', dir: 'ltr' },
];

const VARIABLE_HINTS = ['{{client}}', '{{tracking}}', '{{wilaya}}', '{{cod}}'];

function TemplateCard({
  template, defaultTemplate, onSave,
}: {
  template: Template;
  defaultTemplate: Template;
  onSave: (t: Template) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState('content_darija');
  const [form, setForm] = useState(template);
  const [saving, setSaving] = useState(false);

  const langCfg = LANG_TABS.find(l => l.id === lang)!;
  const content = (form as any)[lang] as string;

  const handleSave = async () => {
    setSaving(true);
    await onSave(form);
    setSaving(false);
  };

  const handleReset = () => {
    setForm(f => ({ ...f, [lang]: (defaultTemplate as any)[lang] }));
  };

  const insertVar = (v: string) => {
    setForm(f => ({ ...f, [lang]: (f as any)[lang] + v }));
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
            <MessageSquare size={15} className="text-green-600" />
          </div>
          <span className="font-semibold text-gray-900">{template.name}</span>
          <span className="text-xs text-gray-400 font-mono">{template.key}</span>
        </div>
        {open ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>

      {open && (
        <div className="border-t border-gray-100 p-5 space-y-4">
          <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
            {LANG_TABS.map(l => (
              <button
                key={l.id}
                onClick={() => setLang(l.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${lang === l.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {l.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-1.5">
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

          <textarea
            value={content}
            onChange={e => setForm(f => ({ ...f, [lang]: e.target.value }))}
            rows={5}
            dir={langCfg.dir as any}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
          />

          {content && (
            <div>
              <p className="text-xs text-gray-400 mb-1">Aperçu</p>
              <div
                className="bg-green-50 border border-green-100 rounded-xl p-4 text-sm text-gray-800 whitespace-pre-line leading-relaxed"
                dir={langCfg.dir as any}
              >
                {content
                  .replace(/\{\{client\}\}/g, 'محمد')
                  .replace(/\{\{tracking\}\}/g, 'ZR-123456')
                  .replace(/\{\{wilaya\}\}/g, 'الجزائر')
                  .replace(/\{\{cod\}\}/g, '2500')}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 text-xs px-3 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-500"
            >
              <RotateCcw size={12} /> Réinitialiser
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 text-sm px-5 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium ml-auto"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
              Sauvegarder
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ParametresPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [defaults, setDefaults] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/templates');
    const json = await res.json();
    setTemplates(json.data || []);
    setDefaults(json.defaults || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const handleSave = async (t: Template) => {
    const res = await fetch('/api/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(t),
    });
    const json = await res.json();
    if (json.error) { toast.error(json.error); return; }
    toast.success('Template sauvegardé !');
    setTemplates(prev => prev.map(p => p.key === t.key ? { ...p, ...json.data } : p));
  };

  return (
    <AppLayout>
      <div className="max-w-screen-lg mx-auto px-6 py-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center">
            <Settings size={20} className="text-gray-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Paramètres</h1>
            <p className="text-sm text-gray-500">Personnalisez vos templates WhatsApp en 3 langues</p>
          </div>
        </div>

        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 flex items-start gap-3">
          <Globe size={16} className="text-blue-500 shrink-0 mt-0.5" />
          <div className="text-sm text-blue-700">
            <span className="font-medium">Templates multi-langue</span>
            <span className="ml-1">— Personnalisez chaque message en Darija, Arabe et Français. Variables disponibles :</span>
            <span className="ml-1">
              {['{{client}}', '{{tracking}}', '{{wilaya}}', '{{cod}}'].map(v => (
                <code key={v} className="mx-0.5 bg-blue-100 px-1.5 py-0.5 rounded text-blue-800 text-xs font-mono">{v}</code>
              ))}
            </span>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 size={24} className="animate-spin text-gray-400" />
          </div>
        ) : (
          <div className="space-y-3">
            {templates.map(t => (
              <TemplateCard
                key={t.key}
                template={t}
                defaultTemplate={defaults.find(d => d.key === t.key) ?? t}
                onSave={handleSave}
              />
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
