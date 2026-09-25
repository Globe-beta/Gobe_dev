import * as THREE from 'three';
import Globe from 'globe.gl';
import { geoEquirectangular, geoPath } from 'd3-geo';
import { union as polyUnion, intersection as polyIntersection, difference as polyDifference } from 'polyclip-ts';
import simplify from '@turf/simplify';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import polylabel from 'polylabel';
import './style.css';
import { TERRITOIRES, TERRITOIRE_PAR_ID } from './data/territoires.js';

const PLAYERS = [
  { name: 'Joueur 1', color: '#e63946' },
  { name: 'Joueur 2', color: '#457b9d' },
  { name: 'Joueur 3', color: '#2a9d8f' },
  { name: 'Joueur 4', color: '#f4a261' },
];
const MARKER_NEUTRAL = '#8a8f9c'; // liseré des marqueurs ville/usine non attribués

// Cases maritimes : contrairement à la terre (déjà visible via la texture satellite en
// dessous), une case maritime sans teinte propre serait un simple contour invisible sur fond
// d'océan. On lui donne une teinte bleutée permanente (peinte une fois, dans drawBaseCanvas,
// jamais effacée par redrawLive qui ne repeint que par-dessus).
const MARITIME_FILL = 'rgba(64, 176, 230, 0.28)';

// Symboles des marqueurs ville/usine — mêmes silhouettes partout (sur le globe ET dans la
// légende), pour que la légende corresponde exactement à ce qu'on voit sur la carte. Formes
// pleines simples (pas de traits fins) : à la taille d'un marqueur, un trait fin disparaît.
// Étoile (le symbole classique des capitales sur une carte) plutôt qu'une silhouette
// d'immeubles : à la taille d'un marqueur, cette dernière se confondait visuellement avec
// l'usine (toutes deux réduites à "des barres verticales") — l'étoile est nettement distincte.
const CITY_ICON_SVG = '<svg viewBox="0 0 24 24" fill="#1a1d24"><polygon points="12,1 15,9 23,9 16.5,14 19,22 12,17 5,22 7.5,14 1,9 9,9"/></svg>';
const FACTORY_ICON_SVG = '<svg viewBox="0 0 24 24" fill="#1a1d24"><rect x="2" y="12" width="20" height="9"/><rect x="5" y="6" width="3" height="7"/><rect x="11" y="3" width="3" height="10"/><rect x="17" y="8" width="3" height="5"/></svg>';

// Pions que chaque joueur a en réserve (voir reservePanel), dans l'ordre d'affichage, avec
// le stock de départ identique pour tous. Mêmes symboles que sur le globe pour le centre
// urbain et l'usine ; les autres suivent le même style (formes pleines, lisibles en petit).
const RESERVE_ITEMS = [
  { key: 'soldats', label: 'Soldats', initial: 20,
    svg: '<svg viewBox="0 0 24 24" fill="#1a1d24"><path d="M6.5 7.5a5.5 5.5 0 0111 0z"/><rect x="5" y="7" width="14" height="1.8" rx="0.9"/><circle cx="12" cy="11" r="2.6"/><path d="M5 22v-4.5a7 7 0 0114 0V22z"/></svg>' },
  { key: 'navires', label: 'Bateaux de guerre', initial: 20,
    svg: '<svg viewBox="0 0 24 24" fill="#1a1d24"><path d="M1.5 14h21l-3.5 6H5z"/><rect x="7" y="9" width="8" height="5"/><rect x="9.5" y="4" width="2.2" height="5"/><rect x="15" y="10.5" width="6.5" height="1.8"/></svg>' },
  { key: 'transports', label: 'Bateaux de transport', initial: 5,
    svg: '<svg viewBox="0 0 24 24" fill="#1a1d24"><path d="M1.5 15h21l-3.5 5H5z"/><rect x="3" y="10.5" width="4" height="4"/><rect x="8" y="10.5" width="4" height="4"/><rect x="13" y="10.5" width="4" height="4"/><rect x="18" y="5" width="3" height="9.5"/></svg>' },
  { key: 'trains', label: 'Trains', initial: 5,
    svg: '<svg viewBox="0 0 24 24" fill="#1a1d24"><path fill-rule="evenodd" d="M5 6a3 3 0 013-3h8a3 3 0 013 3v11H5zM7.5 6v5h9V6z"/><path d="M7 17h2.5l-2 3H5zM17 17h-2.5l2 3H19z"/><rect x="2" y="20.5" width="20" height="1.8"/></svg>' },
  { key: 'villes', label: 'Centres urbains', initial: 5, svg: CITY_ICON_SVG },
  { key: 'usines', label: 'Usines', initial: 10, svg: FACTORY_ICON_SVG },
  { key: 'ports', label: 'Ports', initial: 10,
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="#1a1d24" stroke-width="2.6" stroke-linecap="round"><circle cx="12" cy="5" r="2.4"/><path d="M12 7.5V21M7.5 11h9M4 13.5a8 8 0 0016 0"/></svg>' },
  { key: 'bases', label: 'Bases militaires', initial: 5,
    svg: '<svg viewBox="0 0 24 24" fill="#1a1d24"><rect x="11.2" y="2" width="1.6" height="12"/><path d="M12.8 2.5h6l-1.8 2.2 1.8 2.2h-6z"/><path fill-rule="evenodd" d="M3 22V12h3v2h2v-2h3v2h2v-2h3v2h2v-2h3v10zM10 22v-3a2 2 0 014 0v3z"/></svg>' },
];

// Un symbole par type de ressource (celles listées dans TERRITOIRES[].ressources), affiché
// dans un petit cercle à côté de chaque usine — voir buildResourceMarkers.
const RESOURCE_ICON_SVG = {
  'Denrées': '<svg viewBox="0 0 24 24" fill="#1a1d24"><polygon points="12,2 20,9 20,21 4,21 4,9"/></svg>',
  'Minerais': '<svg viewBox="0 0 24 24" fill="#1a1d24"><polygon points="12,3 20,9 12,21 4,9"/></svg>',
  'Énergie': '<svg viewBox="0 0 24 24" fill="#1a1d24"><polygon points="13,2 4,14 11,14 9,22 20,9 13,9"/></svg>',
  'Terres rares': '<svg viewBox="0 0 24 24" fill="#1a1d24"><path d="M6 3h4v10a2 2 0 104 0V3h4v10a6 6 0 11-12 0z"/></svg>',
};
// Une ressource est soit une simple chaîne ('Denrées'), soit { type, niveau } (ex. Terres
// rares) — ce petit accesseur évite de refaire cette distinction à chaque endroit du code.
function resourceTypeOf(r) {
  return typeof r === 'string' ? r : r.type;
}

// ---------- Rendu des territoires : une texture peinte, pas 195 objets 3D ----------
// Nouvelle approche, plus simple et avec moins de pièces mobiles que la précédente
// (chaque territoire était un objet 3D séparé avec son propre matériau — jusqu'à 195 pour
// 47 territoires découpés en îles/morceaux — et plusieurs versions de cette approche ont
// montré le même bug non reproductible sur l'appareil de test : un seul territoire
// correct, tous les autres avec la mauvaise couleur). Ici, il n'y a qu'UN SEUL objet 3D
// (la sphère du globe) et UNE SEULE texture : "attribuer" un territoire, c'est peindre sa
// forme sur un canvas 2D, exactement comme colorier une carte papier. Le clic ne fait plus
// de raycasting 3D non plus : on récupère directement les coordonnées (lat, lng) du point
// touché sur le globe, et on cherche par calcul géométrique simple quel territoire les
// contient (point-in-polygon). Beaucoup moins de code, beaucoup moins de surface pour un
// bug de rendu.
// Résolution de la texture peinte sur le globe. Plus haute que le strict nécessaire pour
// l'apparence au repos (vue de la Terre entière) : les noms de territoires sont du texte
// matriciel — en zoomant sur un pays, la caméra agrandit les pixels déjà peints, donc plus
// il y a de pixels sources par lettre, moins c'est pixelisé une fois agrandi. 4096 reste
// dans la limite de taille de texture supportée par à peu près tous les appareils/GPU.
const TEX_W = 4096;
const TEX_H = 2048;
const projection = geoEquirectangular().scale(TEX_W / (2 * Math.PI)).translate([TEX_W / 2, TEX_H / 2]);
const path = geoPath(projection);

// Le script de build (scripts/build-geo.mjs) "déplie" les territoires qui traversent
// l'antiméridien (ex. Extrême-Orient russe, Pacifique) en décalant leurs longitudes
// au-delà de 180°, pour que three-globe (qui n'a pas de découpage automatique à
// l'antiméridien) les triangule d'un seul tenant. d3-geo fait exactement l'inverse : il
// sait très bien découper proprement un contour qui passe par ±180°, mais seulement si on
// lui donne les longitudes dans leur intervalle standard [-180, 180]. On annule donc le
// dépliage juste pour le dessin sur le canvas.
function dewrapRing(ring) {
  return ring.map(([lon, lat]) => [lon > 180 ? lon - 360 : lon, lat]);
}

// L'orientation des anneaux (sens horaire/antihoraire) dans nos données issues de la
// fusion (turf/union) n'est pas cohérente d'un territoire à l'autre : d3-geo s'appuie
// pourtant sur cette convention pour distinguer "l'intérieur" (le territoire) de
// "l'extérieur" (le reste du monde) lors du découpage à l'antiméridien. Un anneau dans le
// mauvais sens fait donc dessiner l'inverse de la forme voulue (tout SAUF le territoire).
// Plutôt que de deviner la règle exacte (elle s'est révélée contradictoire d'un territoire
// à l'autre), on corrige de façon empirique : si l'aire projetée d'un morceau dépasse une
// fraction déraisonnable du canevas entier, c'est qu'il est à l'envers, et on inverse
// l'ordre de ses points (ce qui inverse son orientation) pour obtenir la bonne forme.
// Les cases maritimes sont tracées à la main en traits droits SUR LA CARTE À PLAT (voir
// scripts/build-geo.mjs). Or d3-geo relie deux sommets par le plus court chemin sur la sphère
// (arc de grand cercle), pas en ligne droite sur la carte : un bord de 180° de large le long du
// 66e parallèle passait ainsi par le pôle (cases arctiques écrasées, invisibles), et un bord de
// 40° y dessinait une courbe. On insère donc des sommets intermédiaires tous les 0.5° au plus :
// entre deux sommets aussi proches, l'arc et la ligne droite se confondent.
const DENSIFY_STEP_DEG = 0.5;
function densifyRing(ring) {
  const out = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / DENSIFY_STEP_DEG));
    for (let k = 0; k < n; k++) out.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);
  }
  out.push(ring[ring.length - 1]);
  return out;
}
// Une case qui couvre toute la calotte polaire (de -179.9° à 179.9°, jusqu'à 90°N : l'Océan
// Arctique central) est écrite en rectangle dans les données. Sur la sphère, ce rectangle a
// deux côtés verticaux le long du méridien 180°, qui dessineraient un trait jusqu'au pôle. On
// la redessine donc en un simple anneau le long de son parallèle sud, qui fait le tour du pôle :
// d3-geo en déduit tout seul que la forme contient le pôle.
const polarCapLatById = new Map(); // id d'une case calotte polaire -> latitude de son bord
function polarCapGeometry(geometry) {
  if (geometry.type !== 'Polygon') return null;
  const ring = geometry.coordinates[0];
  const lons = ring.map(([lon]) => lon);
  const lats = ring.map(([, lat]) => lat);
  if (Math.max(...lats) < 89.9 || Math.min(...lons) > -179.8 || Math.max(...lons) < 179.8) return null;
  const lat = Math.min(...lats);
  // Premier/dernier sommet à 0.001° de l'antiméridien (pas pile dessus : voir la marge de
  // 179.9° dans scripts/build-geo.mjs) : là où d3-geo coupe l'anneau, ils tombent ainsi à
  // moins d'un pixel du bord de la texture, et le trait qui les relierait au pôle est bien
  // reconnu comme un bord de texture (strokePixelPathWithoutTextureEdges) plutôt que dessiné.
  const EDGE = 179.999;
  const cap = [[-EDGE, lat]];
  for (let lon = -179.5; lon < EDGE; lon += DENSIFY_STEP_DEG) cap.push([lon, lat]);
  cap.push([EDGE, lat], [-EDGE, lat]); // fermeture : court arc à travers l'antiméridien
  return { type: 'Polygon', coordinates: [cap] };
}
function densifyGeometry(geometry, id) {
  const cap = polarCapGeometry(geometry);
  if (cap) {
    polarCapLatById.set(id, cap.coordinates[0][0][1]);
    return cap;
  }
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const coordinates = polys.map((rings) => rings.map(densifyRing));
  return geometry.type === 'Polygon' ? { type: 'Polygon', coordinates: coordinates[0] } : { type: 'MultiPolygon', coordinates };
}

