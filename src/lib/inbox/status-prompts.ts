// Questions ajoutées aux notifications de livraison EXISTANTES (aucun message
// en plus) :
//   - « en livraison » : le client dit s'il est disponible aujourd'hui,
//     demande un report à demain, ou un changement d'adresse ;
//   - « livré »        : avis du client (ممتاز / مقبول / ماعجبنيش).
// La réponse (1 / 2 / 3) est lue par handlePromptReply (lib/inbox/confirm.ts).
// Le marchand voit les demandes de report / changement d'adresse et les avis.

import type { createServiceClient } from '@/lib/supabase/server';
import { normalizePhone } from '@/lib/whatsapp/message-builder';

type Service = ReturnType<typeof createServiceClient>;

export type StatusPromptKind = 'delivery' | 'rating';

export function promptKindForStatus(status: string): StatusPromptKind | null {
  if (status === 'en_livraison') return 'delivery';
  if (status === 'livre') return 'rating';
  return null;
}

export const PROMPT_FOOTERS: Record<StatusPromptKind, string> = {
  delivery: [
    '',
    'ردّ بـ :',
    '*1* راني متاح اليوم ✅',
    '*2* أجّل لغدوة 📅',
    '*3* نبدّل العنوان 📍',
  ].join('\n'),
  rating: [
    '',
    'واش رايك في المنتوج ؟ ردّ بـ :',
    '*1* ممتاز ⭐',
    '*2* مقبول 👌',
    '*3* ماعجبنيش 👎',
  ].join('\n'),
};

/** Ajoute la question à la notification (si le statut en porte une). */
export function withPromptFooter(status: string, message: string): string {
  const kind = promptKindForStatus(status);
  return kind ? `${message.trimEnd()}\n${PROMPT_FOOTERS[kind]}` : message;
}

/** Enregistre la question APRÈS un envoi réussi. Jamais bloquant. */
export async function openStatusPrompt(
  service: Service,
  tenantId: string,
  rawPhone: string,
  status: string,
  trackingNumber: string
): Promise<void> {
  const kind = promptKindForStatus(status);
  const phone = normalizePhone(rawPhone || '');
  if (!kind || !/^\d{8,15}$/.test(phone) || !trackingNumber) return;
  try {
    await service
      .schema('autotim')
      .from('wa_prompts')
      .insert({ tenant_id: tenantId, phone, kind, ref: trackingNumber.slice(0, 100) });
  } catch {
    /* table absente : la notification est partie, seule la question n'est pas suivie */
  }
}

/** Accusés de réception envoyés au client. */
export const STATUS_REPLIES: Record<StatusPromptKind, Record<'1' | '2' | '3', string>> = {
  delivery: {
    '1': 'شكرا 🙏 الموزع جاي اليوم، كون حاضر 🛵',
    '2': 'تمام، سجّلنا طلبك باش التوصيل يكون غدوة 📅',
    '3': 'ابعثلنا العنوان الجديد هنا (البلدية + العنوان) ونبدّلوه 📍',
  },
  rating: {
    '1': 'يعطيك الصحة على رأيك 🙏⭐ نستناوك في طلبية جاية!',
    '2': 'شكرا على رأيك 🙏 نخدمو باش نكونو خير المرة الجاية.',
    '3': 'سامحنا 🙏 واش ما عجبكش ؟ اكتبلنا هنا باش نصلّحو.',
  },
};

export const ANSWER_LABELS: Record<StatusPromptKind, Record<string, string>> = {
  delivery: { '1': 'Disponible aujourd’hui', '2': 'Reporter à demain', '3': 'Changer l’adresse' },
  rating: { '1': 'Excellent', '2': 'Correct', '3': 'Pas satisfait' },
};

export interface ClientRequest {
  id: string;
  phone: string;
  ref: string;
  kind: StatusPromptKind;
  answer: string;
  answered_at: string;
}

/** Demandes à traiter : report à demain / changement d'adresse, pas encore traitées. */
export async function pendingClientRequests(
  service: Service,
  tenantId: string
): Promise<ClientRequest[] | null> {
  const { data, error } = await service
    .schema('autotim')
    .from('wa_prompts')
    .select('id, phone, ref, kind, answer, answered_at')
    .eq('tenant_id', tenantId)
    .eq('kind', 'delivery')
    .in('answer', ['2', '3'])
    .is('handled_at', null)
    .order('answered_at', { ascending: false })
    .limit(100);
  if (error) return null;
  return (data ?? []) as ClientRequest[];
}

export async function markRequestHandled(
  service: Service,
  tenantId: string,
  id: string
): Promise<boolean> {
  const { data, error } = await service
    .schema('autotim')
    .from('wa_prompts')
    .update({ handled_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .is('handled_at', null)
    .select('id');
  return !error && !!data?.length;
}

export interface RatingStats {
  total: number;
  excellent: number;
  correct: number;
  bad: number;
}

/** Avis des 90 derniers jours. */
export async function ratingStats(service: Service, tenantId: string): Promise<RatingStats | null> {
  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  const { data, error } = await service
    .schema('autotim')
    .from('wa_prompts')
    .select('answer')
    .eq('tenant_id', tenantId)
    .eq('kind', 'rating')
    .gte('answered_at', since)
    .limit(5000);
  if (error) return null;
  const rows = (data ?? []) as { answer: string | null }[];
  const n = (a: string) => rows.filter((r) => r.answer === a).length;
  return { total: rows.length, excellent: n('1'), correct: n('2'), bad: n('3') };
}
