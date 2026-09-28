import * as THREE from 'three';
import Globe from 'globe.gl';
import { geoEquirectangular, geoPath } from 'd3-geo';
import { union as polyUnion, intersection as polyIntersection, difference as polyDifference } from 'polyclip-ts';
import simplify from '@turf/simplify';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import polylabel from 'polylabel';
import { feature as topoFeature } from 'topojson-client';
import './style.css';
import { TERRITOIRES, TERRITOIRE_PAR_ID } from './data/territoires.js';
import { CONFIG, COULEURS_JOUEURS, PUISSANCES, ageEnChiffresRomains } from './config.js';
import {
  nouvellePartie, joueurCourant, tirerOrdre, choisirPuissance, puissancePrisePar,
  territoiresPourAtelier, ressourcesPourAtelier, peutConfirmerAtelier, placerAtelier,
  villesPossibles, choisirVille, definirVoisinage, territoiresPourRail, peutPoserRail, placerRail,
  territoiresDepartPossibles, peutChoisirTerritoiresDepart, choisirTerritoiresDepart,
  mersVoisines, territoiresPourPort, peutPlacerPort, placerPort,
} from './partie.js';
import { construireVille, construireUsine } from './models3d.js';

// Joueurs de la partie : leur nombre vient de la configuration (src/config.js).
const PLAYERS = Array.from({ length: CONFIG.nbJoueurs }, (_, i) => ({ name: `Joueur ${i + 1}`, color: COULEURS_JOUEURS[i] }));
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
  // Denrées : un épi de blé (tige, grains de part et d'autre, grain au sommet).
  'Denrées': '<svg viewBox="0 0 24 24" fill="#1a1d24"><rect x="11.3" y="8" width="1.4" height="15" rx="0.7"/><ellipse cx="12" cy="3.4" rx="1.6" ry="2.6"/><ellipse cx="9.6" cy="7.2" rx="1.5" ry="2.6" transform="rotate(-35 9.6 7.2)"/><ellipse cx="14.4" cy="7.2" rx="1.5" ry="2.6" transform="rotate(35 14.4 7.2)"/><ellipse cx="9.6" cy="11.2" rx="1.5" ry="2.6" transform="rotate(-35 9.6 11.2)"/><ellipse cx="14.4" cy="11.2" rx="1.5" ry="2.6" transform="rotate(35 14.4 11.2)"/><ellipse cx="9.6" cy="15.2" rx="1.5" ry="2.6" transform="rotate(-35 9.6 15.2)"/><ellipse cx="14.4" cy="15.2" rx="1.5" ry="2.6" transform="rotate(35 14.4 15.2)"/></svg>',
  // Minerais (le métal) : une épée et une hache croisées.
  'Minerais': '<svg viewBox="0 0 24 24" fill="#1a1d24"><g transform="rotate(45 12 12)"><polygon points="10.9,15 10.9,3.2 12,0.8 13.1,3.2 13.1,15"/><rect x="8" y="15" width="8" height="1.8" rx="0.6"/><rect x="11.2" y="16.8" width="1.6" height="4.4"/><circle cx="12" cy="22.2" r="1.3"/></g><g transform="rotate(-45 12 12)"><rect x="11.2" y="2.5" width="1.6" height="20.5" rx="0.8"/><path d="M12.8 3.6 L17 2 Q19.6 6.3 17 10.6 L12.8 9 Z"/></g></svg>',
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
let bordersCanvas = null;
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

  // Frontières sur un calque À PART (bordersCanvas), redessiné PAR-DESSUS la couleur des
  // joueurs (redrawLive) : un territoire pris garde ainsi ses frontières bien visibles, dans
  // leurs couleurs habituelles. Calculé une seule fois : les frontières ne changent jamais.
  bordersCanvas = document.createElement('canvas');
  bordersCanvas.width = TEX_W;
  bordersCanvas.height = TEX_H;
  const bordersCtx = bordersCanvas.getContext('2d');
  bordersCtx.strokeStyle = 'rgba(0,0,0,0.9)';
  bordersCtx.lineWidth = TEX_W * 0.0006;
  for (const mp of displayGeometryById.values()) {
    bordersCtx.beginPath();
    strokePixelPathWithoutTextureEdges(bordersCtx, mp);
    bordersCtx.stroke();
  }
  // Frontières extérieures des régions, en couleur (une par région), tracées par-dessus
  // les frontières de territoire — jamais les frontières internes entre deux territoires
  // d'une même région (voir computeRegionBorderOverlay).
  if (regionBorderOverlay) bordersCtx.drawImage(regionBorderOverlay, 0, 0);

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

  // Couleur du joueur en semi-transparence : bien lisible sur toutes les teintes du fond
  // satellite (forêt, steppe, désert), tout en laissant deviner le relief dessous.
  for (const [id, p] of Object.entries(partie.proprietaire)) {
    paint(id, colorWithAlpha(PLAYERS[p].color, 0.62));
  }
  // Cases mer où un joueur a un bateau : à sa couleur (la case choisie pour le premier bateau
  // aussi, en aperçu, pendant l'étape du port).
  for (const b of partie.bateaux) paint(b.mer, colorWithAlpha(PLAYERS[b.joueur].color, 0.5));
  if (partie.phase === 'port' && portChoix.mer) paint(portChoix.mer, colorWithAlpha(PLAYERS[joueurCourant(partie)].color, 0.5));
  // Étape "atelier de départ" : seuls les territoires du joueur courant qui ont un slot
  // Industrie libre sont mis en surbrillance ; celui qu'il a choisi, plus fort.
  const surbrillance = territoiresEnSurbrillance();
  const choisis = territoiresChoisis();
  for (const id of surbrillance) paint(id, choisis.includes(id) ? 'rgba(255,224,102,0.8)' : 'rgba(255,224,102,0.45)');
  if (selectedId && !surbrillance.includes(selectedId)) paint(selectedId, 'rgba(255,224,102,0.55)');

  if (bordersCanvas) liveCtx.drawImage(bordersCanvas, 0, 0);
  // Contour jaune épais autour des territoires en surbrillance, par-dessus les frontières.
  liveCtx.strokeStyle = '#ffe066';
  liveCtx.lineWidth = TEX_W * 0.0016;
  for (const id of surbrillance) {
    const mp = displayGeometryById.get(id);
    if (!mp) continue;
    liveCtx.beginPath();
    strokePixelPathWithoutTextureEdges(liveCtx, mp);
    liveCtx.stroke();
  }

  // Rails posés, puis le rail en cours de pose (pas encore confirmé), en transparence.
  for (const r of partie.rails) drawRail(liveCtx, railPath(r.a, r.b), PLAYERS[r.joueur].color, 1);
  if (partie.phase === 'rail' && railChoix.a && railChoix.b) {
    drawRail(liveCtx, railPath(railChoix.a, railChoix.b), PLAYERS[joueurCourant(partie)].color, 0.6);
  }

  drawLabels(liveCtx);

  globeTexture.needsUpdate = true;
}

// Point d'un territoire où arrive un rail : son infrastructure — sa ville si elle est
// possédée, sinon son usine, sinon le cœur du territoire (même point que son nom).
function pointInfrastructure(territoireId) {
  const t = TERRITOIRE_PAR_ID[territoireId];
  if (t?.ville && partie.villes[territoireId] !== undefined) {
    const [x, y] = projection([t.ville.lon, t.ville.lat]);
    return { x, y };
  }
  const usine = partie.usines[territoireId] && markersData.find((d) => d.type === 'factory' && d.territoireId === territoireId);
  if (usine) {
    const [x, y] = projection([usine.lon, usine.lat]);
    return { x, y };
  }
  return labelAnchorById.get(territoireId);
}

