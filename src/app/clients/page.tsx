'use client';

import AppLayout from '@/components/ui/AppLayout';
import { createClient } from '@/lib/supabase/client';
import { useEffect, useState } from 'react';
import { Users, Package } from 'lucide-react';

export default function ClientsPage() {
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    const fetchClients = async () => {
      setLoading(true);
      const { data } = await supabase
        .from('orders')
        .select('client, whatsapp, wilaya, status')
        .order('created_at', { ascending: false });

      if (data) {
        // Group by client
        const map = new Map<string, { client: string; whatsapp: string; wilaya: string; total: number; livre: number }>();
        data.forEach(o => {
          const key = o.whatsapp || o.client;
          if (!map.has(key)) {
            map.set(key, { client: o.client, whatsapp: o.whatsapp, wilaya: o.wilaya, total: 0, livre: 0 });
          }
          const entry = map.get(key)!;
          entry.total++;
          if (o.status === 'livre') entry.livre++;
        });
        setClients(Array.from(map.values()).sort((a, b) => b.total - a.total));
      }
      setLoading(false);
    };
    fetchClients();
  }, []);

  return (
    <AppLayout>
      <div className="max-w-screen-2xl mx-auto px-6 py-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
            <Users size={20} className="text-purple-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Clients</h1>
            <p className="text-sm text-gray-500">Tous vos clients extraits des commandes</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Liste clients ({clients.length})</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Client</th>
                  <th className="px-4 py-3 text-left">WhatsApp</th>
                  <th className="px-4 py-3 text-left">Wilaya</th>
                  <th className="px-4 py-3 text-center">Commandes</th>
                  <th className="px-4 py-3 text-center">Livrées</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Chargement...</td></tr>
                ) : clients.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Aucun client — ajoutez des commandes d'abord</td></tr>
                ) : clients.map((c, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{c.client}</td>
                    <td className="px-4 py-3 text-gray-500">{c.whatsapp || '—'}</td>
                    <td className="px-4 py-3 text-gray-500">{c.wilaya || '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full">{c.total}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded-full">{c.livre}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
