// Assemble un seul GeoJSON (public/geo/territoires.geo.json) à partir de :
// - world-atlas (frontières de pays réelles, Natural Earth)
// - 7 fichiers d'États/provinces réels (US, Canada, Brésil, Chine, Inde, Australie, Russie)
// Chaque feature ne porte qu'un seul attribut utile : territoireId (le reste des
// données de jeu vit dans src/data/territoires.js, jointe au runtime).
//
// Hypothèses géographiques faites faute d'indication explicite dans le tableau validé
// (à corriger si besoin, voir le message de livraison) :
//  - Ukraine, Biélorussie, Moldavie -> Europe centrale
//  - Scandinavie, Pays baltes, Groenland, Îles Féroé -> Europe germanique
//  - Caucase (Géorgie, Arménie, Azerbaïdjan) -> Russie occidentale
//  - Asie centrale (Kazakhstan, Ouzbékistan, Turkménistan, Kirghizistan, Tadjikistan) -> Sibérie occidentale
//  - Mongolie -> Chine du Nord
//  - Turquie, Iran, Chypre -> Mésopotamie/Levant
//  - Petits territoires/îles isolés (Bermudes, Falklands, Polynésie française, etc.) -> non représentés

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as topojson from 'topojson-client';
import { geoCentroid, geoArea } from 'd3-geo';
import simplify from '@turf/simplify';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function loadJSON(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}

// ---- 1. Pays entiers (world-atlas, Natural Earth 50m) ----
const world = loadJSON(path.join(root, 'node_modules/world-atlas/countries-50m.json'));
const countries = topojson.feature(world, world.objects.countries).features;

// Pays gérés via subdivisions (retirés de la couche "pays entiers")
const SUBDIVIDED = new Set(['United States of America', 'Canada', 'Brazil', 'China', 'India', 'Australia', 'Russia']);