// Tracé d'un rail entre les infrastructures de deux territoires voisins, TOUJOURS par la terre :
// la ligne droite entre les deux points peut couper une baie ou un bras de mer (ex. Chine du
// Nord → Chine côtière par le golfe de Bohai). On cherche donc le plus court chemin sur une
// grille (Dijkstra) limitée aux deux territoires — qui ne contiennent que de la terre —, en
// évitant de longer la côte au plus près, puis on le tend en segments droits là où la ligne
// reste sur terre, et on l'arrondit légèrement (sans jamais repasser en mer). Mémorisé par paire.
const railPathCache = new Map();
let landTopo = null;
let realLandPieces = null; // [{ mp, bbox }] : terre réelle en pixels, une entrée par polygone
function realLandNear(box) {
  if (!realLandPieces) {
    realLandPieces = [];
    if (landTopo) {
      for (const f of topoFeature(landTopo, landTopo.objects.land).features) {
        const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
        for (const rings of polys) {
          const mp = projectToPixelMultiPoly({ type: 'Polygon', coordinates: fixPieceWinding(rings) });
          if (mp.length) realLandPieces.push({ mp, bbox: bboxOfPixelMultiPoly(mp) });
        }
      }
    }
  }
  return realLandPieces.filter((l) => bboxesOverlap(box, l.bbox)).map((l) => l.mp);
}
function railPath(a, b) {
  const p1 = pointInfrastructure(a);
  const p2 = pointInfrastructure(b);
  if (!p1 || !p2) return null;
  const cle = `${a}|${b}|${Math.round(p1.x)},${Math.round(p1.y)}|${Math.round(p2.x)},${Math.round(p2.y)}`;
  if (!railPathCache.has(cle)) railPathCache.set(cle, computeLandPath([displayGeometryById.get(a), displayGeometryById.get(b)].filter(Boolean), p1, p2));
  return railPathCache.get(cle);
}

// shapes : formes affichées des deux territoires. La "vraie terre" est le trait de côte mondial
// (realLandNear) : les formes des territoires, simplifiées ou issues de sources d'États aux côtes
// approximatives, referment de petits golfes et estuaires (golfe de Khambhat, estuaire du
// Yangtsé) ou débordent sur la mer. On cherche d'abord un chemin qui reste dans les deux cases ET
// sur la vraie terre ; s'il n'y en a pas (leur contact passe par une côte…), un chemin sur
// n'importe quelle terre — il peut alors mordre un peu sur un territoire voisin, mais ne passe
// jamais par la mer.
function computeLandPath(shapes, p1, p2) {
  const straight = [p1, p2];
  if (!shapes.length) return straight;
  // Grille autour des deux points, avec une large marge pour les détours (contourner une mer
  // intérieure) — mais pas sur tout le territoire : l'Europe germanique, par exemple, inclut le
  // Groenland, et une grille aussi vaste serait trop grossière pour voir les détroits (une case
  // de 40 km enjambe le Kattegat). Pas fin : 1 px de texture (≈ 10 km) pour les rails courts.
  const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const marge = Math.max(60, d * 0.6);
  const x0 = Math.min(p1.x, p2.x) - marge, y0 = Math.min(p1.y, p2.y) - marge;
  const x1 = Math.max(p1.x, p2.x) + marge, y1 = Math.max(p1.y, p2.y) + marge;
  const step = Math.max(1, Math.ceil(Math.max(x1 - x0, y1 - y0) / 700));
  const W = Math.ceil((x1 - x0) / step) + 1;
  const H = Math.ceil((y1 - y0) / step) + 1;
  const boite = [x0, y0, x1, y1];

  // Masque (1 = terre praticable) : zone des formes `limites` (si données) ∩ terre `reelle`.
  const masque = (limites, reelle) => {
    const peindre = (formes, epaisseur) => {
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const cx = c.getContext('2d', { willReadFrequently: true });
      cx.scale(1 / step, 1 / step);
      cx.translate(-x0, -y0);
      cx.fillStyle = '#fff';
      cx.strokeStyle = '#fff';
      cx.lineWidth = epaisseur; // referme les fines coutures entre formes voisines
      cx.beginPath();
      for (const mp of formes) drawPixelPath(cx, mp);
      cx.fill('evenodd');
      if (epaisseur) cx.stroke();
      return c;
    };
    // Terre réelle sans trait : c'est un seul bloc continu par continent (pas de couture à
    // refermer), et un trait refermerait le fond des golfes étroits.
    const c = peindre(reelle, 0);
    if (limites) {
      const cx = c.getContext('2d', { willReadFrequently: true });
      cx.setTransform(1, 0, 0, 1, 0, 0);
      cx.globalCompositeOperation = 'destination-in';
      cx.drawImage(peindre(limites, 1.5), 0, 0);
    }
    const alpha = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    const land = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) land[i] = alpha[i * 4 + 3] > 127 ? 1 : 0;
    return land;
  };
  const tentative = (land) => landPathOnGrid(land, W, H, x0, y0, step, p1, p2);

  const terre = realLandNear(boite);
  if (!terre.length) return straight;
  const chemin = tentative(masque(shapes, terre)) || tentative(masque(null, terre));
  return chemin || straight; // aucune terre ne relie les deux points : on garde la droite
}

// Plus court chemin par la terre sur une grille (Dijkstra, 8 directions), plus cher au ras des
// côtes pour passer par l'intérieur ; puis tendu en segments droits là où la ligne reste sur
// terre, et arrondi légèrement (Chaikin) sans jamais repasser en mer. null s'il n'y a pas de
// passage.
function landPathOnGrid(land, W, H, x0, y0, step, p1, p2) {
  const toCell = (p) => [Math.round((p.x - x0) / step), Math.round((p.y - y0) / step)];
  const onLand = (cx, cy) => cx >= 0 && cy >= 0 && cx < W && cy < H && land[cy * W + cx] === 1;
  // Ligne entre deux points entièrement sur terre ? (échantillonnage à la demi-case)
  const lineOnLand = (pa, pb) => {
    const n = Math.ceil(Math.hypot(pb.x - pa.x, pb.y - pa.y) / (step * 0.5));
    for (let k = 0; k <= n; k++) {
      const t = n ? k / n : 0;
      const [cx, cy] = toCell({ x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t });
      if (!onLand(cx, cy)) return false;
    }
    return true;
  };
  // Case de terre la plus proche d'un point (au cas où il tomberait juste hors de la terre,
  // ex. une ville portuaire posée sur la côte).
  const snap = (p) => {
    const [cx, cy] = toCell(p);
    if (onLand(cx, cy)) return [cx, cy];
    for (let r = 1; r < 40; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) === r && onLand(cx + dx, cy + dy)) return [cx + dx, cy + dy];
      }
    }
    return null;
  };
  const start = snap(p1);
  const goal = snap(p2);
  if (!start || !goal) return null;
  const cellPoint = ([cx, cy]) => ({ x: x0 + cx * step, y: y0 + cy * step });
  // Extrémités ramenées sur la terre si besoin (ville posée sur la côte).
  const q1 = onLand(...toCell(p1)) ? p1 : cellPoint(start);
  const q2 = onLand(...toCell(p2)) ? p2 : cellPoint(goal);
  if (lineOnLand(q1, q2)) return [q1, q2];

  const nearCoast = (cx, cy) => {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (!onLand(cx + dx, cy + dy)) return true;
    return false;
  };
  const dist = new Float64Array(W * H).fill(Infinity);
  const prev = new Int32Array(W * H).fill(-1);
  const heap = [];
  const push = (d, i) => {
    heap.push([d, i]);
    let k = heap.length - 1;
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if (heap[parent][0] <= heap[k][0]) break;
      [heap[parent], heap[k]] = [heap[k], heap[parent]];
      k = parent;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  const si = start[1] * W + start[0];
  const gi = goal[1] * W + goal[0];
  dist[si] = 0;
  push(0, si);
  const dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  while (heap.length) {
    const [d, i] = pop();
    if (i === gi) break;
    if (d > dist[i]) continue;
    const cx = i % W, cy = (i - cx) / W;
    for (const [dx, dy, c] of dirs) {
      const nx = cx + dx, ny = cy + dy;
      if (!onLand(nx, ny)) continue;
      const ni = ny * W + nx;
      const nd = d + c * (nearCoast(nx, ny) ? 4 : 1);
      if (nd < dist[ni]) { dist[ni] = nd; prev[ni] = i; push(nd, ni); }
    }
  }
  if (!Number.isFinite(dist[gi])) return null;
  const cells = [];
  for (let i = gi; i !== -1; i = prev[i]) cells.push(i);
  cells.reverse();
  const raw = cells.map((i) => cellPoint([i % W, Math.floor(i / W)]));
  raw[0] = q1;
  raw[raw.length - 1] = q2;

  // Tendre le chemin : depuis chaque point, sauter au point le plus lointain encore visible par la terre.
  const taut = [raw[0]];
  let k = 0;
  while (k < raw.length - 1) {
    let far = k + 1;
    for (let m = raw.length - 1; m > k + 1; m--) {
      if (lineOnLand(raw[k], raw[m])) { far = m; break; }
    }
    taut.push(raw[far]);
    k = far;
  }
  // Arrondir légèrement les angles (Chaikin), tant que la courbe reste sur terre.
  let smooth = taut;
  for (let iter = 0; iter < 3; iter++) {
    const next = [smooth[0]];
    for (let i = 0; i < smooth.length - 1; i++) {
      const pa = smooth[i], pb = smooth[i + 1];
      next.push({ x: 0.75 * pa.x + 0.25 * pb.x, y: 0.75 * pa.y + 0.25 * pb.y });
      next.push({ x: 0.25 * pa.x + 0.75 * pb.x, y: 0.25 * pa.y + 0.75 * pb.y });
    }
    next.push(smooth[smooth.length - 1]);
    if (!next.every((pt, i) => i === 0 || lineOnLand(next[i - 1], pt))) break;
    smooth = next;
  }
  return smooth;
}

