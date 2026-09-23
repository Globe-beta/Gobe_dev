import * as THREE from 'three';
import Globe from 'globe.gl';
import { geoEquirectangular, geoPath } from 'd3-geo';
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

// Symboles des marqueurs ville/usine — mêmes silhouettes partout (sur le globe ET dans la
// légende), pour que la légende corresponde exactement à ce qu'on voit sur la carte. Formes
// pleines simples (pas de traits fins) : à la taille d'un marqueur, un trait fin disparaît.
const CITY_ICON_SVG = '<svg viewBox="0 0 24 24" fill="#1a1d24"><rect x="3" y="10" width="6" height="11"/><rect x="10" y="4" width="6" height="17"/><rect x="17" y="13" width="4" height="8"/></svg>';
const FACTORY_ICON_SVG = '<svg viewBox="0 0 24 24" fill="#1a1d24"><rect x="2" y="12" width="20" height="9"/><rect x="5" y="6" width="3" height="7"/><rect x="11" y="3" width="3" height="10"/><rect x="17" y="8" width="3" height="5"/></svg>';

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

// territoireId -> géométrie telle que livrée par build-geo.mjs (utilisée pour la
// détection de clic : point-in-polygon, insensible au dépliage antiméridien tant que le
// point testé est décalé de la même façon si besoin — voir findTerritoireAt).
const rawGeometryById = new Map();
// territoireId -> géométrie "dépliée" (utilisée pour le dessin sur le canvas).
const canvasGeometryById = new Map();

function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))];
}

// Une couleur différente par région (22 au total) pour ses frontières. Les teintes sont
// espacées par l'angle d'or (~137.5°) plutôt que régulièrement (360/22°) : deux régions
// consécutives dans la liste (donc souvent voisines géographiquement, ex. les régions
// d'Europe) reçoivent ainsi des teintes franchement différentes plutôt que deux nuances
// proches d'une même couleur.
const REGIONS = [...new Set(TERRITOIRES.map((t) => t.region))];
const regionRgb = new Map(REGIONS.map((r, i) => [r, hslToRgb((i * 137.508) % 360, 80, 55)]));
const regionColor = new Map(REGIONS.map((r) => [r, `rgb(${regionRgb.get(r).join(',')})`]));
// Image (calculée une seule fois à la réception des données) portant uniquement les
// frontières EXTÉRIEURES de chaque région, en couleur — voir computeRegionBorderOverlay.
let regionBorderOverlay = null;

// territoireId -> { x, y } en pixels du canvas, calculé une seule fois par territoire (pas
// à chaque rendu) à partir de sa forme réelle. On utilise le "pôle d'inaccessibilité"
// (polylabel, la même technique que Mapbox pour le placement des noms de pays sur une
// carte) plutôt que le centre géométrique : contrairement au centre, ce point est TOUJOURS
// à l'intérieur de la forme, y compris pour un territoire en croissant, avec une baie, ou
// coupé en plusieurs îles (on ne garde alors que la plus grande).
const labelAnchorById = new Map();
function computeLabelAnchor(geometry) {
  const pieces = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  let best = null;
  for (const rings of pieces) {
    const pixelRings = rings.map((ring) => ring.map((pt) => projection(pt)));
    const area = Math.abs(path.area({ type: 'Polygon', coordinates: rings }));
    if (!best || area > best.area) best = { rings: pixelRings, area };
  }
  if (!best) return null;
  const label = polylabel([best.rings[0]], 0.5);
  return { x: label[0], y: label[1] };
}

// Même taille de police, minuscule, pour tous les territoires (dans l'espace de la texture,
// qui couvre toute la Terre en TEX_W x TEX_H px) : à l'échelle du globe entier le nom est
// presque invisible, volontairement discret ; en zoomant sur un pays ou une région, la même
// caméra qui grossit la carte grossit aussi ce texte, qui devient lisible sans rien
// recalculer. Exprimée en fraction de la largeur de la texture (pas en pixels fixes) : avec
// TEX_W=4096, ça donne ~9px — plus petit, à l'écran, que les 7px de l'ancienne texture à
// 1600px de large (9/4096 < 7/1600), mais dessiné avec davantage de pixels sources, donc
// moins pixelisé une fois agrandi par le zoom.
const LABEL_FONT_SIZE = Math.round(TEX_W * 0.0022);