// nom (world-atlas) -> territoireId
const COUNTRY_TO_TERRITOIRE = {
  // Amériques
  'Mexico': 'mx-central',
  'Guatemala': 'mx-ameriquecentrale', 'Belize': 'mx-ameriquecentrale', 'Honduras': 'mx-ameriquecentrale',
  'El Salvador': 'mx-ameriquecentrale', 'Nicaragua': 'mx-ameriquecentrale', 'Costa Rica': 'mx-ameriquecentrale',
  'Panama': 'mx-ameriquecentrale', 'Cuba': 'mx-ameriquecentrale', 'Haiti': 'mx-ameriquecentrale',
  'Dominican Rep.': 'mx-ameriquecentrale', 'Jamaica': 'mx-ameriquecentrale', 'Bahamas': 'mx-ameriquecentrale',
  'Trinidad and Tobago': 'mx-ameriquecentrale', 'Belize': 'mx-ameriquecentrale',
  'Antigua and Barb.': 'mx-ameriquecentrale', 'Barbados': 'mx-ameriquecentrale', 'Dominica': 'mx-ameriquecentrale',
  'Grenada': 'mx-ameriquecentrale', 'St. Kitts and Nevis': 'mx-ameriquecentrale', 'Saint Lucia': 'mx-ameriquecentrale',
  'St. Vin. and Gren.': 'mx-ameriquecentrale',
  'Argentina': 'as-conesud', 'Chile': 'as-conesud', 'Uruguay': 'as-conesud', 'Paraguay': 'as-conesud',
  'Bolivia': 'as-andes', 'Peru': 'as-andes', 'Ecuador': 'as-andes', 'Colombia': 'as-andes',
  'Venezuela': 'as-andes', 'Guyana': 'as-andes', 'Suriname': 'as-andes',

  // Europe
  'France': 'eu-francebenelux', 'Belgium': 'eu-francebenelux', 'Netherlands': 'eu-francebenelux', 'Luxembourg': 'eu-francebenelux',
  'Germany': 'eu-germanique', 'Austria': 'eu-germanique', 'Switzerland': 'eu-germanique', 'Liechtenstein': 'eu-germanique',
  'Norway': 'eu-germanique', 'Sweden': 'eu-germanique', 'Finland': 'eu-germanique', 'Denmark': 'eu-germanique',
  'Estonia': 'eu-germanique', 'Latvia': 'eu-germanique', 'Lithuania': 'eu-germanique',
  'Greenland': 'eu-germanique', 'Faeroe Is.': 'eu-germanique', 'Iceland': 'eu-germanique',
  'United Kingdom': 'eu-uk', 'Ireland': 'eu-uk',
  'Spain': 'eu-iberique', 'Portugal': 'eu-iberique', 'Andorra': 'eu-iberique',
  'Italy': 'eu-italienne', 'Vatican': 'eu-italienne', 'San Marino': 'eu-italienne', 'Malta': 'eu-italienne',
  'Poland': 'eu-centrale', 'Czechia': 'eu-centrale', 'Slovakia': 'eu-centrale', 'Hungary': 'eu-centrale',
  'Ukraine': 'eu-centrale', 'Belarus': 'eu-centrale', 'Moldova': 'eu-centrale',
  'Greece': 'eu-balkans', 'Albania': 'eu-balkans', 'Bosnia and Herz.': 'eu-balkans', 'Croatia': 'eu-balkans',
  'Serbia': 'eu-balkans', 'Montenegro': 'eu-balkans', 'Macedonia': 'eu-balkans', 'Kosovo': 'eu-balkans',
  'Bulgaria': 'eu-balkans', 'Romania': 'eu-balkans', 'Slovenia': 'eu-balkans',

  // Russie & Eurasie (hors Russie elle-même, gérée via subdivisions)
  'Georgia': 'ru-occidentale', 'Armenia': 'ru-occidentale', 'Azerbaijan': 'ru-occidentale',
  'Kazakhstan': 'ru-siboccidentale', 'Uzbekistan': 'ru-siboccidentale', 'Turkmenistan': 'ru-siboccidentale',
  'Kyrgyzstan': 'ru-siboccidentale', 'Tajikistan': 'ru-siboccidentale', 'Mongolia': 'cn-nord',

  // Moyen-Orient
  'Saudi Arabia': 'mo-peninsulearabique', 'United Arab Emirates': 'mo-peninsulearabique', 'Qatar': 'mo-peninsulearabique',
  'Kuwait': 'mo-peninsulearabique', 'Bahrain': 'mo-peninsulearabique', 'Oman': 'mo-peninsulearabique', 'Yemen': 'mo-peninsulearabique',
  'Turkey': 'mo-mesopotamielevant', 'Syria': 'mo-mesopotamielevant', 'Iraq': 'mo-mesopotamielevant',
  'Lebanon': 'mo-mesopotamielevant', 'Jordan': 'mo-mesopotamielevant', 'Israel': 'mo-mesopotamielevant',
  'Palestine': 'mo-mesopotamielevant', 'Iran': 'mo-mesopotamielevant', 'Cyprus': 'mo-mesopotamielevant', 'N. Cyprus': 'mo-mesopotamielevant',

  // Afrique du Nord
  'Egypt': 'an-valleedunil', 'Sudan': 'an-valleedunil',
  'Morocco': 'an-sahara', 'Algeria': 'an-sahara', 'Tunisia': 'an-sahara', 'Libya': 'an-sahara', 'W. Sahara': 'an-sahara',

  // Afrique de l'Ouest
  'Nigeria': 'ao-golfedeguinee', 'Ghana': 'ao-golfedeguinee', "Côte d'Ivoire": 'ao-golfedeguinee', 'Togo': 'ao-golfedeguinee',
  'Benin': 'ao-golfedeguinee', 'Liberia': 'ao-golfedeguinee', 'Sierra Leone': 'ao-golfedeguinee', 'Guinea': 'ao-golfedeguinee',
  'Guinea-Bissau': 'ao-golfedeguinee', 'Gambia': 'ao-golfedeguinee', 'Cabo Verde': 'ao-golfedeguinee',
  'Senegal': 'ao-sahel', 'Mali': 'ao-sahel', 'Niger': 'ao-sahel', 'Burkina Faso': 'ao-sahel', 'Mauritania': 'ao-sahel', 'Chad': 'ao-sahel',

  // Afrique centrale & orientale
  'Dem. Rep. Congo': 'ac-bassinducongo', 'Congo': 'ac-bassinducongo', 'Gabon': 'ac-bassinducongo',
  'Central African Rep.': 'ac-bassinducongo', 'Cameroon': 'ac-bassinducongo', 'Eq. Guinea': 'ac-bassinducongo',
  'São Tomé and Principe': 'ac-bassinducongo',
  'Kenya': 'ac-esteafricain', 'Tanzania': 'ac-esteafricain', 'Somalia': 'ac-esteafricain', 'Somaliland': 'ac-esteafricain',
  'Djibouti': 'ac-esteafricain', 'Eritrea': 'ac-esteafricain', 'Ethiopia': 'ac-esteafricain', 'S. Sudan': 'ac-esteafricain',
  'Uganda': 'ac-esteafricain', 'Rwanda': 'ac-esteafricain', 'Burundi': 'ac-esteafricain', 'Madagascar': 'ac-esteafricain',
  'Comoros': 'ac-esteafricain', 'Seychelles': 'ac-esteafricain', 'Mauritius': 'ac-esteafricain',

  // Afrique australe
  'South Africa': 'aa-afriquedusud', 'Lesotho': 'aa-afriquedusud', 'eSwatini': 'aa-afriquedusud',
  'Namibia': 'aa-interieuraustral', 'Botswana': 'aa-interieuraustral', 'Zimbabwe': 'aa-interieuraustral',
  'Mozambique': 'aa-interieuraustral', 'Zambia': 'aa-interieuraustral', 'Malawi': 'aa-interieuraustral', 'Angola': 'aa-interieuraustral',

  // Japon & Corée
  'Japan': 'jp-archipel', 'North Korea': 'kr-peninsule', 'South Korea': 'kr-peninsule',

  // Asie du Sud
  'Pakistan': 'as-asiedusud', 'Bangladesh': 'as-asiedusud', 'Nepal': 'as-asiedusud', 'Bhutan': 'as-asiedusud',
  'Sri Lanka': 'as-asiedusud', 'Afghanistan': 'as-asiedusud', 'Maldives': 'as-asiedusud',

  // Asie du Sud-Est
  'Malaysia': 'se-peninsulemalaise', 'Singapore': 'se-peninsulemalaise', 'Brunei': 'se-peninsulemalaise',
  'Indonesia': 'se-peninsulemalaise', 'Philippines': 'se-peninsulemalaise', 'Timor-Leste': 'se-peninsulemalaise',
  'Thailand': 'se-indochine', 'Vietnam': 'se-indochine', 'Myanmar': 'se-indochine', 'Laos': 'se-indochine', 'Cambodia': 'se-indochine',

  // Océanie (hors Australie, gérée via subdivisions)
  'Papua New Guinea': 'oc-outbackpacifique', 'New Zealand': 'oc-outbackpacifique', 'Fiji': 'oc-outbackpacifique',
  'Solomon Is.': 'oc-outbackpacifique', 'Vanuatu': 'oc-outbackpacifique', 'New Caledonia': 'oc-outbackpacifique',
  'Samoa': 'oc-outbackpacifique', 'Tonga': 'oc-outbackpacifique', 'Kiribati': 'oc-outbackpacifique',
  'Micronesia': 'oc-outbackpacifique', 'Palau': 'oc-outbackpacifique', 'Marshall Is.': 'oc-outbackpacifique', 'Nauru': 'oc-outbackpacifique',
};

