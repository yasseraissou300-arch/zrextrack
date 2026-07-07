'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Users, TrendingUp, Ban, CheckCircle, Crown, Package, RefreshCw } from 'lucide-react';

type Profile = {
  id: string;
  email: string;
  full_name: string;
  avatar_url: string;
  company_name: string;
  plan_id: string;
  status: 'active' | 'blocked' | 'pending';
  role: string;
  created_at: string;
};

export default function AdminPage() {
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0, active: 0, blocked: 0, pro: 0 });
  // null = vérification du rôle en cours ; true = admin confirmé.
  // Les non-admins sont redirigés (la RLS protège déjà les données, mais sans
  // cette garde un client curieux tombait sur l'interface admin vide).
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const supabase = createClient();

  useEffect(() => {
    const checkAccess = async () => {
      // Rôle lu via /api/auth/me (serveur, bypass RLS) — fiable.
      const res = await fetch('/api/auth/me');
      if (res.status === 401) { window.location.href = '/login'; return; }
      const me = await res.json();
      if (me?.role !== 'admin') {
        window.location.href = '/admin-dashboard';
        return;
      }
      setAuthorized(true);
      fetchUsers();
    };
    checkAccess();
  }, []);

  // Tous les profils via la route serveur admin (service role, vérif rôle).
  const fetchUsers = async () => {
    setLoading(true);
    const res = await fetch('/api/admin/users');
    const json = await res.json();
    const data: Profile[] | undefined = json.users;
    if (data) {
      setUsers(data);
      setStats({
        total: data.length,
        active: data.filter(u => u.status === 'active').length,
        blocked: data.filter(u => u.status === 'blocked').length,
        pro: data.filter(u => u.plan_id !== 'basic').length,
      });
    }
    setLoading(false);
  };

  const toggleUserStatus = async (userId: string, currentStatus: string) => {
    const newStatus = currentStatus === 'active' ? 'blocked' : 'active';
    await fetch('/api/admin/users', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, status: newStatus }),
    });
    fetchUsers();
  };

  const changePlan = async (userId: string, planId: string) => {
    await fetch('/api/admin/users', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, plan_id: planId }),
    });
    fetchUsers();
  };

  const planColors: Record<string, string> = {
    basic: 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300',
    pro: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
    business: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  };

  // Pendant la vérification du rôle (ou juste avant redirection), on n'affiche
  // rien de l'interface admin.
  if (authorized !== true) {
    return (
      <div className="min-h-screen bg-stone-50 dark:bg-stone-950 flex items-center justify-center">
        <RefreshCw size={20} className="animate-spin text-stone-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950">
      {/* Header */}
      <div className="bg-white dark:bg-stone-900 border-b border-stone-200 dark:border-stone-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300 rounded-xl flex items-center justify-center">
              <Crown size={18} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-stone-900 dark:text-stone-100">Super Admin</h1>
              <p className="text-xs text-stone-500 dark:text-stone-400">Gestion des clients Autotim</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={fetchUsers} className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-stone-100 px-3 py-2 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800">
              <RefreshCw size={14} /> Actualiser
            </button>
            <a href="/admin-dashboard" className="flex items-center gap-2 text-sm bg-violet-600 text-white px-4 py-2 rounded-lg hover:bg-violet-700">
              <Package size={14} /> Dashboard
            </a>
          </div>
        </div>
      </div>

      <div className="p-6 max-w-7xl mx-auto">
        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Total inscrits', value: stats.total, icon: Users, color: 'text-blue-600 bg-blue-50 dark:text-blue-300 dark:bg-blue-500/15' },
            { label: 'Comptes actifs', value: stats.active, icon: CheckCircle, color: 'text-green-600 bg-green-50 dark:text-green-300 dark:bg-green-500/15' },
            { label: 'Comptes bloqués', value: stats.blocked, icon: Ban, color: 'text-red-600 bg-red-50 dark:text-red-300 dark:bg-red-500/15' },
            { label: 'Plans payants', value: stats.pro, icon: TrendingUp, color: 'text-violet-600 bg-violet-50 dark:text-violet-300 dark:bg-violet-500/15' },
          ].map((stat) => (
            <div key={stat.label} className="bg-white dark:bg-stone-900 rounded-xl p-4 shadow-sm border border-stone-100 dark:border-stone-800">
              <div className={`w-10 h-10 rounded-lg ${stat.color} flex items-center justify-center mb-3`}>
                <stat.icon size={20} />
              </div>
              <p className="text-2xl font-bold text-stone-900 dark:text-stone-100 tabular-nums">{stat.value}</p>
              <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Users Table */}
        <div className="bg-white dark:bg-stone-900 rounded-xl shadow-sm border border-stone-100 dark:border-stone-800 overflow-hidden">
          <div className="px-6 py-4 border-b border-stone-100 dark:border-stone-800">
            <h2 className="font-semibold text-stone-900 dark:text-stone-100">Tous les utilisateurs ({users.length})</h2>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-stone-400">Chargement...</div>
          ) : users.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-stone-400 dark:text-stone-500">
              <Users size={48} className="mb-3 opacity-30" />
              <p>Aucun utilisateur inscrit pour l'instant</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-stone-50 dark:bg-stone-800/50">
                  <tr>
                    <th className="text-left text-xs font-medium text-stone-500 dark:text-stone-400 uppercase px-6 py-3">Utilisateur</th>
                    <th className="text-left text-xs font-medium text-stone-500 dark:text-stone-400 uppercase px-6 py-3">Plan</th>
                    <th className="text-left text-xs font-medium text-stone-500 dark:text-stone-400 uppercase px-6 py-3">Statut</th>
                    <th className="text-left text-xs font-medium text-stone-500 dark:text-stone-400 uppercase px-6 py-3">Inscrit le</th>
                    <th className="text-left text-xs font-medium text-stone-500 dark:text-stone-400 uppercase px-6 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-50 dark:divide-stone-800">
                  {users.map((user) => (
                    <tr key={user.id} className="hover:bg-stone-50 dark:hover:bg-stone-800/40 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          {user.avatar_url ? (
                            <img src={user.avatar_url} alt="" className="w-9 h-9 rounded-full" />
                          ) : (
                            <div className="w-9 h-9 rounded-full bg-violet-100 dark:bg-violet-500/15 flex items-center justify-center text-violet-700 dark:text-violet-300 font-semibold text-sm">
                              {(user.full_name || user.email || 'U')[0].toUpperCase()}
                            </div>
                          )}
                          <div>
                            <p className="font-medium text-stone-900 dark:text-stone-100 text-sm">{user.full_name || 'Nom inconnu'}</p>
                            <p className="text-xs text-stone-500 dark:text-stone-400">{user.email}</p>
                          </div>
                          {user.role === 'admin' && (
                            <span className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300 px-2 py-0.5 rounded-full font-medium">Admin</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <select
                          value={user.plan_id}
                          onChange={(e) => changePlan(user.id, e.target.value)}
                          className={`text-xs font-medium px-2 py-1 rounded-full border-0 cursor-pointer ${planColors[user.plan_id] || planColors.basic}`}
                        >
                          <option value="basic">Basic</option>
                          <option value="pro">Pro</option>
                          <option value="business">Business</option>
                        </select>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full ${
                          user.status === 'active' ? 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300' :
                          user.status === 'blocked' ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300' :
                          'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            user.status === 'active' ? 'bg-green-500' :
                            user.status === 'blocked' ? 'bg-red-500' : 'bg-amber-500'
                          }`} />
                          {user.status === 'active' ? 'Actif' : user.status === 'blocked' ? 'Bloqué' : 'En attente'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-stone-500 dark:text-stone-400">
                        {new Date(user.created_at).toLocaleDateString('fr-FR')}
                      </td>
                      <td className="px-6 py-4">
                        {user.role !== 'admin' && (
                          <button
                            onClick={() => toggleUserStatus(user.id, user.status)}
                            className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                              user.status === 'active'
                                ? 'bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-500/15 dark:text-red-300 dark:hover:bg-red-500/25'
                                : 'bg-green-50 text-green-600 hover:bg-green-100 dark:bg-green-500/15 dark:text-green-300 dark:hover:bg-green-500/25'
                            }`}
                          >
                            {user.status === 'active' ? <><Ban size={12} /> Bloquer</> : <><CheckCircle size={12} /> Activer</>}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
