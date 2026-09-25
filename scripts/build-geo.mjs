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
import { geoCentroid } from 'd3-geo';
import { union } from '@turf/union';
import simplify from '@turf/simplify';
import kinks from '@turf/kinks';
import truncate from '@turf/truncate';
import buffer from '@turf/buffer';
import area from '@turf/area';
import { difference as polyDifference } from 'polyclip-ts';

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

// Certains territoires (Extrême-Orient russe via la Tchoukotka, Outback/Pacifique via
// Fidji...) traversent l'antiméridien (180°/-180°). Sans traitement, un anneau qui va de
// +179° à -179° est interprété comme un aller-retour de 358° autour de tout le globe :
// forme aberrante, fusion/rendu qui explosent. On "déplie" ces anneaux (ex: 179 puis 181
// au lieu de 179 puis -179) pour qu'ils restent géométriquement continus ; le rendu final
// (three-globe) accepte des longitudes hors -180/180 sans problème (fonctions périodiques).
function unwrapGeometry(geometry) {
  const rings =
    geometry.type === 'Polygon' ? geometry.coordinates
    : geometry.type === 'MultiPolygon' ? geometry.coordinates.flat()
    : [];
  let minLon = 999, maxLon = -999;
  for (const ring of rings) for (const [lon] of ring) { if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon; }
  // Un même morceau qui contient à la fois des points très à l'est (>150°) et très à
  // l'ouest (<-150°) traverse presque certainement l'antiméridien plutôt que de couvrir
  // légitimement toute la largeur du globe. On ramène tout dans un repère continu
  // (0°→360° pour ce territoire) au lieu du saut +180°/-180°.
  if (maxLon > 150 && minLon < -150) {
    const shift = ([lon, lat]) => [lon < 0 ? lon + 360 : lon, lat];
    if (geometry.type === 'Polygon') geometry.coordinates = geometry.coordinates.map((r) => r.map(shift));
    else if (geometry.type === 'MultiPolygon') geometry.coordinates = geometry.coordinates.map((p) => p.map((r) => r.map(shift)));
  }
  return geometry;
}

const features = [];
const unmatched = [];

for (const c of countries) {
  const name = c.properties.name;
  if (SUBDIVIDED.has(name)) continue;
  if (name === 'Antarctica') continue;
  const territoireId = COUNTRY_TO_TERRITOIRE[name];
  if (!territoireId) { unmatched.push(name); continue; }
  features.push({ type: 'Feature', properties: { territoireId }, geometry: unwrapGeometry(c.geometry) });
}

