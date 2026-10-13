"""Build the reviewed initial registry. Runtime reads JSON, never a planning document."""
from pathlib import Path
import re, json

ROOT = Path(__file__).resolve().parents[2]
source = (ROOT / 'kategori-plani-ek.md').read_text(encoding='utf-8-sig')

def section(a, b):
    return source.split(a, 1)[1].split(b, 1)[0]

def slug(value):
    value = value.translate(str.maketrans('ğĞüÜşŞıİöÖçÇ', 'gguussii oocc'.replace(' ', ''))).lower()
    return re.sub(r'[^a-z0-9]+', '-', value).strip('-')

def cells(line):
    return [x.strip() for x in line.strip('|').split('|')]

fields, templates, nodes, size_sets = {}, [], [], {}
for line in section('### 4.4', '## 5.').splitlines():
    if not line.startswith('| `'): continue
    c = cells(line)
    key = c[0].strip('`')
    fields[key] = dict(key=key, label=c[1].split(' / ')[0], kind='number', canonicalUnit=c[3],
        config=dict(measurement=c[2], inputUnits=c[4], integer=c[2] == 'Sayı'))
for line in section('### 4.2', '### 4.3').splitlines():
    if not re.match(r'\| B\d+ \|', line): continue
    c = cells(line)
    size_sets[c[0]] = c[2].split(' · ')

def define(label, choices=None, kind=None):
    key = slug(label).replace('-', '_')
    choices = choices or []
    kind = kind or ('select' if choices else 'text')
    field = fields.setdefault(key, dict(key=key, label=label, kind=kind, canonicalUnit=None, config={}))
    if choices:
        field['kind'] = kind
        options = field['config'].setdefault('options', [])
        for v in choices:
            if not any(o['id'] == slug(v) for o in options):
                options.append(dict(id=slug(v), label=v, isActive=True))
    return key

define('Cinsiyet', ['Kadın', 'Erkek', 'Unisex'])
define('Yaş Grubu', ['Yetişkin', 'Çocuk', 'Bebek'])
define('Kullanım', ['Günlük', 'Spor', 'Outdoor'])
define('Sezon', ['Yaz', 'Kış', '4 Mevsim'])
define('Büyük Beden', kind='boolean')
define('Tesettür', kind='boolean')
define('Beden', kind='size')
fields['beden']['config'] = {'subsets': size_sets}
define('Bez Numarası', [str(n) for n in range(1, 8)])
define('Ölçü'); define('Ton'); define('Uyumlu Model')
define('Güç Kullanımı',['Kablolu','Şarjlı','İkisi'])

def split_fields(text):
    # Commas inside a definition or an example are not field separators.
    return re.split(r',\s*(?![^()]*\))', text)

def extract(text):
    bindings, groups = [], []
    for item in split_fields(text):
        item = item.strip().replace('\\*', '*')
        required = '*' in item.split('(', 1)[0]
        if item.startswith('Net İçerik'):
            keys = re.findall(r'`(hacim_ml|net_agirlik_g|paket_adedi)`', item)
            if keys:
                bindings.extend(dict(key=k, required=False) for k in keys)
                if required: groups.append(dict(label='Net İçerik', keys=keys))
            continue
        numeric = re.search(r'`([a-z_]+)`', item)
        if numeric and numeric[1] in fields:
            unit = fields[numeric[1]]['canonicalUnit']
            if '**L**' in item: unit = 'L'
            if '**gün**' in item: unit = 'gün'
            bindings.append(dict(key=numeric[1], required=required, displayUnit=unit))
            continue
        item = re.sub(r'^Mevcut Renk/Materyal/ölçü/ağırlık \+ ', '', item)
        label = re.split(r'\s*\(', item)[0].replace('*', '').strip().rstrip('.')
        label = label.split(' = ')[0]
        if label in ('Garanti', 'Garanti Süresi'):
            bindings.append(dict(key='garanti_ay', required=required)); continue
        if not label or label.startswith('Materyal') or any(x in label for x in ['giyim listesi', 'ortak alanları', 'En/Boy', 'Örnek', 'Mevcut', 'Model (metin)']): continue
        if label in ('Hacim', 'Kapasite'):
            bindings.append(dict(key='hacim_ml', required=required)); continue
        if label == 'Minimum Yaş':
            bindings.append(dict(key='minimum_yas_ay', required=required)); continue
        if label in ('Yaka Tipi', 'Kol Boyu', 'Stil', 'Desen', 'Cilt Tipi', 'Çözünürlük', 'Suya Dayanıklılık', 'Kullanım'):
            pass
        choices_match = re.search(r'\(([^()]*)\)', item)
        choices = []
        if choices_match:
            t = choices_match[1]
            if ' · ' in t and 'öneri' not in t:
                choices = t.split(' · ')
            elif t in ('Evet/Hayır', 'Var/Yok'):
                choices = t.split('/')
        key = define(label, choices)
        if label in ('Büyük Beden', 'Tesettür'): fields[key]['kind'] = 'boolean'
        bindings.append(dict(key=key, required=required,
            **({'optionIds': [slug(x) for x in choices]} if choices else {})))
    return bindings, groups

