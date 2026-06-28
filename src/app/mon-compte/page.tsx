'use client';

// Page « Mon compte » — informations du compte connecté + déconnexion.
// La connexion se fait via Google (OAuth) : il n'y a donc pas de mot de passe
// stocké dans l'app. Le mot de passe est celui du compte Google de l'utilisateur.

import React, { useEffect, useState } from 'react';
import AppLayout from '@/components/ui/AppLayout';
import { createClient } from '@/lib/supabase/client';
import { UserCircle, Mail, Shield, LogOut, Loader2, Crown, Building2, CalendarDays } from 'lucide-react';

interface Profile {
  email: string;
  full_name: string;
  avatar_url: string;
  company_name: string;
  plan_id: string;
  role: string;
  created_at: string;
}

const PLAN_LABEL: Record<string, string> = {
  basic: 'Basic (gratuit)', pro: 'Pro', business: 'Business',
};

function Row({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-stone-100 dark:border-stone-800 last:border-0">
      <Icon size={15} className="text-stone-400 shrink-0" />
      <span className="text-xs font-medium text-stone-400 dark:text-stone-500 w-28 shrink-0">{label}</span>
      <span className="text-sm text-stone-800 dark:text-stone-100 break-all">{value}</span>
    </div>
  );
}

export default function MonComptePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { window.location.href = '/login'; return; }
      setEmail(user.email || '');
      const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      setProfile((data as Profile) ?? null);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logout = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  return (
    <AppLayout>
      <div className="min-h-screen bg-stone-50 dark:bg-stone-950">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-violet-100 dark:bg-violet-500/15 rounded-xl flex items-center justify-center">
              <UserCircle size={20} className="text-violet-600 dark:text-violet-300" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-100">Mon compte</h1>
              <p className="text-sm text-stone-500 dark:text-stone-400">Vos informations de connexion</p>
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-16"><Loader2 size={22} className="animate-spin text-stone-400" /></div>
          ) : (
            <>
              <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 shadow-sm p-6">
                <div className="flex items-center gap-4 mb-6">
                  {profile?.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={profile.avatar_url} alt="" className="w-16 h-16 rounded-full" />
                  ) : (
                    <div className="w-16 h-16 rounded-full bg-violet-100 dark:bg-violet-500/15 flex items-center justify-center text-violet-700 dark:text-violet-300 text-2xl font-bold">
                      {(profile?.full_name || email || 'U')[0].toUpperCase()}
                    </div>
                  )}
                  <div>
                    <p className="text-lg font-bold text-stone-900 dark:text-stone-100">{profile?.full_name || 'Sans nom'}</p>
                    {profile?.role === 'admin' && (
                      <span className="inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300 px-2 py-0.5 rounded-full font-medium mt-1">
                        <Shield size={11} /> Super Admin
                      </span>
                    )}
                  </div>
                </div>

                <div>
                  <Row icon={Mail} label="Email" value={email} />
                  <Row icon={Crown} label="Plan" value={PLAN_LABEL[profile?.plan_id || 'basic'] || profile?.plan_id || 'Basic'} />
                  {profile?.company_name && <Row icon={Building2} label="Entreprise" value={profile.company_name} />}
                  {profile?.created_at && <Row icon={CalendarDays} label="Membre depuis" value={new Date(profile.created_at).toLocaleDateString('fr-FR')} />}
                </div>
              </div>

              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/40 rounded-2xl p-4 text-sm text-blue-700 dark:text-blue-300">
                🔐 Vous êtes connecté <strong>via Google</strong>. Il n'y a donc pas de mot de passe à gérer ici — c'est celui de votre compte Google. Pour le changer, passez par les réglages de votre compte Google.
              </div>

              <button
                onClick={logout}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300 font-medium transition-colors"
              >
                <LogOut size={16} /> Se déconnecter
              </button>
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