// Voie ferrée dessinée dans la texture le long d'un tracé (liste de points) : un ballast à la
// couleur du joueur, des traverses sombres, deux rails clairs, et un petit quai rond à chaque bout.
const RAIL_WIDTH = TEX_W * 0.0022;
function drawRail(ctx, pts, color, alpha) {
  if (!pts || pts.length < 2) return;
  const w = RAIL_WIDTH;
  const tracer = (offset) => {
    ctx.beginPath();
    pts.forEach((p, i) => {
      // Normale locale : moyenne des segments autour du point.
      const pa = pts[Math.max(0, i - 1)], pb = pts[Math.min(pts.length - 1, i + 1)];
      const len = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
      const nx = -(pb.y - pa.y) / len, ny = (pb.x - pa.x) / len;
      const x = p.x + nx * offset, y = p.y + ny * offset;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  };
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = w * 2.3;
  tracer(0);
  ctx.strokeStyle = color;
  ctx.lineWidth = w * 1.9;
  tracer(0);
  // Traverses, régulièrement espacées le long du tracé.
  ctx.lineCap = 'butt';
  ctx.strokeStyle = '#3a2a1f';
  ctx.lineWidth = w * 0.32;
  const espacement = w * 0.85;
  let reste = w;
  for (let i = 0; i < pts.length - 1; i++) {
    const pa = pts[i], pb = pts[i + 1];
    const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    if (len < 1e-6) continue;
    const ux = (pb.x - pa.x) / len, uy = (pb.y - pa.y) / len;
    let t = reste;
    for (; t < len; t += espacement) {
      const cx = pa.x + ux * t, cy = pa.y + uy * t;
      ctx.beginPath();
      ctx.moveTo(cx + uy * w * 0.8, cy - ux * w * 0.8);
      ctx.lineTo(cx - uy * w * 0.8, cy + ux * w * 0.8);
      ctx.stroke();
    }
    reste = t - len;
  }
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#eef0f3';
  ctx.lineWidth = w * 0.18;
  tracer(-w * 0.45);
  tracer(w * 0.45);
  for (const p of [pts[0], pts[pts.length - 1]]) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, w * 1.25, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = w * 0.3;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  }
  ctx.restore();
}

// Deux territoires sont voisins si leurs formes affichées se touchent (à 2.5 px de texture
// près, soit ~25 km) : un sommet de l'un posé sur un côté de l'autre. Calcul fait à la demande
// et mémorisé, limité aux sommets et côtés situés dans la zone commune des deux formes.
const VOISIN_TOLERANCE_PX = 2.5;
const voisinageCache = new Map();
function territoiresVoisins(a, b) {
  const cle = a < b ? `${a}|${b}` : `${b}|${a}`;
  if (voisinageCache.has(cle)) return voisinageCache.get(cle);
  const ma = displayGeometryById.get(a);
  const mb = displayGeometryById.get(b);
  let voisins = false;
  if (ma && mb) {
    const t = VOISIN_TOLERANCE_PX;
    const [ax0, ay0, ax1, ay1] = bboxOfPixelMultiPoly(ma);
    const [bx0, by0, bx1, by1] = bboxOfPixelMultiPoly(mb);
    const zone = [Math.max(ax0, bx0) - t, Math.max(ay0, by0) - t, Math.min(ax1, bx1) + t, Math.min(ay1, by1) + t];
    const dans = ([x, y]) => x >= zone[0] && x <= zone[2] && y >= zone[1] && y <= zone[3];
    if (zone[0] <= zone[2] && zone[1] <= zone[3]) {
      const segmentsB = [];
      for (const poly of mb) for (const ring of poly) {
        for (let i = 0; i < ring.length - 1; i++) if (dans(ring[i]) || dans(ring[i + 1])) segmentsB.push([ring[i], ring[i + 1]]);
      }
      const distSeg = ([px, py], [[x1, y1], [x2, y2]]) => {
        const vx = x2 - x1, vy = y2 - y1;
        const l2 = vx * vx + vy * vy;
        const k = l2 ? Math.max(0, Math.min(1, ((px - x1) * vx + (py - y1) * vy) / l2)) : 0;
        return Math.hypot(px - (x1 + k * vx), py - (y1 + k * vy));
      };
      outer: for (const poly of ma) for (const ring of poly) for (const pt of ring) {
        if (!dans(pt)) continue;
        for (const seg of segmentsB) if (distSeg(pt, seg) <= t) { voisins = true; break outer; }
      }
    }
  }
  voisinageCache.set(cle, voisins);
  return voisins;
}
definirVoisinage(territoiresVoisins);

function colorWithAlpha(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
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

// Réserve de départ de chaque joueur (voir RESERVE_ITEMS) : { soldats: 20, navires: 20, … }.
const initialReserve = () => Object.fromEntries(RESERVE_ITEMS.map((item) => [item.key, item.initial]));
// État de la partie (voir src/partie.js) : ordre de jeu, propriétaires des territoires, villes,
// usines, régions intégrées, réserves, richesse, marché, Âge et round. Rien n'est pré-rempli :
// tout part des constantes de src/config.js.
let partie = nouvellePartie(initialReserve());
// Joueur actif une fois la mise en place terminée (phase 'jeu'). Pendant la mise en place,
// c'est l'ordre de jeu tiré qui décide (joueurCourant).
let activePlayer = 0;
function joueurActif() {
  return partie.phase !== 'ordre' && partie.phase !== 'jeu' ? joueurCourant(partie) : activePlayer;
}
// Choix en cours aux étapes de mise en place, tant qu'ils ne sont pas confirmés.
let atelierChoix = { territoireId: null, ressource: null };
let villeChoix = null; // territoireId de la ville choisie
let railChoix = { a: null, b: null }; // les deux territoires touchés, dans l'ordre
let territoiresDepartChoix = []; // territoires de départ sélectionnés
let portChoix = { territoire: null, mer: null, type: 'navires' };
function reinitialiserChoix() {
  atelierChoix = { territoireId: null, ressource: null };
  villeChoix = null;
  railChoix = { a: null, b: null };
  territoiresDepartChoix = [];
  portChoix = { territoire: null, mer: null, type: 'navires' };
}
// Territoire(s) déjà choisi(s) à l'étape en cours (surbrillance plus forte).
function territoiresChoisis() {
  return [atelierChoix.territoireId, villeChoix, railChoix.a, railChoix.b, ...territoiresDepartChoix, portChoix.territoire, portChoix.mer].filter(Boolean);
}
// Territoire touché dont la fiche est affichée | null.
let selectedId = null;
function territoiresEnSurbrillance() {
  const j = joueurCourant(partie);
  if (partie.phase === 'territoires') return territoiresDepartPossibles(partie, j);
  if (partie.phase === 'port') {
    if (!portChoix.territoire) return territoiresPourPort(partie, j);
    return [portChoix.territoire, ...mersVoisines(portChoix.territoire)];
  }
  if (partie.phase === 'atelier') return territoiresPourAtelier(partie, j);
  if (partie.phase === 'ville') return villesPossibles(partie, j);
  if (partie.phase === 'rail') {
    if (!railChoix.a) return territoiresPourRail(partie, j);
    return [railChoix.a, ...territoiresPourRail(partie, j, railChoix.a)];
  }
  return [];
}

// Régions -> liste de territoireId (pour la détection "région intégrée")
const territoiresParRegion = {};
for (const t of TERRITOIRES) {
  (territoiresParRegion[t.region] ??= []).push(t.id);
}

function markerColorForTerritoire(id) {
  const p = partie.proprietaire[id];
  return p === undefined ? MARKER_NEUTRAL : PLAYERS[p].color;
}

function computeScores() {
  const scores = PLAYERS.map(() => ({ territoires: 0, regions: 0, villes: 0 }));

  for (const t of TERRITOIRES) {
    const owner = partie.proprietaire[t.id];
    if (owner === undefined) continue;
    scores[owner].territoires += 1;
    if (t.ville && partie.villes[t.id] === owner) scores[owner].villes += 1;
  }

  for (const [, ids] of Object.entries(territoiresParRegion)) {
    const owners = ids.map((id) => partie.proprietaire[id]);
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
  chip.innerHTML = `<span class="rang"></span><span class="dot" style="background:${p.color}"></span> ${p.name} <span class="score">0</span>`;
  // Changer de joueur à la main n'a de sens qu'une fois la mise en place terminée : avant,
  // c'est l'ordre de jeu tiré qui désigne le joueur dont c'est le tour.
  chip.onclick = () => {
    if (partie.phase !== 'jeu') return;
    activePlayer = i;
    renderAll();
  };
  topbar.appendChild(chip);
  return chip;
});

const spacer = document.createElement('div');
spacer.className = 'spacer';
topbar.appendChild(spacer);

const nextBtn = document.createElement('button');
nextBtn.className = 'btn';
nextBtn.textContent = 'Joueur suivant →';
// Tour de table dans l'ordre de jeu tiré (fixe pour toute la partie).
nextBtn.onclick = () => {
  const ordre = partie.ordre || PLAYERS.map((_, i) => i);
  activePlayer = ordre[(ordre.indexOf(activePlayer) + 1) % ordre.length];
  renderAll();
};
topbar.appendChild(nextBtn);

const resetBtn = document.createElement('button');
resetBtn.className = 'btn';
resetBtn.textContent = 'Réinitialiser';
resetBtn.onclick = () => {
  if (!confirm('Recommencer une nouvelle partie depuis le début (ordre de jeu, puissances, ateliers) ?')) return;
  partie = nouvellePartie(initialReserve());
  activePlayer = 0;
  reinitialiserChoix();
  selectedId = null;
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
  <div class="row"><span class="sq" style="border-radius:50%;background:#ffe066"></span> touchez un territoire pour voir sa fiche ; la mise en place de la partie se fait par étapes dans le panneau du bas</div>
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
  <div class="reserve-wealth" title="Richesse"><span class="coin">$</span><span class="reserve-richesse"></span></div>
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
  const joueur = joueurActif() ?? 0;
  const player = PLAYERS[joueur];
  const reserve = partie.joueurs[joueur].reserve;
  reservePanel.style.setProperty('--player-color', player.color);
  reservePanel.querySelector('.reserve-title .name').textContent = player.name;
  reservePanel.querySelector('.reserve-richesse').textContent = partie.joueurs[joueur].richesse;
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

// ---------- Mise en place de la partie et fiches de territoire ----------
// Un "dock" en bas de l'écran empile deux cartes : la fiche du territoire touché (au-dessus,
// refermable) et la carte de l'étape en cours de la mise en place (ordre de jeu → choix des
// puissances → atelier de départ), puis le résumé de la partie une fois celle-ci lancée.
const dock = document.createElement('div');
dock.className = 'dock';
const infoCard = document.createElement('div');
infoCard.className = 'dock-card info-card';
const setupCard = document.createElement('div');
setupCard.className = 'dock-card setup-card';
dock.append(infoCard, setupCard);
app.appendChild(dock);

const escapeHtml = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const typeRessource = (r) => (typeof r === 'string' ? r : r.type);
const joueurTag = (i) => `<span class="joueur-tag" style="--c:${PLAYERS[i].color}"><span class="dot"></span>${PLAYERS[i].name}</span>`;
const iconeRessource = (type) => `<span class="res-icon">${RESOURCE_ICON_SVG[type] || ''}</span>`;

function ligneMarche() {
  const ressources = ['Énergie', 'Minerais', 'Denrées', 'Terres rares'].map((type) => {
    const verrou = type === 'Terres rares' && partie.age < CONFIG.ageDeblocageTerresRares;
    return `<span class="marche-item${verrou ? ' locked' : ''}" title="${type}${verrou ? ` — débloquées à l'Âge ${ageEnChiffresRomains(CONFIG.ageDeblocageTerresRares)}` : ''}">${iconeRessource(type)}${partie.marche[type]}${verrou ? ' 🔒' : ''}</span>`;
  }).join('');
  return `<div class="setup-meta"><span>Âge ${ageEnChiffresRomains(partie.age)} · Round ${partie.round}</span><span class="marche">Marché ${ressources}</span></div>`;
}

function ligneOrdre() {
  if (!partie.ordre) return '';
  return `<div class="ordre">${partie.ordre.map((j, k) => `<span class="ordre-item${partie.phase !== 'jeu' && k === partie.tour ? ' current' : ''}"><b>${k + 1}.</b> ${joueurTag(j)}</span>`).join('')}</div>`;
}

function renderSetupCard() {
  const tourDe = (j) => `Au tour de ${joueurTag(j)}`;
  let html = ligneMarche();
  if (partie.phase === 'ordre') {
    html += `<div class="setup-title">Étape 1 — Ordre de jeu</div>
      <div class="setup-text">L'ordre est tiré au hasard et restera le même pour toute la partie.</div>
      <div class="setup-actions"><button class="btn btn-primary" data-action="tirer">Tirer l'ordre de jeu</button></div>`;
  } else if (partie.phase === 'puissances') {
    html += ligneOrdre();
    html += `<div class="setup-title">Étape 2 — Choix des puissances</div><div class="setup-text">${tourDe(joueurCourant(partie))} : choisissez votre puissance.</div>`;
    html += `<div class="puissances">${PUISSANCES.map((pu) => {
      const pris = puissancePrisePar(partie, pu.id);
      const villes = pu.villesDepart.map((id) => TERRITOIRE_PAR_ID[id]?.ville?.nom).filter(Boolean).join(' ou ');
      return `<button class="puissance-card${pris !== null ? ' prise' : ''}" data-puissance="${pu.id}" ${pris !== null ? 'disabled' : ''} style="${pris !== null ? `--c:${PLAYERS[pris].color}` : ''}">
        <span class="puissance-nom">${pu.nom}</span>
        <span class="puissance-villes">★ ${villes}</span>
        ${pris !== null ? `<span class="puissance-owner">${joueurTag(pris)}</span>` : ''}
      </button>`;
    }).join('')}</div>`;
  } else if (partie.phase === 'territoires') {
    const j = joueurCourant(partie);
    const puissance = PUISSANCES.find((pu) => pu.id === partie.joueurs[j].puissance);
    const n = CONFIG.territoiresDepart;
    html += ligneOrdre();
    html += `<div class="setup-title">Étape 3 — Territoires de départ</div>
      <div class="setup-text">${tourDe(j)} : choisissez ${n} territoires de ${escapeHtml(puissance?.nom || 'votre région')} (touchez-les sur le globe ou ci-dessous) — ${territoiresDepartChoix.length}/${n}. Pas de région entière au départ, donc pas de bonus de région. <span class="dim">🏭 slot Industrie (atelier) · ★ ville</span></div>
      <div class="setup-actions">${territoiresDepartPossibles(partie, j).map((id) => {
        const t = TERRITOIRE_PAR_ID[id];
        const tags = `${t.slotIndustrie ? ' 🏭' : ''}${t.ville ? ' ★' : ''}`;
        return `<button class="btn${territoiresDepartChoix.includes(id) ? ' btn-chosen' : ''}" data-depart="${id}" style="--c:${PLAYERS[j].color}">${escapeHtml(t.nom)}${tags}</button>`;
      }).join('')}</div>
      <div class="setup-actions" style="margin-top:8px">
        <button class="btn btn-primary" data-action="confirmer-territoires" ${peutChoisirTerritoiresDepart(partie, territoiresDepartChoix) ? '' : 'disabled'}>Confirmer</button>
        <button class="btn" data-action="annuler-choix" ${territoiresDepartChoix.length ? '' : 'disabled'}>Annuler</button>
      </div>`;
  } else if (partie.phase === 'port') {
    const j = joueurCourant(partie);
    const nom = (id) => `<b>${escapeHtml(TERRITOIRE_PAR_ID[id].nom)}</b>`;
    const reserve = partie.joueurs[j].reserve;
    html += ligneOrdre();
    html += `<div class="setup-title">Étape 7 — Port et premier bateau</div>`;
    if (!portChoix.territoire) {
      html += `<div class="setup-text">${tourDe(j)} : touchez un de vos territoires côtiers (en surbrillance) pour y construire un port.</div>
        <div class="setup-actions">${territoiresPourPort(partie, j).map((id) => `<button class="btn" data-port="${id}">⚓ ${escapeHtml(TERRITOIRE_PAR_ID[id].nom)}</button>`).join('')}</div>`;
    } else {
      const bateaux = [['navires', 'Bateau de guerre'], ['transports', 'Bateau de transport']];
      html += `<div class="setup-text">${tourDe(j)} — port à ${nom(portChoix.territoire)} : ${portChoix.mer ? `bateau en ${nom(portChoix.mer)}.` : 'touchez la case mer voisine où placer votre bateau.'}</div>
        <div class="setup-actions">${mersVoisines(portChoix.territoire).map((mer) => `<button class="btn${portChoix.mer === mer ? ' btn-chosen' : ''}" data-mer="${mer}" style="--c:${PLAYERS[j].color}">🌊 ${escapeHtml(TERRITOIRE_PAR_ID[mer].nom)}</button>`).join('')}</div>
        <div class="setup-actions" style="margin-top:8px">${bateaux.map(([type, label]) => `<button class="btn${portChoix.type === type ? ' btn-chosen' : ''}" data-bateau="${type}" style="--c:${PLAYERS[j].color}" ${reserve[type] > 0 ? '' : 'disabled'}>${label} (${reserve[type] ?? 0})</button>`).join('')}</div>`;
    }
    html += `<div class="setup-actions" style="margin-top:8px">
        <button class="btn btn-primary" data-action="confirmer-port" ${peutPlacerPort(partie, portChoix.territoire, portChoix.mer, portChoix.type) ? '' : 'disabled'}>Confirmer</button>
        <button class="btn" data-action="annuler-choix" ${portChoix.territoire ? '' : 'disabled'}>Annuler</button>
      </div>`;
  } else if (partie.phase === 'atelier') {
    const j = joueurCourant(partie);
    html += ligneOrdre();
    html += `<div class="setup-title">Étape 4 — Atelier de départ</div>`;
    if (!atelierChoix.territoireId) {
      const possibles = territoiresPourAtelier(partie, j);
      html += `<div class="setup-text">${tourDe(j)} : touchez un de vos territoires en surbrillance (slot Industrie libre) pour y poser votre usine gratuite.</div>
        <div class="setup-actions">${possibles.map((id) => `<button class="btn" data-territoire="${id}">${escapeHtml(TERRITOIRE_PAR_ID[id].nom)}</button>`).join('')}</div>`;
    } else {
      const t = TERRITOIRE_PAR_ID[atelierChoix.territoireId];
      const ressources = ressourcesPourAtelier(partie, t.id);
      html += `<div class="setup-text">${tourDe(j)} — <b>${escapeHtml(t.nom)}</b> : choisissez la ressource à produire. Capacité de l'Atelier : ${CONFIG.capaciteAtelier} jeton.</div>
        <div class="ressources-choix">${ressources.map((r) => `
          <button class="ressource-btn${r.verrouillee ? ' locked' : ''}${atelierChoix.ressource === r.type ? ' chosen' : ''}" data-ressource="${r.type}" ${r.verrouillee ? 'disabled' : ''} style="--c:${PLAYERS[j].color}">
            <span class="ressource-rond">${RESOURCE_ICON_SVG[r.type] || ''}</span>
            <span>${r.type}</span>
            ${r.verrouillee ? `<span class="lock-note">🔒 Débloquée à l'Âge ${ageEnChiffresRomains(CONFIG.ageDeblocageTerresRares)}</span>` : ''}
          </button>`).join('')}</div>
        <div class="setup-actions">
          <button class="btn btn-primary" data-action="confirmer-atelier" ${peutConfirmerAtelier(partie, atelierChoix.territoireId, atelierChoix.ressource) ? '' : 'disabled'}>Confirmer</button>
          <button class="btn" data-action="annuler-atelier">Annuler</button>
        </div>`;
    }
  } else if (partie.phase === 'ville') {
    const j = joueurCourant(partie);
    html += ligneOrdre();
    html += `<div class="setup-title">Étape 5 — Ville de départ</div>
      <div class="setup-text">${tourDe(j)} : choisissez votre ville de départ parmi celles de votre région (touchez-la sur le globe ou ci-dessous).</div>
      <div class="setup-actions">${villesPossibles(partie, j).map((id) => {
        const t = TERRITOIRE_PAR_ID[id];
        return `<button class="btn${villeChoix === id ? ' btn-chosen' : ''}" data-ville="${id}" style="--c:${PLAYERS[j].color}">★ ${escapeHtml(t.ville.nom)} <span class="dim">(${escapeHtml(t.nom)})</span></button>`;
      }).join('')}</div>
      <div class="setup-actions" style="margin-top:8px">
        <button class="btn btn-primary" data-action="confirmer-ville" ${villeChoix ? '' : 'disabled'}>Confirmer</button>
        <button class="btn" data-action="annuler-choix" ${villeChoix ? '' : 'disabled'}>Annuler</button>
      </div>`;
  } else if (partie.phase === 'rail') {
    const j = joueurCourant(partie);
    const nom = (id) => `<b>${escapeHtml(TERRITOIRE_PAR_ID[id].nom)}</b>`;
    let consigne;
    if (!railChoix.a) consigne = 'touchez un premier territoire (en surbrillance) : le rail en partira.';
    else if (!railChoix.b) consigne = `rail depuis ${nom(railChoix.a)} : touchez maintenant un territoire voisin en surbrillance.`;
    else consigne = `rail ${nom(railChoix.a)} ⟷ ${nom(railChoix.b)} : confirmez pour le poser.`;
    html += ligneOrdre();
    html += `<div class="setup-title">Étape 6 — Rail de départ</div>
      <div class="setup-text">${tourDe(j)} : ${consigne}</div>
      <div class="setup-actions">
        <button class="btn btn-primary" data-action="confirmer-rail" ${peutPoserRail(partie, railChoix.a, railChoix.b) ? '' : 'disabled'}>Confirmer</button>
        <button class="btn" data-action="annuler-choix" ${railChoix.a ? '' : 'disabled'}>Annuler</button>
      </div>`;
  } else {
    html += ligneOrdre();
    html += `<div class="setup-title">Mise en place terminée</div><div class="setup-text">${tourDe(activePlayer)}.</div>`;
  }
  setupCard.innerHTML = html;
}

setupCard.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button');
  if (!btn || btn.disabled) return;
  if (btn.dataset.action === 'tirer') {
    tirerOrdre(partie);
    showToast(`Ordre de jeu : ${partie.ordre.map((j) => PLAYERS[j].name).join(' → ')}`);
  } else if (btn.dataset.puissance) {
    const puissance = PUISSANCES.find((pu) => pu.id === btn.dataset.puissance);
    const joueur = joueurCourant(partie);
    choisirPuissance(partie, puissance.id);
    showToast(`${PLAYERS[joueur].name} prend ${puissance.nom} — région intégrée`);
    flyToRegion(puissance.region);
    if (partie.phase === 'territoires') flyToPlayer(joueurCourant(partie));
  } else if (btn.dataset.territoire) {
    choisirTerritoireAtelier(btn.dataset.territoire);
  } else if (btn.dataset.ressource) {
    atelierChoix.ressource = btn.dataset.ressource;
  } else if (btn.dataset.action === 'annuler-atelier') {
    atelierChoix = { territoireId: null, ressource: null };
  } else if (btn.dataset.depart) {
    basculerTerritoireDepart(btn.dataset.depart);
  } else if (btn.dataset.action === 'confirmer-territoires') {
    const joueur = joueurCourant(partie);
    const noms = territoiresDepartChoix.map((id) => TERRITOIRE_PAR_ID[id].nom).join(' et ');
    choisirTerritoiresDepart(partie, territoiresDepartChoix);
    showToast(`${PLAYERS[joueur].name} : ${noms}`);
    reinitialiserChoix();
    apresEtape();
  } else if (btn.dataset.port) {
    portChoix = { territoire: btn.dataset.port, mer: null, type: portChoix.type };
  } else if (btn.dataset.mer) {
    portChoix.mer = btn.dataset.mer;
  } else if (btn.dataset.bateau) {
    portChoix.type = btn.dataset.bateau;
  } else if (btn.dataset.action === 'confirmer-port') {
    const joueur = joueurCourant(partie);
    placerPort(partie, portChoix.territoire, portChoix.mer, portChoix.type);
    showToast(`${PLAYERS[joueur].name} : port à ${TERRITOIRE_PAR_ID[portChoix.territoire].nom}, bateau en ${TERRITOIRE_PAR_ID[portChoix.mer].nom}`);
    reinitialiserChoix();
    apresEtape();
  } else if (btn.dataset.ville) {
    villeChoix = btn.dataset.ville;
  } else if (btn.dataset.action === 'annuler-choix') {
    reinitialiserChoix();
  } else if (btn.dataset.action === 'confirmer-ville') {
    const joueur = joueurCourant(partie);
    const t = TERRITOIRE_PAR_ID[villeChoix];
    choisirVille(partie, villeChoix);
    showToast(`${PLAYERS[joueur].name} : ville de départ ${t.ville.nom}`);
    reinitialiserChoix();
    apresEtape();
  } else if (btn.dataset.action === 'confirmer-rail') {
    const joueur = joueurCourant(partie);
    placerRail(partie, railChoix.a, railChoix.b);
    showToast(`${PLAYERS[joueur].name} : rail ${TERRITOIRE_PAR_ID[railChoix.a].nom} ⟷ ${TERRITOIRE_PAR_ID[railChoix.b].nom}`);
    reinitialiserChoix();
    apresEtape();
  } else if (btn.dataset.action === 'confirmer-atelier') {
    const joueur = joueurCourant(partie);
    const t = TERRITOIRE_PAR_ID[atelierChoix.territoireId];
    placerAtelier(partie, atelierChoix.territoireId, atelierChoix.ressource);
    showToast(`${PLAYERS[joueur].name} : Atelier posé en ${t.nom} (${atelierChoix.ressource})`);
    reinitialiserChoix();
    apresEtape();
  }
  renderAll();
});

// Après chaque choix confirmé : caméra sur la puissance du joueur suivant, ou, une fois la mise
// en place terminée, premier joueur de l'ordre tiré actif.
function apresEtape() {
  if (partie.phase === 'jeu') activePlayer = partie.ordre[0];
  else flyToPlayer(joueurCourant(partie));
}

function choisirTerritoireAtelier(id) {
  atelierChoix = { territoireId: id, ressource: null };
  selectedId = null;
}

// Territoires de départ : toucher un territoire le sélectionne ou le désélectionne (au plus
// CONFIG.territoiresDepart).
function basculerTerritoireDepart(id) {
  if (territoiresDepartChoix.includes(id)) territoiresDepartChoix = territoiresDepartChoix.filter((x) => x !== id);
  else if (territoiresDepartChoix.length < CONFIG.territoiresDepart) territoiresDepartChoix = [...territoiresDepartChoix, id];
}

// Étape du rail : premier territoire touché, puis un voisin ; retoucher le premier l'annule,
// toucher un autre territoire de départ possible recommence depuis celui-ci.
function toucherPourRail(id) {
  const j = joueurCourant(partie);
  if (railChoix.a === id) {
    railChoix = { a: null, b: null };
  } else if (railChoix.a && territoiresPourRail(partie, j, railChoix.a).includes(id)) {
    railChoix.b = id;
  } else if (territoiresPourRail(partie, j).includes(id)) {
    railChoix = { a: id, b: null };
  }
}

// Centre la caméra sur une région (moyenne des positions de ses territoires).
function flyToRegion(region) {
  const pts = (territoiresParRegion[region] || []).map((id) => labelAnchorById.get(id)).filter(Boolean)
    .map((a) => projection.invert([a.x, a.y]));
  if (!pts.length) return;
  const lng = pts.reduce((a, p) => a + p[0], 0) / pts.length;
  const lat = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  // Sur téléphone, le panneau de mise en place couvre le bas de l'écran : on vise un peu plus
  // au sud pour que la région apparaisse dans la moitié haute, bien visible et touchable.
  const decalage = window.matchMedia('(max-width: 699px)').matches ? 14 : 0;
  world.pointOfView({ lat: lat - decalage, lng, altitude: 1.3 }, 1200);
}
function flyToPlayer(joueur) {
  const puissance = PUISSANCES.find((pu) => pu.id === partie.joueurs[joueur]?.puissance);
  if (puissance) flyToRegion(puissance.region);
}

// Fiche d'un territoire touché : lisible par tous ; seul son propriétaire pourra y agir (actions
// à venir). Une fois la mise en place terminée, un territoire neutre peut être envahi.
function renderInfoCard() {
  if (!selectedId) {
    infoCard.style.display = 'none';
    return;
  }
  const t = TERRITOIRE_PAR_ID[selectedId];
  const owner = partie.proprietaire[t.id];
  const integree = partie.regionsIntegrees[t.region];
  const usine = partie.usines[t.id];
  const ressources = (t.ressources || []).map(typeRessource);
  const lignes = [];
  lignes.push(`<div class="info-sub">${escapeHtml(t.region)} · ${owner === undefined ? 'Neutre' : joueurTag(owner)}${integree ? ' <span class="badge">Région intégrée</span>' : ''}</div>`);
  if (t.type !== 'maritime') {
    lignes.push(`<div class="info-row">Ressources : ${ressources.length ? ressources.map((r) => `${iconeRessource(r)}${r}`).join(' ') : '—'}</div>`);
    lignes.push(`<div class="info-row">Centre urbain : ${t.ville ? `★ ${escapeHtml(t.ville.nom)}${partie.villes[t.id] !== undefined ? ` (${joueurTag(partie.villes[t.id])})` : ''}` : '—'}</div>`);
    lignes.push(`<div class="info-row">Slot Industrie : ${t.slotIndustrie ? (usine ? `occupé — usine de ${joueurTag(usine.joueur)}, jeton ${usine.jetons.join(', ')}` : 'libre') : '—'}</div>`);
    const port = partie.ports[t.id];
    if (port) lignes.push(`<div class="info-row">Port : ⚓ ${joueurTag(port.joueur)}, vers ${escapeHtml(TERRITOIRE_PAR_ID[port.mer].nom)}</div>`);
  } else {
    const bateaux = partie.bateaux.filter((b) => b.mer === t.id);
    lignes.push(`<div class="info-row">Bateaux : ${bateaux.length ? bateaux.map((b) => `${b.type === 'navires' ? 'guerre' : 'transport'} (${joueurTag(b.joueur)})`).join(', ') : '—'}</div>`);
  }
  let actions = '';
  const moi = joueurActif();
  if (owner !== undefined && owner !== moi) {
    actions = `<div class="info-note">Appartient à ${joueurTag(owner)} : consultation seulement.</div>`;
  } else if (owner !== undefined && owner === moi) {
    actions = '<div class="info-note">Votre territoire (actions à venir).</div>';
  } else if (partie.phase === 'jeu' && t.type !== 'maritime') {
    actions = '<div class="info-note">Territoire neutre : il se colonise en y construisant un bâtiment (à venir).</div>';
  }
  infoCard.innerHTML = `<button class="info-close" data-action="fermer" aria-label="Fermer">×</button>
    <div class="info-title">${escapeHtml(t.nom)}</div>${lignes.join('')}${actions}`;
  infoCard.style.display = '';
}

infoCard.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button');
  if (!btn) return;
  if (btn.dataset.action === 'fermer') clearSelection();
});