const features = [];
const unmatched = [];

for (const c of countries) {
  const name = c.properties.name;
  if (SUBDIVIDED.has(name)) continue;
  if (name === 'Antarctica') continue;
  const territoireId = COUNTRY_TO_TERRITOIRE[name];
  if (!territoireId) { unmatched.push(name); continue; }
  features.push({ type: 'Feature', properties: { territoireId }, geometry: c.geometry });
}

// ---- 2. Pays subdivisés en États/provinces réels ----
function addSubdivision(file, nameToTerritoire, propKey = 'name') {
  const data = loadJSON(path.join(root, 'scripts/raw', file));
  const feats = data.features || [];
  for (const f of feats) {
    const name = f.properties[propKey];
    const territoireId = nameToTerritoire[name];
    if (!territoireId) { unmatched.push(`[${file}] ${name}`); continue; }
    features.push({ type: 'Feature', properties: { territoireId }, geometry: f.geometry });
  }
}

addSubdivision('us-states.json', {
  Maine: 'us-nordest', 'New Hampshire': 'us-nordest', Vermont: 'us-nordest', Massachusetts: 'us-nordest',
  'Rhode Island': 'us-nordest', Connecticut: 'us-nordest', 'New York': 'us-nordest', 'New Jersey': 'us-nordest',
  Pennsylvania: 'us-nordest', Delaware: 'us-nordest', Maryland: 'us-nordest', 'District of Columbia': 'us-nordest',
  Virginia: 'us-nordest', 'West Virginia': 'us-nordest', 'North Carolina': 'us-nordest', 'South Carolina': 'us-nordest',
  Georgia: 'us-nordest', Florida: 'us-nordest',
  Ohio: 'us-grandslacs', Michigan: 'us-grandslacs', Indiana: 'us-grandslacs', Illinois: 'us-grandslacs',
  Wisconsin: 'us-grandslacs', Minnesota: 'us-grandslacs', Iowa: 'us-grandslacs', Missouri: 'us-grandslacs',
  Kentucky: 'us-grandslacs', Tennessee: 'us-grandslacs',
  Texas: 'us-sud', Oklahoma: 'us-sud', Kansas: 'us-sud', Nebraska: 'us-sud', 'North Dakota': 'us-sud',
  'South Dakota': 'us-sud', Arkansas: 'us-sud', Louisiana: 'us-sud', Mississippi: 'us-sud', Alabama: 'us-sud',
  California: 'us-ouest', Oregon: 'us-ouest', Washington: 'us-ouest', Nevada: 'us-ouest', Idaho: 'us-ouest',
  Montana: 'us-ouest', Wyoming: 'us-ouest', Utah: 'us-ouest', Colorado: 'us-ouest', Arizona: 'us-ouest', 'New Mexico': 'us-ouest',
});

