// CRUD des équivalences de tailles AutoSwap (par utilisateur).
//
// GET  /api/autoswap/equivalences         → liste les équivalences du user
// POST /api/autoswap/equivalences         → upsert un produit { product_key, product_label, groups }
// DELETE /api/autoswap/equivalences?key=X → supprime un produit
//
// Pas d'endpoint de « seed defaults » public : chaque utilisateur ajoute
// ses propres produits via l'UI, on évite ainsi qu'un ami récupère par
// inadvertance les produits d'un autre vendeur.

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

interface EquivalenceRow {
  id: string;
  user_id: string;
  product_key: string;
  product_label: string | null;
  groups: string[][];
  created_at: string;
  updated_at: string;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = createServiceClient();
  const { data, error } = await service
    .from('autoswap_size_equivalences')
    .select('*')
    .eq('user_id', user.id)
    .order('product_label', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: (data ?? []) as EquivalenceRow[] });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = createServiceClient();

  // Upsert d'un produit
  const body = await req.json().catch(() => ({}));
  const { product_key, product_label, groups } = body as {
    product_key?: string;
    product_label?: string;
    groups?: string[][];
  };

  if (!product_key || !product_key.trim()) {
    return NextResponse.json({ error: 'product_key requis' }, { status: 400 });
  }
  if (!Array.isArray(groups) || groups.length === 0) {
    return NextResponse.json({ error: 'groups doit être un tableau non vide' }, { status: 400 });
  }
  // Validation : chaque groupe est un tableau de strings non vide
  for (const g of groups) {
    if (!Array.isArray(g) || g.length < 2 || !g.every(x => typeof x === 'string' && x.trim())) {
      return NextResponse.json({ error: 'Chaque groupe doit contenir au moins 2 tailles' }, { status: 400 });
    }
  }

  // Normalise les tailles : trim + upper-case alpha, brut pour numérique
  const normalizedGroups = groups.map(g => g.map(s => {
    const t = s.trim();
    return /^\d+$/.test(t) ? t : t.toUpperCase();
  }));

  const { data, error } = await service
    .from('autoswap_size_equivalences')
    .upsert(
      {
        user_id: user.id,
        product_key: product_key.trim().toLowerCase(),
        product_label: product_label?.trim() || null,
        groups: normalizedGroups,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,product_key' }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const key = url.searchParams.get('key');
  if (!key) return NextResponse.json({ error: 'key manquant' }, { status: 400 });

  const service = createServiceClient();
  const { error } = await service
    .from('autoswap_size_equivalences')
    .delete()
    .eq('user_id', user.id)
    .eq('product_key', key.toLowerCase());

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
