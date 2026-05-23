-- ============================================================================
-- Bucket de stockage des médias de campagnes (photos / vidéos uploadées par
-- l'utilisateur depuis la création de campagne).
--
-- Le bucket est PUBLIC en lecture : sinon WhatsApp / Evolution ne pourrait
-- pas récupérer les fichiers pour les attacher aux messages.
-- L'upload est restreint aux utilisateurs authentifiés, dans leur propre
-- dossier (préfixé par leur user_id).
--
-- À exécuter dans Supabase → SQL Editor.
-- ============================================================================

-- Création du bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'campaign-media',
  'campaign-media',
  true,                                            -- public en lecture
  16 * 1024 * 1024,                                -- 16 MB max (WhatsApp Media limit)
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/webm', 'video/quicktime',
    'audio/mpeg', 'audio/ogg', 'audio/mp4',
    'application/pdf'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Policy : lecture publique (anyone, le bucket est public anyway)
DROP POLICY IF EXISTS "campaign_media_public_read" ON storage.objects;
CREATE POLICY "campaign_media_public_read" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'campaign-media');

-- Policy : upload uniquement par les users authentifiés, dans leur dossier
-- (le path doit commencer par leur user_id, ex « user-id-uuid/abc.jpg »)
DROP POLICY IF EXISTS "campaign_media_user_upload" ON storage.objects;
CREATE POLICY "campaign_media_user_upload" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'campaign-media'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Policy : suppression par le user propriétaire seulement
DROP POLICY IF EXISTS "campaign_media_user_delete" ON storage.objects;
CREATE POLICY "campaign_media_user_delete" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'campaign-media'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