addSubdivision('ca-provinces.json', {
  Quebec: 'ca-oriental', Ontario: 'ca-oriental', 'Newfoundland and Labrador': 'ca-oriental',
  'New Brunswick': 'ca-oriental', 'Nova Scotia': 'ca-oriental', 'Prince Edward Island': 'ca-oriental',
  'British Columbia': 'ca-nord', Alberta: 'ca-nord', Saskatchewan: 'ca-nord', Manitoba: 'ca-nord',
  'Yukon Territory': 'ca-nord', 'Northwest Territories': 'ca-nord', Nunavut: 'ca-nord',
});

addSubdivision('br-states.json', {
  'São Paulo': 'br-littoral', 'Rio de Janeiro': 'br-littoral', 'Minas Gerais': 'br-littoral', 'Espírito Santo': 'br-littoral',
  Paraná: 'br-littoral', 'Santa Catarina': 'br-littoral', 'Rio Grande do Sul': 'br-littoral', Bahia: 'br-littoral',
  Pernambuco: 'br-littoral', Ceará: 'br-littoral', 'Rio Grande do Norte': 'br-littoral', Paraíba: 'br-littoral',
  Alagoas: 'br-littoral', Sergipe: 'br-littoral', Maranhão: 'br-littoral', Piauí: 'br-littoral',
  Amazonas: 'br-amazonie', Pará: 'br-amazonie', Acre: 'br-amazonie', Rondônia: 'br-amazonie', Roraima: 'br-amazonie', Amapá: 'br-amazonie',
  'Mato Grosso': 'br-transamazonienne', 'Mato Grosso do Sul': 'br-transamazonienne', Goiás: 'br-transamazonienne',
  'Distrito Federal': 'br-transamazonienne', Tocantins: 'br-transamazonienne',
});

addSubdivision('cn-provinces.json', {
  Beijing: 'cn-nord', Tianjin: 'cn-nord', Hebei: 'cn-nord', 'Inner Mongolia': 'cn-nord', Shanxi: 'cn-nord',
  Shaanxi: 'cn-nord', Henan: 'cn-nord', Liaoning: 'cn-nord', Jilin: 'cn-nord', Heilongjian: 'cn-nord',
  Shanghai: 'cn-cotiere', Jiangsu: 'cn-cotiere', Zhejiang: 'cn-cotiere', Fujian: 'cn-cotiere', Shandong: 'cn-cotiere',
  Anhui: 'cn-cotiere', Guangdong: 'cn-cotiere', Hainan: 'cn-cotiere', 'Hong Kong': 'cn-cotiere', Macau: 'cn-cotiere', Taiwan: 'cn-cotiere',
  Guangxi: 'cn-sud', Yunnan: 'cn-sud', Guizhou: 'cn-sud', Sichuan: 'cn-sud', Chongqing: 'cn-sud', Hubei: 'cn-sud', Hunan: 'cn-sud', Jiangxi: 'cn-sud',
  Xinjiang: 'cn-interieure', Tibet: 'cn-interieure', Qinghai: 'cn-interieure', Gansu: 'cn-interieure', Ningxia: 'cn-interieure',
});

