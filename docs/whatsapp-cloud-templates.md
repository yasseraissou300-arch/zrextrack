# WhatsApp officiel (Meta Cloud API) — mise en route

Phase 1 : le numéro officiel sert **la boutique du propriétaire** (comptes listés
dans `WHATSAPP_CLOUD_TENANTS`). Les autres marchands restent sur leur numéro
(Evolution) jusqu'à la phase 2 (numéro partagé + facturation au message).

Code : `src/lib/whatsapp/cloud.ts`, webhook `src/app/api/whatsapp/cloud/webhook/route.ts`.

---

## 1. Côté Meta (à faire par le propriétaire)

1. **developers.facebook.com** → _Créer une app_ → type **Business** → ajouter le
   produit **WhatsApp**.
2. **Numéro** : WhatsApp → _Configuration de l'API_ → _Ajouter un numéro_.
   Le numéro ne doit plus être actif dans l'application WhatsApp du téléphone
   (WhatsApp → Paramètres → Compte → _Supprimer mon compte_), puis
   vérification par SMS / appel.
3. **Moyen de paiement** : WhatsApp Manager → _Paramètres de paiement_ (carte
   internationale). Meta facture chaque message « utility » (~0,004 $ en Algérie
   à vérifier sur la grille officielle).
4. **Jeton permanent** : Paramètres de l'entreprise → _Utilisateurs système_ →
   créer un utilisateur système (Admin) → lui donner l'app et le compte
   WhatsApp → _Générer un jeton_ avec `whatsapp_business_messaging` et
   `whatsapp_business_management`.
5. **Les 6 modèles ci-dessous** : WhatsApp Manager → _Modèles de messages_ →
   _Créer_ → catégorie **Utilitaire**, langue **Arabe (ar)**. Les noms doivent
   être EXACTEMENT ceux indiqués. Attendre l'approbation (quelques minutes à
   24 h).

## 2. Vercel (Settings → Environment Variables → Production)

| Variable                      | Valeur                                                           |
| ----------------------------- | ---------------------------------------------------------------- |
| `WHATSAPP_CLOUD_TOKEN`        | jeton permanent (étape 4)                                        |
| `WHATSAPP_CLOUD_PHONE_ID`     | _Phone number ID_ (WhatsApp → Configuration de l'API)            |
| `WHATSAPP_CLOUD_APP_SECRET`   | App → Paramètres → Général → _Clé secrète_                       |
| `WHATSAPP_CLOUD_VERIFY_TOKEN` | un mot de passe que vous inventez (servira à l'étape 3)          |
| `WHATSAPP_CLOUD_TENANTS`      | l'identifiant de votre compte AutoTim (Mon compte → Identifiant) |
| `WHATSAPP_CLOUD_DAILY_LIMIT`  | facultatif, défaut 250 (limite Meta d'un compte non vérifié)     |

Puis **redéployer**.

## 3. Webhook (Meta → app → WhatsApp → Configuration)

- URL de rappel : `https://autotim.vercel.app/api/whatsapp/cloud/webhook`
- Jeton de vérification : la valeur de `WHATSAPP_CLOUD_VERIFY_TOKEN`
- _Gérer_ → s'abonner au champ **messages**

---

## Modèles (catégorie Utilitaire, langue ar)

Les `{{n}}` sont remplis par AutoTim. Les boutons sont des **réponses rapides**
dans l'ordre indiqué (AutoTim lit le 1er bouton comme « 1 », le 2e comme « 2 »…).

### `autotim_confirmation`

```
السلام عليكم {{1}} 👋
وصلتنا طلبيتك :
• المنتوج : {{2}}
• الثمن : {{3}} دج (الدفع عند الاستلام)
• التوصيل : {{4}} — {{5}}
تأكّد الطلبية باش نبعثوهالك ؟
```

Boutons : `نأكّد ✅` · `نلغي ❌`

Exemple pour Meta : أمين · Veste EMY · 3 200 · للدار · Oran

### `autotim_en_transit`

```
السلام عليكم {{1}} 👋
طلبيتك {{2}} راهي في الطريق.
رقم التتبع : {{3}}
التوصيل : {{4}}
شكراً على ثقتك 🚚
```

Pas de bouton.

### `autotim_en_livraison`

```
السلام عليكم {{1}} 👋
الموزع في الطريق ليك اليوم بطلبيتك {{2}}.
حضّر {{3}} دج — التوصيل : {{4}}
واش راك متاح اليوم ؟
```

Boutons : `راني متاح ✅` · `أجّل لغدوة 📅` · `نبدّل العنوان 📍`

### `autotim_livre`

```
السلام عليكم {{1}} 👋
تسلّمت طلبيتك {{2}}، يعطيك الصحة على ثقتك 🙏
واش رايك في المنتوج ؟
```

Boutons : `ممتاز ⭐` · `مقبول 👌` · `ماعجبنيش 👎`

### `autotim_echec`

```
السلام عليكم {{1}} 👋
حاولنا نوصّلولك طلبيتك (رقم {{2}}) وما قدرناش نتلاقاو.
تواصل معانا باش نعاودو التوصيل.
```

Pas de bouton.

### `autotim_retourne`

```
السلام عليكم {{1}} 👋
طلبيتك (رقم {{2}}) رجعت لينا.
إذا حبيت تعاود تطلب، راحنا هنا.
```

Pas de bouton.

---

## Comportement

- Aucun envoi automatique de **21:00 à 08:00** (heure d'Alger) : les messages
  partent le matin. Le bouton « Demander la confirmation » reste possible.
- Réponses (boutons ou « 1 / 2 / 3 ») : traitées par le webhook, accusé envoyé
  en texte libre (autorisé dans les 24 h qui suivent le message du client).
- Les campagnes et le chatbot restent sur le numéro Evolution.
