# Campagnes WhatsApp

## Lancement — `POST /api/campaigns/[id]/send`

La route enfile le travail, elle n'envoie rien elle-même. Depuis la Phase 1,
elle ne boucle plus avec `sleep()` dans la requête, ce qui la faisait tuer
au bout de 60 s.

1. Lecture de la campagne, scopée au tenant.
2. L'instance `auto_confirmation` doit être connectée (`connectionState =
open`). Sinon, réponse 503.
3. Information sur le plafond : envois des dernières 24 h, warm-up. Le
   plafond est **revérifié à chaque envoi**.
4. Passage à `en_cours`, puis job `campaign.dispatch` avec `{ campaign_id,
offset: 0 }`.

## Dispatch — handler `campaign.dispatch`

- Une campagne `termine` ou `annule` s'arrête proprement.
- L'audience se lit par lots de 25, de deux façons :
  - liste personnalisée `audience_phones`, enrichie depuis `orders` ;
  - filtre `delivery_status` sur `orders`, avec pagination par offset triée
    sur `created_at`.
- Chaque destinataire devient un job `whatsapp.send`. La clé est
  `camp:<campagne>:<téléphone brut>` et `run_after` s'incrémente de 20 à 60 s.
- Le lot suivant se ré-enfile avec la clé `campdisp:<campagne>:<offset>`.
- Une audience vide passe la campagne à `termine`.

## Points d'attention

- **Renvoyer** : le bouton existe pour une campagne terminée. Sur `main`, la
  clé `campdisp:<id>:0` est déjà prise (index unique non partiel), donc le
  job n'est pas créé et la campagne reste « en cours » pour toujours.
  Correctif `p1-campaign-relaunch` : un identifiant de lancement dans la
  clé de dispatch, tandis que les clés destinataires restent inchangées. Un
  renvoi ne contacte donc **que les clients qui n'ont pas encore reçu** la
  campagne.
  **Décision produit ouverte** : un « renvoyer à tous » recontacterait des
  clients déjà servis, avec un risque anti-spam.
- **Téléphone non normalisé dans la clé** : « 0550… » et « +213550… »
  désignent la même personne mais donnent deux clés. Un client enregistré
  sous deux formats dans `orders` recevrait la campagne deux fois. À vérifier
  sur les données réelles après le gel (requête de doublons normalisés), puis
  normaliser la clé.
- **Pagination par offset sur un filtre mouvant** : si une commande change de
  statut entre deux lots, un destinataire peut être **sauté**. Il ne peut pas
  être doublé grâce à la clé destinataire.
- **Débit** : sur `p1-queue-send-spacing`, environ 1 envoi par tenant et par
  tick de 5 min, dans la limite du plafond journalier.
