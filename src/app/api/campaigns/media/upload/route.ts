// Upload d'un fichier media (image / vidéo / audio / PDF) pour une campagne.
// Le fichier est stocké dans Supabase Storage bucket « campaign-media » dans
// un dossier propre à l'utilisateur (user_id/...) pour l'isolation RLS.
// Renvoie l'URL publique du fichier pour qu'on puisse la stocker dans
// campaigns.media_url et l'envoyer via Evolution / Green API.

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

const BUCKET = 'campaign-media';
const MAX_SIZE = 16 * 1024 * 1024; // 16 MB — limite WhatsApp Media
const ALLOWED_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/mpeg', 'audio/ogg', 'audio/mp4',
  'application/pdf',
]);

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const formData = await req.formData().catch(() => null);
  if (!formData) return NextResponse.json({ error: 'Formulaire multipart invalide' }, { status: 400 });

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Aucun fichier fourni (champ « file » manquant)' }, { status: 400 });
  }

  // Validations
  if (file.size > MAX_SIZE) {
    return NextResponse.json({
      error: `Fichier trop volumineux : ${(file.size / 1024 / 1024).toFixed(1)} MB. Maximum ${MAX_SIZE / 1024 / 1024} MB.`,
      hint: 'WhatsApp refuse les médias au-delà de 16 MB. Compresse ta vidéo ou réduis la résolution.',
    }, { status: 413 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({
      error: `Type de fichier non supporté : ${file.type || 'inconnu'}`,
      hint: 'Formats acceptés : JPG, PNG, GIF, WEBP, MP4, WEBM, MOV, MP3, OGG, PDF.',
    }, { status: 415 });
  }

  // Construit un nom de fichier unique pour éviter les collisions et préserver
  // l'extension d'origine (utile pour l'inférence de type côté WhatsApp).
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5);
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const objectPath = `${user.id}/${stamp}-${rand}.${ext}`;

  // Upload via le service client (bypass RLS — on a déjà vérifié l'auth ci-dessus)
  const service = createServiceClient();
  const arrayBuffer = await file.arrayBuffer();
  const { error: upErr } = await service.storage
    .from(BUCKET)
    .upload(objectPath, arrayBuffer, {
      contentType: file.type,
      cacheControl: '3600',
      upsert: false,
    });

  if (upErr) {
    return NextResponse.json({ error: `Upload échoué : ${upErr.message}` }, { status: 500 });
  }

  // URL publique — le bucket est en read public donc cette URL est accessible
  // par Evolution / Green API qui devra la fetch pour attacher le media.
  const { data: pub } = service.storage.from(BUCKET).getPublicUrl(objectPath);

  return NextResponse.json({
    ok: true,
    url: pub.publicUrl,
    path: objectPath,
    type: file.type,
    size: file.size,
    name: file.name,
  });
}

// Suppression d'un fichier précédemment uploadé (utile si l'user change d'avis
// avant de créer la campagne, pour éviter d'accumuler des fichiers orphelins).
export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const url = new URL(req.url);
  const path = url.searchParams.get('path');
  if (!path) return NextResponse.json({ error: 'path manquant' }, { status: 400 });

  // Garde-fou : on n'autorise que la suppression dans le propre dossier de l'user
  if (!path.startsWith(`${user.id}/`)) {
    return NextResponse.json({ error: 'Interdit' }, { status: 403 });
  }

  const service = createServiceClient();
  const { error } = await service.storage.from(BUCKET).remove([path]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
