// Données de jeu — table validée par l'utilisateur (22 régions, 47 territoires, 18 villes, 25 slots Industrie).
// Séparé des données géographiques (voir data/geo.generated.json) pour rester facile à corriger.

export const TERRITOIRES = [
  // --- Amériques ---
  { id: 'us-nordest', bloc: 'Amériques', region: 'États-Unis', nom: 'Nord-Est', ressources: ['Denrées', 'Minerais'], enclavement: 0, slotIndustrie: 1, ville: { nom: 'New York', slots: 1, lat: 40.7128, lon: -74.0060 } },
  { id: 'us-grandslacs', bloc: 'Amériques', region: 'États-Unis', nom: 'Grands Lacs', ressources: ['Minerais', 'Énergie'], enclavement: 0, slotIndustrie: 1, ville: null },
  { id: 'us-sud', bloc: 'Amériques', region: 'États-Unis', nom: 'Sud', ressources: [], enclavement: 0, slotIndustrie: 0, ville: null },
  { id: 'us-ouest', bloc: 'Amériques', region: 'États-Unis', nom: 'Côte Ouest', ressources: [{ type: 'Terres rares', niveau: 2 }], enclavement: 0, slotIndustrie: 0, ville: { nom: 'Los Angeles', slots: 1, lat: 34.0522, lon: -118.2437 } },

  { id: 'ca-oriental', bloc: 'Amériques', region: 'Canada', nom: 'Canada oriental', ressources: ['Denrées', 'Minerais'], enclavement: 0, slotIndustrie: 1, ville: null },
  { id: 'ca-nord', bloc: 'Amériques', region: 'Canada', nom: 'Grand Nord canadien', ressources: [{ type: 'Terres rares', niveau: 1 }], enclavement: 2, slotIndustrie: 0, ville: null },

  { id: 'mx-central', bloc: 'Amériques', region: 'Mexique & Am. centrale', nom: 'Mexique central', ressources: ['Minerais', 'Denrées'], enclavement: 0, slotIndustrie: 1, ville: { nom: 'Mexico', slots: 1, lat: 19.4326, lon: -99.1332 } },
  { id: 'mx-ameriquecentrale', bloc: 'Amériques', region: 'Mexique & Am. centrale', nom: 'Amérique centrale', ressources: [], enclavement: 1, slotIndustrie: 0, ville: null },

  { id: 'br-littoral', bloc: 'Amériques', region: 'Brésil', nom: 'Littoral brésilien', ressources: ['Denrées', 'Minerais'], enclavement: 0, slotIndustrie: 1, ville: { nom: 'São Paulo', slots: 1, lat: -23.5505, lon: -46.6333 } },
  { id: 'br-amazonie', bloc: 'Amériques', region: 'Brésil', nom: 'Cœur amazonien', ressources: [{ type: 'Terres rares', niveau: 2 }], enclavement: 2, slotIndustrie: 0, ville: null },
  { id: 'br-transamazonienne', bloc: 'Amériques', region: 'Brésil', nom: 'Route transamazonienne', ressources: [], enclavement: 1, slotIndustrie: 0, ville: null },

  { id: 'as-conesud', bloc: 'Amériques', region: 'Amérique du Sud', nom: 'Cône Sud', ressources: ['Denrées'], enclavement: 0, slotIndustrie: 1, ville: null },
  { id: 'as-andes', bloc: 'Amériques', region: 'Amérique du Sud', nom: 'Cordillère des Andes', ressources: [], enclavement: 1, slotIndustrie: 0, ville: null },

  // --- Europe ---
  { id: 'eu-francebenelux', bloc: 'Europe', region: 'France & Benelux', nom: 'France & Benelux', ressources: ['Denrées', 'Minerais'], enclavement: 0, slotIndustrie: 1, ville: { nom: 'Paris', slots: 1, lat: 48.8566, lon: 2.3522 } },
  { id: 'eu-germanique', bloc: 'Europe', region: 'Europe germanique', nom: 'Europe germanique', ressources: ['Minerais', 'Énergie'], enclavement: 0, slotIndustrie: 1, ville: { nom: 'Francfort', slots: 1, lat: 50.1109, lon: 8.6821 } },
  { id: 'eu-uk', bloc: 'Europe', region: 'Royaume-Uni & Irlande', nom: 'Royaume-Uni & Irlande', ressources: ['Minerais', 'Énergie'], enclavement: 0, slotIndustrie: 1, ville: { nom: 'Londres', slots: 1, lat: 51.5074, lon: -0.1278 } },
  { id: 'eu-iberique', bloc: 'Europe', region: 'Europe méditerranéenne', nom: 'Péninsule ibérique', ressources: ['Denrées', 'Minerais'], enclavement: 0, slotIndustrie: 1, ville: null },
  { id: 'eu-italienne', bloc: 'Europe', region: 'Europe méditerranéenne', nom: 'Péninsule italienne', ressources: [], enclavement: 0, slotIndustrie: 0, ville: null },
  { id: 'eu-centrale', bloc: 'Europe', region: 'Europe centrale & orientale', nom: 'Europe centrale', ressources: ['Minerais', 'Denrées'], enclavement: 0, slotIndustrie: 1, ville: null },
  { id: 'eu-balkans', bloc: 'Europe', region: 'Europe centrale & orientale', nom: 'Balkans', ressources: [], enclavement: 1, slotIndustrie: 0, ville: null },

  // --- Russie & Eurasie ---
  { id: 'ru-occidentale', bloc: 'Russie & Eurasie', region: 'Russie & Eurasie', nom: 'Russie occidentale', ressources: ['Denrées', 'Minerais'], enclavement: 0, slotIndustrie: 1, ville: { nom: 'Moscou', slots: 1, lat: 55.7558, lon: 37.6173 } },
  { id: 'ru-siboccidentale', bloc: 'Russie & Eurasie', region: 'Russie & Eurasie', nom: 'Sibérie occidentale', ressources: ['Énergie', { type: 'Terres rares', niveau: 1 }], enclavement: 0, slotIndustrie: 1, ville: { nom: 'Novossibirsk', slots: 1, lat: 55.0084, lon: 82.9357 } },
  { id: 'ru-siborientale', bloc: 'Russie & Eurasie', region: 'Russie & Eurasie', nom: 'Sibérie orientale', ressources: [], enclavement: 2, slotIndustrie: 0, ville: null },
  { id: 'ru-extremeorient', bloc: 'Russie & Eurasie', region: 'Russie & Eurasie', nom: 'Extrême-Orient russe', ressources: [{ type: 'Terres rares', niveau: 1 }], enclavement: 1, slotIndustrie: 0, ville: null },

  // --- Afrique & Moyen-Orient ---
  { id: 'mo-peninsulearabique', bloc: 'Afrique & MO', region: 'Moyen-Orient', nom: 'Péninsule arabique', ressources: ['Énergie'], enclavement: 0, slotIndustrie: 1, ville: { nom: 'Dubaï', slots: 1, lat: 25.2048, lon: 55.2708 } },
  { id: 'mo-mesopotamielevant', bloc: 'Afrique & MO', region: 'Moyen-Orient', nom: 'Mésopotamie/Levant', ressources: [], enclavement: 1, slotIndustrie: 0, ville: null },
  { id: 'an-valleedunil', bloc: 'Afrique & MO', region: 'Afrique du Nord', nom: 'Vallée du Nil', ressources: ['Denrées', 'Énergie'], enclavement: 0, slotIndustrie: 1, ville: { nom: 'Le Caire', slots: 1, lat: 30.0444, lon: 31.2357 } },
  { id: 'an-sahara', bloc: 'Afrique & MO', region: 'Afrique du Nord', nom: 'Sahara', ressources: [], enclavement: 2, slotIndustrie: 0, ville: null },
  { id: 'ao-golfedeguinee', bloc: 'Afrique & MO', region: "Afrique de l'Ouest", nom: 'Golfe de Guinée', ressources: ['Denrées', 'Énergie'], enclavement: 0, slotIndustrie: 1, ville: { nom: 'Lagos', slots: 1, lat: 6.5244, lon: 3.3792 } },
  { id: 'ao-sahel', bloc: 'Afrique & MO', region: "Afrique de l'Ouest", nom: 'Sahel', ressources: [], enclavement: 1, slotIndustrie: 0, ville: null },
  { id: 'ac-esteafricain', bloc: 'Afrique & MO', region: 'Afrique centrale & orientale', nom: "Afrique de l'Est côtière", ressources: [], enclavement: 0, slotIndustrie: 0, ville: null },
  { id: 'ac-bassinducongo', bloc: 'Afrique & MO', region: 'Afrique centrale & orientale', nom: 'Bassin du Congo', ressources: ['Minerais', { type: 'Terres rares', niveau: 1 }], enclavement: 2, slotIndustrie: 1, ville: null },
  { id: 'aa-afriquedusud', bloc: 'Afrique & MO', region: 'Afrique australe', nom: 'Afrique du Sud', ressources: ['Minerais', { type: 'Terres rares', niveau: 2 }], enclavement: 0, slotIndustrie: 1, ville: null },
  { id: 'aa-interieuraustral', bloc: 'Afrique & MO', region: 'Afrique australe', nom: 'Intérieur austral', ressources: [], enclavement: 1, slotIndustrie: 0, ville: null },

  // --- Asie-Pacifique ---
  { id: 'cn-nord', bloc: 'Asie-Pacifique', region: 'Chine', nom: 'Chine du Nord', ressources: ['Denrées', 'Minerais'], enclavement: 0, slotIndustrie: 1, ville: { nom: 'Pékin', slots: 1, lat: 39.9042, lon: 116.4074 } },
  { id: 'cn-cotiere', bloc: 'Asie-Pacifique', region: 'Chine', nom: 'Chine côtière', ressources: ['Minerais', 'Denrées'], enclavement: 0, slotIndustrie: 1, ville: { nom: 'Shanghai', slots: 1, lat: 31.2304, lon: 121.4737 } },
  { id: 'cn-sud', bloc: 'Asie-Pacifique', region: 'Chine', nom: 'Chine du Sud', ressources: [], enclavement: 0, slotIndustrie: 0, ville: null },
  { id: 'cn-interieure', bloc: 'Asie-Pacifique', region: 'Chine', nom: 'Chine intérieure (Xinjiang/Tibet)', ressources: [{ type: 'Terres rares', niveau: 4 }], enclavement: 2, slotIndustrie: 0, ville: null },
  { id: 'jp-archipel', bloc: 'Asie-Pacifique', region: 'Japon & Corée', nom: 'Archipel japonais', ressources: ['Minerais', 'Énergie'], enclavement: 0, slotIndustrie: 1, ville: { nom: 'Tokyo', slots: 1, lat: 35.6762, lon: 139.6503 } },
  { id: 'kr-peninsule', bloc: 'Asie-Pacifique', region: 'Japon & Corée', nom: 'Péninsule coréenne', ressources: [], enclavement: 0, slotIndustrie: 0, ville: null },
  { id: 'in-cotiere', bloc: 'Asie-Pacifique', region: 'Inde', nom: 'Inde côtière', ressources: ['Denrées', 'Minerais'], enclavement: 0, slotIndustrie: 1, ville: { nom: 'Mumbai', slots: 1, lat: 19.0760, lon: 72.8777 } },
  { id: 'in-deccan', bloc: 'Asie-Pacifique', region: 'Inde', nom: 'Plateau du Deccan', ressources: [{ type: 'Terres rares', niveau: 2 }], enclavement: 1, slotIndustrie: 0, ville: null },
  { id: 'as-asiedusud', bloc: 'Asie-Pacifique', region: 'Asie du Sud', nom: 'Asie du Sud', ressources: ['Denrées', 'Minerais'], enclavement: 0, slotIndustrie: 1, ville: null },
  { id: 'se-peninsulemalaise', bloc: 'Asie-Pacifique', region: 'Asie du Sud-Est', nom: 'Péninsule malaise', ressources: ['Denrées', 'Énergie'], enclavement: 0, slotIndustrie: 1, ville: { nom: 'Singapour', slots: 1, lat: 1.3521, lon: 103.8198 } },
  { id: 'se-indochine', bloc: 'Asie-Pacifique', region: 'Asie du Sud-Est', nom: 'Indochine/Birmanie', ressources: [{ type: 'Terres rares', niveau: 3 }], enclavement: 1, slotIndustrie: 0, ville: null },
  { id: 'oc-australiecotiere', bloc: 'Asie-Pacifique', region: 'Océanie', nom: 'Australie côtière', ressources: [{ type: 'Terres rares', niveau: 3 }], enclavement: 0, slotIndustrie: 0, ville: { nom: 'Sydney', slots: 1, lat: -33.8688, lon: 151.2093 } },
  { id: 'oc-outbackpacifique', bloc: 'Asie-Pacifique', region: 'Océanie', nom: 'Outback/Pacifique', ressources: ['Minerais', 'Énergie'], enclavement: 2, slotIndustrie: 1, ville: null },

  // --- Maritime : cases de mer (contours dessinés à la main, pas de source Natural Earth —
  // voir scripts/build-geo.mjs). Pas de ville ni d'usine : seuls comptent le nom, le statut
  // de chokepoint (goulet d'étranglement stratégique) et l'accessibilité. ---
  { id: 'mar-ormuz', bloc: 'Maritime', region: 'Océan Indien', nom: "Détroit d'Ormuz", type: 'maritime', chokepoint: true, ressources: [], enclavement: 0, slotIndustrie: 0, ville: null },
  { id: 'mar-indienouest', bloc: 'Maritime', region: 'Océan Indien', nom: 'Océan Indien occidental', type: 'maritime', ressources: [], enclavement: 0, slotIndustrie: 0, ville: null },
  { id: 'mar-indienest', bloc: 'Maritime', region: 'Océan Indien', nom: 'Océan Indien oriental', type: 'maritime', ressources: [], enclavement: 0, slotIndustrie: 0, ville: null },

  // Arctique : inaccessible avant une technologie tardive (fonte des glaces) — voir le blocage
  // de l'invasion sur `accessible: false` dans main.js.
  { id: 'mar-arctiquenordam', bloc: 'Maritime', region: 'Arctique', nom: 'Arctique nord-américain', type: 'maritime', accessible: false, ressources: [], enclavement: 0, slotIndustrie: 0, ville: null },
  { id: 'mar-arctiquerusse', bloc: 'Maritime', region: 'Arctique', nom: 'Arctique russe', type: 'maritime', accessible: false, ressources: [], enclavement: 0, slotIndustrie: 0, ville: null },
  { id: 'mar-arctiquecentral', bloc: 'Maritime', region: 'Arctique', nom: 'Passage central arctique', type: 'maritime', accessible: false, ressources: [], enclavement: 0, slotIndustrie: 0, ville: null },

  { id: 'mar-medoccidentale', bloc: 'Maritime', region: 'Méditerranée', nom: 'Méditerranée occidentale', type: 'maritime', ressources: [], enclavement: 0, slotIndustrie: 0, ville: null },
  { id: 'mar-suez', bloc: 'Maritime', region: 'Méditerranée', nom: 'Canal de Suez', type: 'maritime', chokepoint: true, ressources: [], enclavement: 0, slotIndustrie: 0, ville: null },
];

export const TERRITOIRE_PAR_ID = Object.fromEntries(TERRITOIRES.map(t => [t.id, t]));