const CANVAS_AREA = TEX_W * TEX_H;
function fixPieceWinding(rings) {
  const area = Math.abs(path.area({ type: 'Polygon', coordinates: rings }));
  if (area < CANVAS_AREA * 0.4) return rings;
  return rings.map((ring) => [...ring].reverse());
}
function dewrapGeometry(geometry) {
  if (geometry.type === 'Polygon') return { type: 'Polygon', coordinates: fixPieceWinding(geometry.coordinates.map(dewrapRing)) };
  if (geometry.type === 'MultiPolygon') return { type: 'MultiPolygon', coordinates: geometry.coordinates.map((poly) => fixPieceWinding(poly.map(dewrapRing))) };
  return geometry;
}

// territoireId -> géométrie "dépliée" (lon/lat), point de départ commun pour tout le reste :
// voir projectToPixelMultiPoly et computeDisplayGeometry.
const canvasGeometryById = new Map();

// Convertit une géométrie lon/lat en coordonnées PIXEL de la texture (même repère que tout
// ce qui est dessiné sur le canvas), sous la forme attendue par polyclip-ts : un MultiPoly =
// tableau de Poly, chaque Poly = un anneau unique [ring] (pas de trous). On n'utilise PAS une
// simple projection point par point : d3-geo (via path.context) découpe lui-même proprement
// un contour qui traverse l'antiméridien (Extrême-Orient russe, Pacifique) en plusieurs
// morceaux — une projection naïve donnerait un unique anneau qui traverse toute la largeur
// de la texture au lieu de deux morceaux bien séparés. On récupère ce découpage "gratuitement"
// en donnant à path() un faux contexte canvas qui enregistre les points au lieu de dessiner.
function projectToPixelMultiPoly(geometry) {
  const rings = [];
  let current = null;
  const recorder = {
    moveTo(x, y) { current = [[x, y]]; rings.push(current); },
    lineTo(x, y) { current.push([x, y]); },
    closePath() {
      if (current && current.length && (current[0][0] !== current[current.length - 1][0] || current[0][1] !== current[current.length - 1][1])) {
        current.push(current[0]);
      }
    },
    beginPath() {},
  };
  path.context(recorder);
  path({ type: 'Feature', geometry });
  path.context(null);
  return rings.filter((r) => r.length >= 4).map((r) => [r]);
}

// Dessine un MultiPoly pixel (voir ci-dessus) directement sur un contexte canvas, sans
// projection (déjà en coordonnées pixel) — remplace path()+geometry lon/lat pour tout ce qui
// utilise displayGeometryById.
function drawPixelPath(ctx, multiPoly) {
  for (const poly of multiPoly) {
    // Chaque Poly peut porter des trous depuis polyDifference (une case maritime moins la
    // terre qui la chevauche, voir subtractLandFrom) : poly[0] est le contour extérieur,
    // poly[1+] les trous (îles à exclure). Le sens de rotation opposé (garanti par
    // polyclip-ts, convention GeoJSON standard) fait que le fillRule "nonzero" par défaut du
    // canvas les exclut automatiquement du remplissage — encore faut-il les tracer.
    for (const ring of poly) {
      ctx.moveTo(ring[0][0], ring[0][1]);
      for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i][0], ring[i][1]);
      ctx.closePath();
    }
  }
}

// Comme drawPixelPath, pour un TRAIT : saute les segments posés pile sur un bord de la texture.
// Ceux-là ne sont pas de vraies frontières mais la coupure de la carte à plat (antiméridien
// à gauche/droite, pôle Nord en haut) là où une forme qui la traverse est découpée : tracés,
// ils dessinaient un trait du bord de la forme jusqu'au pôle, ou le long du méridien 180°.
const TEXTURE_EDGE_TOLERANCE_PX = 0.5;
function onTextureEdge([x0, y0], [x1, y1]) {
  const t = TEXTURE_EDGE_TOLERANCE_PX;
  return (x0 <= t && x1 <= t) || (x0 >= TEX_W - t && x1 >= TEX_W - t)
    || (y0 <= t && y1 <= t) || (y0 >= TEX_H - t && y1 >= TEX_H - t);
}
function strokePixelPathWithoutTextureEdges(ctx, multiPoly) {
  for (const poly of multiPoly) {
    for (const ring of poly) {
      ctx.moveTo(ring[0][0], ring[0][1]);
      for (let i = 1; i < ring.length; i++) {
        if (onTextureEdge(ring[i - 1], ring[i])) ctx.moveTo(ring[i][0], ring[i][1]);
        else ctx.lineTo(ring[i][0], ring[i][1]);
      }
      if (!onTextureEdge(ring[ring.length - 1], ring[0])) ctx.lineTo(ring[0][0], ring[0][1]);
    }
  }
}

// territoireId -> forme affichée sur la carte (MultiPoly en coordonnées pixel), utilisée pour
// le dessin, la détection de clic ET le placement des noms — voir computeDisplayGeometry.
const displayGeometryById = new Map();

// Simplifie un MultiPoly pixel (réduit son nombre de points, en gardant sa forme visuelle)
// avant de le passer à polyclip-ts : les données géographiques ont des côtes bien plus
// détaillées que nécessaire à l'écran (parfois des dizaines de milliers de points pour un
// seul territoire, ex. les côtes russes ou canadiennes), et polyclip-ts (union/intersection)
// ralentit fortement avec le nombre de points. Une tolérance de 1.5px de texture (sur une
// image de 4096px de large) est imperceptible visuellement mais réduit le calcul d'un ordre
// de grandeur.
function simplifyPixelMultiPoly(multiPoly, tolerance = 1.5) {
  const simplifyOne = (coordinates) => simplify(
    { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates } },
    { tolerance, highQuality: false, mutate: false },
  ).geometry.coordinates;
  try {
    return simplifyOne(multiPoly);
  } catch {
    // Un morceau dégénéré fait échouer @turf/simplify sur toute la forme : on simplifie alors
    // morceau par morceau, en gardant tel quel celui qui résiste, plutôt que de bloquer le
    // chargement de tout le jeu pour un détail de tracé.
    return multiPoly.flatMap((poly) => {
      try { return simplifyOne([poly]); } catch { return [poly]; }
    });
  }
}

// Bornes [x0,y0,x1,y1] d'un MultiPoly pixel — utilisé pour ne tester que les paires de formes
// dont les rectangles englobants se chevauchent (voir subtractLandFrom), plutôt que de lancer
// une différence géométrique coûteuse contre chacun des 47 territoires terrestres à chaque fois.
function bboxOfPixelMultiPoly(mp) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const poly of mp) for (const [x, y] of poly[0]) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y);
    x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}
