import { PrismaClient } from '@prisma/client'

// Küratörlü palet: aile-gruplu (nötrler → ahşap/kahve → maviler → yeşiller →
// sıcaklar → metalikler). Dizinin sırası = ekrandaki sıra (seed her renge
// sortOrder = index yazar; sıralayıcı bu sortOrder'ı kullanır). Metalik finish
// aileleri bilinçli olarak bitişik: Altın → Eskitme Altın → Rose Altın,
// Gümüş → Eskitme Gümüş, Bakır → Pirinç. Mix/Şeffaf hex'siz (swatch'sız) en sonda.
const COLORS = [
  { slug: 'beyaz', label: 'Beyaz', hexColor: '#FFFFFF' },
  { slug: 'krem', label: 'Krem', hexColor: '#FFF8DC' },
  { slug: 'bej', label: 'Bej', hexColor: '#F5F0E8' },
  { slug: 'naturel', label: 'Naturel', hexColor: '#E8DCC8' },
  { slug: 'sampanya', label: 'Şampanya', hexColor: '#F3E5C0' },
  { slug: 'acik-gri', label: 'Açık Gri', hexColor: '#D3D3D3' },
  { slug: 'gri', label: 'Gri', hexColor: '#808080' },
  { slug: 'antrasit', label: 'Antrasit', hexColor: '#3B3B3B' },
  { slug: 'siyah', label: 'Siyah', hexColor: '#000000' },
  { slug: 'acik-kahverengi', label: 'Açık Kahverengi', hexColor: '#C4956A' },
  { slug: 'kahverengi', label: 'Kahverengi', hexColor: '#8B4513' },
  { slug: 'koyu-kahverengi', label: 'Koyu Kahverengi', hexColor: '#4A2C0A' },
  { slug: 'dogal-ahsap', label: 'Doğal Ahşap', hexColor: '#DEB887' },
  { slug: 'mese', label: 'Meşe', hexColor: '#C19A6B' },
  { slug: 'ceviz', label: 'Ceviz', hexColor: '#7B4A2D' },
  { slug: 'eskitme', label: 'Eskitme', hexColor: '#A08A6F' },
  { slug: 'buz-mavisi', label: 'Buz Mavisi', hexColor: '#CDE7F0' },
  { slug: 'acik-mavi', label: 'Açık Mavi', hexColor: '#87CEEB' },
  { slug: 'mavi', label: 'Mavi', hexColor: '#4169E1' },
  { slug: 'petrol-mavisi', label: 'Petrol Mavisi', hexColor: '#1C5F6B' },
  { slug: 'lacivert', label: 'Lacivert', hexColor: '#1C2C5B' },
  { slug: 'mint-yesil', label: 'Mint Yeşil', hexColor: '#AAF0D1' },
  { slug: 'yesil', label: 'Yeşil', hexColor: '#228B22' },
  { slug: 'zeytin-yesili', label: 'Zeytin Yeşili', hexColor: '#6B7C42' },
  { slug: 'turuncu', label: 'Turuncu', hexColor: '#FF8C00' },
  { slug: 'terracotta', label: 'Terracotta', hexColor: '#C66E3D' },
  { slug: 'kirmizi', label: 'Kırmızı', hexColor: '#DC143C' },
  { slug: 'bordo', label: 'Bordo', hexColor: '#800020' },
  { slug: 'pembe', label: 'Pembe', hexColor: '#FFB6C1' },
  { slug: 'mor', label: 'Mor', hexColor: '#800080' },
  { slug: 'altin', label: 'Altın', hexColor: '#FFD700' },
  { slug: 'eskitme-altin', label: 'Eskitme Altın', hexColor: '#C0A062' },
  { slug: 'rose-altin', label: 'Rose Altın', hexColor: '#B76E79' },
  { slug: 'gumus', label: 'Gümüş', hexColor: '#C0C0C0' },
  { slug: 'eskitme-gumus', label: 'Eskitme Gümüş', hexColor: '#B7B7B0' },
  { slug: 'bakir', label: 'Bakır', hexColor: '#B87333' },
  { slug: 'pirinc', label: 'Pirinç', hexColor: '#B5A642' },
  { slug: 'mix', label: 'Mix', hexColor: null },
  { slug: 'seffaf', label: 'Şeffaf', hexColor: null },
]

const MATERIALS = [
  { slug: 'masif-ahsap', label: 'Masif Ahşap' },
  { slug: 'mdf', label: 'MDF' },
  { slug: 'sunta', label: 'Sunta' },
  { slug: 'kontraplak', label: 'Kontraplak' },
  { slug: 'bambu', label: 'Bambu' },
  { slug: 'rattan', label: 'Rattan' },
  { slug: 'hasir', label: 'Hasır' },
  { slug: 'metal-celik', label: 'Metal / Çelik' },
  { slug: 'demir', label: 'Demir' },
  { slug: 'aluminyum', label: 'Alüminyum' },
  { slug: 'paslanmaz-celik', label: 'Paslanmaz Çelik' },
  { slug: 'pirinc', label: 'Pirinç' },
  { slug: 'cam', label: 'Cam' },
  { slug: 'temperli-cam', label: 'Temperli Cam' },
  { slug: 'ayna', label: 'Ayna' },
  { slug: 'mermer', label: 'Mermer' },
  { slug: 'granit', label: 'Granit' },
  { slug: 'seramik', label: 'Seramik' },
  { slug: 'porselen', label: 'Porselen' },
  { slug: 'terracotta-malzeme', label: 'Terracotta' },
  { slug: 'beton', label: 'Beton' },
  { slug: 'plastik', label: 'Plastik' },
  { slug: 'akrilik', label: 'Akrilik' },
  { slug: 'keten', label: 'Keten' },
  { slug: 'pamuk', label: 'Pamuk' },
  { slug: 'kadife', label: 'Kadife' },
  { slug: 'deri', label: 'Deri' },
  { slug: 'suni-deri', label: 'Suni Deri' },
  { slug: 'kumas', label: 'Kumaş' },
  { slug: 'polyester', label: 'Polyester' },
]

export async function seedAttributeOptions(prisma: PrismaClient) {
  let colorCount = 0
  let materialCount = 0

  for (let i = 0; i < COLORS.length; i++) {
    const c = COLORS[i]!
    await prisma.productAttributeOption.upsert({
      where: { type_slug: { type: 'color', slug: c.slug } },
      update: { label: c.label, hexColor: c.hexColor ?? null, sortOrder: i },
      create: {
        type: 'color',
        slug: c.slug,
        label: c.label,
        hexColor: c.hexColor ?? null,
        sortOrder: i,
        isActive: true,
      },
    })
    colorCount++
  }

  for (let i = 0; i < MATERIALS.length; i++) {
    const m = MATERIALS[i]!
    await prisma.productAttributeOption.upsert({
      where: { type_slug: { type: 'material', slug: m.slug } },
      update: { label: m.label, sortOrder: i },
      create: {
        type: 'material',
        slug: m.slug,
        label: m.label,
        sortOrder: i,
        isActive: true,
      },
    })
    materialCount++
  }

  console.log(`  Renk seçeneği  : ${colorCount}`)
  console.log(`  Materyal seç.  : ${materialCount}`)
}