// Un territoire touché sur le globe (ou sa ville) : à l'étape de l'atelier, un territoire en
// surbrillance du joueur courant ouvre directement le choix de ressource ; sinon, sa fiche.
// Un même toucher peut remonter deux fois (clic du globe + événement de pointeur selon
// l'appareil) : sans garde, l'étape du rail — où retoucher un territoire l'annule — le
// sélectionnait puis le désélectionnait aussitôt. On ignore donc un second toucher du même
// territoire arrivé presque en même temps.
let dernierToucher = { id: null, at: 0 };
function handleTerritoryClick(id) {
  const now = Date.now();
  if (dernierToucher.id === id && now - dernierToucher.at < 350) return;
  dernierToucher = { id, at: now };
  if (partie.phase === 'atelier' && territoiresEnSurbrillance().includes(id)) {
    choisirTerritoireAtelier(id);
    renderAll();
    return;
  }
  if (partie.phase === 'territoires' && territoiresEnSurbrillance().includes(id)) {
    basculerTerritoireDepart(id);
    selectedId = null;
    renderAll();
    return;
  }
  if (partie.phase === 'port') {
    const j = joueurCourant(partie);
    if (portChoix.territoire && mersVoisines(portChoix.territoire).includes(id)) {
      portChoix.mer = id;
      selectedId = null;
      renderAll();
      return;
    }
    if (territoiresPourPort(partie, j).includes(id)) {
      portChoix = { territoire: id, mer: null, type: portChoix.type };
      selectedId = null;
      renderAll();
      return;
    }
  }
  if (partie.phase === 'ville' && territoiresEnSurbrillance().includes(id)) {
    villeChoix = id;
    selectedId = null;
    renderAll();
    return;
  }
  // Rail : tout territoire en surbrillance (à soi ou neutre voisin), ou l'un des siens (pour
  // recommencer depuis un autre point de départ).
  if (partie.phase === 'rail' && (territoiresEnSurbrillance().includes(id) || partie.proprietaire[id] === joueurCourant(partie))) {
    toucherPourRail(id);
    selectedId = null;
    renderAll();
    return;
  }
  selectTerritoire(id);
}

