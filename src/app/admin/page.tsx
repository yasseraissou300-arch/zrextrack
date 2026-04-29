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
  const supabase = createClient();

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

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
    await supabase.from('profiles').update({ status: newStatus }).eq('id', userId);
    fetchUsers();
  };

  const changePlan = async (userId: string, planId: string) => {
    await supabase.from('profiles').update({ plan_id: planId }).eq('id', userId);
    fetchUsers();
  };

  const planColors: Record<string, string> = {
    basic: 'bg-slate-100 text-slate-700',
    pro: 'bg-blue-100 text-blue-700',
    business: 'bg-purple-100 text-purple-700',
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center">
              <Crown size={16} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">Admin Autotim</h1>
              <p className="text-xs text-gray-500">Gestion des utilisateurs</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={fetchUsers} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 px-3 py-2 rounded-lg hover:bg-gray-100">
              <RefreshCw size={14} /> Actualiser
            </button>
            <a href="/admin-dashboard" className="flex items-center gap-2 text-sm bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600">
              <Package size={14} /> Dashboard
            </a>
          </div>
        </div>
      </div>

      <div className="p-6 max-w-7xl mx-auto">
        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Total inscrits', value: stats.total, icon: Users, color: 'text-blue-600 bg-blue-50' },
            { label: 'Comptes actifs', value: stats.active, icon: CheckCircle, color: 'text-green-600 bg-green-50' },
            { label: 'Comptes bloqués', value: stats.blocked, icon: Ban, color: 'text-red-600 bg-red-50' },
            { label: 'Plans payants', value: stats.pro, icon: TrendingUp, color: 'text-purple-600 bg-purple-50' },
          ].map((stat) => (
            <div key={stat.label} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
              <div className={`w-10 h-10 rounded-lg ${stat.color} flex items-center justify-center mb-3`}>
                <stat.icon size={20} />
              </div>
              <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
              <p className="text-sm text-gray-500 mt-1">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Users Table */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Tous les utilisateurs ({users.length})</h2>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-gray-400">Chargement...</div>
          ) : users.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
              <Users size={48} className="mb-3 opacity-30" />
              <p>Aucun utilisateur inscrit pour l'instant</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left text-xs font-medium text-gray-500 uppercase px-6 py-3">Utilisateur</th>
                    <th className="text-left text-xs font-medium text-gray-500 uppercase px-6 py-3">Plan</th>
                    <th className="text-left text-xs font-medium text-gray-500 uppercase px-6 py-3">Statut</th>
                    <th className="text-left text-xs font-medium text-gray-500 uppercase px-6 py-3">Inscrit le</th>
                    <th className="text-left text-xs font-medium text-gray-500 uppercase px-6 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {users.map((user) => (
                    <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          {user.avatar_url ? (
                            <img src={user.avatar_url} alt="" className="w-9 h-9 rounded-full" />
                          ) : (
                            <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-semibold text-sm">
                              {(user.full_name || user.email || 'U')[0].toUpperCase()}
                            </div>
                          )}
                          <div>
                            <p className="font-medium text-gray-900 text-sm">{user.full_name || 'Nom inconnu'}</p>
                            <p className="text-xs text-gray-500">{user.email}</p>
                          </div>
                          {user.role === 'admin' && (
                            <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-medium">Admin</span>
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
                          user.status === 'active' ? 'bg-green-100 text-green-700' :
                          user.status === 'blocked' ? 'bg-red-100 text-red-700' :
                          'bg-yellow-100 text-yellow-700'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            user.status === 'active' ? 'bg-green-500' :
                            user.status === 'blocked' ? 'bg-red-500' : 'bg-yellow-500'
                          }`} />
                          {user.status === 'active' ? 'Actif' : user.status === 'blocked' ? 'Bloqué' : 'En attente'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {new Date(user.created_at).toLocaleDateString('fr-FR')}
                      </td>
                      <td className="px-6 py-4">
                        {user.role !== 'admin' && (
                          <button
                            onClick={() => toggleUserStatus(user.id, user.status)}
                            className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                              user.status === 'active'
                                ? 'bg-red-50 text-red-600 hover:bg-red-100'
                                : 'bg-green-50 text-green-600 hover:bg-green-100'
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
