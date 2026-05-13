/**
 * Hanuja Marketplace — Seed Data
 *
 * Gerçekçi Türkçe içerik ile başlangıç verisi.
 * Çalıştırma: pnpm db:seed
 *
 * Oluşturulan kayıtlar:
 *  - 1 admin kullanıcı
 *  - 2 müşteri kullanıcı
 *  - 2 satıcı (onaylı) + profil + banka bilgisi
 *  - Kategori ağacı (7 ana + 14 alt kategori)
 *  - 12 ürün (farklı satıcılar, kategoriler, durumlar)
 *  - 2 sipariş (farklı lifecycle aşamaları)
 *  - Ledger girdileri
 *  - 2 blog yazısı
 */

import { PrismaClient, UserRole, SellerStatus, ProductStatus, OrderStatus, PaymentMethod, PaymentStatus, ShipmentStatus, PayoutStatus, LedgerEntryType, PenaltyReason, BlogPostStatus } from '@prisma/client'
import { createAuth } from '../../api/lib/auth'
import { seedAttributeOptions } from './attribute-options'

const prisma = new PrismaClient()

async function ensureUser(params: {
  id: string
  email: string
  name: string
  role: UserRole
}) {
  const existing = await prisma.user.findFirst({
    where: {
      OR: [
        { id: params.id },
        { email: params.email },
      ],
    },
  })

  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data: {
        email: params.email,
        name: params.name,
        emailVerified: true,
        role: params.role,
      },
    })
  }

  return prisma.user.create({
    data: {
      id: params.id,
      email: params.email,
      name: params.name,
      emailVerified: true,
      role: params.role,
    },
  })
}