function selectTerritoire(id) {
  selectedId = id;
  renderAll();
}

function clearSelection() {
  selectedId = null;
  renderAll();
}

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

// Maquettes 3D en relief (voir src/models3d.js) : une par ville possédée et par usine posée,
// visibles seulement une fois assez zoomé (MODEL_ALT_VISIBLE) — elles remplacent alors
// l'icône HTML au même endroit, à une taille comparable. Construites une seule fois par
// (lieu, couleur) puis réutilisées d'un rafraîchissement à l'autre.
const MODEL_ALT_VISIBLE = 1.0;
const modelCache = new Map();
let objects3d = [];
let objects3dSignature = '';
let models3dVisible = false;
function refreshObjects3d() {
  const wanted = [];
  for (const [territoireId, joueur] of Object.entries(partie.villes)) {
    const t = TERRITOIRE_PAR_ID[territoireId];
    if (t?.ville) wanted.push({ key: `ville:${territoireId}:${joueur}`, territoireId, lat: t.ville.lat, lon: t.ville.lon, build: () => construireVille(t.ville.nom, PLAYERS[joueur].color) });
  }
  for (const [territoireId, usine] of Object.entries(partie.usines)) {
    const m = markersData.find((d) => d.type === 'factory' && d.territoireId === territoireId);
    if (m) wanted.push({ key: `usine:${territoireId}:${usine.joueur}`, territoireId, lat: m.lat, lon: m.lon, build: () => construireUsine(PLAYERS[usine.joueur].color) });
  }
  const signature = wanted.map((w) => w.key).join('|');
  if (signature === objects3dSignature) return;
  objects3dSignature = signature;
  objects3d = wanted.map((w) => {
    if (!modelCache.has(w.key)) modelCache.set(w.key, w.build());
    const obj = modelCache.get(w.key);
    obj.visible = models3dVisible;
    return { territoireId: w.territoireId, lat: w.lat, lon: w.lon, obj };
  });
  world.objectsData(objects3d);
}
function setModels3dVisible(visible) {
  if (visible === models3dVisible) return;
  models3dVisible = visible;
  for (const o of objects3d) o.obj.visible = visible;
  document.documentElement.classList.toggle('zoom-3d', visible);
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
    if (id) handleTerritoryClick(id);
    else renderAll();
  })
  .htmlLat((d) => d.lat)
  .htmlLng((d) => d.lon)
  .htmlAltitude(0.012)
  .htmlElement(buildMarkerElement)
  .onZoom(updatePoiScale);

