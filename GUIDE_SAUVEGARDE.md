# 💾 Sauvegardes de la base de données — mode d'emploi

Le plan gratuit Supabase ne fait **aucune sauvegarde**. Ce projet a donc une
sauvegarde automatique **chaque dimanche** via GitHub Actions
(`.github/workflows/db-backup.yml`). Les archives sont **chiffrées (AES-256)**
et conservées **90 jours**.

---

## ⚙️ Configuration initiale (à faire UNE fois)

### 1. Récupérer l'URL de connexion à la base

1. Ouvrir [le dashboard Supabase](https://supabase.com/dashboard/project/hhqgnzlwgtuxcmpkouen)
2. Cliquer le bouton **« Connect »** (en haut)
3. Choisir **« Session pooler »** et copier l'URI, qui ressemble à :
   ```
   postgresql://postgres.hhqgnzlwgtuxcmpkouen:[YOUR-PASSWORD]@aws-0-eu-west-1.pooler.supabase.com:5432/postgres
   ```
4. Remplacer `[YOUR-PASSWORD]` par le **mot de passe de la base**.
   Mot de passe oublié ? → Settings → Database → **Reset database password**
   (⚠️ choisir un mot de passe SANS caractères spéciaux comme @ : / pour
   éviter les problèmes d'URL)

### 2. Ajouter les 2 secrets sur GitHub

1. Aller sur https://github.com/yasseraissou300-arch/zrextrack/settings/secrets/actions
2. **New repository secret** :
   - Nom : `SUPABASE_DB_URL` → Valeur : l'URI complète de l'étape 1
3. **New repository secret** (encore) :
   - Nom : `BACKUP_PASSPHRASE` → Valeur : un mot de passe fort de votre choix
   - ⚠️ **NOTEZ-LE quelque part de sûr** : sans lui, les sauvegardes sont
     irrécupérables.

### 3. Tester

1. Onglet **Actions** du repo → workflow **« Sauvegarde base de données »**
2. **Run workflow** → attendre ~2 min → vert ✅
3. Cliquer sur l'exécution → en bas, section **Artifacts** →
   `sauvegarde-supabase-N` est téléchargeable. C'est votre sauvegarde !

---

## 🆘 RESTAURATION (en cas de catastrophe)

### Étape 1 — Récupérer la sauvegarde

1. GitHub → **Actions** → dernière exécution verte de « Sauvegarde base de données »
2. Section **Artifacts** → télécharger → dézipper → vous obtenez
   `backup_AAAA-MM-JJ_HHMM.dump.gpg`

### Étape 2 — Déchiffrer

Sur un PC avec [Gpg4win](https://gpg4win.org) (Windows) ou gpg (Linux/Mac) :

```bash
gpg --batch --yes --passphrase "VOTRE_BACKUP_PASSPHRASE" \
    --decrypt backup_2026-06-07_0200.dump.gpg > backup.dump
```

### Étape 3 — Restaurer dans Supabase

Avec le client PostgreSQL installé ([téléchargement](https://www.postgresql.org/download/)) :

```bash
pg_restore --clean --if-exists --no-owner --no-privileges \
    --dbname "postgresql://postgres.hhqgnzlwgtuxcmpkouen:MOTDEPASSE@aws-0-eu-west-1.pooler.supabase.com:5432/postgres" \
    backup.dump
```

> `--clean --if-exists` remplace les tables existantes par celles de la
> sauvegarde. À utiliser sur un projet vide ou réellement corrompu.

### Étape 4 — Vérifier

```sql
SELECT count(*) FROM orders;  -- doit afficher vos commandes
```

---

## ❓ FAQ

- **Ça coûte quelque chose ?** Non. GitHub Actions est gratuit (2 000 min/mois,
  la sauvegarde en prend ~2), les artefacts aussi.
- **Quelqu'un peut voler mes données via le repo public ?** Non : l'archive
  est chiffrée AES-256. Sans la passphrase, elle est illisible.
- **Le workflow s'arrête tout seul ?** GitHub désactive les crons après 60
  jours sans aucun commit sur le repo. Un commit de temps en temps suffit
  (ou relancer manuellement depuis l'onglet Actions).