// ---- 2. Pays subdivisés en États/provinces réels ----
function addSubdivision(file, nameToTerritoire, propKey = 'name') {
  const data = loadJSON(path.join(root, 'scripts/raw', file));
  const feats = data.features || [];
  for (const f of feats) {
    const name = f.properties[propKey];
    const territoireId = nameToTerritoire[name];
    if (!territoireId) { unmatched.push(`[${file}] ${name}`); continue; }
    features.push({ type: 'Feature', properties: { territoireId }, geometry: unwrapGeometry(f.geometry) });
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

// ---- 3. Fusion : un territoire = une seule forme ----
// Jusqu'ici chaque pays/État reste une feature séparée (frontières internes visibles).
// On les fusionne maintenant par territoireId en une seule (multi)géométrie dont le
// contour est le vrai tracé extérieur de l'ensemble des pays/États qui le composent
// (les frontières internes disparaissent, la frontière externe reste réelle).

// Pas de simplification avant la fusion : Douglas-Peucker (turf/simplify) casse la
// topologie sur des tracés complexes (auto-intersections), ce qui bloque ensuite la
// triangulation du globe. La fusion elle-même réduit déjà beaucoup le nombre de points
// (les frontières internes partagées entre pays/États voisins disparaissent).
//
// En revanche on arrondit les coordonnées à 10⁻⁵ degré (~1 m) avant fusion : les frontières
// partagées entre deux pays/États voisins viennent de fichiers sources différents et ne
// tombent jamais exactement sur les mêmes flottants, ce qui laisse des micro-écarts que la
// fusion transforme en auto-intersections. Arrondir les fait coïncider exactement.
for (const f of features) truncate(f, { precision: 5, mutate: true });

// Certaines sources (États brésiliens, russes, australiens en particulier) contiennent des
// polygones déjà auto-intersectants à la base (défaut du fichier d'origine, ex. Maranhão :
// 143 auto-intersections avant même toute fusion). On les répare avec un léger "gonflage"
// géométrique (~11 m, invisible à l'échelle du plateau) qui reconstruit un contour valide.
function countKinksIn(geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry] : geometry.coordinates.map((c) => ({ type: 'Polygon', coordinates: c }));
  let total = 0;
  for (const p of polys) {
    try { total += kinks({ type: 'Feature', properties: {}, geometry: p }).features.length; } catch { total += 1; }
  }
  return total;
}
let repaired = 0;
for (const f of features) {
  if (countKinksIn(f.geometry) > 0) {
    try {
      const fixed = buffer(f, 0.0001, { units: 'degrees' });
      if (countKinksIn(fixed.geometry) === 0) { f.geometry = fixed.geometry; repaired++; }
    } catch { /* laissé tel quel, sera retenté si besoin après fusion */ }
  }
}
if (repaired) console.log(`${repaired} géométrie(s) source(s) réparée(s) (auto-intersections d'origine).`);

const byTerritoire = {};
for (const f of features) {
  (byTerritoire[f.properties.territoireId] ??= []).push(f);
}

const merged = [];
const fusionEchecs = [];

for (const [territoireId, feats] of Object.entries(byTerritoire)) {
  let geometry;
  if (feats.length === 1) {
    geometry = feats[0].geometry;
  } else {
    try {
      const fc = { type: 'FeatureCollection', features: feats.map((f) => ({ type: 'Feature', properties: {}, geometry: f.geometry })) };
      const unioned = union(fc);
      geometry = unioned.geometry;
    } catch (err) {
      fusionEchecs.push(`${territoireId}: ${err.message}`);
      // Repli : on garde les morceaux séparés en une seule MultiPolygon (frontières
      // internes visibles pour ce territoire seulement, à défaut de mieux).
      const polys = [];
      for (const f of feats) {
        if (f.geometry.type === 'Polygon') polys.push(f.geometry.coordinates);
        else if (f.geometry.type === 'MultiPolygon') polys.push(...f.geometry.coordinates);
      }
      geometry = { type: 'MultiPolygon', coordinates: polys };
    }
  }

  const feature = { type: 'Feature', properties: { territoireId }, geometry };
  merged.push(feature);
}

// ---- 3.5 Cases maritimes ----
// Pas de source Natural Earth pour la mer : chaque grand ensemble (océan/mer — une région de
// jeu, voir data/territoires.js) est subdivisé ici à la main en cases mer, chacune une zone
// candidate faite de traits droits (sur la carte à plat) dont main.js soustrait ensuite la
// terre (computeDisplayGeometry) pour que son bord côtier suive la vraie côte. Un contour peut
// donc passer librement par la terre : seul compte le tracé de ses bords EN MER.
//
// Les zones sont listées par PRIORITÉ : chacune perd ce que recouvrent déjà les précédentes.
// Une mer intérieure (ex. Mer du Nord et Baltique) se découpe ainsi simplement dans le grand
// rectangle d'océan qui l'englobe, sans avoir à suivre ses côtes à la main, et deux cases ne
// se chevauchent jamais en mer (la Mer des Caraïbes, par exemple, sort de l'Atlantique
// Nord-Ouest au lieu d'y être en double).
//
// Bord extérieur à 179.9°/-179.9° plutôt que pile ±180° : un sommet EXACTEMENT sur
// l'antiméridien fait basculer le pré-découpage antiméridien de d3-geo (main.js) dans un cas
// limite qui produit un anneau dégénéré ("invalid polygon, fewer than 4 points" pendant la
// simplification). Écart invisible à l'échelle du plateau (~11 km à l'équateur).
const MARITIME_ZONES = [
  // Mer du Nord et Baltique : fermée au nord par un trait nord de l'Écosse → côte norvégienne,
  // et au sud-ouest par le Pas de Calais ; le reste du contour passe par les terres.
  ['mer-nord-baltique', [[-3.3, 58.5], [5.2, 61.0], [7.5, 60.8], [12, 63.5], [15, 66.5], [26, 66.3], [31, 64], [33, 58], [25, 53], [12, 52.5], [6, 52.5], [3, 50.5], [1.75, 50.8], [1.2, 51.15], [-1, 51.5], [-2.5, 53], [-2.5, 54.5], [-3.5, 55.6], [-4.3, 56.5], [-4.8, 57.6]]],
  // Mer de Norvège : du méridien 0° jusqu'au trait pôle Nord → côte nord de la Norvège (29.5°E,
  // sur la péninsule de Varanger, juste avant la frontière russe : la Norvège reste ainsi
  // bordée, à l'est de ce trait, par l'Arctique oriental qui longe la Russie).
  ['mer-norvege', [[0, 90], [29.5, 90], [29.5, 70.35], [26, 69.3], [20, 58], [0, 58]]],
  ['mer-arctique-est', [[26, 66], [179.9, 66], [179.9, 90], [29.5, 90], [29.5, 70.35], [26, 69.3]]],
  ['mer-arctique-ouest', [[-179.9, 66], [0, 66], [0, 90], [-179.9, 90]]],

  // Méditerranée occidentale : ne déborde plus dans le golfe de Gascogne (contour par
  // l'Espagne et la France), s'ouvre sur l'Atlantique au détroit de Gibraltar (-5.9°).
  ['mer-mediterranee-ouest', [[-5.9, 30], [15, 30], [15, 46], [3, 46], [0, 43.5], [-2, 42.5], [-5.9, 36.3]]],
  ['mer-mediterranee-est', [[15, 30], [36, 30], [36, 46], [15, 46]]],

  ['mer-caraibes-ouest', [[-98, 7], [-76, 7], [-76, 31], [-98, 31]]],
  ['mer-caraibes-est', [[-76, 7], [-55, 7], [-55, 31], [-76, 31]]],

  // Atlantique Nord-Est (côtier) : entre le trait (-20°, 66°N) → côte du Maroc (près de Safi)
  // et les côtes d'Europe/du Maroc, jusqu'au Pas de Calais et à Gibraltar.
  ['mer-atlantiquenord-est', [[-20, 66], [0, 66], [2, 51], [2, 50.5], [0, 45], [-2, 42.5], [-5.9, 36.3], [-5.9, 35.6], [-6, 34], [-9, 31.5]]],
  // Atlantique Nord central : le reste de l'ancien rectangle Nord-Est.
  ['mer-atlantiquenord-centre', [[-40, 0], [0, 0], [0, 66], [-40, 66]]],
  ['mer-atlantiquenord-ouest', [[-80, 0], [-40, 0], [-40, 66], [-80, 66]]],

  ['mer-atlantiquesud-ouest', [[-70, -60], [-25, -60], [-25, 0], [-70, 0]]],
  ['mer-atlantiquesud-est', [[-25, -60], [20, -60], [20, 0], [-25, 0]]],

  ['mer-pacifiquenord-ouest', [[120, 0], [179.9, 0], [179.9, 66], [120, 66]]],
  ['mer-pacifiquenord-est', [[-179.9, 0], [-100, 0], [-100, 66], [-179.9, 66]]],

  ['mer-pacifiquesud-ouest', [[120, -60], [179.9, -60], [179.9, 0], [120, 0]]],
  ['mer-pacifiquesud-est', [[-179.9, -60], [-70, -60], [-70, 0], [-179.9, 0]]],

  ['mer-indien-ouest', [[20, -60], [70, -60], [70, 30], [20, 30]]],
  ['mer-indien-est', [[70, -60], [120, -60], [120, 30], [70, 30]]],
];
const zonesDejaPrises = [];
for (const [territoireId, points] of MARITIME_ZONES) {
  const candidate = [[...points, points[0]]];
  const pieces = zonesDejaPrises.length ? polyDifference([candidate], ...zonesDejaPrises) : [candidate];
  zonesDejaPrises.push([candidate]);
  if (!pieces.length) throw new Error(`Case maritime ${territoireId} entièrement recouverte par les précédentes`);
  merged.push({
    type: 'Feature',
    properties: { territoireId },
    geometry: pieces.length === 1 ? { type: 'Polygon', coordinates: pieces[0] } : { type: 'MultiPolygon', coordinates: pieces },
  });
}

// ---- 4. Nettoyage et simplification, île par île ----
// Un territoire fusionné (surtout les archipels : Extrême-Orient russe, Grand Nord
// canadien, Outback/Pacifique) est une MultiPolygon de centaines de morceaux séparés
// (chaque île, chaque presqu'île). Valider/réparer la forme entière d'un coup est lent et
// peu fiable ; on traite chaque morceau indépendamment (rapide, et un gonflage sur une
// petite île ne peut pas accidentellement chevaucher une île lointaine).
function countKinksOfPolygon(polygonCoords) {
  try { return kinks({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: polygonCoords } }).features.length; }
  catch { return 1; }
}