function bboxesOverlap(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

// Forme terrestre SANS aucun trou : chaque territoire est simplifié séparément (voir
// simplifyPixelMultiPoly), ce qui ouvre de minuscules fentes le long de ses frontières avec
// ses voisins, et les données sources en contiennent déjà quelques-unes entre subdivisions
// assemblées (Chine du Nord, Russie…). Gardées telles quelles, ces fentes devenaient des
// "trous" dans la région, que computeRegionBorderOverlay cerclait de la couleur de la région
// (et que le trait noir des territoires soulignait d'un point) en plein milieu des terres.
// Aucun territoire terrestre du jeu n'en enclave un autre : on remplit donc tous les trous.
// On fusionne d'abord (polyUnion) : projectToPixelMultiPoly rend chaque anneau source, trous
// compris, comme un polygone à part, qui se retrouve ainsi absorbé par le contour qui le
// contient au lieu de s'y superposer.
function withoutHoles(mp) {
  let merged = mp;
  try { merged = polyUnion(mp); } catch { /* topologie dégénérée : on garde les anneaux tels quels */ }
  return merged.map((poly) => [poly[0]]);
}

function computeDisplayGeometry() {
  // Cases maritimes : leur tracé dessiné à la main (voir scripts/build-geo.mjs) n'est qu'une
  // zone candidate — sur le bord qui touche une côte, on veut suivre cette côte RÉELLE (comme
  // n'importe quelle frontière terrestre), pas garder un simple rectangle par-dessus la terre.
  // On soustrait donc la terre qui recouvre chaque case maritime avant tout le reste : le
  // résultat devient sa "vraie" forme, exactement comme canvasGeometryById l'est pour un
  // territoire terrestre.
  const landPixelMPsWithBbox = TERRITOIRES
    .filter((t) => t.type !== 'maritime')
    .map((t) => {
      const mp = simplifyPixelMultiPoly(projectToPixelMultiPoly(canvasGeometryById.get(t.id)));
      return { mp, bbox: bboxOfPixelMultiPoly(mp) };
    });
  function subtractLandFrom(mp) {
    const bbox = bboxOfPixelMultiPoly(mp);
    const overlapping = landPixelMPsWithBbox.filter((l) => bboxesOverlap(bbox, l.bbox)).map((l) => l.mp);
    if (!overlapping.length) return mp;
    try {
      // Terre fusionnée PUIS débarrassée de ses trous (withoutHoles) : les fentes entre deux
      // territoires voisins (voir withoutHoles) ne doivent pas rester, dans la case, comme de
      // petits éclats de "mer" en plein milieu des terres.
      const land = withoutHoles(polyUnion(...overlapping));
      const diff = polyDifference(mp, land);
      return diff.length ? diff : mp;
    } catch {
      return mp; // topologie dégénérée : on garde la case telle quelle plutôt que de la perdre
    }
  }

  for (const region of REGIONS) {
    const ids = territoiresParRegion[region] || [];
    if (!ids.length) continue;
    const isMaritimeRegion = TERRITOIRE_PAR_ID[ids[0]].type === 'maritime';
    const pixelMPs = new Map(ids.map((id) => {
      let mp = simplifyPixelMultiPoly(projectToPixelMultiPoly(canvasGeometryById.get(id)));
      if (isMaritimeRegion) mp = subtractLandFrom(mp);
      return [id, mp];
    }));

    if (!isMaritimeRegion && ids.length === 1) {
      displayGeometryById.set(ids[0], withoutHoles(pixelMPs.get(ids[0])));
      continue;
    }
    if (isMaritimeRegion) {
      // Une région maritime (un "grand ensemble" océan/mer) est directement subdivisée à la
      // main (scripts/build-geo.mjs) en cases mer rectangulaires DÉJÀ disjointes, qui se
      // touchent pile à leur frontière commune (ex. -40° pour "Atlantique Nord") : pas besoin
      // de les partager géométriquement (rectangularCells) entre elles comme pour une région
      // terrestre composite — chacune garde simplement sa propre forme (candidate moins la terre).
      for (const id of ids) displayGeometryById.set(id, pixelMPs.get(id));
      continue;
    }

    const regionOuter = withoutHoles(polyUnion(pixelMPs.get(ids[0]), ...ids.slice(1).map((id) => pixelMPs.get(id))));

    // Une région qui traverse l'antiméridien (Russie : la pointe de la Tchoukotka, au-delà de
    // 180°, revient tout à gauche de la carte à plat) est d'abord "dépliée" : ses morceaux de la
    // moitié gauche sont décalés d'une largeur de carte vers la droite, pour la découper d'un
    // seul tenant. Sinon, cette pointe tomberait dans le rectangle du territoire le plus à
    // l'ouest de la région (Russie occidentale), à l'autre bout du pays.
    const [rx0, , rx1] = bboxOfPixelMultiPoly(regionOuter);
    const wraps = rx0 <= 2 && rx1 >= TEX_W - 2;
    const unwrapX = (x) => (wraps && x < TEX_W / 2 ? x + TEX_W : x);
    const outer = wraps
      ? regionOuter.map((poly) => (Math.max(...poly[0].map(([x]) => x)) < TEX_W / 2 ? poly.map((ring) => ring.map(([x, y]) => [x + TEX_W, y])) : poly))
      : regionOuter;

    const sites = ids.map((id) => {
      const ville = TERRITOIRE_PAR_ID[id]?.ville;
      const preferredPoint = ville ? projection([ville.lon, ville.lat]) : undefined;
      const a = anchorOfPixelMultiPoly(pixelMPs.get(id), preferredPoint);
      return a ? [unwrapX(a.x), a.y] : null;
    });
    const rects = rectangularCells(outer, sites);

    for (let i = 0; i < ids.length; i++) {
      if (!rects[i]) continue;
      let clipped = polyIntersection([rectRing(rects[i])], outer);
      if (wraps) {
        // Repli : la partie au-delà du bord droit revient à gauche de la carte.
        const inMap = polyIntersection(clipped, [rectRing([-1, -1, TEX_W, TEX_H + 1])]);
        const beyond = polyIntersection(clipped, [rectRing([TEX_W, -1, 2 * TEX_W + 1, TEX_H + 1])])
          .map((poly) => poly.map((ring) => ring.map(([x, y]) => [x - TEX_W, y])));
        clipped = [...inMap, ...beyond];
      }
      if (clipped.length) displayGeometryById.set(ids[i], clipped);
    }
  }
}

// Partage géométrique d'une région à plusieurs territoires en RECTANGLES (traits uniquement
// horizontaux et verticaux sur la carte à plat, c.-à-d. parallèles et méridiens sur le globe),
// à la place du tracé réel, sinueux, de leurs frontières — et à la place des traits obliques
// d'un diagramme de Voronoï, qui donnait des formes peu lisibles (Chine, Brésil) et des traits
// qui semblaient converger vers le pôle (Russie). Le contour extérieur de la région reste
// exactement le vrai (chaque rectangle est ensuite découpé par lui).
//
// Découpage récursif en deux (comme un arbre k-d) : on coupe la partie courante de la région
// dans son sens le plus long (largeur réelle, corrigée de l'étirement de la carte avec la
// latitude), entre les positions des territoires (leur ville, sinon le cœur de leur forme),
// chaque côté recevant une part de surface proportionnelle à son nombre de territoires — pour
// des cases de tailles comparables, aussi proches que possible du carré. Chaque territoire
// garde toujours sa position (sa ville) dans son propre rectangle.
function rectRing([x0, y0, x1, y1]) {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
}
function ringAreaPx(ring) {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return Math.abs(a) / 2;
}
// Sutherland–Hodgman : ne garde d'un anneau que sa partie du côté "coord < c" (below) ou
// "coord >= c" d'une droite horizontale/verticale — rapide, suffisant pour mesurer des aires.
function clipRingAxis(ring, axis, c, below) {
  const inside = (p) => (below ? p[axis] < c : p[axis] >= c);
  const out = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const p = ring[i];
    const q = ring[i + 1];
    const pin = inside(p);
    const qin = inside(q);
    if (pin) out.push(p);
    if (pin !== qin) {
      const t = (c - p[axis]) / (q[axis] - p[axis]);
      out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
    }
  }
  if (out.length) out.push(out[0]);
  return out;
}
function clipRingRect(ring, [x0, y0, x1, y1]) {
  let r = ring;
  r = clipRingAxis(r, 0, x0, false); if (r.length < 4) return null;
  r = clipRingAxis(r, 0, x1, true); if (r.length < 4) return null;
  r = clipRingAxis(r, 1, y0, false); if (r.length < 4) return null;
  r = clipRingAxis(r, 1, y1, true); if (r.length < 4) return null;
  return r;
}
function rectangularCells(regionOuter, sites) {
  const rings = regionOuter.map((poly) => poly[0]);
  const partIn = (rect) => rings.map((r) => clipRingRect(r, rect)).filter(Boolean);
  const areaIn = (rect) => partIn(rect).reduce((a, r) => a + ringAreaPx(r), 0);
  const bboxIn = (rect) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of partIn(rect)) for (const [x, y] of r) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    return x0 === Infinity ? rect : [x0, y0, x1, y1];
  };
  const rects = new Array(sites.length).fill(null);
  const usable = sites.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
  const all = bboxIn([-Infinity, -Infinity, Infinity, Infinity]);
  const PAD = 10;

  function split(indices, rect) {
    if (indices.length === 1) { rects[indices[0]] = rect; return; }
    const pb = bboxIn(rect);
    const latMid = 90 - ((pb[1] + pb[3]) / 2 / TEX_H) * 180;
    const widthKm = (pb[2] - pb[0]) * Math.cos((latMid * Math.PI) / 180);
    const heightKm = pb[3] - pb[1];
    const k = Math.floor(indices.length / 2);
    const gapAlong = (axis) => {
      const sorted = [...indices].sort((a, b) => sites[a][axis] - sites[b][axis]);
      return { axis, sorted, lo: sites[sorted[k - 1]][axis], hi: sites[sorted[k]][axis] };
    };
    let cut = gapAlong(widthKm >= heightKm ? 0 : 1);
    if (cut.hi - cut.lo < 1) {
      const other = gapAlong(1 - cut.axis);
      if (other.hi - other.lo > cut.hi - cut.lo) cut = other;
    }
    const { axis, sorted, lo, hi } = cut;
    // Position de la coupe : la surface du côté "bas" doit valoir k/n de la partie courante,
    // mais toujours strictement entre les deux groupes de territoires (recherche dichotomique).
    const target = (areaIn(rect) * k) / indices.length;
    const margin = Math.min(4, (hi - lo) / 4);
    let a = lo + margin;
    let b = hi - margin;
    for (let it = 0; it < 24 && b - a > 0.25; it++) {
      const c = (a + b) / 2;
      const belowRect = axis === 0 ? [rect[0], rect[1], c, rect[3]] : [rect[0], rect[1], rect[2], c];
      if (areaIn(belowRect) < target) a = c; else b = c;
    }
    const c = (a + b) / 2;
    const low = axis === 0 ? [rect[0], rect[1], c, rect[3]] : [rect[0], rect[1], rect[2], c];
    const high = axis === 0 ? [c, rect[1], rect[2], rect[3]] : [rect[0], c, rect[2], rect[3]];
    split(sorted.slice(0, k), low);
    split(sorted.slice(k), high);
  }
  if (usable.length) split(usable, [all[0] - PAD, all[1] - PAD, all[2] + PAD, all[3] + PAD]);
  return rects;
}

