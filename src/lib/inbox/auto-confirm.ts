// Envoi automatique des demandes de confirmation, appelé par le drain des
// notifications (synchronisation toutes les 5 min). Désactivé par défaut :
// le marchand l'active dans « À confirmer ». Toute erreur → 0 envoi.

import type { createServiceClient } from '@/lib/supabase/server';
import { getSource } from '@/lib/inbox/store';
import { expireUnanswered, sendPendingConfirmations, type SendText } from '@/lib/inbox/confirm';
import { logWaMessage } from '@/lib/inbox/wa-sender';

type Service = ReturnType<typeof createServiceClient>;

export async function autoConfirmations(
  service: Service,
  tenantId: string,
  budget: number,
  send: SendText
): Promise<number> {
  try {
    const source = await getSource(service, tenantId);
    if (!source) return 0; // migration 011 non exécutée
    await expireUnanswered(service, tenantId);
    if (!source.auto_confirm || budget <= 0) return 0;
    return await sendPendingConfirmations(
      {
        service,
        tenantId,
        send,
        logSent: (o, text) =>
          logWaMessage(
            service,
            tenantId,
            `CONF-${o.id.slice(0, 8)}`,
            o.customer_name,
            o.phone,
            text
          ),
      },
      budget,
      source.confirm_template
    );
  } catch {
    return 0;
  }
}