world
  .objectLat((d) => d.lat)
  .objectLng((d) => d.lon)
  .objectAltitude(0.002)
  .objectFacesSurface(true)
  .objectThreeObject((d) => d.obj)
  // Un toucher sur une maquette 3D (même invisible de loin : elle reste sur le trajet du
  // clic) n'arrive pas au globe (onGlobeClick) : on le traite comme un toucher de son territoire.
  .onObjectClick((d) => {
    if (!wasCleanTap()) return;
    lastClickInfo = `objet→${d.territoireId}`;
    handleTerritoryClick(d.territoireId);
  });

world.pointOfView({ lat: 20, lng: 10, altitude: 2.6 }, 0);
window.__world = world; // debug uniquement
// debug uniquement (tests automatisés)
window.__debug = {
  partie: () => partie,
  markers: () => markersData,
  ancre: (id) => { const a = labelAnchorById.get(id); return a ? projection.invert([a.x, a.y]) : null; },
  surbrillance: () => territoiresEnSurbrillance(),
  choix: () => ({ atelierChoix, villeChoix, railChoix, dernierToucher, lastClickInfo }),
  railPath: (a, b) => (railPath(a, b) || []).map((pt) => projection.invert([pt.x, pt.y])),
};
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
  const usine = partie.usines[d.territoireId];
  // Slot occupé : carré plein à la couleur du joueur, et sa maquette 3D d'usine (voir
  // objects3d) prend le relais de l'icône en zoomant.
  marker.className = `poi-marker poi-marker--factory${usine ? ' occupied has-3d' : ''}`;
  marker.style.borderColor = markerColorForTerritoire(d.territoireId);
  if (usine) marker.style.background = PLAYERS[usine.joueur].color;
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
      // Ressource produite (jeton de production posé dessus) : tout le rond prend la couleur
      // du joueur, le symbole restant visible en blanc.
      if (usine && usine.jetons.includes(resourceTypeOf(r))) {
        icon.classList.add('produite');
        icon.style.background = PLAYERS[usine.joueur].color;
        icon.style.borderColor = PLAYERS[usine.joueur].color;
      }
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

  if (d.type === 'port' || d.type === 'bateau') {
    // Port (ancre) / bateau : carré plein à la couleur du joueur, symbole en blanc.
    const marker = document.createElement('div');
    marker.className = `poi-marker occupied${d.type === 'bateau' ? ' poi-marker--boat' : ''}`;
    marker.style.background = PLAYERS[d.joueur].color;
    marker.style.borderColor = PLAYERS[d.joueur].color;
    const cle = d.type === 'port' ? 'ports' : d.bateau;
    marker.innerHTML = RESERVE_ITEMS.find((it) => it.key === cle)?.svg || '';
    marker.title = d.type === 'port' ? `Port — ${TERRITOIRE_PAR_ID[d.territoireId].nom}` : `${d.bateau === 'navires' ? 'Bateau de guerre' : 'Bateau de transport'} — ${TERRITOIRE_PAR_ID[d.territoireId].nom}`;
    marker.onclick = (ev) => { ev.stopPropagation(); if (!wasCleanTap()) return; handleTerritoryClick(d.territoireId); };
    group.appendChild(marker);
  } else if (d.type === 'city') {
    const marker = document.createElement('div');
    // Ville possédée : sa maquette 3D (voir objects3d) prend le relais de l'icône en zoomant.
    const proprioVille = partie.villes[d.territoireId];
    // Ville possédée : carré plein à la couleur du joueur, étoile en blanc (comme une usine posée).
    marker.className = `poi-marker${proprioVille !== undefined ? ' occupied has-3d' : ''}`;
    marker.style.borderColor = proprioVille !== undefined ? PLAYERS[proprioVille].color : MARKER_NEUTRAL;
    if (proprioVille !== undefined) marker.style.background = PLAYERS[proprioVille].color;
    marker.innerHTML = CITY_ICON_SVG;
    marker.title = `${d.nom} — ${TERRITOIRE_PAR_ID[d.territoireId].nom}`;
    marker.onclick = (ev) => { ev.stopPropagation(); if (!wasCleanTap()) return; handleTerritoryClick(d.territoireId); };
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
  setModels3dVisible(altitude < MODEL_ALT_VISIBLE);
}