giyim = 'Cinsiyet*, Yaş Grubu*, Kullanım, Sezon, Kalıp (Dar/Slim · Normal · Rahat · Oversize), Desen (Düz · Çizgili · Kareli · Çiçekli · Puantiyeli · Baskılı · Geometrik · Kamuflaj · Hayvan Deseni · Etnik), Kumaş Tipi (Örme · Dokuma · Triko · Denim · Kadife · Saten · Şifon · Polar · Kaşe · Dantel · Tül), Büyük Beden, Tesettür'
common, _ = extract(giyim)
materials_giyim = 'Pamuk · Organik Pamuk · Polyester · Viskon · Modal · Keten · Yün · Kaşmir · İpek · Akrilik · Poliamid · Elastan · Deri · Suni Deri · Karışım'.split(' · ')
materials_canta = 'Deri · Suni Deri · Kanvas · Kumaş · Naylon · Süet · Hasır · Kadife'.split(' · ')
for line in section('### 4.3', '### 4.4').splitlines():
    if not line.startswith('| `'): continue
    c = cells(line)
    code = c[0].strip('`')
    text = c[3]
    # Material and common visibility sentences are not generic field labels.
    field_text = re.split(r'\. Materyal|\. En/Boy|\. Net içerik|\s+Materyal listesi:', text)[0]
    bindings, groups = extract(field_text)
    if code.startswith('GIY-'): bindings = [*common, *bindings]
    unique = {}
    for b in bindings:
        if b['key'] in unique: b['required'] = b['required'] or unique[b['key']]['required']
        unique[b['key']] = b
    variant = c[2].split(' (')[0]
    variant_keys = {'Beden':'beden', 'Hacim':'hacim_ml', 'Net İçerik':'net_icerik', 'Bez Numarası':'bez_numarasi', 'Ölçü':'olcu', 'Ton':'ton', 'Uyumlu Model':'uyumlu_model'}
    vk = variant_keys.get(variant)
    if vk and vk != 'net_icerik':
        unique.setdefault(vk, dict(key=vk, required=(code in ('KOZ-PARFUM', 'BEB-BEZ'))))
    materials = []
    m = re.search(r'Materyal[: ]+([^.]*)', text)
    if code.startswith('GIY-') or 'giyim listesi' in text: materials = materials_giyim
    elif 'çanta listesi' in text: materials = materials_canta
    elif code == 'AYK': materials = 'Deri · Süet · Nubuk · Rugan · Tekstil · Kanvas · Suni Deri · Kauçuk · Hasır'.split(' · ')
    elif m and ' · ' in m[1]: materials = m[1].strip().split(' · ')
    templates.append(dict(code=code, label=code, compatibilityVersion=1, config=dict(
        fields=list(unique.values()), requiredGroups=groups, variantKey=vk,
        variantLabel=variant if vk else None,
        contentKeys=[k for k in ('hacim_ml','net_agirlik_g','paket_adedi') if k in unique] if vk == 'net_icerik' else [],
        shared=dict(color='Renk gizli' not in text, material='Materyal gizli' not in text and 'Materyal ve' not in text,
            dimensions=('En/Boy/Yükseklik görünür' in text or code.startswith('EV-'))),
        materialLabels=materials)))

# Explicit product-level diaper count: approved after version 3 review.
by_code = {t['code']:t for t in templates}
by_code['BEB-BEZ']['config']['fields'] = [dict(key='bez_numarasi',required=True),dict(key='paket_adedi',required=True),dict(key='kilo_araligi',required=False)]
for t in templates:
    if t['code'].startswith('EV-'): t['config']['shared']['material'] = True
    if t['code'] == 'KOZ-BAKIM': t['config']['shared'].update(color=False, material=False)
    for b in t['config']['fields']:
        if b['key'] == 'kullanim' and t['code'].startswith('SPR-'): b['optionIds']=['spor','outdoor']
        if b['key'] == 'kullanim' and (t['code'].startswith('GIY-') or t['code']=='AYK'): b['optionIds']=['gunluk','spor','outdoor']
        if b['key'] == 'kullanim' and t['code']=='ELK-BAKIM-ALETI': b['key']='guc_kullanimi'

root_name = root_slug = None
for line in section('### 5.1', '### 5.2').splitlines():
    root = re.match(r'#### (.*?) · `/kategori/([^`]+)`',line)
    if root:
        root_name,root_slug = root.groups()
        if root_slug not in ('ev','ofis'):
            nodes.append(dict(slug=root_slug,name=root_name,parentSlug=None,templateCode=None))
        continue
    branch = re.match(r'- \*\*(.*?)\*\* · `([^`]+)` — (.*)',line)
    if not branch: continue
    name, code, leaf_text = branch.groups()
    branch_slug = f'{root_slug}-{slug(name)}'
    if root_slug in ('ev','ofis'): continue
    nodes.append(dict(slug=branch_slug,name=name,parentSlug=root_slug,templateCode=code))
    for leaf in leaf_text.split(', '):
        override = re.search(r' `([^`]+)`',leaf)
        leaf_name = re.sub(r' `[^`]+`','',leaf).replace('⁺','').replace('°','')
        nodes.append(dict(slug=f'{branch_slug}-{slug(leaf_name)}',name=leaf_name,parentSlug=branch_slug,
            templateCode=override[1] if override else None))

assert len(templates)==50 and len(nodes)==337 and len(size_sets)==14
assert len(set(v for vs in size_sets.values() for v in vs))==154
catalog=dict(fields=list(fields.values()), templates=templates, nodes=nodes)
(ROOT/'api/domain/category-catalog.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'templates':len(templates),'nodes':len(nodes),'fields':len(fields)},ensure_ascii=False))