addSubdivision('in-states.json', {
  Gujarat: 'in-cotiere', Maharashtra: 'in-cotiere', Goa: 'in-cotiere', Karnataka: 'in-cotiere', Kerala: 'in-cotiere',
  'Tamil Nadu': 'in-cotiere', 'Andhra Pradesh': 'in-cotiere', Odisha: 'in-cotiere', 'West Bengal': 'in-cotiere',
  Pondicherry: 'in-cotiere', 'Daman and Diu': 'in-cotiere', 'Dadra and Nagar Haveli': 'in-cotiere',
  'Andaman and Nicobar Islands': 'in-cotiere', Lakshadweep: 'in-cotiere',
  Rajasthan: 'in-deccan', Punjab: 'in-deccan', Haryana: 'in-deccan', Delhi: 'in-deccan', 'Uttar Pradesh': 'in-deccan',
  Uttarakhand: 'in-deccan', 'Himachal Pradesh': 'in-deccan', 'Jammu and Kashmir': 'in-deccan', Chandigarh: 'in-deccan',
  'Madhya Pradesh': 'in-deccan', Chhattisgarh: 'in-deccan', Jharkhand: 'in-deccan', Bihar: 'in-deccan', Assam: 'in-deccan',
  Sikkim: 'in-deccan', Manipur: 'in-deccan', Meghalaya: 'in-deccan', Mizoram: 'in-deccan', Nagaland: 'in-deccan',
  Tripura: 'in-deccan', Telangana: 'in-deccan',
});

addSubdivision('au-states.json', {
  'New South Wales': 'oc-australiecotiere', Victoria: 'oc-australiecotiere', Queensland: 'oc-australiecotiere',
  'South Australia': 'oc-australiecotiere', Tasmania: 'oc-australiecotiere', 'Australian Capital Territory': 'oc-australiecotiere',
  'Northern Territory': 'oc-outbackpacifique', 'Western Australia': 'oc-outbackpacifique', 'Other Territories': 'oc-outbackpacifique',
});

