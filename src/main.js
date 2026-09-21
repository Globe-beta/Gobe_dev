import * as THREE from 'three';
import Globe from 'globe.gl';
import './style.css';
import { TERRITOIRES, TERRITOIRE_PAR_ID } from './data/territoires.js';

const PLAYERS = [
  { name: 'Joueur 1', color: '#e63946' },
  { name: 'Joueur 2', color: '#457b9d' },
  { name: 'Joueur 3', color: '#2a9d8f' },
  { name: 'Joueur 4', color: '#f4a261' },
];
const MARKER_NEUTRAL = '#e8e8e8'; // ville/usine non attribuée : reste bien visible (carré blanc)

// Matériaux du globe : on passe par de vrais THREE.Material (polygonCapMaterial /
// polygonSideMaterial) plutôt que par des chaînes de couleur CSS (polygonCapColor /
// polygonSideColor). three-globe applique par défaut depthWrite:true à ses matériaux
// internes même quand ils sont rendus invisibles par transparence — un territoire non
// attribué (alpha 0) écrit alors quand même dans le tampon de profondeur, ce qui peut
// perturber le tri des surfaces transparentes voisines (parois, contours). En fournissant
// nos propres matériaux avec depthWrite:false pour tout ce qui est invisible ou semi-
// transparent, on élimine ce risque à la source.
//
// Une instance de matériau DÉDIÉE par territoire (et par état : non attribué ou par
// joueur), plutôt que des instances partagées entre territoires : sur l'appareil de test,
// un territoire attribué à un joueur a fini par visuellement "contaminer" tous les autres
// territoires non attribués avec la même couleur, symptôme qui n'a pu être reproduit dans
// aucun test automatisé mais qui disparaît par construction si aucune référence de
// matériau n'est jamais partagée entre deux territoires différents.
const capMaterialsById = new Map();
const sideMaterialsById = new Map();
for (const t of TERRITOIRES) {
  capMaterialsById.set(t.id, [
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    ...PLAYERS.map((p) => new THREE.MeshBasicMaterial({ color: p.color, side: THREE.DoubleSide })),
  ]);
  sideMaterialsById.set(t.id, [
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    ...PLAYERS.map(() => new THREE.MeshBasicMaterial({ color: 0x141414, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide })),
  ]);
}

// territoireId -> index de joueur (0-3) | undefined si non attribué
const ownership = {};
let activePlayer = 0;

// Régions -> liste de territoireId (pour la détection "région intégrée")
const territoiresParRegion = {};
for (const t of TERRITOIRES) {
  (territoiresParRegion[t.region] ??= []).push(t.id);
}

function capMaterialForTerritoire(id) {
  const p = ownership[id];
  return capMaterialsById.get(id)[p === undefined ? 0 : p + 1];
}

