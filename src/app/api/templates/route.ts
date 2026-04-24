import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

const DEFAULT_TEMPLATES = [
  {
    key: 'en_transit',
    name: 'En transit',
    content_darija: 'السلام عليكم {{client}} 👋\nطردك رقم *{{tracking}}* في الطريق لـ *{{wilaya}}*.\nغادي يوصلك قريب انشاء الله 🚚',
    content_arabic: 'السلام عليكم {{client}} 👋\nطلبك رقم *{{tracking}}* في طريقه إليك.\nسيصل قريباً إن شاء الله 🚚',
    content_french: 'Bonjour {{client}} 👋\nVotre colis *{{tracking}}* est en route vers *{{wilaya}}*.\nIl arrivera bientôt 🚚',
  },
  {
    key: 'en_livraison',
    name: 'En cours de livraison',
    content_darija: 'السلام عليكم {{client}} 👋\nطردك رقم *{{tracking}}* مع الليفروار دروك في *{{wilaya}}*.\nالمبلغ لي يتسلم: *{{cod}} دج*\nكون في الدار ويصلك 🛵',
    content_arabic: 'السلام عليكم {{client}} 👋\nطلبك رقم *{{tracking}}* مع المندوب الآن في *{{wilaya}}*.\nالمبلغ المطلوب: *{{cod}} دج*\nكن في المنزل 🛵',
    content_french: 'Bonjour {{client}} 👋\nVotre colis *{{tracking}}* est en cours de livraison à *{{wilaya}}*.\nMontant à payer: *{{cod}} DA*\nSoyez disponible 🛵',
  },
  {
    key: 'livre',
    name: 'Livré',
    content_darija: 'السلام عليكم {{client}} 👋\nطردك رقم *{{tracking}}* وصل.\nشكرا على ثقتك فينا وانشاء الله راك راضي 🙏',
    content_arabic: 'السلام عليكم {{client}} 👋\nطلبك رقم *{{tracking}}* تم توصيله.\nشكراً لثقتك بنا 🙏',
    content_french: 'Bonjour {{client}} 👋\nVotre colis *{{tracking}}* a été livré.\nMerci de votre confiance 🙏',
  },
  {
    key: 'echec',
    name: 'Échec de livraison',
    content_darija: 'السلام عليكم {{client}} 👋\nحاولنا نوصلو طردك *{{tracking}}* ولقيناك ما جاوبتناش.\nتواصل معنا باش نرتبو وقت آخر 📞',
    content_arabic: 'السلام عليكم {{client}} 👋\nحاولنا توصيل طلبك *{{tracking}}* ولم نتمكن من الوصول إليك.\nتواصل معنا لترتيب موعد آخر 📞',
    content_french: 'Bonjour {{client}} 👋\nNous avons tenté de livrer votre colis *{{tracking}}* mais nous ne vous avons pas trouvé.\nContactez-nous pour reprogrammer 📞',
  },
  {
    key: 'retourne',
    name: 'Retourné',
    content_darija: 'السلام عليكم {{client}} 👋\nطردك رقم *{{tracking}}* رجع لينا.\nإذا تبغي تعاود تطلب تواصل معنا 🔄',
    content_arabic: 'السلام عليكم {{client}} 👋\nطلبك رقم *{{tracking}}* تم إرجاعه.\nإذا أردت إعادة الطلب تواصل معنا 🔄',
    content_french: 'Bonjour {{client}} 👋\nVotre colis *{{tracking}}* nous a été retourné.\nContactez-nous si vous souhaitez repasser commande 🔄',
  },
];

export async function GET() {
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const supabase = createServiceClient();
  const { data } = await supabase
    .from('message_templates')
    .select('*')
    .eq('user_id', user.id)
    .order('key');

  // Merge defaults with user overrides
  const userMap = new Map((data || []).map(t => [t.key, t]));
  const merged = DEFAULT_TEMPLATES.map(def => userMap.get(def.key) ?? { ...def, user_id: user.id, id: null, is_active: true });
  return NextResponse.json({ data: merged, defaults: DEFAULT_TEMPLATES });
}

export async function POST(request: NextRequest) {
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const body = await request.json();
  const { key, name, content_darija, content_arabic, content_french, is_active } = body;
  if (!key || !name) return NextResponse.json({ error: 'key et name requis' }, { status: 400 });

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('message_templates')
    .upsert(
      { user_id: user.id, key, name, content_darija, content_arabic, content_french, is_active, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,key' }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