// Certains morceaux fusionnés (ex. littoral brésilien) contiennent des dizaines de
// minuscules trous internes (< 50 km²), artefacts de la fusion plutôt que de vraies
// enclaves. Ces trous bloquent ensuite la simplification (Douglas-Peucker en crée des
// auto-intersections) sans être visibles à l'échelle du plateau : on les retire.
const HOLE_AREA_MIN_M2 = 50_000_000; // 50 km²
function ringAreaM2(ring) {
  try { return area({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }); }
  catch { return 0; }
}
function stripTinyHoles(polygonCoords) {
  if (polygonCoords.length <= 1) return polygonCoords;
  const [exterior, ...holes] = polygonCoords;
  const keptHoles = holes.filter((h) => ringAreaM2(h) >= HOLE_AREA_MIN_M2);
  return [exterior, ...keptHoles];
}

function cleanPiece(polygonCoords) {
  polygonCoords = stripTinyHoles(polygonCoords);
  if (countKinksOfPolygon(polygonCoords) === 0) return polygonCoords;
  const asFeature = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: polygonCoords } };
  for (const dist of [0.0002, 0.001, 0.005, 0.02]) {
    try {
      const fixed = buffer(asFeature, dist, { units: 'degrees' });
      if (fixed && countKinksOfPolygon(fixed.geometry.coordinates) === 0) return fixed.geometry.coordinates;
    } catch { /* essaie la distance suivante */ }
  }
  for (const tolerance of [0.02, 0.08, 0.2]) {
    const simplified = simplify(asFeature, { tolerance, highQuality: true, mutate: false });
    if (countKinksOfPolygon(simplified.geometry.coordinates) === 0) return simplified.geometry.coordinates;
  }
  return null; // irréparable : ce morceau (typiquement un minuscule îlot) est abandonné
}

