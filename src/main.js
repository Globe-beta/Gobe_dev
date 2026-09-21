import Globe from 'globe.gl';
import './style.css';
import { TERRITOIRES, TERRITOIRE_PAR_ID } from './data/territoires.js';

const PLAYERS = [
  { name: 'Joueur 1', color: '#e63946' },
  { name: 'Joueur 2', color: '#457b9d' },
  { name: 'Joueur 3', color: '#2a9d8f' },
  { name: 'Joueur 4', color: '#f4a261' },
];
const NEUTRAL = '#3a3f4d';

// territoireId -> index de joueur (0-3) | undefined si non attribué
const ownership = {};
let activePlayer = 0;

// Régions -> liste de territoireId (pour la détection "région intégrée")
const territoiresParRegion = {};
for (const t of TERRITOIRES) {
  (territoiresParRegion[t.region] ??= []).push(t.id);
}

function colorForTerritoire(id) {
  const p = ownership[id];
  return p === undefined ? NEUTRAL : PLAYERS[p].color;
}

function resourceLabel(r) {
  if (typeof r === 'string') return r;
  return `${r.type} niv.${r.niveau}`;
}

function tooltipHtml(territoireId) {
  const t = TERRITOIRE_PAR_ID[territoireId];
  if (!t) return '';
  const owner = ownership[territoireId];
  const ressources = t.ressources.length ? t.ressources.map(resourceLabel).join(', ') : '—';
  return `
    <div class="tooltip">
      <b>${t.nom}</b>
      <span class="dim">${t.region} · ${t.bloc}</span><br/>
      Ressources : ${ressources}<br/>
      Enclavement : ${t.enclavement}${t.slotIndustrie ? ' · Slot Industrie' : ''}${t.ville ? ` · Ville : ${t.ville.nom} (${t.ville.slots} slot${t.ville.slots > 1 ? 's' : ''})` : ''}<br/>
      <span class="dim">${owner === undefined ? 'Non attribué' : PLAYERS[owner].name}</span>
    </div>`;
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

// ---------- Globe ----------
const world = new Globe(globeEl)
  .globeImageUrl('/textures/earth-dark.jpg')
  .backgroundImageUrl('/textures/night-sky.png')
  .backgroundColor('#05070d')
  .showAtmosphere(true)
  .atmosphereColor('#4a6fa5')
  .polygonAltitude(0.006)
  .polygonsTransitionDuration(0)
  .polygonCapColor((f) => colorForTerritoire(f.properties.territoireId))
  .polygonSideColor(() => 'rgba(0,0,0,0.3)')
  .polygonStrokeColor(() => 'rgba(255,255,255,0.35)')
  .polygonLabel((f) => tooltipHtml(f.properties.territoireId))
  .onPolygonClick((f) => assignTerritoire(f.properties.territoireId))
  .htmlLat((d) => d.lat)
  .htmlLng((d) => d.lon)
  .htmlAltitude(0.012)
  .htmlElement(buildMarkerElement);

world.pointOfView({ lat: 20, lng: 10, altitude: 2.6 }, 0);

let markersData = [];

function buildMarkerElement(d) {
  const el = document.createElement('div');
  if (d.type === 'city') {
    el.className = `city-marker slots-${Math.min(d.slots, 3)}`;
    el.style.background = colorForTerritoire(d.territoireId);
    el.title = `${d.nom} — ${TERRITOIRE_PAR_ID[d.territoireId].nom}`;
    el.onclick = (ev) => { ev.stopPropagation(); assignTerritoire(d.territoireId); };
  } else {
    el.className = 'factory-marker';
    el.style.borderColor = colorForTerritoire(d.territoireId) === NEUTRAL ? 'rgba(255,255,255,0.85)' : colorForTerritoire(d.territoireId);
  }
  return el;
}

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
  // Ré-invoque l'accesseur de couleur (sans re-fournir les données géographiques :
  // seul le matériau des territoires déjà tracés est mis à jour, pas leur géométrie).
  world.polygonCapColor(world.polygonCapColor());
  // Rafraîchit les marqueurs (nouvelle référence de tableau pour forcer le re-rendu des couleurs)
  world.htmlElementsData([...markersData]);

  chips.forEach((chip, i) => {
    chip.style.borderColor = i === activePlayer ? '#fff' : 'transparent';
    const scores = computeScores();
    chip.querySelector('.score').textContent = scores[i].total;
  });
}

// ---------- Chargement des données géographiques ----------
Promise.all([
  fetch('/geo/territoires.geo.json').then((r) => r.json()),
  fetch('/geo/centroides.json').then((r) => r.json()),
]).then(([geo, centroides]) => {
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
});

window.addEventListener('resize', () => {
  world.width(window.innerWidth).height(window.innerHeight);
});