addSubdivision('ru-regions.json', {
  Moscow: 'ru-occidentale', 'Moscow Oblast': 'ru-occidentale', 'Saint Petersburg': 'ru-occidentale', 'Leningrad Oblast': 'ru-occidentale',
  'Kaliningrad Oblast': 'ru-occidentale', 'Novgorod Oblast': 'ru-occidentale', 'Pskov Oblast': 'ru-occidentale', 'Smolensk Oblast': 'ru-occidentale',
  'Bryansk Oblast': 'ru-occidentale', 'Kaluga Oblast': 'ru-occidentale', 'Tula Oblast': 'ru-occidentale', 'Oryol Oblast': 'ru-occidentale',
  'Kursk Oblast': 'ru-occidentale', 'Belgorod Oblast': 'ru-occidentale', 'Voronezh Oblast': 'ru-occidentale', 'Lipetsk Oblast': 'ru-occidentale',
  'Tambov Oblast': 'ru-occidentale', 'Ryazan Oblast': 'ru-occidentale', 'Vladimir Oblast': 'ru-occidentale', 'Ivanovo Oblast': 'ru-occidentale',
  'Yaroslavl Oblast': 'ru-occidentale', 'Kostroma Oblast': 'ru-occidentale', 'Tver Oblast': 'ru-occidentale', 'Vologda Oblast': 'ru-occidentale',
  'Arkhangelsk Oblast': 'ru-occidentale', 'Nenets Autonomous Okrug': 'ru-occidentale', 'Murmansk Oblast': 'ru-occidentale',
  'Republic of Karelia': 'ru-occidentale', 'Komi Republic': 'ru-occidentale', 'Kirov Oblast': 'ru-occidentale',
  'Nizhny Novgorod Oblast': 'ru-occidentale', 'Mari El Republic': 'ru-occidentale', 'Chuvash Republic': 'ru-occidentale',
  'Republic of Mordovia': 'ru-occidentale', 'Republic of Tatarstan': 'ru-occidentale', 'Ulyanovsk Oblast': 'ru-occidentale',
  'Samara Oblast': 'ru-occidentale', 'Penza Oblast': 'ru-occidentale', 'Saratov Oblast': 'ru-occidentale', 'Volgograd Oblast': 'ru-occidentale',
  'Astrakhan Oblast': 'ru-occidentale', 'Rostov Oblast': 'ru-occidentale', 'Krasnodar Krai': 'ru-occidentale', 'Stavropol Krai': 'ru-occidentale',
  'Republic of Adygea': 'ru-occidentale', 'Republic of Kalmykia': 'ru-occidentale', 'Republic of Dagestan': 'ru-occidentale',
  'Chechen Republic': 'ru-occidentale', 'Republic of Ingushetia': 'ru-occidentale', 'Kabardino-Balkar Republic': 'ru-occidentale',
  'Karachay-Cherkess Republic': 'ru-occidentale', 'Republic of North Ossetia-Alania': 'ru-occidentale',
  'Republic of Bashkortostan': 'ru-occidentale', 'Udmurt Republic': 'ru-occidentale', 'Perm Krai': 'ru-occidentale',
  'Orenburg Oblast': 'ru-occidentale', 'Sverdlovsk Oblast': 'ru-occidentale', 'Chelyabinsk Oblast': 'ru-occidentale', 'Kurgan Oblast': 'ru-occidentale',
  'Tyumen Oblast': 'ru-siboccidentale', 'Khanty–Mansi Autonomous Okrug – Yugra': 'ru-siboccidentale', 'Yamalo-Nenets Autonomous Okrug': 'ru-siboccidentale',
  'Omsk Oblast': 'ru-siboccidentale', 'Novosibirsk Oblast': 'ru-siboccidentale', 'Tomsk Oblast': 'ru-siboccidentale',
  'Altai Krai': 'ru-siboccidentale', 'Altai Republic': 'ru-siboccidentale', 'Kemerovo Oblast': 'ru-siboccidentale',
  'Krasnoyarsk Krai': 'ru-siborientale', 'Republic of Khakassia': 'ru-siborientale', 'Tuva Republic': 'ru-siborientale',
  'Irkutsk Oblast': 'ru-siborientale', 'Republic of Buryatia': 'ru-siborientale', 'Zabaykalsky Krai': 'ru-siborientale',
  'Sakha (Yakutia) Republic': 'ru-extremeorient', 'Amur Oblast': 'ru-extremeorient', 'Jewish Autonomous Oblast': 'ru-extremeorient',
  'Khabarovsk Krai': 'ru-extremeorient', 'Primorsky Krai': 'ru-extremeorient', 'Sakhalin Oblast': 'ru-extremeorient',
  'Magadan Oblast': 'ru-extremeorient', 'Kamchatka Krai': 'ru-extremeorient', 'Chukotka Autonomous Okrug': 'ru-extremeorient',
}, 'name_latin');

// Simplifie les tracés : on assemble un jeu de plateau (échelle territoire), pas une
// carte de précision. Sans ça, certains États dépassent 20k points et rendent le globe
// très lourd à afficher et à interagir (raycasting tactile en particulier sur iPad).
const geojson = simplify({ type: 'FeatureCollection', features }, { tolerance: 0.06, highQuality: false, mutate: true });

// ---- 3. Centre représentatif de chaque territoire (pour les marqueurs d'usine) ----
// Moyenne des centroïdes de chaque partie, pondérée par leur aire, pour rester
// dans la plus grande masse de terre du territoire (utile pour les archipels).
const byTerritoire = {};
for (const f of features) {
  (byTerritoire[f.properties.territoireId] ??= []).push(f);
}
const centroides = {};
for (const [id, feats] of Object.entries(byTerritoire)) {
  let sx = 0, sy = 0, sw = 0;
  for (const f of feats) {
    const area = Math.abs(geoArea(f));
    const [lon, lat] = geoCentroid(f);
    if (Number.isNaN(lon) || Number.isNaN(lat)) continue;
    sx += lon * area; sy += lat * area; sw += area;
  }
  centroides[id] = sw > 0 ? [sx / sw, sy / sw] : geoCentroid(feats[0]);
}

mkdirSync(path.join(root, 'public/geo'), { recursive: true });
writeFileSync(path.join(root, 'public/geo/territoires.geo.json'), JSON.stringify(geojson));
writeFileSync(path.join(root, 'public/geo/centroides.json'), JSON.stringify(centroides));

console.log(`OK: ${features.length} formes géographiques écrites dans public/geo/territoires.geo.json`);
if (unmatched.length) {
  console.log(`\n${unmatched.length} entités non reconnues (ignorées) :`);
  console.log(unmatched.join(', '));
}