function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))];
}

// Une couleur différente par région terrestre (22 au total) pour ses frontières. Les teintes
// sont espacées par l'angle d'or (~137.5°) plutôt que régulièrement (360/22°) : deux régions
// consécutives dans la liste (donc souvent voisines géographiquement, ex. les régions
// d'Europe) reçoivent ainsi des teintes franchement différentes plutôt que deux nuances
// proches d'une même couleur. Les "grands ensembles" maritimes (régions dont les territoires
// sont de type 'maritime'), eux, partagent tous la MÊME couleur bleue plutôt qu'une teinte par
// ensemble : il ne s'agit pas de les distinguer les uns des autres, juste de marquer "mer" par
// opposition à "terre".
const REGIONS = [...new Set(TERRITOIRES.map((t) => t.region))];
const MARITIME_REGION_RGB = [64, 160, 235];
const regionIsMaritime = new Map(REGIONS.map((r) => [r, TERRITOIRES.find((t) => t.region === r)?.type === 'maritime']));
const landRegions = REGIONS.filter((r) => !regionIsMaritime.get(r));
const landRegionRgb = new Map(landRegions.map((r, i) => [r, hslToRgb((i * 137.508) % 360, 80, 55)]));
const regionRgb = new Map(REGIONS.map((r) => [r, regionIsMaritime.get(r) ? MARITIME_REGION_RGB : landRegionRgb.get(r)]));
const regionColor = new Map(REGIONS.map((r) => [r, `rgb(${regionRgb.get(r).join(',')})`]));
// Image (calculée une seule fois à la réception des données) portant uniquement les
// frontières EXTÉRIEURES de chaque région, en couleur — voir computeRegionBorderOverlay.
let regionBorderOverlay = null;

// { x, y } en pixels du canvas pour un MultiPoly pixel (voir projectToPixelMultiPoly) —
// utilisé à la fois comme position d'un territoire pour le découpage en rectangles de sa
// région (computeDisplayGeometry, rectangularCells) et comme
// position d'ancrage des noms de territoires (labelAnchorById). On utilise le "pôle
// d'inaccessibilité" (polylabel, la même technique que Mapbox pour le placement des noms de
// pays sur une carte) plutôt que le centre géométrique : contrairement au centre, ce point
// est TOUJOURS à l'intérieur de la forme, y compris pour une forme en croissant, avec une
// baie, ou coupée en plusieurs îles.
//
// Choix du morceau (pour un territoire en plusieurs îles) : par défaut, le plus grand par
// aire — mais certains territoires regroupent volontairement des pays très éloignés (ex.
// "Europe germanique" = Allemagne + Scandinavie + pays baltes + Groenland + Islande, par
// choix de design du jeu, comme "Asie du Sud" qui entoure l'Inde). Dans ce cas, le plus
// grand morceau par aire n'est pas forcément le plus pertinent (le Groenland est bien plus
// grand que l'Allemagne alors que le territoire s'appelle "Europe germanique") : si un point
// préféré est fourni (ex. la ville du territoire, déjà placée à la main au bon endroit), on
// choisit plutôt le morceau qui le contient.
function anchorOfPixelMultiPoly(multiPoly, preferredPoint) {
  if (!multiPoly) return null;
  let best = null;
  let preferred = null;
  for (const poly of multiPoly) {
    const ring = poly[0]; // aire/appartenance : seul le contour extérieur compte, jamais les trous
    // Ignore un anneau dégénéré (< 4 points, donc < 3 sommets distincts) : polylabel le refuse,
    // et ça peut arriver après une union géométrique (ex. deux cases maritimes voisines qui ne
    // s'alignaient plus exactement après avoir chacune soustrait la terre différemment le long
    // de leur frontière commune) — un artefact numérique minuscule, jamais la forme voulue.
    if (ring.length < 4) continue;
    let a = 0;
    for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    const area = Math.abs(a) / 2;
    if (!best || area > best.area) best = { poly, area };
    if (preferredPoint && !preferred && booleanPointInPolygon(preferredPoint, { type: 'Polygon', coordinates: poly })) {
      preferred = { poly, area };
    }
  }
  const chosen = preferred || best;
  if (!chosen) return null;
  // Le POLY entier (avec ses trous, ex. une île à l'intérieur d'une case maritime) est passé à
  // polylabel, pas seulement son contour extérieur : sinon le point retenu pourrait tomber en
  // plein sur un trou (une île, donc hors de la case maritime elle-même). Si un trou est lui-même
  // dégénéré (ex. Madagascar entièrement enclavé dans une case océanique, réduit à presque rien
  // après simplification), on retombe sur le contour extérieur seul plutôt que de faire échouer
  // tout le chargement pour un simple point d'ancrage.
  let label;
  try {
    label = polylabel(chosen.poly, 0.5);
  } catch {
    try {
      label = polylabel([chosen.poly[0]], 0.5);
    } catch {
      return null;
    }
  }
  return { x: label[0], y: label[1] };
}

// Calcule un point d'ancrage bien à l'intérieur du territoire (comme anchorOfPixelMultiPoly),
// mais délibérément à l'opposé de avoidPoint plutôt qu'au centre — utilisé pour poser l'usine
// loin de la ville sur un même territoire, jamais juste à côté. On reste sur le MÊME morceau
// que celui contenant avoidPoint (jamais un autre bout de terre isolé, même lointain) : on
// coupe ce morceau en deux par une droite perpendiculaire à la direction ville→centre,
// passant par le centre, et on garde la moitié opposée à la ville, dans laquelle on cherche
// le point le mieux inscrit (polylabel) — donc bien à l'intérieur, pas juste sur un bord.
function factoryAnchorFarFrom(multiPoly, avoidPoint) {
  if (!multiPoly) return null;
  let chosen = null;
  for (const poly of multiPoly) {
    const ring = poly[0];
    let a = 0;
    for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    const area = Math.abs(a) / 2;
    if (!chosen || area > chosen.area) chosen = { ring, area };
    if (booleanPointInPolygon(avoidPoint, { type: 'Polygon', coordinates: [ring] })) {
      chosen = { ring, area };
      break;
    }
  }
  if (!chosen) return null;

  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const [x, y] of chosen.ring) {
    bx0 = Math.min(bx0, x); by0 = Math.min(by0, y);
    bx1 = Math.max(bx1, x); by1 = Math.max(by1, y);
  }
  const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2;
  let nx = cx - avoidPoint[0], ny = cy - avoidPoint[1];
  const len = Math.hypot(nx, ny) || 1;
  nx /= len; ny /= len;
  const px = -ny, py = nx; // perpendiculaire à n, pour la largeur du demi-plan
  const big = Math.hypot(bx1 - bx0, by1 - by0) * 2 + 1;

  const halfPlane = [[[
    [cx - px * big, cy - py * big],
    [cx + px * big, cy + py * big],
    [cx + px * big + nx * big, cy + py * big + ny * big],
    [cx - px * big + nx * big, cy - py * big + ny * big],
    [cx - px * big, cy - py * big],
  ]]];

  let farRing = chosen.ring;
  try {
    const clipped = polyIntersection([chosen.ring], halfPlane);
    if (clipped.length) {
      let best = null;
      for (const poly of clipped) {
        const ring = poly[0];
        let a = 0;
        for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
        const area = Math.abs(a) / 2;
        if (!best || area > best.area) best = { ring, area };
      }
      if (best && best.area > 4) farRing = best.ring;
    }
  } catch {
    // Découpage impossible (topologie dégénérée) : on garde le morceau entier tel quel.
  }
  const label = polylabel([farRing], 0.5);
  return { x: label[0], y: label[1] };
}

// territoireId -> { x, y } en pixels du canvas, calculé une seule fois par territoire (pas à
// chaque rendu), à partir de sa forme AFFICHÉE (displayGeometryById) — donc toujours à
// l'intérieur de la forme géométrique simplifiée qu'on dessine, pas de l'ancienne forme réelle.
const labelAnchorById = new Map();

// Nom du "grand ensemble" (région maritime, ex. "Atlantique Nord") -> { x, y } — un point bien
// à l'intérieur de l'UNION de ses cases mer, pour un nom qui semble couvrir tout l'ensemble
// (comme sur une carte du monde) plutôt qu'une seule de ses cases. Calculé une fois, après
// labelAnchorById, dans loadGameData.
const regionLabelAnchorById = new Map();

// Même taille de police, minuscule, pour tous les territoires (dans l'espace de la texture,
// qui couvre toute la Terre en TEX_W x TEX_H px) : à l'échelle du globe entier le nom est
// presque invisible, volontairement discret ; en zoomant sur un pays ou une région, la même
// caméra qui grossit la carte grossit aussi ce texte, qui devient lisible sans rien
// recalculer. Exprimée en fraction de la largeur de la texture (pas en pixels fixes) : avec
// TEX_W=4096, ça donne ~9px — plus petit, à l'écran, que les 7px de l'ancienne texture à
// 1600px de large (9/4096 < 7/1600), mais dessiné avec davantage de pixels sources, donc
// moins pixelisé une fois agrandi par le zoom.
const LABEL_FONT_SIZE = Math.round(TEX_W * 0.0022);
// Nom d'un "grand ensemble" maritime (région) : nettement plus grand que celui d'une case ou
// d'un territoire, pour donner l'impression de couvrir tout l'ensemble — comme le nom d'un
// océan étalé sur une carte du monde — plutôt que de désigner un seul point.
const ENSEMBLE_LABEL_FONT_SIZE = Math.round(TEX_W * 0.009);
const ENSEMBLE_LABEL_COLOR = `rgb(${MARITIME_REGION_RGB.join(',')})`;

