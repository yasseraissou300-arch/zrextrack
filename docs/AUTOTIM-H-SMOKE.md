# AutoTim — H-SMOKE : vérification de production connectée

> Environ 15 min. Production : `https://autotim.vercel.app`.
> **Règles** : un seul message, envoyé **vers votre propre numéro de test** ; aucune campagne ; aucun client réel.
> En cas d'erreur, noter l'heure et la référence `ref` affichée. Ne jamais envoyer de capture contenant des données client.
> Les étapes 0 et 7 se font sans session ; les autres demandent d'être connecté.

| # | Domaine | Action exacte | Attendu | Couvre |
|---|---|---|---|---|
| 0 | Sécurité (sans session) | `curl -s -o /dev/null -w '%{http_code}' https://autotim.vercel.app/api/orders` | `401` | API protégées |
| 0b | Sécurité | même commande sur `/api/ai-chatbot/relance` en `-X POST` | `401` | #104 |
| 1 | Auth | se connecter (email et mot de passe habituels), puis se déconnecter et se reconnecter | tableau de bord affiché ; déconnexion → `/login` | session |
| 2 | Dashboard | ouvrir le Tableau de bord, puis Commandes | KPI cohérents avec la veille ; liste paginée (navigation entre pages sans erreur) | #109, #111 |
| 3 | Dashboard | ouvrir Clients, Livraisons, Rapports, Alertes, Corbeille | chaque page s'affiche sans erreur | #110, #114 |
| 4 | WhatsApp — statut | Messages → Connexion : statut | « Connecté » avec votre numéro | #143 (instance résolue) |
| 5 | WhatsApp — QR | même écran : afficher le QR ou le statut **sans rescanner** | pas d'erreur ; aucune nouvelle instance créée | #143, #105 |
| 6 | WhatsApp — envoi | Messages → envoi manuel d'**un** message vers **votre propre numéro de test** | message reçu sur votre téléphone | #143, #103 |
| 6b | Anti-doublon | renvoyer immédiatement le même message au même numéro | **aucun** second message reçu. L'écran affiche « 0 message(s) envoye(s) » ; après #147 : « déjà servi(s) récemment — non renvoyé(s) » | #103 (+ #147) |
| 7 | Webhook (sans session) | `curl -s -o /dev/null -w '%{http_code}' -X POST https://autotim.vercel.app/api/ai-chatbot/webhook/whatsapp -d '{}'` | **avant** WEBHOOK-SECRET-001 : `400` (risque connu) ; **après** : `401` | WEBHOOK-SECRET-001 |
| 7b | Webhook | même commande avec `-H 'x-webhook-token: mauvais'` | après WEBHOOK-SECRET-001 : `403` | idem |
| 8 | Entrant | depuis votre téléphone, écrire « Salam » au numéro connecté | réponse du bot dans la minute | webhook, Gemini, #143 (routage par propriétaire) |
| 8b | Isolation | dans le tableau de bord, Chatbot → Conversations | la conversation n'apparaît **que** dans votre compte | tenant scoping |
| 9 | ZRExpress | Sync → « Synchroniser » **une seule fois** (geste habituel ; ne pas répéter : #113, qui supprime les réécritures et notifications superflues, n'est pas encore déployée) | nombre de commandes affiché ; **aucune** vague de notifications WhatsApp inattendue | #117 (clé côté serveur) |
| 10 | Notifications | Messages → historique | aucun envoi non attendu dans l'heure | file (#125, #126) |
| 11 | File (Vercel) | Vercel → Logs → filtre `cron.tick` (dernière heure) | ticks réguliers ; pas de `exception` en boucle | cron-job.org, #125 |

**Résultat à transmettre** (sans aucune donnée client ni secret) : `#étape : OK / KO (+ ref)`.

**Après H-SMOKE OK** : exécuter MIGRATION-009 (voir `docs/AUTOTIM-HUMAN-ACTIONS-FINAL.md` §5), puis refaire les étapes 4, 5, 6 et 8.
