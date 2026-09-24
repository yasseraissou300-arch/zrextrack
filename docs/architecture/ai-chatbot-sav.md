# Chatbot IA, commandes, relance et SAV

## Flux d'un message WhatsApp entrant

`POST /api/ai-chatbot/webhook/whatsapp`, envoyé par Evolution sur l'événement
`MESSAGES_UPSERT`.

1. Authentification par secret d'URL, puis validation de forme du payload.
2. Anti-rejeu sur `wa:<instance>:<messageId>` : en mémoire sur `main`, en
   Postgres sur la branche.
3. Identification du tenant et du service par `whatsapp_instances.instance_name`.
4. Chargement de la configuration active (`chatbot_configs`, par
   `template_type`) et de la session (`ai_chat_sessions`, une par contact).
5. Filtres, dans l'ordre :
   - écho sortant (`fromMe`) ;
   - préfixes bloqués ;
   - pause humaine ;
   - transfert humain déjà fait ;
   - **colère**, qui déclenche le transfert humain ;
   - **blabla** : message d'accueil, sans IA.
6. Après 2 échecs de l'IA : transfert humain.
7. Gemini (`gemini-2.5-flash`) sur le **pool de clés BYOK** du marchand, en
   passant à la clé suivante sur un 429. La conversation est tronquée aux 10
   derniers messages.
8. Extraction du bloc `<data>{…}</data>`, fusion dans `extracted_data`, puis
   upsert de la session.
9. Une fois complet : Google Sheets (Apps Script du marchand), notification
   WhatsApp à l'admin, `sheets_sent`.
10. Réponse au client, sans le bloc `<data>`.

## Sortie du modèle : validation serveur

Branche `p1-chatbot-extraction-validation`, module `src/lib/ai-chatbot/extraction.ts`.
Sur `main`, la sortie du modèle est utilisée telle quelle.

| Donnée        | Règle serveur                                                                                                                                 |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| téléphone     | mobile algérien 05/06/07 + 8 chiffres, normalisé en `0XXXXXXXXX`                                                                              |
| wilaya        | nom officiel, via la table de variantes (58 wilayas et plus)                                                                                  |
| clés          | `[a-z][a-z0-9_]{0,39}`, 20 au maximum, valeurs ≤ 300 caractères, pas d'objets                                                                 |
| complétude    | commande : nom, téléphone, wilaya, produit ; SAV : réclamation et commande ; suivi : jamais ; prompt personnalisé : ancienne règle (≥ 3 clés) |
| Google Sheets | préfixe `'` sur `= + - @` (injection de formule)                                                                                              |
| refus         | le client reçoit une demande de correction, pas « commande enregistrée ✅ »                                                                   |

**Non couvert à ce jour**, par absence de modèle de données :

- commune et adresse ;
- quantité numérique et prix ;
- variantes (taille, couleur) ;
- rapprochement avec un catalogue produit.

Le prompt ne les demande pas, à l'exception de la quantité, qui est
facultative. Tant qu'aucun catalogue n'existe, **le prix n'est jamais tiré de
la sortie du modèle**. C'est une décision produit à prendre avant d'ajouter
ces champs.

## Concurrence

- Deux messages du même client traités en parallèle, avec `sheets_sent` lu en
  début de requête, produisaient **deux lignes dans le Sheet** et deux
  notifications admin. Correctif : prise atomique de `sheets_sent`, qui
  n'est plus jamais réécrit par l'upsert.
- La conversation est une colonne JSONB réécrite en entier à chaque message.
  En cas de concurrence, le dernier écrit gagne et un message peut manquer à
  l'historique. Risque connu, non corrigé : il faudrait une table de messages
  par conversation.

## Relance — `/api/ai-chatbot/relance`

Elle cible les sessions incomplètes, sans transfert humain, inactives depuis
2 h ou plus, et une seule fois par session. Correctifs sur
`p1-relance-sav-hardening` (voir whatsapp.md, chemin #5) :

- portée : le marchand ou le planificateur authentifié ;
- un envoi par tenant et par exécution ;
- plafond et journal ;
- instance du bon service.

**À noter (décision produit)** : les textes de relance sont en darija
**marocaine** (« dyalek », « bghiti »), alors que le prompt exige la darija
algérienne.

## SAV

Le prompt `sav` émet `{"reclamation","commande"}`. Sur `main`, ces deux clés
ne rendent jamais la session « complète » (seuil de 3 clés), si bien
qu'**aucune réclamation n'atteint le Sheet ni l'admin**. C'est corrigé sur
la branche d'extraction.

`/api/ai-chatbot/reclamations/resolve` gère trois résolutions : échange,
remboursement, résolu. Elle envoie un message au client depuis l'instance
SAV. Un double clic envoyait deux messages ; c'est corrigé par une prise
atomique sur `resolution IS NULL`.

## Facebook Messenger

`/api/ai-chatbot/webhook/facebook` reprend la même logique d'extraction,
avec les mêmes défauts : règle des 3 clés et `sheets_sent` non atomique. À
aligner **après** le merge de `p0-facebook-webhook-signature`, pour éviter un
conflit.