// Dessine le nom de chaque territoire, toujours à la même place (calculée une seule fois,
// voir labelAnchorById/anchorOfPixelMultiPoly). Un contour sombre derrière le texte blanc le
// garde lisible quel que soit le fond (océan, désert, couleur de joueur une fois le
// territoire attribué...). Même mécanique pour le nom (en bleu, plus grand) de chaque grand
// ensemble maritime : un texte dessiné une fois dans la texture à taille fixe, minuscule à
// l'échelle du globe entier, que le même zoom caméra qui agrandit la carte rend lisible sans
// rien recalculer — exactement comme pour les territoires.
// Sur la carte à plat, un parallèle à la latitude φ est aussi long que l'équateur, mais il est
// cos(φ) fois plus court sur le globe : un nom écrit tel quel y paraît donc comprimé en largeur
// (de moitié à 60°N, et en simple tache près du pôle). On l'élargit d'autant sur la carte pour
// qu'il retrouve ses proportions normales une fois posé sur le globe.
const LABEL_MAX_STRETCH = 6;
function drawStretchedText(ctx, text, x, y) {
  const lat = 90 - (y / TEX_H) * 180;
  const stretch = Math.min(LABEL_MAX_STRETCH, 1 / Math.max(1e-6, Math.cos((lat * Math.PI) / 180)));
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(stretch, 1);
  ctx.strokeText(text, 0, 0);
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function drawLabels(ctx) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.font = `${LABEL_FONT_SIZE}px system-ui, sans-serif`;
  ctx.lineWidth = LABEL_FONT_SIZE * 0.16;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.fillStyle = '#ffffff';
  for (const t of TERRITOIRES) {
    const a = labelAnchorById.get(t.id);
    if (!a) continue;
    drawStretchedText(ctx, t.nom, a.x, a.y);
  }

  ctx.font = `bold ${ENSEMBLE_LABEL_FONT_SIZE}px system-ui, sans-serif`;
  ctx.lineWidth = ENSEMBLE_LABEL_FONT_SIZE * 0.14;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.fillStyle = ENSEMBLE_LABEL_COLOR;
  for (const [region, a] of regionLabelAnchorById) {
    drawStretchedText(ctx, region, a.x, a.y);
  }
}

let earthImg = null;
let baseCanvas = null;
let baseCtx = null;
let liveCanvas = null;
let liveCtx = null;
let globeTexture = null;

// Épaisseur des frontières de région dans l'image de sortie (rayon, en px de texture, du
// carré peint autour de chaque pixel de frontière détecté — voir plus bas).
const REGION_BORDER_RADIUS = Math.round(TEX_W * 0.001);

// Calcule une image (même résolution que la texture) qui ne contient que les frontières
// EXTÉRIEURES des régions, chacune dans sa propre couleur — jamais les frontières internes
// entre deux territoires d'une même région. Approche par pixels plutôt que par fusion
// géométrique (@turf/union), pour être fiable même quand deux territoires voisins ne
// partagent pas des sommets parfaitement identiques dans les données sources.
//
// Régions traitées une par une (pas toutes dans le même canvas) : pour une région donnée,
// tous ses territoires sont peints dans le MÊME blanc opaque sur un canvas à part, ce qui
// rend sa frontière interne invisible (blanc sur blanc, pas d'ambiguïté de couleur, même
// avec l'anti-aliasing du canvas). Un pixel plein (canal alpha > seuil) dont au moins un des
// 4 voisins est vide est alors un pixel de frontière EXTÉRIEURE de cette région ; on peint un
// petit carré (REGION_BORDER_RADIUS) autour de lui dans l'image de sortie, pour obtenir un
// trait plus épais qu'un simple contour de 1px — mais ce carré est peint UNIQUEMENT sur les
// pixels qui appartiennent encore à cette région (jamais au-delà de sa propre frontière) :
// quand deux régions différentes sont mitoyennes, chacune peint donc son propre trait sur
// son propre côté de la limite, sans jamais effacer le trait de l'autre — les deux couleurs
// restent visibles côte à côte plutôt que l'une écrasant l'autre. Traiter les régions
// séparément (plutôt qu'un seul canvas partagé avec un identifiant par région) évite aussi
// tout risque qu'un pixel à la frontière entre deux régions DIFFÉRENTES se retrouve, à cause
// du fondu de l'anti-aliasing, avec une valeur intermédiaire qui ressemblerait par hasard à
// l'identifiant d'une troisième région. Le travail par région est limité à son rectangle
// englobant (pas le canvas entier) : une région n'occupe généralement qu'une petite fraction
// de la carte, et à la résolution de texture actuelle (4096x2048), parcourir les 22 régions
// sur l'image entière serait bien trop lent.
function computeRegionBorderOverlay() {
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = TEX_W;
  maskCanvas.height = TEX_H;
  const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });

  const overlay = document.createElement('canvas');
  overlay.width = TEX_W;
  overlay.height = TEX_H;
  const overlayCtx = overlay.getContext('2d');
  const overlayData = overlayCtx.createImageData(TEX_W, TEX_H);
  const out = overlayData.data;

  const ALPHA_THRESHOLD = 127;
  const PAD = REGION_BORDER_RADIUS + 2;

  for (const region of REGIONS) {
    // Pas de contour de couleur autour des grands ensembles maritimes (océans, mers) : seuls
    // les traits noirs entre leurs cases (drawBaseCanvas) les délimitent.
    if (regionIsMaritime.get(region)) continue;
    const ids = territoiresParRegion[region] || [];
    const shapes = ids.map((tid) => displayGeometryById.get(tid)).filter(Boolean);
    if (!shapes.length) continue;
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const mp of shapes) {
      for (const poly of mp) {
        for (const [x, y] of poly[0]) {
          bx0 = Math.min(bx0, x); by0 = Math.min(by0, y);
          bx1 = Math.max(bx1, x); by1 = Math.max(by1, y);
        }
      }
    }
    const x0 = Math.max(0, Math.floor(bx0) - PAD);
    const y0 = Math.max(0, Math.floor(by0) - PAD);
    const x1 = Math.min(TEX_W - 1, Math.ceil(bx1) + PAD);
    const y1 = Math.min(TEX_H - 1, Math.ceil(by1) + PAD);
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    if (w <= 0 || h <= 0) continue;

    maskCtx.clearRect(x0, y0, w, h);
    maskCtx.fillStyle = '#fff';
    for (const mp of shapes) {
      maskCtx.beginPath();
      drawPixelPath(maskCtx, mp);
      maskCtx.fill('evenodd');
    }
    const { data } = maskCtx.getImageData(x0, y0, w, h);
    const inside = (lx, ly) => lx >= 0 && lx < w && ly >= 0 && ly < h && data[(ly * w + lx) * 4 + 3] > ALPHA_THRESHOLD;
    // Au-delà du bord de la texture (antiméridien à gauche/droite, pôles en haut/bas), la
    // région continue de l'autre côté du globe : ce n'est pas une frontière à tracer.
    const insideOrBeyond = (lx, ly) => inside(lx, ly) || x0 + lx < 0 || x0 + lx >= TEX_W || y0 + ly < 0 || y0 + ly >= TEX_H;
    const [r, g, b] = regionRgb.get(region);
    const stamp = (lx, ly) => {
      for (let dy = -REGION_BORDER_RADIUS; dy <= REGION_BORDER_RADIUS; dy++) {
        for (let dx = -REGION_BORDER_RADIUS; dx <= REGION_BORDER_RADIUS; dx++) {
          const nx = lx + dx;
          const ny = ly + dy;
          if (!inside(nx, ny)) continue; // ne jamais déborder hors de sa propre région
          const i = ((y0 + ny) * TEX_W + (x0 + nx)) * 4;
          out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = 255;
        }
      }
    };

    for (let ly = 0; ly < h; ly++) {
      for (let lx = 0; lx < w; lx++) {
        if (!inside(lx, ly)) continue;
        if (insideOrBeyond(lx - 1, ly) && insideOrBeyond(lx + 1, ly) && insideOrBeyond(lx, ly - 1) && insideOrBeyond(lx, ly + 1)) continue; // pixel intérieur, pas une frontière
        stamp(lx, ly);
      }
    }
  }
  overlayCtx.putImageData(overlayData, 0, 0);
  return overlay;
}

function drawBaseCanvas() {
  baseCanvas = document.createElement('canvas');
  baseCanvas.width = TEX_W;
  baseCanvas.height = TEX_H;
  baseCtx = baseCanvas.getContext('2d');
  baseCtx.drawImage(earthImg, 0, 0, TEX_W, TEX_H);

  // Teinte permanente des cases maritimes (voir MARITIME_FILL) : avant les frontières, pour
  // qu'elles restent tracées nettement par-dessus.
  for (const t of TERRITOIRES) {
    if (t.type !== 'maritime') continue;
    const mp = displayGeometryById.get(t.id);
    if (!mp) continue;
    baseCtx.fillStyle = MARITIME_FILL;
    baseCtx.beginPath();
    drawPixelPath(baseCtx, mp);
    baseCtx.fill('evenodd');
  }

  // Frontières de tous les territoires, dessinées une seule fois : elles ne changent
  // jamais, seul le remplissage (attribué/sélectionné) est redessiné ensuite.
  baseCtx.strokeStyle = 'rgba(0,0,0,0.9)';
  baseCtx.lineWidth = TEX_W * 0.0006;
  for (const mp of displayGeometryById.values()) {
    baseCtx.beginPath();
    strokePixelPathWithoutTextureEdges(baseCtx, mp);
    baseCtx.stroke();
  }

  // Frontières extérieures des régions, en couleur (une par région), tracées par-dessus
  // les frontières de territoire — jamais les frontières internes entre deux territoires
  // d'une même région (voir computeRegionBorderOverlay).
  if (regionBorderOverlay) baseCtx.drawImage(regionBorderOverlay, 0, 0);

  liveCanvas = document.createElement('canvas');
  liveCanvas.width = TEX_W;
  liveCanvas.height = TEX_H;
  liveCtx = liveCanvas.getContext('2d');
  globeTexture = new THREE.CanvasTexture(liveCanvas);
}