// Ports et bateaux : marqueurs calculés à chaque rafraîchissement (ils changent en cours de
// partie). Le port se pose sur la côte de son territoire, face à la case mer qu'il dessert ; le
// bateau juste au large, dans cette case mer.
const portPointCache = new Map();
function pointDuPort(territoireId, mer) {
  const cle = `${territoireId}|${mer}`;
  if (portPointCache.has(cle)) return portPointCache.get(cle);
  const terre = displayGeometryById.get(territoireId);
  const eau = displayGeometryById.get(mer);
  const repere = pointInfrastructure(territoireId) || labelAnchorById.get(territoireId);
  // Ne pas poser le port sur la ville ou l'usine du territoire (marqueurs superposés).
  const occupes = markersData.filter((m) => m.territoireId === territoireId).map((m) => {
    const [x, y] = projection([m.lon, m.lat]);
    return { x, y };
  });
  const tropPres = ([x, y]) => occupes.some((o) => Math.hypot(o.x - x, o.y - y) < 28);
  let meilleur = null;
  if (terre && eau && repere) {
    // Sommets de la côte du territoire qui bordent cette case mer (à 3 px près)…
    const segments = [];
    for (const poly of eau) for (const ring of poly) for (let i = 0; i < ring.length - 1; i++) segments.push([ring[i], ring[i + 1]]);
    const distSeg = ([px, py], [[x1, y1], [x2, y2]]) => {
      const vx = x2 - x1, vy = y2 - y1;
      const l2 = vx * vx + vy * vy;
      const k = l2 ? Math.max(0, Math.min(1, ((px - x1) * vx + (py - y1) * vy) / l2)) : 0;
      return Math.hypot(px - (x1 + k * vx), py - (y1 + k * vy));
    };
    let meilleureDist = Infinity;
    for (const poly of terre) for (const ring of poly) for (const pt of ring) {
      const d = Math.hypot(pt[0] - repere.x, pt[1] - repere.y);
      if (d >= meilleureDist || tropPres(pt)) continue;
      if (segments.some((seg) => distSeg(pt, seg) <= 3)) { meilleur = { x: pt[0], y: pt[1] }; meilleureDist = d; }
    }
  }
  // … celui le plus proche du cœur du territoire (sa ville, son usine, son nom).
  const resultat = meilleur || repere;
  portPointCache.set(cle, resultat);
  return resultat;
}
function pointAuLarge(portPt, mer, rang) {
  const eau = displayGeometryById.get(mer);
  const cible = labelAnchorById.get(mer);
  if (!eau || !cible || !portPt) return cible || portPt;
  const dans = (x, y) => booleanPointInPolygon([x, y], { type: 'MultiPolygon', coordinates: eau });
  const dx = cible.x - portPt.x, dy = cible.y - portPt.y;
  const len = Math.hypot(dx, dy) || 1;
  // Premier point dans la mer, à au moins ~25 px de texture (≈ 250 km) de la côte, vers le centre
  // de la case — bien détaché du port.
  for (let t = 25 + rang * 14; t < len; t += 3) {
    const x = portPt.x + (dx / len) * t, y = portPt.y + (dy / len) * t;
    if (dans(x, y)) return { x, y };
  }
  return cible;
}
function marqueursPortsEtBateaux() {
  const out = [];
  const versLonLat = (p) => projection.invert([p.x, p.y]);
  for (const [territoireId, port] of Object.entries(partie.ports)) {
    const p = pointDuPort(territoireId, port.mer);
    if (!p) continue;
    const [lon, lat] = versLonLat(p);
    out.push({ type: 'port', territoireId, joueur: port.joueur, lat, lon });
  }
  const parMer = {};
  for (const b of partie.bateaux) {
    const rang = (parMer[b.mer] = (parMer[b.mer] ?? -1) + 1);
    const port = Object.entries(partie.ports).find(([, pt]) => pt.mer === b.mer && pt.joueur === b.joueur);
    const depart = port ? pointDuPort(port[0], b.mer) : labelAnchorById.get(b.mer);
    const p = pointAuLarge(depart, b.mer, rang);
    if (!p) continue;
    const [lon, lat] = versLonLat(p);
    out.push({ type: 'bateau', territoireId: b.mer, joueur: b.joueur, bateau: b.type, lat, lon });
  }
  return out;
}