function simplifyPieceIfValid(polygonCoords) {
  for (const tolerance of [0.05, 0.03, 0.015, 0.008, 0.003]) {
    const simplified = simplify({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: polygonCoords } }, { tolerance, highQuality: true, mutate: false });
    if (countKinksOfPolygon(simplified.geometry.coordinates) === 0) return simplified.geometry.coordinates;
  }
  return polygonCoords;
}

// Un territoire fusionné peut compter jusqu'à plusieurs centaines de morceaux séparés
// (îlots minuscules, langues de terre isolées). À l'échelle de ce plateau (47 territoires
// pour toute la planète), un confetti de quelques km² n'a aucune importance de jeu et ne
// fait que coûter une triangulation et une zone cliquable au rendu — ce qui a fini par
// ralentir sérieusement l'appareil de test. Plutôt qu'un calcul savant (couverture d'aire
// cumulée, plafond de nombre...), on tranche simplement : sous ce seuil de surface, un
// morceau est ignoré, un point c'est tout — pas de tracé de frontière pour de simples îlots.
const MIN_PIECE_AREA_M2 = 3_000 * 1e6; // 3000 km² (~taille de la Corse)
function pieceAreaM2(coords) {
  try { return area({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: coords } }); }
  catch { return 0; }
}
function keepSignificantPieces(pieces) {
  if (pieces.length <= 1) return pieces;
  const withArea = pieces.map((coords) => ({ coords, area: pieceAreaM2(coords) }));
  const significant = withArea.filter((p) => p.area >= MIN_PIECE_AREA_M2).map((p) => p.coords);
  if (significant.length > 0) return significant;
  // Cas rare : le territoire n'est fait que de petites îles (aucune ne dépasse le seuil).
  // On garde quand même la plus grande pour ne jamais laisser un territoire sans forme.
  withArea.sort((a, b) => b.area - a.area);
  return [withArea[0].coords];
}

const abandonedPieces = [];
for (const feature of merged) {
  const rawPieces = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  const pieces = keepSignificantPieces(rawPieces);
  const cleaned = [];
  for (const piece of pieces) {
    const fixed = cleanPiece(piece);
    if (fixed) cleaned.push(simplifyPieceIfValid(fixed));
    else abandonedPieces.push(feature.properties.territoireId);
  }
  if (cleaned.length > 0) {
    feature.geometry = cleaned.length === 1
      ? { type: 'Polygon', coordinates: cleaned[0] }
      : { type: 'MultiPolygon', coordinates: cleaned };
  } // sinon (cas extrême) : on garde la géométrie fusionnée d'origine telle quelle
}

const centroides = {};
for (const feature of merged) {
  const [lon, lat] = geoCentroid(feature);
  centroides[feature.properties.territoireId] = [lon, lat];
}

const geojson = { type: 'FeatureCollection', features: merged };

mkdirSync(path.join(root, 'public/geo'), { recursive: true });
writeFileSync(path.join(root, 'public/geo/territoires.geo.json'), JSON.stringify(geojson));
writeFileSync(path.join(root, 'public/geo/centroides.json'), JSON.stringify(centroides));

console.log(`OK: ${geojson.features.length} territoires fusionnés écrits dans public/geo/territoires.geo.json`);
if (fusionEchecs.length) {
  console.log(`\n${fusionEchecs.length} fusion(s) en échec (repli sur multi-formes non fusionnées) :`);
  console.log(fusionEchecs.join('\n'));
}
if (abandonedPieces.length) {
  console.log(`\n${abandonedPieces.length} petit(s) morceau(x) irréparable(s) abandonné(s) (îlot négligeable) sur :`);
  console.log([...new Set(abandonedPieces)].join(', '));
}
if (unmatched.length) {
  console.log(`\n${unmatched.length} entités non reconnues (ignorées) :`);
  console.log(unmatched.join(', '));
}