// Repeint le territoire attribué/sélectionné par-dessus la carte de base (déjà à jour pour
// tous les autres territoires, qui n'ont donc pas besoin d'être retouchés). Pour l'état
// initial (redrawLive(null) implicite au chargement), on copie juste la base telle quelle.
function redrawLive() {
  liveCtx.drawImage(baseCanvas, 0, 0);

  const paint = (id, fillStyle) => {
    const mp = displayGeometryById.get(id);
    if (!mp) return;
    liveCtx.fillStyle = fillStyle;
    liveCtx.beginPath();
    drawPixelPath(liveCtx, mp);
    liveCtx.fill('evenodd');
  };

  for (const [id, p] of Object.entries(ownership)) {
    paint(id, PLAYERS[p].color);
  }
  if (selectedId) paint(selectedId, '#ffe066');

  drawLabels(liveCtx);

  globeTexture.needsUpdate = true;
}

// Cherche quel territoire contient le point (lat, lng) touché sur le globe. On projette le
// point une seule fois en pixels puis on le teste contre les mêmes formes AFFICHÉES
// (displayGeometryById) que celles dessinées — ainsi, on ne peut jamais toucher une zone qui
// a l'air d'appartenir à un territoire à l'écran mais que le clic ne reconnaît pas.
function findTerritoireAt(lat, lng) {
  const [x, y] = projection([lng, lat]);
  for (const [id, mp] of displayGeometryById) {
    if (booleanPointInPolygon([x, y], { type: 'MultiPolygon', coordinates: mp })) return id;
  }
  return null;
}

// territoireId -> index de joueur (0-3) | undefined si non attribué
const ownership = {};
let activePlayer = 0;
// Réserve propre à chaque joueur (voir RESERVE_ITEMS) : { soldats: 20, navires: 20, … }.
const initialReserve = () => Object.fromEntries(RESERVE_ITEMS.map((item) => [item.key, item.initial]));
const reserves = PLAYERS.map(initialReserve);
// Territoire actuellement touché, en attente de confirmation ("Envahir") | null si aucun.
let selectedId = null;

// Régions -> liste de territoireId (pour la détection "région intégrée")
const territoiresParRegion = {};
for (const t of TERRITOIRES) {
  (territoiresParRegion[t.region] ??= []).push(t.id);
}

function markerColorForTerritoire(id) {
  const p = ownership[id];
  return p === undefined ? MARKER_NEUTRAL : PLAYERS[p].color;
}

function computeScores() {
  const scores = PLAYERS.map(() => ({ territoires: 0, regions: 0, villes: 0 }));

  for (const t of TERRITOIRES) {
    const owner = ownership[t.id];
    if (owner === undefined) continue;
    scores[owner].territoires += 1;
    if (t.ville) scores[owner].villes += 1;
  }

  for (const [, ids] of Object.entries(territoiresParRegion)) {
    const owners = ids.map((id) => ownership[id]);
    const first = owners[0];
    if (first !== undefined && owners.every((o) => o === first)) {
      scores[first].regions += 1;
    }
  }

  return scores.map((s) => ({
    ...s,
    total: s.territoires * 1 + s.regions * 3 + s.villes * 4,
  }));
}

// ---------- UI ----------
const app = document.getElementById('app');

const globeEl = document.createElement('div');
globeEl.id = 'globeViz';
app.appendChild(globeEl);

// Bandeau d'erreur visible à l'écran : sans ça, un souci (WebGL, chargement des
// données...) se traduit juste par un écran noir sans aucune indication.
const errorBanner = document.createElement('div');
errorBanner.style.cssText = 'position:absolute;inset:0;z-index:9999;display:none;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center;background:#1a0505;color:#ffb4b4;font:15px/1.5 system-ui,sans-serif;';
app.appendChild(errorBanner);
function showError(title, detail) {
  errorBanner.style.display = 'flex';
  errorBanner.innerHTML = `<div style="font-size:20px;font-weight:700">⚠️ ${title}</div><div style="max-width:480px;opacity:0.85;font-family:ui-monospace,monospace;font-size:13px;white-space:pre-wrap">${detail}</div>`;
}
// capture:true est indispensable pour attraper les échecs de chargement de fichiers
// (script/texture/JSON manquant ou bloqué) : ces erreurs ne remontent pas en bouillonnement.
window.addEventListener('error', (e) => {
  if (e.message === 'WEBGL_UNAVAILABLE') return;
  const cible = e.target && e.target !== window ? ` (${e.target.tagName} : ${e.target.src || e.target.href || '?'})` : '';
  showError('Erreur de chargement/JavaScript', (e.message || 'échec du chargement d\'une ressource') + cible);
}, true);
window.addEventListener('unhandledrejection', (e) => showError('Erreur (promesse)', String(e.reason)));

// Statut de diagnostic bien visible, collé en haut (jamais coupé par la barre du
// navigateur, contrairement au bas de l'écran) : si ça reste bloqué sur "Chargement…"
// sans jamais passer à "Prêt", sans bandeau rouge non plus, ça oriente le diagnostic.
const statusEl = document.createElement('div');
statusEl.style.cssText = 'position:fixed;top:56px;left:8px;right:8px;z-index:9998;font:13px monospace;font-weight:700;color:#000;background:#ffe400;padding:6px 10px;border-radius:6px;text-align:center;';
// L'identifiant de build est affiché ici (bandeau toujours visible en haut), pas seulement
// en bas de la légende (invisible sur les captures d'écran reçues jusqu'ici, coupée par le
// bord de l'écran) : Safari iOS met en cache la page HTML de façon agressive, et sans ce
// repère bien visible, impossible de savoir si un appareil exécute vraiment le dernier
// déploiement ou une ancienne version restée en cache.
const BUILD_ID = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : '?';
statusEl.textContent = `Chargement… (build ${BUILD_ID})`;
document.body.appendChild(statusEl);

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
  } catch { return false; }
}
if (!hasWebGL()) {
  showError('WebGL indisponible sur cet appareil/navigateur', "Le globe 3D a besoin de WebGL. Essaie de recharger la page, ou dans un autre navigateur.");
  throw new Error('WEBGL_UNAVAILABLE');
}

const topbar = document.createElement('div');
topbar.className = 'topbar';
app.appendChild(topbar);

const chips = PLAYERS.map((p, i) => {
  const chip = document.createElement('button');
  chip.className = 'player-chip btn';
  chip.style.border = '2px solid transparent';
  chip.innerHTML = `<span class="dot" style="background:${p.color}"></span> ${p.name} <span class="score">0</span>`;
  chip.onclick = () => { activePlayer = i; renderAll(); };
  topbar.appendChild(chip);
  return chip;
});

const spacer = document.createElement('div');
spacer.className = 'spacer';
topbar.appendChild(spacer);

const nextBtn = document.createElement('button');
nextBtn.className = 'btn';
nextBtn.textContent = 'Joueur suivant →';
nextBtn.onclick = () => { activePlayer = (activePlayer + 1) % PLAYERS.length; renderAll(); };
topbar.appendChild(nextBtn);

const resetBtn = document.createElement('button');
resetBtn.className = 'btn';
resetBtn.textContent = 'Réinitialiser';
resetBtn.onclick = () => {
  if (!confirm('Effacer toutes les attributions de territoires et remettre les réserves à zéro ?')) return;
  for (const k of Object.keys(ownership)) delete ownership[k];
  reserves.forEach((r, i) => { reserves[i] = initialReserve(); });
  renderAll();
};
topbar.appendChild(resetBtn);

// Liste des régions et de leur couleur de frontière (voir computeRegionBorderOverlay), pour
// associer chaque couleur vue sur le globe à son nom de région. Menu déroulant (<details>) :
// sur téléphone, la liste dépliée masquait une bonne partie du globe — elle y démarre donc
// repliée, et reste dépliée par défaut sur grand écran où elle ne gêne pas.
const regionLegendBar = document.createElement('details');
regionLegendBar.className = 'region-legend';
regionLegendBar.open = window.matchMedia('(min-width: 700px)').matches;
regionLegendBar.innerHTML = `
  <summary>Régions (${REGIONS.length})</summary>
  <div class="region-legend-list">${REGIONS.map((region) => `
    <span class="item"><span class="sq" style="background:${regionColor.get(region)}"></span>${region}</span>
  `).join('')}</div>
`;
app.appendChild(regionLegendBar);

// Sur écran étroit, le bandeau jaune de statut passe sur deux lignes : on place le menu des
// régions juste sous sa hauteur RÉELLE plutôt qu'à une position fixe qui le ferait chevaucher.
// La réserve du joueur (colonne de droite, voir reservePanel) se place à son tour juste sous
// la liste des régions, dépliée ou non : dépliée sur grand écran, celle-ci s'étire sur toute la
// largeur et en masquait sinon le haut.
function placeRegionLegend() {
  regionLegendBar.style.top = `${Math.round(statusEl.getBoundingClientRect().bottom) + 6}px`;
  if (typeof reservePanel === 'undefined') return;
  const top = Math.round(regionLegendBar.getBoundingClientRect().bottom) + 8;
  reservePanel.style.top = `${top}px`;
  reservePanel.style.maxHeight = `${window.innerHeight - top - 12}px`;
}
placeRegionLegend();
regionLegendBar.addEventListener('toggle', placeRegionLegend);

