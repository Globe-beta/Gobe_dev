// Maquettes 3D posées en relief sur le globe (villes, usines), construites directement en
// formes simples three.js — aucun fichier à télécharger, donc léger et instantané.
//
// Unités : celles du globe de globe.gl (rayon = 100). 1 unité ≈ 64 km au sol. Les maquettes
// font environ 2.5 unités de large : à peu près la taille à l'écran des icônes HTML qu'elles
// remplacent quand on zoome (voir MODEL_ALT_VISIBLE dans main.js).
//
// Orientation : globe.gl (objectFacesSurface) oriente l'axe +Z local de chaque objet selon la
// verticale du lieu. On construit donc chaque maquette "debout" selon +Y (plus naturel), dans
// un sous-groupe qu'on bascule de 90° pour amener +Y sur +Z.

import * as THREE from 'three';

// Petit générateur pseudo-aléatoire déterministe (mulberry32) : chaque ville garde toujours la
// même silhouette, calculée à partir de son nom.
function aleatoireDepuis(texte) {
  let a = 0;
  for (const c of texte) a = (Math.imul(a ^ c.charCodeAt(0), 2654435761) >>> 0);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function debout(contenu) {
  const racine = new THREE.Group();
  contenu.rotation.x = Math.PI / 2; // +Y (debout) → +Z (verticale du lieu, voir en-tête)
  racine.add(contenu);
  return racine;
}

const materiauxCache = new Map();
function materiau(couleur, options = {}) {
  const cle = `${couleur}|${JSON.stringify(options)}`;
  if (!materiauxCache.has(cle)) {
    materiauxCache.set(cle, new THREE.MeshLambertMaterial({ color: couleur, ...options }));
  }
  return materiauxCache.get(cle);
}

function boite(l, h, p, couleur, x = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(l, h, p), materiau(couleur));
  mesh.position.set(x, h / 2, z);
  return mesh;
}

// Ville : un socle à la couleur du joueur, une grappe d'immeubles de hauteurs variées autour
// d'une tour centrale plus haute coiffée de la couleur du joueur, et une ceinture d'immeubles
// bas. Silhouette propre à chaque ville (tirée de son nom).
export function construireVille(nom, couleurJoueur) {
  const alea = aleatoireDepuis(nom);
  const g = new THREE.Group();

  const socle = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.45, 0.12, 24), materiau(couleurJoueur));
  socle.position.y = 0.06;
  g.add(socle);

  const teintes = ['#e8ecf2', '#cfd8e3', '#b8c4d4', '#dfe6ee', '#aebccd'];
  // Tour centrale.
  const tourH = 3.2 + alea() * 0.9;
  const tour = boite(0.38, tourH, 0.38, '#f4f7fb', 0, 0);
  tour.position.y += 0.12;
  g.add(tour);
  const coiffe = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.6, 4), materiau(couleurJoueur));
  coiffe.position.y = 0.12 + tourH + 0.3;
  coiffe.rotation.y = Math.PI / 4;
  g.add(coiffe);

  // Anneau intérieur d'immeubles moyens, puis anneau extérieur d'immeubles bas.
  const anneaux = [{ n: 6, r: 0.62, hMin: 1.2, hMax: 2.4 }, { n: 9, r: 1.05, hMin: 0.4, hMax: 1.1 }];
  for (const { n, r, hMin, hMax } of anneaux) {
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2 + alea() * 0.4;
      const h = hMin + alea() * (hMax - hMin);
      const l = 0.22 + alea() * 0.16;
      const b = boite(l, h, l, teintes[Math.floor(alea() * teintes.length)], Math.cos(angle) * r, Math.sin(angle) * r);
      b.position.y += 0.12;
      b.rotation.y = alea() * Math.PI;
      g.add(b);
    }
  }
  return debout(g);
}

// Usine : un socle à la couleur du joueur, un grand hall à toit en dents de scie (sheds), un
// bâtiment annexe et une haute cheminée cerclée de la couleur du joueur.
export function construireUsine(couleurJoueur) {
  const g = new THREE.Group();

  const socle = boite(2.4, 0.1, 1.7, couleurJoueur);
  g.add(socle);

  const hall = boite(1.5, 0.8, 1.0, '#c9ced6', -0.25, 0.1);
  hall.position.y += 0.1;
  g.add(hall);

  // Toit en dents de scie : 4 prismes triangulaires posés sur le hall.
  const forme = new THREE.Shape();
  forme.moveTo(0, 0);
  forme.lineTo(0.375, 0);
  forme.lineTo(0, 0.3);
  forme.lineTo(0, 0);
  const prisme = new THREE.ExtrudeGeometry(forme, { depth: 1.0, bevelEnabled: false });
  for (let i = 0; i < 4; i++) {
    const dent = new THREE.Mesh(prisme, materiau('#8f9aa8'));
    dent.position.set(-1.0 + i * 0.375, 1.0, -0.4);
    g.add(dent);
  }

  const annexe = boite(0.6, 0.6, 0.55, '#dde2e8', 0.8, -0.35);
  annexe.position.y += 0.1;
  g.add(annexe);

  const cheminee = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 2.6, 12), materiau('#9aa3ad'));
  cheminee.position.set(0.75, 1.4, 0.4);
  g.add(cheminee);
  for (const y of [2.2, 2.5]) {
    const bague = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.135, 0.14, 12), materiau(couleurJoueur));
    bague.position.set(0.75, y, 0.4);
    g.add(bague);
  }
  return debout(g);
}