function renderAll() {
  if (globeTexture) redrawLive();
  // Rafraîchit les marqueurs : globe.gl réutilise l'élément HTML d'une donnée qu'il connaît
  // déjà (même objet), sans rappeler buildMarkerElement — il faut donc lui passer des COPIES
  // pour qu'il les reconstruise avec l'état à jour (couleur du propriétaire, slot occupé,
  // jeton, maquette 3D).
  world.htmlElementsData([...markersData.map((d) => ({ ...d })), ...marqueursPortsEtBateaux()]);
  refreshObjects3d();

  renderReservePanel();
  renderSetupCard();
  renderInfoCard();

  const scores = computeScores();
  const actif = joueurActif();
  chips.forEach((chip, i) => {
    chip.style.borderColor = i === actif ? '#fff' : 'transparent';
    chip.querySelector('.score').textContent = scores[i].total;
    // Rang dans l'ordre de jeu, une fois tiré.
    chip.querySelector('.rang').textContent = partie.ordre ? `${partie.ordre.indexOf(i) + 1}.` : '';
  });
  nextBtn.style.display = partie.phase === 'jeu' ? '' : 'none';

  // Diagnostic : liste explicitement les territoires réellement marqués "attribués", et le
  // dernier point touché avec le territoire trouvé (ou "aucun") — utile pour vérifier que
  // la détection de clic (point-in-polygon) retrouve bien le bon territoire.
  if (readyStatusBase) {
    const owned = Object.keys(partie.proprietaire);
    statusEl.textContent = `${readyStatusBase} · clic:${lastClickInfo} · attribués(${owned.length})`;
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
    // Trait de côte mondial (Natural Earth 50m), chargé en parallèle : sert à faire passer les
    // rails par la vraie terre (voir railPath).
    landTopo || import('world-atlas/land-50m.json').then((m) => { landTopo = m.default; }),
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