// Même principe que la liste des régions : menu déroulant, replié par défaut sur téléphone
// (où la légende dépliée couvrait près de la moitié de l'écran), déplié sur grand écran.
const legend = document.createElement('details');
legend.className = 'legend';
legend.open = window.matchMedia('(min-width: 700px)').matches;
legend.innerHTML = `
  <summary>Légende</summary>
  <div class="legend-body">
  <div><b>47 territoires</b> + <b>20 cases maritimes</b> (8 mers/océans) · 30 régions · 18 villes</div>
  <div class="row"><span class="sq" style="border-radius:50%;background:#ffe066"></span> touchez un territoire pour le sélectionner, puis "Envahir" pour l'attribuer au joueur actif</div>
  <div class="row"><span class="legend-icon">${CITY_ICON_SVG}</span> centre urbain (zoomez sur un pays pour le voir)</div>
  <div class="row"><span class="legend-icon">${FACTORY_ICON_SVG}</span> slot Industrie</div>
  <div class="row"><span class="legend-icon" style="border-radius:50%">${RESOURCE_ICON_SVG['Denrées']}</span> Denrées</div>
  <div class="row"><span class="legend-icon" style="border-radius:50%">${RESOURCE_ICON_SVG['Minerais']}</span> Minerais</div>
  <div class="row"><span class="legend-icon" style="border-radius:50%">${RESOURCE_ICON_SVG['Énergie']}</span> Énergie</div>
  <div class="row"><span class="legend-icon" style="border-radius:50%">${RESOURCE_ICON_SVG['Terres rares']}</span> Terres rares</div>
  <div class="row"><span class="sq" style="border-radius:3px;background:#2f8fc7"></span> case maritime</div>
  <div>1 pt/territoire · +3/région intégrée · +4/ville</div>
  <div style="opacity:0.5;margin-top:4px">build ${typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : '?'}</div>
  </div>
`;
app.appendChild(legend);

// Réserve du joueur actif : ce qu'il lui reste à poser (unités, centres urbains, usines,
// ports), une icône dans un cercle par type avec le nombre restant dessous. Chaque joueur a
// sa propre réserve : le panneau affiche celle du joueur dont c'est le tour, à sa couleur, et
// bascule avec lui (puce joueur ou "Joueur suivant").
const reservePanel = document.createElement('div');
reservePanel.className = 'reserve-panel';
reservePanel.innerHTML = `
  <div class="reserve-title"><span class="dot"></span><span class="name"></span></div>
  ${RESERVE_ITEMS.map((item) => `
    <div class="reserve-item" data-key="${item.key}" title="${item.label}">
      <span class="reserve-icon">${item.svg}</span>
      <span class="reserve-count"></span>
    </div>
  `).join('')}
`;
app.appendChild(reservePanel);
placeRegionLegend();
function renderReservePanel() {
  const player = PLAYERS[activePlayer];
  const reserve = reserves[activePlayer];
  reservePanel.style.setProperty('--player-color', player.color);
  reservePanel.querySelector('.reserve-title .name').textContent = player.name;
  for (const el of reservePanel.querySelectorAll('.reserve-item')) {
    const n = reserve[el.dataset.key];
    el.querySelector('.reserve-count').textContent = n;
    el.classList.toggle('empty', n <= 0);
  }
}

const toast = document.createElement('div');
toast.className = 'panel-toast';
app.appendChild(toast);
let toastTimer = null;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

// Barre de confirmation d'invasion : touchez un territoire pour le sélectionner (surbrillance
// jaune) sans l'attribuer tout de suite, puis confirmez avec "Envahir". Ça sépare le geste
// tactile (imprécis, surtout pendant une rotation du globe) de l'attribution elle-même : une
// sélection déclenchée par erreur ne coûte rien, seule une confirmation explicite compte.
const invadeBar = document.createElement('div');
invadeBar.className = 'invade-bar';
const invadeLabel = document.createElement('span');
const invadeBtn = document.createElement('button');
invadeBtn.className = 'btn';
invadeBtn.textContent = 'Envahir';
const cancelBtn = document.createElement('button');
cancelBtn.className = 'btn';
cancelBtn.textContent = 'Annuler';
invadeBar.append(invadeLabel, invadeBtn, cancelBtn);
app.appendChild(invadeBar);

function selectTerritoire(id) {
  selectedId = id;
  renderAll();
}

function clearSelection() {
  selectedId = null;
  renderAll();
}

invadeBtn.onclick = () => {
  if (!selectedId) return;
  assignTerritoire(selectedId);
  selectedId = null;
  renderAll();
};
cancelBtn.onclick = clearSelection;

// ---------- Détection tapotement propre vs glissement (rotation du globe) ----------
// Un tapotement qui glisse légèrement pendant une rotation du globe pouvait quand même
// être interprété comme un clic. On mesure nous-mêmes la distance et la durée entre
// l'appui et le relâchement, et on n'autorise la sélection que si ça ressemble vraiment à
// un tapotement immobile.
let pointerDownX = 0;
let pointerDownY = 0;
let pointerDownAt = 0;
let lastPointerWasClean = true;
document.addEventListener('pointerdown', (e) => {
  pointerDownX = e.clientX;
  pointerDownY = e.clientY;
  pointerDownAt = Date.now();
}, true);
document.addEventListener('pointerup', (e) => {
  const dist = Math.hypot(e.clientX - pointerDownX, e.clientY - pointerDownY);
  const duration = Date.now() - pointerDownAt;
  lastPointerWasClean = dist < 8 && duration < 600;
}, true);
function wasCleanTap() {
  return lastPointerWasClean;
}

// ---------- Globe ----------
let lastClickInfo = '—';
const world = new Globe(globeEl)
  .onGlobeReady(() => { window.__globeReady = true; })
  .backgroundColor('#000010')
  .showAtmosphere(true)
  .atmosphereColor('#6fb1ff')
  .onGlobeClick(({ lat, lng }) => {
    if (!wasCleanTap()) return;
    const id = findTerritoireAt(lat, lng);
    lastClickInfo = `${lat.toFixed(1)},${lng.toFixed(1)}→${id || 'aucun'}`;
    if (id) selectTerritoire(id);
    else renderAll();
  })
  .htmlLat((d) => d.lat)
  .htmlLng((d) => d.lon)
  .htmlAltitude(0.012)
  .htmlElement(buildMarkerElement)
  .onZoom(updatePoiScale);

world.pointOfView({ lat: 20, lng: 10, altitude: 2.6 }, 0);
window.__world = world; // debug uniquement
updatePoiScale(world.pointOfView());

// Diagnostic : sur un appareil sous pression mémoire (tablette, beaucoup de géométrie),
// le navigateur peut perdre le contexte WebGL — symptôme typique : tout le globe se met
// soudainement à s'afficher dans une seule couleur plate, sans lien évident avec l'action
// qui vient d'être faite. Sans ce message, ça ressemble à un bug de logique alors que
// c'est en fait le GPU qui a coupé le rendu. On rend ça visible plutôt que de deviner.
const glCanvas = world.renderer().domElement;
glCanvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  showError('Contexte WebGL perdu', "L'appareil a coupé le rendu 3D (probablement une limite mémoire/GPU). Recharge la page pour continuer.");
});
glCanvas.addEventListener('webglcontextrestored', () => {
  statusEl.textContent = 'Contexte WebGL restauré — recharge la page si l\'affichage reste incorrect.';
});

let markersData = [];

function buildFactoryMarker(d) {
  const marker = document.createElement('div');
  marker.className = 'poi-marker poi-marker--factory';
  marker.style.borderColor = markerColorForTerritoire(d.territoireId);
  marker.innerHTML = FACTORY_ICON_SVG;
  // Les cercles de ressource sont des ENFANTS du carré usine (pas des marqueurs séparés avec
  // leur propre position géographique) : ils héritent ainsi de la même transformation CSS
  // (--poi-scale, appliquée une seule fois sur .poi-group, voir buildMarkerElement) que le
  // reste du marqueur, et leur position (juste en dessous, en ligne) reste dans une
  // proportion FIXE par rapport à sa taille à n'importe quel niveau de zoom — impossible
  // qu'ils se chevauchent entre eux ou avec l'usine, ou au contraire s'écartent trop.
  if (d.resources && d.resources.length) {
    const row = document.createElement('div');
    row.className = 'poi-resource-row';
    for (const r of d.resources) {
      const icon = document.createElement('div');
      icon.className = 'poi-resource-icon';
      icon.innerHTML = RESOURCE_ICON_SVG[resourceTypeOf(r)] || '';
      icon.title = resourceTypeOf(r);
      row.appendChild(icon);
    }
    marker.appendChild(row);
  }
  return marker;
}

// Un marqueur = une ancre (position gérée par globe.gl/CSS2DRenderer, qui réécrit son style
// "transform" à chaque frame — on n'y touche jamais) contenant un groupe (.poi-group) qui
// porte, lui seul, l'échelle liée au zoom (--poi-scale, voir updatePoiScale) : sur un
// territoire qui a une usine (ses ressources sont ses ENFANTS, voir buildFactoryMarker),
// cette échelle garantit que l'écart usine↔ressources reste dans une proportion FIXE à
// n'importe quel niveau de zoom. Ville et usine restent volontairement deux marqueurs
// séparés, chacun à sa propre position géographique — voir factoryAnchorFarFrom.
function buildMarkerElement(d) {
  const anchor = document.createElement('div');
  anchor.className = 'poi-anchor';
  const group = document.createElement('div');
  group.className = 'poi-group';
  anchor.appendChild(group);

  if (d.type === 'city') {
    const marker = document.createElement('div');
    marker.className = 'poi-marker';
    marker.style.borderColor = markerColorForTerritoire(d.territoireId);
    marker.innerHTML = CITY_ICON_SVG;
    marker.title = `${d.nom} — ${TERRITOIRE_PAR_ID[d.territoireId].nom}`;
    marker.onclick = (ev) => { ev.stopPropagation(); if (!wasCleanTap()) return; selectTerritoire(d.territoireId); };
    group.appendChild(marker);
  } else {
    group.appendChild(buildFactoryMarker(d));
  }
  return anchor;
}