// Dessine le nom de chaque territoire, toujours à la même place (calculée une seule fois,
// voir computeLabelAnchor). Un contour sombre derrière le texte blanc le garde lisible quel
// que soit le fond (océan, désert, couleur de joueur une fois le territoire attribué...).
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
    ctx.strokeText(t.nom, a.x, a.y);
    ctx.fillText(t.nom, a.x, a.y);
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
const REGION_BORDER_RADIUS = Math.round(TEX_W * 0.0018);

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
// trait plus épais qu'un simple contour de 1px. Traiter les régions séparément (plutôt qu'un
// seul canvas partagé avec un identifiant par région) évite tout risque qu'un pixel à la
// frontière entre deux régions DIFFÉRENTES se retrouve, à cause du fondu de l'anti-aliasing,
// avec une valeur intermédiaire qui ressemblerait par hasard à l'identifiant d'une troisième
// région. Le travail par région est limité à son rectangle englobant (pas le canvas entier) :
// une région n'occupe généralement qu'une petite fraction de la carte, et à la résolution de
// texture actuelle (4096x2048), parcourir les 22 régions sur l'image entière serait bien
// trop lent.
function computeRegionBorderOverlay() {
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = TEX_W;
  maskCanvas.height = TEX_H;
  const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
  path.context(maskCtx);

  const overlay = document.createElement('canvas');
  overlay.width = TEX_W;
  overlay.height = TEX_H;
  const overlayCtx = overlay.getContext('2d');
  const overlayData = overlayCtx.createImageData(TEX_W, TEX_H);
  const out = overlayData.data;
  const stamp = (cx, cy, r, g, b) => {
    const x0 = Math.max(0, cx - REGION_BORDER_RADIUS);
    const x1 = Math.min(TEX_W - 1, cx + REGION_BORDER_RADIUS);
    const y0 = Math.max(0, cy - REGION_BORDER_RADIUS);
    const y1 = Math.min(TEX_H - 1, cy + REGION_BORDER_RADIUS);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = (y * TEX_W + x) * 4;
        out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = 255;
      }
    }
  };

  const ALPHA_THRESHOLD = 127;
  const PAD = REGION_BORDER_RADIUS + 2;

  for (const region of REGIONS) {
    const ids = territoiresParRegion[region] || [];
    const features = ids.map((tid) => ({ type: 'Feature', geometry: canvasGeometryById.get(tid) })).filter((f) => f.geometry);
    if (!features.length) continue;
    const [[bx0, by0], [bx1, by1]] = path.bounds({ type: 'FeatureCollection', features });
    const x0 = Math.max(0, Math.floor(bx0) - PAD);
    const y0 = Math.max(0, Math.floor(by0) - PAD);
    const x1 = Math.min(TEX_W - 1, Math.ceil(bx1) + PAD);
    const y1 = Math.min(TEX_H - 1, Math.ceil(by1) + PAD);
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    if (w <= 0 || h <= 0) continue;

    maskCtx.clearRect(x0, y0, w, h);
    maskCtx.fillStyle = '#fff';
    for (const f of features) {
      maskCtx.beginPath();
      path(f);
      maskCtx.fill();
    }
    const { data } = maskCtx.getImageData(x0, y0, w, h);
    const inside = (lx, ly) => data[(ly * w + lx) * 4 + 3] > ALPHA_THRESHOLD;
    const [r, g, b] = regionRgb.get(region);

    for (let ly = 0; ly < h; ly++) {
      for (let lx = 0; lx < w; lx++) {
        if (!inside(lx, ly)) continue;
        const left = lx > 0 && inside(lx - 1, ly);
        const right = lx < w - 1 && inside(lx + 1, ly);
        const up = ly > 0 && inside(lx, ly - 1);
        const down = ly < h - 1 && inside(lx, ly + 1);
        if (left && right && up && down) continue; // pixel intérieur, pas une frontière
        stamp(x0 + lx, y0 + ly, r, g, b);
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

  // Frontières de tous les territoires, dessinées une seule fois : elles ne changent
  // jamais, seul le remplissage (attribué/sélectionné) est redessiné ensuite.
  path.context(baseCtx);
  baseCtx.strokeStyle = 'rgba(0,0,0,0.9)';
  baseCtx.lineWidth = TEX_W * 0.0012;
  for (const geometry of canvasGeometryById.values()) {
    baseCtx.beginPath();
    path({ type: 'Feature', geometry });
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
  path.context(liveCtx);

  const paint = (id, fillStyle) => {
    const geometry = canvasGeometryById.get(id);
    if (!geometry) return;
    liveCtx.fillStyle = fillStyle;
    liveCtx.beginPath();
    path({ type: 'Feature', geometry });
    liveCtx.fill();
  };

  for (const [id, p] of Object.entries(ownership)) {
    paint(id, PLAYERS[p].color);
  }
  if (selectedId) paint(selectedId, '#ffe066');

  drawLabels(liveCtx);

  globeTexture.needsUpdate = true;
}

// Cherche quel territoire contient le point (lat, lng) touché sur le globe. Comme pour le
// dessin, certains territoires ont des longitudes décalées au-delà de ±180° dans les
// données ; on teste donc le point à sa position normale ET décalée de ±360°, l'une des
// deux correspondra forcément à la représentation stockée pour ce territoire.
function findTerritoireAt(lat, lng) {
  for (const [id, geometry] of rawGeometryById) {
    const feature = { type: 'Feature', geometry };
    if (
      booleanPointInPolygon([lng, lat], feature) ||
      booleanPointInPolygon([lng + 360, lat], feature) ||
      booleanPointInPolygon([lng - 360, lat], feature)
    ) {
      return id;
    }
  }
  return null;
}

// territoireId -> index de joueur (0-3) | undefined si non attribué
const ownership = {};
let activePlayer = 0;
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
  if (!confirm('Effacer toutes les attributions de territoires ?')) return;
  for (const k of Object.keys(ownership)) delete ownership[k];
  renderAll();
};
topbar.appendChild(resetBtn);

// Bandeau pleine largeur listant les 22 régions et leur couleur de frontière (voir
// computeRegionBorderOverlay), pour pouvoir associer chaque couleur vue sur le globe à son
// nom de région.
const regionLegendBar = document.createElement('div');
regionLegendBar.className = 'region-legend';
regionLegendBar.innerHTML = REGIONS.map((region) => `
  <span class="item"><span class="sq" style="background:${regionColor.get(region)}"></span>${region}</span>
`).join('');
app.appendChild(regionLegendBar);

const legend = document.createElement('div');
legend.className = 'legend';
legend.innerHTML = `
  <div><b>47 territoires</b> · 22 régions · 18 villes</div>
  <div class="row"><span class="sq" style="border-radius:50%;background:#ffe066"></span> touchez un territoire pour le sélectionner, puis "Envahir" pour l'attribuer au joueur actif</div>
  <div class="row"><span class="legend-icon">${CITY_ICON_SVG}</span> centre urbain (zoomez sur un pays pour le voir)</div>
  <div class="row"><span class="legend-icon">${FACTORY_ICON_SVG}</span> slot Industrie</div>
  <div>1 pt/territoire · +3/région intégrée · +4/ville</div>
  <div style="opacity:0.5;margin-top:4px">build ${typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : '?'}</div>
`;
app.appendChild(legend);

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

// Un marqueur = une ancre (position gérée par globe.gl/CSS2DRenderer, qui réécrit son style
// "transform" à chaque frame — on n'y touche jamais) contenant un carré visuel séparé
// (.poi-marker) : c'est SUR ce carré, jamais sur l'ancre, qu'on applique l'échelle liée au
// zoom (voir updatePoiScale), sans quoi elle serait écrasée en permanence par globe.gl.
function buildMarkerElement(d) {
  const anchor = document.createElement('div');
  anchor.className = 'poi-anchor';
  const marker = document.createElement('div');
  marker.className = 'poi-marker';
  marker.style.borderColor = markerColorForTerritoire(d.territoireId);
  marker.innerHTML = d.type === 'city' ? CITY_ICON_SVG : FACTORY_ICON_SVG;
  anchor.appendChild(marker);
  if (d.type === 'city') {
    marker.title = `${d.nom} — ${TERRITOIRE_PAR_ID[d.territoireId].nom}`;
    marker.onclick = (ev) => { ev.stopPropagation(); if (!wasCleanTap()) return; selectTerritoire(d.territoireId); };
  } else {
    marker.classList.add('poi-marker--factory');
  }
  return anchor;
}

// Les marqueurs ville/usine sont quasiment invisibles à l'échelle du globe entier, et
// apparaissent en zoomant sur un pays — comme les noms de territoires, mais par un autre
// moyen : ce sont des éléments HTML (CSS2DRenderer), pas des pixels de la texture, donc ils
// ne grossissent pas tout seuls avec le zoom de la caméra. On calcule donc nous-mêmes une
// échelle à partir de l'altitude de la caméra (0 = invisible, loin ; 1 = taille normale,
// proche) à chaque changement de vue, appliquée via une variable CSS lue par .poi-marker.
const POI_ALT_HIDDEN = 2.2;
const POI_ALT_FULL = 0.45;
function updatePoiScale({ altitude }) {
  const t = (POI_ALT_HIDDEN - altitude) / (POI_ALT_HIDDEN - POI_ALT_FULL);
  const scale = Math.max(0, Math.min(1, t));
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
    fetchJson('geo/centroides.json' + cacheBust),
    earthImg || loadImage('textures/earth-day.jpg' + cacheBust).then((img) => { earthImg = img; }),
  ]).then(([geo, centroides]) => {
    const totalPoints = geo.features.reduce((a, f) => a + countPoints(f.geometry), 0);
    statusEl.textContent = `Prêt (${geo.features.length} terr., ${totalPoints} pts géo)`;

    for (const f of geo.features) {
      const id = f.properties.territoireId;
      rawGeometryById.set(id, f.geometry);
      canvasGeometryById.set(id, dewrapGeometry(f.geometry));
    }
    for (const t of TERRITOIRES) {
      const anchor = computeLabelAnchor(canvasGeometryById.get(t.id));
      if (anchor) labelAnchorById.set(t.id, anchor);
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
      if (t.slotIndustrie && centroides[t.id]) {
        const [lon, lat] = centroides[t.id];
        markersData.push({ type: 'factory', territoireId: t.id, lat, lon });
      }
    }
    world.htmlElementsData(markersData);

    readyStatusBase = `build ${BUILD_ID} · Prêt · ${geo.features.length} terr. · ${totalPoints} pts`;
    renderAll();
  }).catch((err) => {
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
});