function sideMaterialForTerritoire(id) {
  const p = ownership[id];
  return sideMaterialsById.get(id)[p === undefined ? 0 : p + 1];
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

const legend = document.createElement('div');
legend.className = 'legend';
legend.innerHTML = `
  <div><b>47 territoires</b> · 22 régions · 18 villes</div>
  <div class="row"><span class="sq" style="border-radius:50%"></span> touchez un territoire pour l'attribuer au joueur actif</div>
  <div class="row"><span class="sq"></span> ville (carré, taille = slots)</div>
  <div class="row"><span class="sq" style="transform:rotate(45deg)"></span> slot Industrie</div>
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

// ---------- Détection tapotement propre vs glissement (rotation du globe) ----------
// three-globe déclenche onPolygonClick sur l'événement 'click' du canvas ; sur iPad, un
// tapotement qui glisse légèrement pendant une rotation du globe pouvait quand même
// produire un ou plusieurs clics sur des territoires traversés au passage ("ça défile
// plusieurs territoires à la suite comme si ça cherchait"). On mesure nous-mêmes la
// distance et la durée entre l'appui et le relâchement, et on n'autorise l'attribution
// que si ça ressemble vraiment à un tapotement immobile.
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
const world = new Globe(globeEl)
  .onGlobeReady(() => { window.__globeReady = true; })
  .globeImageUrl('textures/earth-day.jpg')
  .backgroundColor('#000010')
  .showAtmosphere(true)
  .atmosphereColor('#6fb1ff')
  .polygonAltitude(0.006)
  .polygonCapMaterial((f) => capMaterialForTerritoire(f.properties.territoireId))
  .polygonSideMaterial((f) => sideMaterialForTerritoire(f.properties.territoireId))
  .polygonStrokeColor(() => 'rgba(255,255,255,0.35)')
  .onPolygonClick((f) => { if (!wasCleanTap()) return; assignTerritoire(f.properties.territoireId); })
  .htmlLat((d) => d.lat)
  .htmlLng((d) => d.lon)
  .htmlAltitude(0.012)
  .htmlElement(buildMarkerElement);

world.pointOfView({ lat: 20, lng: 10, altitude: 2.6 }, 0);
window.__world = world; // debug uniquement

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

function buildMarkerElement(d) {
  const el = document.createElement('div');
  if (d.type === 'city') {
    el.className = `city-marker slots-${Math.min(d.slots, 3)}`;
    el.style.background = markerColorForTerritoire(d.territoireId);
    el.title = `${d.nom} — ${TERRITOIRE_PAR_ID[d.territoireId].nom}`;
    el.onclick = (ev) => { ev.stopPropagation(); if (!wasCleanTap()) return; assignTerritoire(d.territoireId); };
  } else {
    el.className = 'factory-marker';
    el.style.borderColor = markerColorForTerritoire(d.territoireId);
  }
  return el;
}

// Sur écran tactile, un tapotement peut déclencher plusieurs "clics" d'affilée si le
// doigt bouge légèrement (le geste est alors aussi interprété comme une rotation du
// globe). Sans ça, un seul tapotement pouvait attribuer plusieurs territoires voisins
// à la suite. On ignore toute nouvelle attribution moins de 400 ms après la précédente.
let lastAssignAt = 0;
function assignTerritoire(id) {
  const now = Date.now();
  if (now - lastAssignAt < 400) return;
  lastAssignAt = now;

  const region = TERRITOIRE_PAR_ID[id]?.region;
  ownership[id] = activePlayer;
  renderAll();

  const ids = territoiresParRegion[region] || [];
  if (ids.length && ids.every((tid) => ownership[tid] === activePlayer)) {
    showToast(`Région intégrée : ${region} → +3 pts pour ${PLAYERS[activePlayer].name}`);
  }
}

// Un territoire une fois créé dans la scène 3D (à la première réception des données) n'est
// plus jamais recréé : seul son matériau doit changer quand il est attribué. Plutôt que de
// repasser par polygonCapMaterial/polygonSideMaterial (qui déclenchent un cycle de mise à
// jour interne à la bibliothèque, avec anti-rebond, dont le comportement exact lors
// d'appels répétés n'est pas garanti), on modifie directement les objets Three.js déjà
// présents dans la scène : moins de surprise, et un contrôle total sur ce qui change vraiment.
function applyMaterialsDirectly() {
  let updated = 0;
  world.scene().traverse((obj) => {
    if (obj.__globeObjType !== 'polygon') return;
    const conic = obj.children[0];
    if (!conic || !Array.isArray(conic.material)) return;
    const feature = obj.__data && obj.__data.data;
    const id = feature && feature.properties && feature.properties.territoireId;
    if (!id) return;
    conic.material[0] = sideMaterialForTerritoire(id);
    conic.material[1] = capMaterialForTerritoire(id);
    updated++;
  });
  return updated;
}

function renderAll() {
  const updated = applyMaterialsDirectly();
  if (updated === 0) {
    // Les objets 3D n'existent pas encore (tout premier rendu, avant que la bibliothèque
    // n'ait fini de créer les maillages) : on retombe sur les accesseurs normaux, qui
    // s'appliqueront dès que polygonsData() aura fait son travail initial.
    world.polygonCapMaterial((f) => capMaterialForTerritoire(f.properties.territoireId));
    world.polygonSideMaterial((f) => sideMaterialForTerritoire(f.properties.territoireId));
  }
  // Rafraîchit les marqueurs (nouvelle référence de tableau pour forcer le re-rendu des couleurs)
  world.htmlElementsData([...markersData]);

  chips.forEach((chip, i) => {
    chip.style.borderColor = i === activePlayer ? '#fff' : 'transparent';
    const scores = computeScores();
    chip.querySelector('.score').textContent = scores[i].total;
  });

  // Diagnostic : liste explicitement les territoires réellement marqués "attribués" dans
  // les données, pour pouvoir comparer avec ce qui s'affiche visuellement en cas de doute
  // (ex. tout le globe qui semble attribué alors que peu de territoires le sont vraiment).
  // "maj:N" indique combien d'objets 3D ont été mis à jour directement (devrait valoir 47
  // une fois les données chargées ; 0 signifierait un repli sur l'ancien mécanisme).
  if (readyStatusBase) {
    const owned = Object.keys(ownership);
    statusEl.textContent = `${readyStatusBase} · maj:${updated} · attribués(${owned.length}):${owned.join(',') || '—'}`;
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
  ]).then(([geo, centroides]) => {
    const totalPoints = geo.features.reduce((a, f) => a + countPoints(f.geometry), 0);
    statusEl.textContent = `Prêt (${geo.features.length} terr., ${totalPoints} pts géo)`;
    world.polygonsData(geo.features);

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
    renderAll();

    setTimeout(() => {
      const domMarkers = document.querySelectorAll('.city-marker, .factory-marker').length;
      let layersOk = '?';
      try {
        const topGroup = world.scene().children.find((c) => c.type === 'Group');
        layersOk = topGroup.children.filter((c) => c.children.length > 0).length;
      } catch { /* ignore */ }
      readyStatusBase = `build ${BUILD_ID} · Prêt · ${geo.features.length} terr. · ${totalPoints} pts · couches actives:${layersOk} · marqueurs:${domMarkers}`;
      renderAll();
    }, 1200);
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