// Les marqueurs ville/usine sont visibles dès la vue du globe entier (échelle MIN_SCALE), et
// grossissent progressivement en zoomant sur un pays — comme les noms de territoires, mais
// par un autre moyen : ce sont des éléments HTML (CSS2DRenderer), pas des pixels de la
// texture, donc ils ne grossissent pas tout seuls avec le zoom de la caméra. On calcule donc
// nous-mêmes une échelle à partir de l'altitude de la caméra, appliquée via une variable CSS
// lue par .poi-marker : MIN_SCALE (déjà bien visible) tant qu'on n'a pas commencé à zoomer
// (POI_ALT_HIDDEN), 1 (taille normale) à POI_ALT_FULL, puis un grossissement continu jusqu'à
// POI_MAX_SCALE en continuant de zoomer (jusqu'à POI_ALT_CLOSE).
const POI_ALT_HIDDEN = 2.2;
const POI_ALT_FULL = 0.45;
const POI_ALT_CLOSE = 0.12;
const POI_MIN_SCALE = 0.6;
const POI_MAX_SCALE = 4;
function updatePoiScale({ altitude }) {
  let scale;
  if (altitude >= POI_ALT_HIDDEN) {
    scale = POI_MIN_SCALE;
  } else if (altitude >= POI_ALT_FULL) {
    const t = (POI_ALT_HIDDEN - altitude) / (POI_ALT_HIDDEN - POI_ALT_FULL);
    scale = POI_MIN_SCALE + t * (1 - POI_MIN_SCALE);
  } else {
    const t = Math.min(1, (POI_ALT_FULL - altitude) / (POI_ALT_FULL - POI_ALT_CLOSE));
    scale = 1 + t * (POI_MAX_SCALE - 1);
  }
  document.documentElement.style.setProperty('--poi-scale', scale.toFixed(3));
}

// Appelée uniquement depuis le bouton "Envahir" (confirmation explicite).
function assignTerritoire(id) {
  const region = TERRITOIRE_PAR_ID[id]?.region;
  ownership[id] = activePlayer;
  renderAll();

  const ids = territoiresParRegion[region] || [];
  if (ids.length && ids.every((tid) => ownership[tid] === activePlayer)) {
    showToast(`Région intégrée : ${region} → +3 pts pour ${PLAYERS[activePlayer].name}`);
  }
}

function renderAll() {
  if (globeTexture) redrawLive();
  // Rafraîchit les marqueurs (nouvelle référence de tableau pour forcer le re-rendu des couleurs)
  world.htmlElementsData([...markersData]);

  renderReservePanel();

  chips.forEach((chip, i) => {
    chip.style.borderColor = i === activePlayer ? '#fff' : 'transparent';
    const scores = computeScores();
    chip.querySelector('.score').textContent = scores[i].total;
  });

  if (selectedId) {
    const t = TERRITOIRE_PAR_ID[selectedId];
    invadeLabel.textContent = `${t ? t.nom : selectedId} → ${PLAYERS[activePlayer].name} ?`;
    invadeBar.classList.add('show');
  } else {
    invadeBar.classList.remove('show');
  }

  // Diagnostic : liste explicitement les territoires réellement marqués "attribués", et le
  // dernier point touché avec le territoire trouvé (ou "aucun") — utile pour vérifier que
  // la détection de clic (point-in-polygon) retrouve bien le bon territoire.
  if (readyStatusBase) {
    const owned = Object.keys(ownership);
    statusEl.textContent = `${readyStatusBase} · clic:${lastClickInfo} · attribués(${owned.length}):${owned.join(',') || '—'}`;
  }
  placeRegionLegend();
}
let readyStatusBase = '';

// ---------- Chargement des données géographiques ----------
// Un fetch() sans limite peut rester bloqué très longtemps si la connexion faiblit
// en cours de route (ni résolu, ni rejeté) : on ajoute un délai maximum, pour échouer
// vite et pouvoir réessayer, plutôt que de rester sur "Chargement…" indéfiniment.
function fetchJson(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status} sur ${url}`);
      return r.json();
    })
    .finally(() => clearTimeout(timer));
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Échec du chargement de l'image ${url}`));
    img.src = url;
  });
}

// Cache-busting : geo/*.json ont un nom fixe (pas de hash comme les assets JS/CSS),
// le CDN/navigateur peut donc en garder une ancienne copie en cache. On force le
// rechargement en accrochant l'identifiant de build à l'URL.
const cacheBust = typeof __BUILD_ID__ !== 'undefined' ? `?v=${encodeURIComponent(__BUILD_ID__)}` : `?v=${Date.now()}`;

function countPoints(geom) {
  const rings = geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat();
  return rings.reduce((a, r) => a + r.length, 0);
}

function loadGameData(attempt = 1) {
  statusEl.textContent = attempt === 1 ? 'Chargement des données géographiques…' : `Nouvelle tentative (${attempt}/3)…`;
  errorBanner.style.display = 'none';

  Promise.all([
    fetchJson('geo/territoires.geo.json' + cacheBust),
    earthImg || loadImage('textures/earth-day.jpg' + cacheBust).then((img) => { earthImg = img; }),
  ]).then(([geo]) => {
    const totalPoints = geo.features.reduce((a, f) => a + countPoints(f.geometry), 0);
    statusEl.textContent = `Prêt (${geo.features.length} terr., ${totalPoints} pts géo)`;

    for (const f of geo.features) {
      const id = f.properties.territoireId;
      // Densifié AVANT le contrôle d'orientation de dewrapGeometry (fixPieceWinding), qui mesure
      // l'aire de la forme telle que d3-geo la voit : sans sommets intermédiaires, cette aire
      // est celle de la forme déformée par les arcs de grand cercle, pas de la vraie case.
      const raw = TERRITOIRE_PAR_ID[id]?.type === 'maritime' ? densifyGeometry(f.geometry, id) : f.geometry;
      canvasGeometryById.set(id, dewrapGeometry(raw));
    }
    computeDisplayGeometry();
    for (const t of TERRITOIRES) {
      const preferredPoint = t.ville ? projection([t.ville.lon, t.ville.lat]) : undefined;
      const anchor = anchorOfPixelMultiPoly(displayGeometryById.get(t.id), preferredPoint);
      if (anchor) labelAnchorById.set(t.id, anchor);
    }
    // Calotte polaire : son nom se placerait sinon au milieu de la bande (vers 85°N), là où la
    // carte à plat l'écrase en une tache au pôle. On le pose près de son bord, face à l'Europe.
    for (const [id, capLat] of polarCapLatById) {
      const [x, y] = projection([0, capLat + 2.5]);
      labelAnchorById.set(id, { x, y });
    }
    for (const region of REGIONS) {
      if (!regionIsMaritime.get(region)) continue;
      // Nom du grand ensemble placé hors de la calotte polaire (même raison que ci-dessus),
      // sauf si l'ensemble n'est fait que de ça.
      const ids = territoiresParRegion[region] || [];
      const idsHorsCalotte = ids.filter((id) => !polarCapLatById.has(id));
      const shapes = (idsHorsCalotte.length ? idsHorsCalotte : ids).map((id) => displayGeometryById.get(id)).filter(Boolean);
      if (!shapes.length) continue;
      try {
        const union = shapes.length === 1 ? shapes[0] : polyUnion(shapes[0], ...shapes.slice(1));
        const anchor = anchorOfPixelMultiPoly(union);
        if (anchor) regionLabelAnchorById.set(region, anchor);
      } catch {
        // Topologie dégénérée à l'union : pas de nom de grand ensemble pour cette région plutôt
        // que de faire échouer tout le chargement pour un simple label.
      }
    }
    regionBorderOverlay = computeRegionBorderOverlay();
    drawBaseCanvas();
    redrawLive();
    const mat = world.globeMaterial();
    mat.map = globeTexture;
    mat.color = null;
    mat.needsUpdate = true;

    markersData = [];
    for (const t of TERRITOIRES) {
      if (t.ville) {
        markersData.push({ type: 'city', territoireId: t.id, nom: t.ville.nom, slots: t.ville.slots, lat: t.ville.lat, lon: t.ville.lon });
      }
      if (t.slotIndustrie) {
        // Ville ET usine sur le même territoire : l'usine n'est jamais posée à côté de la
        // ville, mais délibérément à l'opposé (voir factoryAnchorFarFrom), pour bien les
        // distinguer visuellement — deux informations différentes, deux endroits différents.
        // Sans ville, l'usine garde son ancre habituelle (labelAnchorById).
        const cityPixel = t.ville ? projection([t.ville.lon, t.ville.lat]) : null;
        let anchor = cityPixel ? factoryAnchorFarFrom(displayGeometryById.get(t.id), cityPixel) : null;
        // Garde-fou : le découpage par demi-plan (factoryAnchorFarFrom) part de la forme
        // SIMPLIFIÉE (displayGeometryById) — sur un territoire fin ou très découpé, le point
        // obtenu peut, par la marge de simplification, tomber tout juste hors de la forme
        // RÉELLE. On revérifie contre la géométrie non simplifiée ; en cas de doute, on
        // retombe sur l'ancre habituelle (labelAnchorById), déjà garantie à l'intérieur.
        if (anchor) {
          const realPixelMultiPoly = projectToPixelMultiPoly(canvasGeometryById.get(t.id));
          const stillInside = realPixelMultiPoly.some((poly) => booleanPointInPolygon([anchor.x, anchor.y], { type: 'Polygon', coordinates: poly }));
          if (!stillInside) anchor = null;
        }
        if (!anchor) anchor = labelAnchorById.get(t.id);
        if (anchor) {
          const [lon, lat] = projection.invert([anchor.x, anchor.y]);
          markersData.push({ type: 'factory', territoireId: t.id, lat, lon, resources: t.ressources || [] });
        }
      }
    }
    world.htmlElementsData(markersData);

    readyStatusBase = `build ${BUILD_ID} · Prêt · ${geo.features.length} terr. · ${totalPoints} pts`;
    renderAll();
  }).catch((err) => {
    console.error(err); // trace complète dans la console du navigateur, pour le diagnostic
    if (attempt < 3) {
      setTimeout(() => loadGameData(attempt + 1), 1500);
      return;
    }
    statusEl.textContent = 'Échec du chargement (connexion instable ?)';
    showError(
      'Impossible de charger les données géographiques',
      `${err}\n\nTa connexion a peut-être coupé pendant le téléchargement. Vérifie ton réseau et réessaie.`,
    );
    const retryBtn = document.createElement('button');
    retryBtn.textContent = 'Réessayer';
    retryBtn.style.cssText = 'margin-top:8px;padding:10px 20px;border-radius:8px;border:none;background:#fff;color:#1a0505;font-weight:700;font-size:14px;';
    retryBtn.onclick = () => loadGameData(1);
    errorBanner.appendChild(retryBtn);
  });
}

loadGameData();

window.addEventListener('resize', () => {
  world.width(window.innerWidth).height(window.innerHeight);
  placeRegionLegend();
});