async function main() {
  console.log('🌱 Seed başlıyor...')

  // ─────────────────────────────────────────────────
  // KULLANICILAR
  // ─────────────────────────────────────────────────

  const adminUser = await ensureUser({
    id: 'user_admin_01',
    email: 'admin@hanuja.com.tr',
    name: 'Hanuja Admin',
    role: UserRole.admin,
  })

  const auth = createAuth({
    baseURL: 'http://localhost:3002',
    secret: process.env.BETTER_AUTH_SECRET ?? 'change-me-in-production',
    prisma,
    trustedOrigins: ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002'],
  })

  const adminResetToken = 'seed-admin-reset-token-20260420'
  await prisma.verification.deleteMany({
    where: { identifier: `reset-password:${adminResetToken}` },
  })
  await prisma.verification.create({
    data: {
      identifier: `reset-password:${adminResetToken}`,
      value: adminUser.id,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    },
  })
  await auth.api.resetPassword({
    body: {
      token: adminResetToken,
      newPassword: 'Admin1234!',
    },
  })

  const customerAyse = await ensureUser({
    id: 'user_customer_01',
    email: 'ayse.kaya@example.com',
    name: 'Ayşe Kaya',
    role: UserRole.customer,
  })

  const customerMehmet = await ensureUser({
    id: 'user_customer_02',
    email: 'mehmet.demir@example.com',
    name: 'Mehmet Demir',
    role: UserRole.customer,
  })

  const sellerUserAtelier = await ensureUser({
    id: 'user_seller_01',
    email: 'satici@atelyenoa.com',
    name: 'Noa Atölye',
    role: UserRole.seller,
  })

  const sellerUserWoodform = await ensureUser({
    id: 'user_seller_02',
    email: 'satici@woodform.com',
    name: 'Woodform Design',
    role: UserRole.seller,
  })

  console.log('✅ Kullanıcılar oluşturuldu')

  // ─────────────────────────────────────────────────
  // ADRESLER
  // ─────────────────────────────────────────────────

  const addressAyse = await prisma.address.upsert({
    where: { id: 'addr_ayse_01' },
    update: {},
    create: {
      id: 'addr_ayse_01',
      userId: customerAyse.id,
      label: 'Ev',
      fullName: 'Ayşe Kaya',
      phone: '05301234567',
      addressLine1: 'Bağcılar Mahallesi, Gül Sokak No:12 Kat:3 D:7',
      district: 'Kadıköy',
      city: 'İstanbul',
      postalCode: '34710',
      isDefault: true,
    },
  })

  await prisma.address.upsert({
    where: { id: 'addr_mehmet_01' },
    update: {},
    create: {
      id: 'addr_mehmet_01',
      userId: customerMehmet.id,
      label: 'Ev',
      fullName: 'Mehmet Demir',
      phone: '05329876543',
      addressLine1: 'Kızılay Mahallesi, Atatürk Bulvarı No:45 Daire:2',
      district: 'Çankaya',
      city: 'Ankara',
      postalCode: '06430',
      isDefault: true,
    },
  })

  console.log('✅ Adresler oluşturuldu')

  // ─────────────────────────────────────────────────
  // SATICILAR
  // ─────────────────────────────────────────────────

  const sellerAtelier = await prisma.seller.upsert({
    where: { userId: sellerUserAtelier.id },
    update: {},
    create: {
      id: 'seller_atelier_01',
      userId: sellerUserAtelier.id,
      slug: 'atelier-noa',
      displayName: 'Atelier Noa',
      status: SellerStatus.active,
      profile: {
        create: {
          bio: 'El yapımı, doğal malzemelerle üretilmiş ev dekor ürünleri. İstanbul\'da küçük bir atölyeden dünyaya.',
          story: 'Noa Atölye, 2018 yılında İstanbul\'da kurulmuş bir el sanatları markasıdır. Rattan, ahşap ve doğal tekstil malzemelerini bir araya getirerek hem işlevsel hem estetik ürünler tasarlıyoruz.',
          companyName: 'Noa Tasarım San. ve Tic. Ltd. Şti.',
          city: 'İstanbul',
          district: 'Kadıköy',
          postalCode: '34710',
          legalAddress: 'Caferağa Mah. Moda Cad. No:48 Kat:2',
          phone: '02121234567',
          taxOffice: 'Kadıköy',
          taxNumber: '1234567890',
          mersis: '0123-4567-8900-0001',
          isVerified: true,
          verifiedAt: new Date('2024-01-15'),
        },
      },
    },
  })

  const sellerWoodform = await prisma.seller.upsert({
    where: { userId: sellerUserWoodform.id },
    update: {},
    create: {
      id: 'seller_woodform_01',
      userId: sellerUserWoodform.id,
      slug: 'woodform-design',
      displayName: 'Woodform Design',
      status: SellerStatus.active,
      profile: {
        create: {
          bio: 'Masif ahşap mobilya ve ev aksesuarları. Kalıcı tasarımlar, sağlam işçilik.',
          story: 'Woodform Design, Bursa\'da marangozluk geçmişine sahip bir ailenin kurduğu modern mobilya markasıdır. Meşe, ceviz ve gürgen ağaçlarından sürdürülebilir üretim yapıyoruz.',
          companyName: 'Woodform Mobilya A.Ş.',
          city: 'Bursa',
          district: 'Nilüfer',
          postalCode: '16140',
          legalAddress: 'Nilüfer OSB Mah. Ahşapçılar Cad. No:8',
          phone: '02241234567',
          taxOffice: 'Ertuğrul',
          taxNumber: '9876543210',
          mersis: '0987-6543-2100-0001',
          isVerified: true,
          verifiedAt: new Date('2024-02-10'),
        },
      },
    },
  })

  // Banka bilgileri
  await prisma.sellerBankDetail.upsert({
    where: { id: 'bank_atelier_01' },
    update: {},
    create: {
      id: 'bank_atelier_01',
      sellerId: sellerAtelier.id,
      iban: 'TR330006100519786457841326', // Test IBAN — üretimde şifreli saklanır
      accountHolder: 'Noa Tasarım San. ve Tic. Ltd. Şti.',
      bankName: 'Garanti BBVA',
      isActive: true,
      isVerified: true,
      verifiedAt: new Date('2024-01-20'),
      activatedAt: new Date('2024-01-20'),
    },
  })

  await prisma.sellerBankDetail.upsert({
    where: { id: 'bank_woodform_01' },
    update: {},
    create: {
      id: 'bank_woodform_01',
      sellerId: sellerWoodform.id,
      iban: 'TR320001200926795955885692', // Test IBAN
      accountHolder: 'Woodform Mobilya A.Ş.',
      bankName: 'İş Bankası',
      isActive: true,
      isVerified: true,
      verifiedAt: new Date('2024-02-15'),
      activatedAt: new Date('2024-02-15'),
    },
  })

  console.log('✅ Satıcılar oluşturuldu')

  // ─────────────────────────────────────────────────
  // KATEGORİLER — PRE-LAUNCH TEMİZLİK + YENİ HİYERARŞİ
  // EV + OFİS ana dalı, 10 orta dal, ~70 yaprak kategori
  // ─────────────────────────────────────────────────

  // Pre-launch temizlik — FK bağımlılık sırasına göre
  await prisma.payout.deleteMany()
  await prisma.sellerLedgerEntry.deleteMany()
  await prisma.orderStatusHistory.deleteMany()
  await prisma.shipment.deleteMany()
  await prisma.payment.deleteMany()
  await prisma.orderLine.deleteMany()
  await prisma.order.deleteMany()
  await prisma.productVariant.deleteMany()
  await prisma.productImage.deleteMany()
  await prisma.product.deleteMany()
  await prisma.category.deleteMany()

  console.log('🗑️  Eski ürünler ve kategoriler temizlendi')

  // ── KÖK KATEGORİLER ─────────────────────────────

  const catEv = await prisma.category.upsert({
    where: { slug: 'ev' },
    update: {},
    create: {
      slug: 'ev',
      name: 'Ev',
      description: 'Ev ürünleri — mobilya, dekorasyon, tekstil, aydınlatma ve daha fazlası.',
      sortOrder: 1,
    },
  })

  const catOfis = await prisma.category.upsert({
    where: { slug: 'ofis' },
    update: {},
    create: {
      slug: 'ofis',
      name: 'Ofis',
      description: 'Ofis ve çalışma alanı ürünleri — mobilya, aksesuar, aydınlatma.',
      sortOrder: 2,
    },
  })

  // ── EV — ORTA DAL KATEGORİLER ───────────────────

  const catEvMobilya = await prisma.category.upsert({
    where: { slug: 'ev-mobilya' },
    update: {},
    create: {
      slug: 'ev-mobilya',
      name: 'Mobilya',
      parentId: catEv.id,
      description: 'Koltuk, berjer, sehpa, masa, dolap ve tüm ev mobilyaları.',
      sortOrder: 1,
    },
  })

  const catEvAydinlatma = await prisma.category.upsert({
    where: { slug: 'ev-aydinlatma' },
    update: {},
    create: {
      slug: 'ev-aydinlatma',
      name: 'Aydınlatma',
      parentId: catEv.id,
      description: 'Yer lambası, sarkıt, masa lambası, duvar ve dekoratif aydınlatmalar.',
      sortOrder: 2,
    },
  })

  const catEvBakim = await prisma.category.upsert({
    where: { slug: 'ev-bakim' },
    update: {},
    create: {
      slug: 'ev-bakim',
      name: 'Ev Bakımı',
      parentId: catEv.id,
      description: 'Oda kokusu, uçucu yağ, tütsü ve temizlik ürünleri.',
      sortOrder: 3,
    },
  })

  const catEvAksesuar = await prisma.category.upsert({
    where: { slug: 'ev-aksesuar' },
    update: {},
    create: {
      slug: 'ev-aksesuar',
      name: 'Ev Aksesuarları',
      parentId: catEv.id,
      description: 'Saklama, düzenleme, banyo ve duvar aksesuarları.',
      sortOrder: 4,
    },
  })

  const catEvMutfak = await prisma.category.upsert({
    where: { slug: 'ev-mutfak' },
    update: {},
    create: {
      slug: 'ev-mutfak',
      name: 'Mutfak & Sofra',
      parentId: catEv.id,
      description: 'Bardak, tabak, sofra takımı, pişirme ve sofra tekstili.',
      sortOrder: 5,
    },
  })

  const catEvDekorasyon = await prisma.category.upsert({
    where: { slug: 'ev-dekorasyon' },
    update: {},
    create: {
      slug: 'ev-dekorasyon',
      name: 'Ev Dekorasyon',
      parentId: catEv.id,
      description: 'Ayna, çerçeve, vazo, saat, dekoratif obje ve mum.',
      sortOrder: 6,
    },
  })

  const catEvTekstil = await prisma.category.upsert({
    where: { slug: 'ev-tekstil' },
    update: {},
    create: {
      slug: 'ev-tekstil',
      name: 'Ev Tekstili',
      parentId: catEv.id,
      description: 'Yastık, halı, paspas, havlu, battaniye ve nevresim.',
      sortOrder: 7,
    },
  })

  // ── OFİS — ORTA DAL KATEGORİLER ─────────────────

  const catOfisMobilya = await prisma.category.upsert({
    where: { slug: 'ofis-mobilya' },
    update: {},
    create: {
      slug: 'ofis-mobilya',
      name: 'Mobilya',
      parentId: catOfis.id,
      description: 'Çalışma masası, koltuk, sandalye, puf ve depolama.',
      sortOrder: 1,
    },
  })

  const catOfisAksesuar = await prisma.category.upsert({
    where: { slug: 'ofis-aksesuar' },
    update: {},
    create: {
      slug: 'ofis-aksesuar',
      name: 'Aksesuar',
      parentId: catOfis.id,
      description: 'Masaüstü aksesuarları, düzenleme ve ofis saatleri.',
      sortOrder: 2,
    },
  })

  const catOfisAydinlatma = await prisma.category.upsert({
    where: { slug: 'ofis-aydinlatma' },
    update: {},
    create: {
      slug: 'ofis-aydinlatma',
      name: 'Aydınlatma',
      parentId: catOfis.id,
      description: 'Masa lambası, yer aydınlatması ve tavan aydınlatması.',
      sortOrder: 3,
    },
  })

  // ── EV MOBİLYA — YAPRAK KATEGORİLER ────────────

  await prisma.category.upsert({ where: { slug: 'ev-mobilya-koltuk-kanepe' }, update: {}, create: { slug: 'ev-mobilya-koltuk-kanepe', name: 'Koltuk & Kanepe', parentId: catEvMobilya.id, sortOrder: 1 } })
  await prisma.category.upsert({ where: { slug: 'ev-mobilya-berjer' }, update: {}, create: { slug: 'ev-mobilya-berjer', name: 'Berjer', parentId: catEvMobilya.id, sortOrder: 2 } })
  await prisma.category.upsert({ where: { slug: 'ev-mobilya-sandalye-tabure' }, update: {}, create: { slug: 'ev-mobilya-sandalye-tabure', name: 'Sandalye & Tabure', parentId: catEvMobilya.id, sortOrder: 3 } })
  const catLeafDresuarKonsol = await prisma.category.upsert({ where: { slug: 'ev-mobilya-dresuar-konsol' }, update: {}, create: { slug: 'ev-mobilya-dresuar-konsol', name: 'Dresuar & Konsol', parentId: catEvMobilya.id, sortOrder: 4 } })
  await prisma.category.upsert({ where: { slug: 'ev-mobilya-vitrin-bufe' }, update: {}, create: { slug: 'ev-mobilya-vitrin-bufe', name: 'Vitrin & Büfe', parentId: catEvMobilya.id, sortOrder: 5 } })
  await prisma.category.upsert({ where: { slug: 'ev-mobilya-dolap' }, update: {}, create: { slug: 'ev-mobilya-dolap', name: 'Dolap', parentId: catEvMobilya.id, sortOrder: 6 } })
  await prisma.category.upsert({ where: { slug: 'ev-mobilya-bank' }, update: {}, create: { slug: 'ev-mobilya-bank', name: 'Bank', parentId: catEvMobilya.id, sortOrder: 7 } })
  await prisma.category.upsert({ where: { slug: 'ev-mobilya-yatak-karyola' }, update: {}, create: { slug: 'ev-mobilya-yatak-karyola', name: 'Yatak & Karyola', parentId: catEvMobilya.id, sortOrder: 8 } })
  await prisma.category.upsert({ where: { slug: 'ev-mobilya-sifonyer-komodin' }, update: {}, create: { slug: 'ev-mobilya-sifonyer-komodin', name: 'Şifonyer & Komodin', parentId: catEvMobilya.id, sortOrder: 9 } })
  await prisma.category.upsert({ where: { slug: 'ev-mobilya-puf' }, update: {}, create: { slug: 'ev-mobilya-puf', name: 'Puf', parentId: catEvMobilya.id, sortOrder: 10 } })
  const catLeafSehpaModelleri = await prisma.category.upsert({ where: { slug: 'ev-mobilya-sehpa-modelleri' }, update: {}, create: { slug: 'ev-mobilya-sehpa-modelleri', name: 'Sehpa Modelleri', parentId: catEvMobilya.id, sortOrder: 11 } })
  await prisma.category.upsert({ where: { slug: 'ev-mobilya-masa' }, update: {}, create: { slug: 'ev-mobilya-masa', name: 'Masa', parentId: catEvMobilya.id, sortOrder: 12 } })
  await prisma.category.upsert({ where: { slug: 'ev-mobilya-asillik' }, update: {}, create: { slug: 'ev-mobilya-asillik', name: 'Askılık', parentId: catEvMobilya.id, sortOrder: 13 } })
  const catLeafBahceMobilya = await prisma.category.upsert({ where: { slug: 'ev-mobilya-bahce-mobilyasi' }, update: {}, create: { slug: 'ev-mobilya-bahce-mobilyasi', name: 'Bahçe Mobilyaları', parentId: catEvMobilya.id, sortOrder: 14 } })
  const catLeafKitaplik = await prisma.category.upsert({ where: { slug: 'ev-mobilya-kitaplik' }, update: {}, create: { slug: 'ev-mobilya-kitaplik', name: 'Kitaplık', parentId: catEvMobilya.id, sortOrder: 15 } })

  // ── EV AYDINLATMA — YAPRAK KATEGORİLER ─────────

  await prisma.category.upsert({ where: { slug: 'ev-aydinlatma-yer' }, update: {}, create: { slug: 'ev-aydinlatma-yer', name: 'Yer Lambası', parentId: catEvAydinlatma.id, sortOrder: 1 } })
  const catLeafTavanSarkit = await prisma.category.upsert({ where: { slug: 'ev-aydinlatma-tavan-sarkit' }, update: {}, create: { slug: 'ev-aydinlatma-tavan-sarkit', name: 'Tavan & Sarkıt', parentId: catEvAydinlatma.id, sortOrder: 2 } })
  await prisma.category.upsert({ where: { slug: 'ev-aydinlatma-masa-lambasi' }, update: {}, create: { slug: 'ev-aydinlatma-masa-lambasi', name: 'Masa Lambaları', parentId: catEvAydinlatma.id, sortOrder: 3 } })
  await prisma.category.upsert({ where: { slug: 'ev-aydinlatma-dekoratif' }, update: {}, create: { slug: 'ev-aydinlatma-dekoratif', name: 'Dekoratif', parentId: catEvAydinlatma.id, sortOrder: 4 } })
  await prisma.category.upsert({ where: { slug: 'ev-aydinlatma-duvar' }, update: {}, create: { slug: 'ev-aydinlatma-duvar', name: 'Duvar', parentId: catEvAydinlatma.id, sortOrder: 5 } })
  await prisma.category.upsert({ where: { slug: 'ev-aydinlatma-abajur' }, update: {}, create: { slug: 'ev-aydinlatma-abajur', name: 'Abajur', parentId: catEvAydinlatma.id, sortOrder: 6 } })

  // ── EV BAKIM — YAPRAK KATEGORİLER ───────────────

  await prisma.category.upsert({ where: { slug: 'ev-bakim-oda-kokusu' }, update: {}, create: { slug: 'ev-bakim-oda-kokusu', name: 'Oda Kokuları', parentId: catEvBakim.id, sortOrder: 1 } })
  await prisma.category.upsert({ where: { slug: 'ev-bakim-ucucu-yag-buhurdanlik' }, update: {}, create: { slug: 'ev-bakim-ucucu-yag-buhurdanlik', name: 'Uçucu Yağ & Buhurdanlıklar', parentId: catEvBakim.id, sortOrder: 2 } })
  await prisma.category.upsert({ where: { slug: 'ev-bakim-tutsu' }, update: {}, create: { slug: 'ev-bakim-tutsu', name: 'Tütsü & Tütsülükler', parentId: catEvBakim.id, sortOrder: 3 } })
  await prisma.category.upsert({ where: { slug: 'ev-bakim-temizlik' }, update: {}, create: { slug: 'ev-bakim-temizlik', name: 'Temizlik Ürünleri', parentId: catEvBakim.id, sortOrder: 4 } })

  // ── EV AKSESUAR — YAPRAK KATEGORİLER ────────────

  await prisma.category.upsert({ where: { slug: 'ev-aksesuar-saklama-duzenleme' }, update: {}, create: { slug: 'ev-aksesuar-saklama-duzenleme', name: 'Saklama & Düzenleme', parentId: catEvAksesuar.id, sortOrder: 1 } })
  await prisma.category.upsert({ where: { slug: 'ev-aksesuar-duvar' }, update: {}, create: { slug: 'ev-aksesuar-duvar', name: 'Duvar Aksesuarları', parentId: catEvAksesuar.id, sortOrder: 2 } })
  await prisma.category.upsert({ where: { slug: 'ev-aksesuar-banyo' }, update: {}, create: { slug: 'ev-aksesuar-banyo', name: 'Banyo Aksesuarları', parentId: catEvAksesuar.id, sortOrder: 3 } })
  await prisma.category.upsert({ where: { slug: 'ev-aksesuar-duvar-askilar' }, update: {}, create: { slug: 'ev-aksesuar-duvar-askilar', name: 'Duvar Askıları', parentId: catEvAksesuar.id, sortOrder: 4 } })
  await prisma.category.upsert({ where: { slug: 'ev-aksesuar-tavan' }, update: {}, create: { slug: 'ev-aksesuar-tavan', name: 'Tavan Aksesuarları', parentId: catEvAksesuar.id, sortOrder: 5 } })

  // ── EV MUTFAK — YAPRAK KATEGORİLER ──────────────

  await prisma.category.upsert({ where: { slug: 'ev-mutfak-bardak-fincan-kupa' }, update: {}, create: { slug: 'ev-mutfak-bardak-fincan-kupa', name: 'Bardak & Fincan & Kupa', parentId: catEvMutfak.id, sortOrder: 1 } })
  await prisma.category.upsert({ where: { slug: 'ev-mutfak-sunum-aksesuar' }, update: {}, create: { slug: 'ev-mutfak-sunum-aksesuar', name: 'Sunum Aksesuarları', parentId: catEvMutfak.id, sortOrder: 2 } })
  const catLeafTabakKase = await prisma.category.upsert({ where: { slug: 'ev-mutfak-tabak-kase' }, update: {}, create: { slug: 'ev-mutfak-tabak-kase', name: 'Tabak & Kase', parentId: catEvMutfak.id, sortOrder: 3 } })
  await prisma.category.upsert({ where: { slug: 'ev-mutfak-pisirim-hazirlama' }, update: {}, create: { slug: 'ev-mutfak-pisirim-hazirlama', name: 'Pişirme & Hazırlama', parentId: catEvMutfak.id, sortOrder: 4 } })
  await prisma.category.upsert({ where: { slug: 'ev-mutfak-saklama-duzenleme' }, update: {}, create: { slug: 'ev-mutfak-saklama-duzenleme', name: 'Saklama & Düzenleme', parentId: catEvMutfak.id, sortOrder: 5 } })
  await prisma.category.upsert({ where: { slug: 'ev-mutfak-sofra-tekstili' }, update: {}, create: { slug: 'ev-mutfak-sofra-tekstili', name: 'Sofra Tekstili', parentId: catEvMutfak.id, sortOrder: 6 } })
  await prisma.category.upsert({ where: { slug: 'ev-mutfak-catal-kasik-bicak' }, update: {}, create: { slug: 'ev-mutfak-catal-kasik-bicak', name: 'Çatal & Kaşık & Bıçak', parentId: catEvMutfak.id, sortOrder: 7 } })

  // ── EV DEKORASYON — YAPRAK KATEGORİLER ──────────

  await prisma.category.upsert({ where: { slug: 'ev-dekorasyon-ayna' }, update: {}, create: { slug: 'ev-dekorasyon-ayna', name: 'Ayna', parentId: catEvDekorasyon.id, sortOrder: 1 } })
  await prisma.category.upsert({ where: { slug: 'ev-dekorasyon-cerceve' }, update: {}, create: { slug: 'ev-dekorasyon-cerceve', name: 'Çerçeve', parentId: catEvDekorasyon.id, sortOrder: 2 } })
  const catLeafVazo = await prisma.category.upsert({ where: { slug: 'ev-dekorasyon-vazo' }, update: {}, create: { slug: 'ev-dekorasyon-vazo', name: 'Vazo', parentId: catEvDekorasyon.id, sortOrder: 3 } })
  await prisma.category.upsert({ where: { slug: 'ev-dekorasyon-saat' }, update: {}, create: { slug: 'ev-dekorasyon-saat', name: 'Saat', parentId: catEvDekorasyon.id, sortOrder: 4 } })
  await prisma.category.upsert({ where: { slug: 'ev-dekorasyon-dekoratif-obje' }, update: {}, create: { slug: 'ev-dekorasyon-dekoratif-obje', name: 'Dekoratif Obje', parentId: catEvDekorasyon.id, sortOrder: 5 } })
  await prisma.category.upsert({ where: { slug: 'ev-dekorasyon-saksi-bitki' }, update: {}, create: { slug: 'ev-dekorasyon-saksi-bitki', name: 'Saksı & Bitki', parentId: catEvDekorasyon.id, sortOrder: 6 } })
  await prisma.category.upsert({ where: { slug: 'ev-dekorasyon-kulplar' }, update: {}, create: { slug: 'ev-dekorasyon-kulplar', name: 'Kulplar', parentId: catEvDekorasyon.id, sortOrder: 7 } })
  const catLeafMumMumluk = await prisma.category.upsert({ where: { slug: 'ev-dekorasyon-mum-mumluk' }, update: {}, create: { slug: 'ev-dekorasyon-mum-mumluk', name: 'Mum & Mumluk', parentId: catEvDekorasyon.id, sortOrder: 8 } })
  await prisma.category.upsert({ where: { slug: 'ev-dekorasyon-somine-barbeku' }, update: {}, create: { slug: 'ev-dekorasyon-somine-barbeku', name: 'Şömine & Barbekü', parentId: catEvDekorasyon.id, sortOrder: 9 } })

  // ── EV TEKSTİL — YAPRAK KATEGORİLER ─────────────

  const catLeafYastik = await prisma.category.upsert({ where: { slug: 'ev-tekstil-yastik' }, update: {}, create: { slug: 'ev-tekstil-yastik', name: 'Yastık', parentId: catEvTekstil.id, sortOrder: 1 } })
  await prisma.category.upsert({ where: { slug: 'ev-tekstil-hali-kilim' }, update: {}, create: { slug: 'ev-tekstil-hali-kilim', name: 'Halı & Kilim', parentId: catEvTekstil.id, sortOrder: 2 } })
  await prisma.category.upsert({ where: { slug: 'ev-tekstil-paspas' }, update: {}, create: { slug: 'ev-tekstil-paspas', name: 'Paspas', parentId: catEvTekstil.id, sortOrder: 3 } })
  await prisma.category.upsert({ where: { slug: 'ev-tekstil-havlu-pestemal' }, update: {}, create: { slug: 'ev-tekstil-havlu-pestemal', name: 'Havlu & Peştemal', parentId: catEvTekstil.id, sortOrder: 4 } })
  await prisma.category.upsert({ where: { slug: 'ev-tekstil-bornoz' }, update: {}, create: { slug: 'ev-tekstil-bornoz', name: 'Bornoz', parentId: catEvTekstil.id, sortOrder: 5 } })
  await prisma.category.upsert({ where: { slug: 'ev-tekstil-yatak-koltuk-ortu' }, update: {}, create: { slug: 'ev-tekstil-yatak-koltuk-ortu', name: 'Yatak & Koltuk Örtüleri', parentId: catEvTekstil.id, sortOrder: 6 } })
  await prisma.category.upsert({ where: { slug: 'ev-tekstil-battaniye' }, update: {}, create: { slug: 'ev-tekstil-battaniye', name: 'Battaniye', parentId: catEvTekstil.id, sortOrder: 7 } })
  await prisma.category.upsert({ where: { slug: 'ev-tekstil-nevresim' }, update: {}, create: { slug: 'ev-tekstil-nevresim', name: 'Nevresim', parentId: catEvTekstil.id, sortOrder: 8 } })

  // ── OFİS MOBİLYA — YAPRAK KATEGORİLER ──────────

  await prisma.category.upsert({ where: { slug: 'ofis-mobilya-sehpa' }, update: {}, create: { slug: 'ofis-mobilya-sehpa', name: 'Sehpa', parentId: catOfisMobilya.id, sortOrder: 1 } })
  await prisma.category.upsert({ where: { slug: 'ofis-mobilya-koltuk-berjer' }, update: {}, create: { slug: 'ofis-mobilya-koltuk-berjer', name: 'Koltuk & Berjer', parentId: catOfisMobilya.id, sortOrder: 2 } })
  await prisma.category.upsert({ where: { slug: 'ofis-mobilya-sandalye' }, update: {}, create: { slug: 'ofis-mobilya-sandalye', name: 'Sandalye', parentId: catOfisMobilya.id, sortOrder: 3 } })
  await prisma.category.upsert({ where: { slug: 'ofis-mobilya-tabure-puf' }, update: {}, create: { slug: 'ofis-mobilya-tabure-puf', name: 'Tabure & Puf', parentId: catOfisMobilya.id, sortOrder: 4 } })
  await prisma.category.upsert({ where: { slug: 'ofis-mobilya-depolama' }, update: {}, create: { slug: 'ofis-mobilya-depolama', name: 'Depolama', parentId: catOfisMobilya.id, sortOrder: 5 } })
  const catLeafOfisCalismaMasasi = await prisma.category.upsert({ where: { slug: 'ofis-mobilya-calisma-masasi' }, update: {}, create: { slug: 'ofis-mobilya-calisma-masasi', name: 'Çalışma Masası', parentId: catOfisMobilya.id, sortOrder: 6 } })

  // ── OFİS AKSESUAR — YAPRAK KATEGORİLER ──────────

  await prisma.category.upsert({ where: { slug: 'ofis-aksesuar-masaustu' }, update: {}, create: { slug: 'ofis-aksesuar-masaustu', name: 'Masaüstü Aksesuarları', parentId: catOfisAksesuar.id, sortOrder: 1 } })
  await prisma.category.upsert({ where: { slug: 'ofis-aksesuar-duzenleme' }, update: {}, create: { slug: 'ofis-aksesuar-duzenleme', name: 'Düzenleme', parentId: catOfisAksesuar.id, sortOrder: 2 } })
  await prisma.category.upsert({ where: { slug: 'ofis-aksesuar-saat' }, update: {}, create: { slug: 'ofis-aksesuar-saat', name: 'Saat', parentId: catOfisAksesuar.id, sortOrder: 3 } })

  // ── OFİS AYDINLATMA — YAPRAK KATEGORİLER ────────

  await prisma.category.upsert({ where: { slug: 'ofis-aydinlatma-masa-lambasi' }, update: {}, create: { slug: 'ofis-aydinlatma-masa-lambasi', name: 'Masa Lambaları', parentId: catOfisAydinlatma.id, sortOrder: 1 } })
  await prisma.category.upsert({ where: { slug: 'ofis-aydinlatma-yer' }, update: {}, create: { slug: 'ofis-aydinlatma-yer', name: 'Yer Aydınlatmaları', parentId: catOfisAydinlatma.id, sortOrder: 2 } })
  await prisma.category.upsert({ where: { slug: 'ofis-aydinlatma-tavan' }, update: {}, create: { slug: 'ofis-aydinlatma-tavan', name: 'Tavan Aydınlatmaları', parentId: catOfisAydinlatma.id, sortOrder: 3 } })

  console.log('✅ Kategoriler oluşturuldu (EV + OFİS — 2 kök, 10 orta dal, ~70 yaprak)')

  // ─────────────────────────────────────────────────
  // ÜRÜNLER
  // ─────────────────────────────────────────────────

  // Atelier Noa ürünleri
  const productSehpa = await prisma.product.upsert({
    where: { slug: 'masif-mese-orta-sehpa-dogal' },
    update: {},
    create: {
      id: 'prod_sehpa_01',
      sellerId: sellerAtelier.id,
      categoryId: catLeafSehpaModelleri.id,
      slug: 'masif-mese-orta-sehpa-dogal',
      name: 'Masif Meşe Orta Sehpa — Doğal',
      description: 'El yapımı masif meşe sehpa. Hafif mat lake ile işlenmiş, ahşabın doğal damarları ön plana çıkarılmıştır. Her parça benzersizdir; ahşabın renk ve desen farklılıkları ürünün özgünlüğünü oluşturur.\n\nBoyutlar: 90 × 50 × 40 cm (G × D × Y)\nMalzeme: Masif meşe, mat lake\nAyaklar: Siyah mat toz boya metal\nBakım: Nemli bez ile silinebilir, aşındırıcı temizleyicilerden kaçının.',
      shortDescription: 'El yapımı masif meşe, siyah metal ayaklı orta sehpa. Her parça özgün.',
      status: ProductStatus.published,
      price: 2850,
      compareAtPrice: 3200,
      stockQuantity: 8,
      sku: 'NOA-SEHPA-MESE-01',
      weight: 14,
      dimensionLength: 90,
      dimensionWidth: 50,
      dimensionHeight: 40,
      publishedAt: new Date('2024-03-01'),
      images: {
        create: [
          { url: 'https://cdn.hanuja.com.tr/products/sehpa-mese-01-main.jpg', altText: 'Masif meşe orta sehpa önden görünüm', sortOrder: 0, isPrimary: true },
          { url: 'https://cdn.hanuja.com.tr/products/sehpa-mese-01-detail.jpg', altText: 'Masif meşe sehpa ahşap detay', sortOrder: 1 },
          { url: 'https://cdn.hanuja.com.tr/products/sehpa-mese-01-room.jpg', altText: 'Masif meşe sehpa mekan içi', sortOrder: 2 },
        ],
      },
    },
  })

  const productRattanKonsol = await prisma.product.upsert({
    where: { slug: 'rattan-konsol-aynali-dogal' },
    update: {},
    create: {
      id: 'prod_konsol_01',
      sellerId: sellerAtelier.id,
      categoryId: catLeafDresuarKonsol.id,
      slug: 'rattan-konsol-aynali-dogal',
      name: 'Rattan Konsol — Aynalı',
      description: 'Doğal rattan ve meşe kombinasyonundan üretilmiş konsol masası. Üst kısmında pirinç çerçeveli dikdörtgen ayna ile tasarlanmıştır. Giriş, yatak odası veya oturma odası için ideal.\n\nBoyutlar: 100 × 35 × 80 cm\nMalzeme: Doğal rattan, masif meşe, pirinç\nAyna: 60 × 40 cm, pirinç çerçeveli',
      shortDescription: 'Doğal rattan & meşe kombinasyonu konsol, pirinç çerçeveli ayna ile.',
      status: ProductStatus.published,
      price: 4200,
      stockQuantity: 4,
      sku: 'NOA-KONSOL-RTN-01',
      weight: 18,
      dimensionLength: 100,
      dimensionWidth: 35,
      dimensionHeight: 80,
      publishedAt: new Date('2024-03-15'),
      images: {
        create: [
          { url: 'https://cdn.hanuja.com.tr/products/konsol-rattan-01-main.jpg', altText: 'Rattan konsol önden görünüm', sortOrder: 0, isPrimary: true },
          { url: 'https://cdn.hanuja.com.tr/products/konsol-rattan-01-side.jpg', altText: 'Rattan konsol yan görünüm', sortOrder: 1 },
        ],
      },
    },
  })

  const productVazoSet = await prisma.product.upsert({
    where: { slug: 'el-yapimi-seramik-vazo-seti-3lu' },
    update: {},
    create: {
      id: 'prod_vazo_01',
      sellerId: sellerAtelier.id,
      categoryId: catLeafVazo.id,
      slug: 'el-yapimi-seramik-vazo-seti-3lu',
      name: 'El Yapımı Seramik Vazo Seti — 3\'lü',
      description: 'Çark tekniğiyle şekillendirilmiş, mat glasür kaplı üç farklı boyda seramik vazo seti. Her set birbiriyle uyumlu ama birbirinden farklı boyutlarda üç parçadan oluşur.\n\nBoyutlar: S (8×15 cm), M (10×22 cm), L (12×30 cm)\nMalzeme: Stoneware seramik, mat glasür\nRenkler: Krem, Sage yeşili, Gül kurusu (seçiniz)',
      shortDescription: 'Çark yapımı mat seramik vazo seti, 3 parça. Üç farklı renk seçeneği.',
      status: ProductStatus.published,
      price: 680,
      stockQuantity: 20,
      sku: 'NOA-VAZO-SRM-3L',
      weight: 1.8,
      publishedAt: new Date('2024-04-01'),
      images: {
        create: [
          { url: 'https://cdn.hanuja.com.tr/products/vazo-seramik-3lu-main.jpg', altText: 'Seramik vazo seti üç parça', sortOrder: 0, isPrimary: true },
        ],
      },
      variants: {
        create: [
          { name: 'Renk: Krem', sku: 'NOA-VAZO-SRM-3L-KREM', barcode: '9900000000001', stockQuantity: 8, options: { 'Renk': 'Krem' }, sortOrder: 0 },
          { name: 'Renk: Sage Yeşili', sku: 'NOA-VAZO-SRM-3L-SAGE', barcode: '9900000000002', stockQuantity: 7, options: { 'Renk': 'Sage Yeşili' }, sortOrder: 1 },
          { name: 'Renk: Gül Kurusu', sku: 'NOA-VAZO-SRM-3L-GUL', barcode: '9900000000003', stockQuantity: 5, options: { 'Renk': 'Gül Kurusu' }, sortOrder: 2 },
        ],
      },
    },
  })

  const productMumluk = await prisma.product.upsert({
    where: { slug: 'pirinc-mumluk-seti-3lu-altin' },
    update: {},
    create: {
      id: 'prod_mumluk_01',
      sellerId: sellerAtelier.id,
      categoryId: catLeafMumMumluk.id,
      slug: 'pirinc-mumluk-seti-3lu-altin',
      name: 'Pirinç Mumluk Seti — 3\'lü Altın',
      description: 'Döküm pirinç, elle işlenmiş üç farklı boy mumluk seti. Altın rengi vernik kaplama, zaman içinde patine edinebilir; bu durum ürünün doğal karakterini yansıtır.\n\nBoyutlar: S (Ø5×8 cm), M (Ø6×12 cm), L (Ø7×18 cm)\nMalzeme: Döküm pirinç, altın rengi vernik\nTej mumu fitil çapı: 2,2 cm (standart)\n\nNot: Standart tablo mumlukları ile uyumludur.',
      shortDescription: 'Döküm pirinç, 3\'lü altın mumluk seti. Farklı boylar, aynı zarafet.',
      status: ProductStatus.published,
      price: 450,
      compareAtPrice: 520,
      stockQuantity: 30,
      sku: 'NOA-MUMLUK-PRC-3L',
      weight: 0.9,
      publishedAt: new Date('2024-03-20'),
      images: {
        create: [
          { url: 'https://cdn.hanuja.com.tr/products/mumluk-pirinc-01-main.jpg', altText: 'Pirinç mumluk seti üç parça altın', sortOrder: 0, isPrimary: true },
        ],
      },
    },
  })

  const productYastik = await prisma.product.upsert({
    where: { slug: 'pamuk-dokuma-dekoratif-yastik-50x50' },
    update: {},
    create: {
      id: 'prod_yastik_01',
      sellerId: sellerAtelier.id,
      categoryId: catLeafYastik.id,
      slug: 'pamuk-dokuma-dekoratif-yastik-50x50',
      name: 'Pamuk Dokuma Dekoratif Yastık — 50×50',
      description: 'El dokuma %100 organik pamuk yastık kılıfı. İç dolgu dahildir. Geometrik desen, Anadolu dokuma geleneğinden ilham alınarak tasarlanmıştır.\n\nBoyut: 50×50 cm\nMalzeme: %100 organik pamuk\nİç dolgu: Silikon elyaf\nBakım: 30°C\'de yıkama, düşük sıcaklıkta kurutma',
      shortDescription: '%100 organik pamuk, el dokuma yastık. İç dolgu dahil.',
      status: ProductStatus.published,
      price: 320,
      stockQuantity: 45,
      sku: 'NOA-YASTIK-PAM-50',
      weight: 0.6,
      publishedAt: new Date('2024-04-10'),
      images: {
        create: [
          { url: 'https://cdn.hanuja.com.tr/products/yastik-pamuk-01-main.jpg', altText: 'Pamuk dokuma dekoratif yastık', sortOrder: 0, isPrimary: true },
        ],
      },
      variants: {
        create: [
          { name: 'Renk: Doğal Krem', sku: 'NOA-YASTIK-PAM-50-KREM', barcode: '9900000000004', stockQuantity: 20, options: { 'Renk': 'Doğal Krem' }, sortOrder: 0 },
          { name: 'Renk: Terrakota', sku: 'NOA-YASTIK-PAM-50-TERRA', barcode: '9900000000005', stockQuantity: 15, options: { 'Renk': 'Terrakota' }, sortOrder: 1 },
          { name: 'Renk: Petrol Mavisi', sku: 'NOA-YASTIK-PAM-50-MAV', barcode: '9900000000006', stockQuantity: 10, options: { 'Renk': 'Petrol Mavisi' }, sortOrder: 2 },
        ],
      },
    },
  })

  // Woodform Design ürünleri
  const productCalistirma = await prisma.product.upsert({
    where: { slug: 'masif-ceviz-calisma-masasi-140cm' },
    update: {},
    create: {
      id: 'prod_masa_01',
      sellerId: sellerWoodform.id,
      categoryId: catLeafOfisCalismaMasasi.id,
      slug: 'masif-ceviz-calisma-masasi-140cm',
      name: 'Masif Ceviz Çalışma Masası — 140 cm',
      description: 'Türkiye\'de yetişen masif ceviz ağacından el işçiliği ile üretilmiş çalışma masası. Zemin bağlantılı siyah mat boyalı çelik ayaklar, yüksek stabilite sağlar. Tabletop doğal cevizin zengin damarlarını ortaya çıkaran mat sertleştirici ile bitirilmiştir.\n\nBoyutlar: 140 × 70 × 75 cm\nMalzeme: Masif ceviz, çelik\nYüzey: Mat poliüretan sertleştirici\nAyaklar: Siyah mat toz boya çelik\nMontaj: Gerekli tüm vidalar ve montaj kılavuzu dahildir.',
      shortDescription: 'Masif ceviz tabletop, siyah çelik ayaklı çalışma masası. 140 cm genişlik.',
      status: ProductStatus.published,
      price: 8900,
      compareAtPrice: 9800,
      stockQuantity: 3,
      sku: 'WF-MASA-CEV-140',
      weight: 42,
      dimensionLength: 140,
      dimensionWidth: 70,
      dimensionHeight: 75,
      publishedAt: new Date('2024-02-20'),
      images: {
        create: [
          { url: 'https://cdn.hanuja.com.tr/products/masa-ceviz-01-main.jpg', altText: 'Masif ceviz çalışma masası önden görünüm', sortOrder: 0, isPrimary: true },
          { url: 'https://cdn.hanuja.com.tr/products/masa-ceviz-01-top.jpg', altText: 'Masif ceviz tabletop detay', sortOrder: 1 },
          { url: 'https://cdn.hanuja.com.tr/products/masa-ceviz-01-room.jpg', altText: 'Masif ceviz masa mekan içi', sortOrder: 2 },
        ],
      },
    },
  })

  const productRaf = await prisma.product.upsert({
    where: { slug: 'mese-duvar-raf-sistemi-modüler' },
    update: {},
    create: {
      id: 'prod_raf_01',
      sellerId: sellerWoodform.id,
      categoryId: catLeafKitaplik.id,
      slug: 'mese-duvar-raf-sistemi-modüler',
      name: 'Meşe Duvar Raf Sistemi — Modüler',
      description: 'Duvara monte masif meşe raf sistemi. Üç farklı genişlikte modüler raf seçenekleri, siyah mat demir konsol ile duvara sabitlenir.\n\nRaf genişlikleri: 60, 90, 120 cm\nRaf derinliği: 22 cm\nRaf kalınlığı: 4 cm\nMalzeme: Masif meşe, mat vernik, siyah demir konsol\nMontaj: Dübel ve vida dahildir.',
      shortDescription: 'Masif meşe duvar rafı, siyah demir konsol. 3 genişlik seçeneği.',
      status: ProductStatus.published,
      price: 890,
      stockQuantity: 25,
      sku: 'WF-RAF-MESE-MOD',
      weight: 4.5,
      publishedAt: new Date('2024-03-05'),
      images: {
        create: [
          { url: 'https://cdn.hanuja.com.tr/products/raf-mese-01-main.jpg', altText: 'Meşe duvar raf sistemi', sortOrder: 0, isPrimary: true },
        ],
      },
      variants: {
        create: [
          { name: '60 cm', sku: 'WF-RAF-MESE-60', barcode: '9900000000007', price: 590, stockQuantity: 10, options: { 'Genişlik': '60 cm' }, sortOrder: 0 },
          { name: '90 cm', sku: 'WF-RAF-MESE-90', barcode: '9900000000008', price: 750, stockQuantity: 10, options: { 'Genişlik': '90 cm' }, sortOrder: 1 },
          { name: '120 cm', sku: 'WF-RAF-MESE-120', barcode: '9900000000009', price: 890, stockQuantity: 5, options: { 'Genişlik': '120 cm' }, sortOrder: 2 },
        ],
      },
    },
  })

  const productSarkit = await prisma.product.upsert({
    where: { slug: 'ahsap-kure-sarkit-lamba-mese' },
    update: {},
    create: {
      id: 'prod_sarkit_01',
      sellerId: sellerWoodform.id,
      categoryId: catLeafTavanSarkit.id,
      slug: 'ahsap-kure-sarkit-lamba-mese',
      name: 'Ahşap Küre Sarkıt Lamba — Meşe',
      description: 'CNC tornalı masif meşe küre içinde gizlenmiş Edison ampullü sarkıt lamba. Tekstil örgü kablo, tavan rozeti ve ampul dahildir.\n\nÇap: 20 cm\nKablo boyu: Ayarlanabilir, maks. 120 cm\nDuy: E27\nAmpul: 4W LED Edison (dahil)\nMalzeme: Masif meşe, tekstil kablo\n\nElektrik Sertifikası: CE uyumlu',
      shortDescription: 'CNC tornalı masif meşe küre sarkıt lamba. Edison ampul & tekstil kablo dahil.',
      status: ProductStatus.published,
      price: 1250,
      stockQuantity: 12,
      sku: 'WF-SARKIT-MESE-KRE',
      weight: 1.2,
      publishedAt: new Date('2024-03-10'),
      images: {
        create: [
          { url: 'https://cdn.hanuja.com.tr/products/sarkit-mese-01-main.jpg', altText: 'Meşe küre sarkıt lamba', sortOrder: 0, isPrimary: true },
          { url: 'https://cdn.hanuja.com.tr/products/sarkit-mese-01-on.jpg', altText: 'Meşe sarkıt lamba açık', sortOrder: 1 },
        ],
      },
    },
  })

  const productBahceTakimi = await prisma.product.upsert({
    where: { slug: 'tik-bahce-oturma-grubu-2li' },
    update: {},
    create: {
      id: 'prod_bahce_01',
      sellerId: sellerWoodform.id,
      categoryId: catLeafBahceMobilya.id,
      slug: 'tik-bahce-oturma-grubu-2li',
      name: 'Tik Bahçe Oturma Grubu — 2\'li Koltuk Set',
      description: 'A-grade tik ağacından üretilmiş 2\'li bahçe koltuk takımı. Tik, doğal yağ içeriği sayesinde dış mekanda ekstra bakım gerektirmez.\n\nSet içeriği: 2× koltuk\nKoltuk boyutları: 65×70×85 cm (G×D×Y)\nOturma yüksekliği: 42 cm\nMalzeme: A-grade tik, paslanmaz çelik vida\nMindersiz olarak satılır; Sunbrella minderler ayrıca edinilebilir.',
      shortDescription: 'A-grade tik, 2\'li bahçe koltuğu. Dış mekan dayanıklı, bakım gerektirmez.',
      status: ProductStatus.published,
      price: 12500,
      stockQuantity: 2,
      sku: 'WF-BAHCE-TIK-2KLT',
      weight: 28,
      publishedAt: new Date('2024-04-05'),
      images: {
        create: [
          { url: 'https://cdn.hanuja.com.tr/products/bahce-tik-01-main.jpg', altText: 'Tik bahçe koltuk seti', sortOrder: 0, isPrimary: true },
        ],
      },
    },
  })

  // Taslak ürün (yayında değil)
  await prisma.product.upsert({
    where: { slug: 'gur-kitaplik-modeler-taslak' },
    update: {},
    create: {
      id: 'prod_kitaplik_01',
      sellerId: sellerWoodform.id,
      categoryId: catLeafKitaplik.id,
      slug: 'gur-kitaplik-modeler-taslak',
      name: 'Gürgen Kitaplık — Modüler (Taslak)',
      description: 'Taslak ürün — henüz yayında değil.',
      status: ProductStatus.draft,
      price: 5600,
      stockQuantity: 0,
      sku: 'WF-KITAP-GUR-MOD',
      weight: 35,
    },
  })

  // İnceleme bekleyen ürün
  await prisma.product.upsert({
    where: { slug: 'bambu-sofra-takimi-6-kisilik-inceleme' },
    update: {},
    create: {
      id: 'prod_sofra_01',
      sellerId: sellerAtelier.id,
      categoryId: catLeafTabakKase.id,
      slug: 'bambu-sofra-takimi-6-kisilik-inceleme',
      name: 'Bambu Sofra Takımı — 6 Kişilik',
      description: 'Organik bambu, 6 kişilik sofra seti.',
      status: ProductStatus.pending_review,
      price: 780,
      stockQuantity: 15,
      sku: 'NOA-SOFRA-BAM-6KSI',
      weight: 2.4,
    },
  })

  console.log('✅ Ürünler oluşturuldu')

  // ─────────────────────────────────────────────────
  // SİPARİŞLER
  // ─────────────────────────────────────────────────

  // Sipariş 1: Teslim onaylandı, payout hold aktif
  const order1 = await prisma.order.upsert({
    where: { id: 'order_01' },
    update: {},
    create: {
      id: 'order_01',
      customerId: customerAyse.id,
      addressId: addressAyse.id,
      status: OrderStatus.delivery_confirmed,
      grossAmount: 2850,
      discountAmount: 0,
      shippingAmount: 0,
      totalAmount: 2850,
      paymentConfirmedAt: new Date('2025-03-01T10:00:00Z'),
      sellerQueueReadyAt: new Date('2025-03-01T10:05:00Z'),
      shippedAt: new Date('2025-03-03T14:00:00Z'),
      deliveredAt: new Date('2025-03-06T11:30:00Z'),
      deliveryConfirmedAt: new Date('2025-03-09T09:00:00Z'),
    },
  })

  const orderLine1 = await prisma.orderLine.upsert({
    where: { id: 'ol_01' },
    update: {},
    create: {
      id: 'ol_01',
      orderId: order1.id,
      productId: productSehpa.id,
      sellerId: sellerAtelier.id,
      productName: 'Masif Meşe Orta Sehpa — Doğal',
      quantity: 1,
      unitPrice: 2850,
      totalPrice: 2850,
      commissionRate: 0.15,
      commissionAmount: 427.5,
      netPayoutAmount: 2422.5,
    },
  })

  // Sipariş 1 ödeme
  await prisma.payment.upsert({
    where: { id: 'pay_01' },
    update: {},
    create: {
      id: 'pay_01',
      orderId: order1.id,
      method: PaymentMethod.card,
      status: PaymentStatus.confirmed,
      amount: 2850,
      providerPaymentId: 'iyzico_test_conv_001',
      confirmedAt: new Date('2025-03-01T10:00:00Z'),
    },
  })

  // Sipariş 1 kargo
  await prisma.shipment.upsert({
    where: { id: 'ship_01' },
    update: {},
    create: {
      id: 'ship_01',
      orderId: order1.id,
      sellerId: sellerAtelier.id,
      cargoProvider: 'yurtiçi',
      trackingNumber: 'YK123456789TR',
      status: ShipmentStatus.delivered,
      handedAt: new Date('2025-03-03T14:00:00Z'),
      deliveredAt: new Date('2025-03-06T11:30:00Z'),
    },
  })

  // Sipariş 1 payout (hold aktif, 30 gün = 2025-04-08)
  const payout1 = await prisma.payout.upsert({
    where: { id: 'payout_01' },
    update: {},
    create: {
      id: 'payout_01',
      sellerId: sellerAtelier.id,
      orderId: order1.id,
      orderLineId: orderLine1.id,
      bankDetailId: 'bank_atelier_01',
      status: PayoutStatus.hold_active,
      grossAmount: 2850,
      commissionAmount: 427.5,
      netAmount: 2422.5,
      holdStartedAt: new Date('2025-03-09T09:00:00Z'),
      holdUntil: new Date('2025-04-08T09:00:00Z'),
    },
  })

  // Sipariş 1 durum geçmişi
  const order1History = [
    { fromStatus: null, toStatus: OrderStatus.draft, createdAt: new Date('2025-03-01T09:50:00Z') },
    { fromStatus: OrderStatus.draft, toStatus: OrderStatus.payment_pending, createdAt: new Date('2025-03-01T09:52:00Z') },
    { fromStatus: OrderStatus.payment_pending, toStatus: OrderStatus.payment_confirmed, createdAt: new Date('2025-03-01T10:00:00Z'), actorId: 'system', reason: 'Iyzico ödeme onayı' },
    { fromStatus: OrderStatus.payment_confirmed, toStatus: OrderStatus.seller_queue_ready, createdAt: new Date('2025-03-01T10:05:00Z'), actorId: 'system' },
    { fromStatus: OrderStatus.seller_queue_ready, toStatus: OrderStatus.preparing, createdAt: new Date('2025-03-02T09:00:00Z'), actorId: sellerUserAtelier.id },
    { fromStatus: OrderStatus.preparing, toStatus: OrderStatus.shipped, createdAt: new Date('2025-03-03T14:00:00Z'), actorId: sellerUserAtelier.id, reason: 'YK123456789TR takip numarası ile kargoya verildi' },
    { fromStatus: OrderStatus.shipped, toStatus: OrderStatus.delivered, createdAt: new Date('2025-03-06T11:30:00Z'), actorId: 'system', reason: 'Yurtiçi Kargo teslimat kaydı' },
    { fromStatus: OrderStatus.delivered, toStatus: OrderStatus.delivery_confirmed, createdAt: new Date('2025-03-09T09:00:00Z'), actorId: 'system', reason: '72 saat itiraz gelmedi, sessiz onay' },
  ]

  for (const h of order1History) {
    await prisma.orderStatusHistory.create({
      data: {
        orderId: order1.id,
        fromStatus: h.fromStatus as OrderStatus | undefined ?? undefined,
        toStatus: h.toStatus,
        actorId: h.actorId,
        reason: h.reason,
        createdAt: h.createdAt,
      },
    }).catch(() => {/* idempotent — zaten varsa atla */})
  }

  // Sipariş 1 ledger girişleri
  await prisma.sellerLedgerEntry.createMany({
    skipDuplicates: true,
    data: [
      {
        id: 'ledger_atelier_01',
        sellerId: sellerAtelier.id,
        type: LedgerEntryType.sale,
        amount: 2850,
        balanceAfter: 2850,
        referenceType: 'order',
        referenceId: order1.id,
        description: 'Sipariş #order_01 — Masif Meşe Orta Sehpa satışı',
        createdAt: new Date('2025-03-01T10:00:00Z'),
      },
      {
        id: 'ledger_atelier_02',
        sellerId: sellerAtelier.id,
        type: LedgerEntryType.commission,
        amount: -427.5,
        balanceAfter: 2422.5,
        referenceType: 'order',
        referenceId: order1.id,
        description: 'Sipariş #order_01 — %15 komisyon kesintisi',
        createdAt: new Date('2025-03-09T09:00:00Z'),
      },
    ],
  })

  // Sipariş 2: Ödeme onaylı, satıcı kuyruğunda
  const order2 = await prisma.order.upsert({
    where: { id: 'order_02' },
    update: {},
    create: {
      id: 'order_02',
      customerId: customerMehmet.id,
      status: OrderStatus.seller_queue_ready,
      grossAmount: 8900,
      discountAmount: 0,
      shippingAmount: 0,
      totalAmount: 8900,
      paymentConfirmedAt: new Date('2025-04-05T14:30:00Z'),
      sellerQueueReadyAt: new Date('2025-04-05T14:35:00Z'),
    },
  })

  await prisma.orderLine.upsert({
    where: { id: 'ol_02' },
    update: {},
    create: {
      id: 'ol_02',
      orderId: order2.id,
      productId: productCalistirma.id,
      sellerId: sellerWoodform.id,
      productName: 'Masif Ceviz Çalışma Masası — 140 cm',
      quantity: 1,
      unitPrice: 8900,
      totalPrice: 8900,
      commissionRate: 0.12,
      commissionAmount: 1068,
      netPayoutAmount: 7832,
    },
  })

  await prisma.payment.upsert({
    where: { id: 'pay_02' },
    update: {},
    create: {
      id: 'pay_02',
      orderId: order2.id,
      method: PaymentMethod.card,
      status: PaymentStatus.confirmed,
      amount: 8900,
      providerPaymentId: 'iyzico_test_conv_002',
      confirmedAt: new Date('2025-04-05T14:30:00Z'),
    },
  })

  await prisma.orderStatusHistory.createMany({
    skipDuplicates: true,
    data: [
      {
        id: 'osh_02_01',
        orderId: order2.id,
        toStatus: OrderStatus.draft,
        createdAt: new Date('2025-04-05T14:20:00Z'),
      },
      {
        id: 'osh_02_02',
        orderId: order2.id,
        fromStatus: OrderStatus.draft,
        toStatus: OrderStatus.payment_pending,
        createdAt: new Date('2025-04-05T14:22:00Z'),
      },
      {
        id: 'osh_02_03',
        orderId: order2.id,
        fromStatus: OrderStatus.payment_pending,
        toStatus: OrderStatus.payment_confirmed,
        actorId: 'system',
        reason: 'Iyzico ödeme onayı',
        createdAt: new Date('2025-04-05T14:30:00Z'),
      },
      {
        id: 'osh_02_04',
        orderId: order2.id,
        fromStatus: OrderStatus.payment_confirmed,
        toStatus: OrderStatus.seller_queue_ready,
        actorId: 'system',
        createdAt: new Date('2025-04-05T14:35:00Z'),
      },
    ],
  })

  await prisma.sellerLedgerEntry.createMany({
    skipDuplicates: true,
    data: [
      {
        id: 'ledger_woodform_01',
        sellerId: sellerWoodform.id,
        type: LedgerEntryType.sale,
        amount: 8900,
        balanceAfter: 8900,
        referenceType: 'order',
        referenceId: order2.id,
        description: 'Sipariş #order_02 — Masif Ceviz Çalışma Masası satışı',
        createdAt: new Date('2025-04-05T14:30:00Z'),
      },
    ],
  })

  console.log('✅ Siparişler oluşturuldu')

  // ─────────────────────────────────────────────────
  // BLOG YAZILARI
  // ─────────────────────────────────────────────────

  await prisma.blogPost.upsert({
    where: { slug: 'kucuk-salon-dekorasyon-fikirleri-2025' },
    update: {},
    create: {
      id: 'blog_01',
      slug: 'kucuk-salon-dekorasyon-fikirleri-2025',
      title: 'Küçük Salonlar İçin 8 Dekorasyon Fikri',
      summary: 'Sınırlı alanı daha geniş ve işlevsel göstermenin yolları. Renk, mobilya ve aksesuar seçimiyle küçük salonunuzu yeniden keşfedin.',
      body: `## Küçük Alanlar, Büyük Etki

Küçük bir salona sahip olmak, estetikten ödün vermek anlamına gelmez. Doğru mobilya seçimi, renk paleti ve aksesuar kullanımıyla küçük alanlar etkileyici ve konforlu mekânlara dönüştürülebilir.

### 1. Hafif Görünümlü Mobilya Seçin

Metal ve cam ayaklı, görsel ağırlığı az mobilyalar küçük salonlarda yer açar. Masif meşe veya rattan sehpalar, masif kütükten yapılmış muadillerine kıyasla mekânda daha az yer kaplar hissi verir.

### 2. Duvarları Kullanın

Duvara monte raf sistemleri hem depolama alanı yaratır hem de zemin alanını serbest bırakır. Modüler meşe raflar, kitap koleksiyonunuzu ve dekor parçalarınızı sergilemenin şık bir yolunu sunar.

### 3. Ayna Kullanımı

Stratejik yerleştirilmiş ayna, ışığı yansıtarak odanın daha geniş görünmesini sağlar. Pirinç çerçeveli konsollu ayna modelleri hem işlevsel hem dekoratif tercihler arasındadır.

### 4. Renk Harmonisi

Açık tonlar mekanı büyütür; ancak tüm yüzeyler için aynı tonu kullanmak gerekmiyor. İki veya üç uyumlu ton ile derinlik yaratabilirsiniz.

### 5. Çok İşlevli Parçalar

Depolama özellikli puf, uzatılabilir sehpa veya katlanan yan sehpalar gibi çok işlevli mobilyalar küçük salonlarda büyük fark yaratır.`,
      status: BlogPostStatus.published,
      authorId: adminUser.id,
      publishedAt: new Date('2025-02-15T09:00:00Z'),
      coverUrl: 'https://cdn.hanuja.com.tr/blog/kucuk-salon-dekorasyon-01.jpg',
    },
  })

  await prisma.blogPost.upsert({
    where: { slug: 'ev-ofis-duzeni-nasil-kurulur-verimli-calisma-alani' },
    update: {},
    create: {
      id: 'blog_02',
      slug: 'ev-ofis-duzeni-nasil-kurulur-verimli-calisma-alani',
      title: 'Ev Ofisi Düzeni: Verimli Çalışma Alanı Nasıl Kurulur?',
      summary: 'Evden çalışma düzenini kalıcı hale getirmek için mobilya, aydınlatma ve organizasyon ipuçları.',
      body: `## Evden Çalışmanın Kalıcı Adresi

Pandemi sonrası uzaktan çalışma modellerinin yaygınlaşmasıyla ev ofisi artık bir tercih değil, ihtiyaç haline geldi. Verimli bir ev ofisi için doğru mobilya ve düzenleme kritik öneme sahip.

### Masa Seçimi

Masanın boyutu, bilgisayar monitörü, yazı yazma alanı ve küçük depolama ihtiyacını karşılamalıdır. Minimum 120 cm genişlik önerilir; 140 cm veya daha geniş masalar daha fazla esneklik sağlar. Masif ahşap çalışma masaları, günlük kullanım koşullarında plastik ve sunta alternatiflere göre çok daha uzun ömürlüdür.

### Aydınlatma

Doğal ışık en değerli kaynaktır; masanızı mümkünse bir pencereye yakın konumlandırın. Yapay aydınlatmada soğuk beyaz (5000–6500K) ışık odaklanmayı destekler. Doğrudan monitöre vuran ışıktan kaçının.

### Ergonomi

Sandalye yüksekliği, dirseklerin masayla düz açı yapmasını sağlamalıdır. Monitör göz hizasında veya hafif aşağıda olmalıdır.

### Organizasyon

Duvara monte raf sistemleri masa üzerindeki yükü azaltır, önemli dokümanlar ve referans kitapları el altında tutulabilir hale gelir. Kablo yönetimi için masa altı kablo organizatörleri sıklıkla göz ardı edilir ancak büyük fark yaratır.`,
      status: BlogPostStatus.published,
      authorId: adminUser.id,
      publishedAt: new Date('2025-03-10T10:00:00Z'),
      coverUrl: 'https://cdn.hanuja.com.tr/blog/ev-ofis-duzeni-01.jpg',
    },
  })

  console.log('✅ Blog yazıları oluşturuldu')

  // ─────────────────────────────────────────────────
  // ÜRÜN ÖZELLİK SEÇENEKLERİ (Renk & Materyal)
  // ─────────────────────────────────────────────────

  console.log('\n🎨 Ürün özellik seçenekleri oluşturuluyor...')
  await seedAttributeOptions(prisma)
  console.log('✅ Özellik seçenekleri oluşturuldu')

  // ─────────────────────────────────────────────────
  // ÖZET
  // ─────────────────────────────────────────────────

  const counts = await Promise.all([
    prisma.user.count(),
    prisma.seller.count(),
    prisma.category.count(),
    prisma.product.count(),
    prisma.order.count(),
    prisma.blogPost.count(),
  ])

  console.log('\n📊 Seed özeti:')
  console.log(`  Kullanıcı      : ${counts[0]}`)
  console.log(`  Satıcı         : ${counts[1]}`)
  console.log(`  Kategori       : ${counts[2]}`)
  console.log(`  Ürün           : ${counts[3]}`)
  console.log(`  Sipariş        : ${counts[4]}`)
  console.log(`  Blog yazısı    : ${counts[5]}`)
  console.log('\n✅ Seed tamamlandı.')
}

main()
  .catch((e) => {
    console.error('❌ Seed hatası:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
