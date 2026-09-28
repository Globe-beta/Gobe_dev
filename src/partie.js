// État de la partie et règles de la phase de mise en place — sans rien d'affichage (voir
// main.js pour l'interface), pour pouvoir les lire, les tester et les faire évoluer à part.
//
// Déroulé : 'ordre' (tirage de l'ordre de jeu) → 'puissances' (chaque joueur choisit une
// puissance, dans l'ordre tiré) → 'atelier' (chaque joueur pose son usine de départ, dans le
// même ordre) → 'jeu'.

import { CONFIG, PUISSANCES } from './config.js';
import { TERRITOIRES, TERRITOIRE_PAR_ID } from './data/territoires.js';

export const RESSOURCES_PRODUCTIBLES = ['Énergie', 'Minerais', 'Denrées', 'Terres rares'];

// Une ressource d'un territoire est soit une chaîne ('Denrées'), soit { type, niveau }.
const typeDeRessource = (r) => (typeof r === 'string' ? r : r.type);

export function nouvellePartie(reserveInitiale = {}) {
  return {
    phase: 'ordre',
    // ordre[k] = index du joueur qui joue en k-ième position (fixe pour toute la partie).
    ordre: null,
    // Position courante dans `ordre` pendant une étape de mise en place.
    tour: 0,
    age: CONFIG.ageDepart,
    round: CONFIG.roundDepart,
    marche: { ...CONFIG.marcheDepart },
    joueurs: Array.from({ length: CONFIG.nbJoueurs }, () => ({
      richesse: CONFIG.richesseDepart,
      ressources: { ...CONFIG.ressourcesEnMainDepart },
      puissance: null,
      reserve: { ...reserveInitiale },
    })),
    // territoireId -> index du joueur propriétaire (absent = neutre).
    proprietaire: {},
    // région -> { joueur, bonus } pour chaque région intégrée (tous ses territoires au même joueur).
    regionsIntegrees: {},
    // territoireId -> index du joueur, pour chaque ville (centre urbain) possédée.
    villes: {},
    // territoireId -> { joueur, jetons: [ressource, ...] } pour chaque usine posée.
    usines: {},
  };
}

export function joueurCourant(partie) {
  return partie.ordre ? partie.ordre[partie.tour] : null;
}

// Étape 1 : tirage au sort de l'ordre de jeu (mélange de Fisher-Yates).
export function tirerOrdre(partie, aleatoire = Math.random) {
  if (partie.phase !== 'ordre') throw new Error("L'ordre de jeu est déjà tiré.");
  const ordre = partie.joueurs.map((_, i) => i);
  for (let i = ordre.length - 1; i > 0; i--) {
    const j = Math.floor(aleatoire() * (i + 1));
    [ordre[i], ordre[j]] = [ordre[j], ordre[i]];
  }
  partie.ordre = ordre;
  partie.phase = 'puissances';
  partie.tour = 0;
}

export function puissancePrisePar(partie, puissanceId) {
  const i = partie.joueurs.findIndex((j) => j.puissance === puissanceId);
  return i >= 0 ? i : null;
}

// Étape 2 : le joueur courant prend une puissance libre — tous les territoires de sa région,
// la région intégrée (bonus activés) et ses villes de départ.
export function choisirPuissance(partie, puissanceId) {
  if (partie.phase !== 'puissances') throw new Error("Ce n'est pas le moment de choisir une puissance.");
  const puissance = PUISSANCES.find((p) => p.id === puissanceId);
  if (!puissance) throw new Error(`Puissance inconnue : ${puissanceId}`);
  if (puissancePrisePar(partie, puissanceId) !== null) throw new Error(`${puissance.nom} est déjà prise.`);
  const joueur = joueurCourant(partie);

  partie.joueurs[joueur].puissance = puissanceId;
  for (const t of TERRITOIRES) {
    if (t.region === puissance.region) partie.proprietaire[t.id] = joueur;
  }
  partie.regionsIntegrees[puissance.region] = { joueur, bonus: { ...CONFIG.bonusRegionIntegree } };
  for (const territoireId of puissance.villesDepart) {
    partie.villes[territoireId] = joueur;
    if (partie.joueurs[joueur].reserve.villes > 0) partie.joueurs[joueur].reserve.villes -= 1;
  }

  partie.tour += 1;
  // Tous les joueurs ont une puissance (ou il n'y en a plus à prendre) : étape suivante.
  if (partie.tour >= partie.ordre.length || PUISSANCES.every((p) => puissancePrisePar(partie, p.id) !== null)) {
    partie.phase = 'atelier';
    partie.tour = 0;
  }
}

// Étape 3 : territoires où le joueur peut poser son usine de départ — les siens, avec un slot
// Industrie encore libre.
export function territoiresPourAtelier(partie, joueur) {
  return TERRITOIRES
    .filter((t) => partie.proprietaire[t.id] === joueur && t.slotIndustrie > 0 && !partie.usines[t.id])
    .map((t) => t.id);
}

// Ressources exploitables par une usine sur ce territoire : [{ type, verrouillee }]. Les
// Terres rares apparaissent mais restent verrouillées avant leur Âge de déblocage.
export function ressourcesPourAtelier(partie, territoireId) {
  const t = TERRITOIRE_PAR_ID[territoireId];
  const types = [...new Set((t?.ressources || []).map(typeDeRessource))]
    .filter((type) => RESSOURCES_PRODUCTIBLES.includes(type));
  return types.map((type) => ({
    type,
    verrouillee: type === 'Terres rares' && partie.age < CONFIG.ageDeblocageTerresRares,
  }));
}

// Règle de validation : un territoire ET une ressource choisis, tous deux autorisés.
export function peutConfirmerAtelier(partie, territoireId, ressource) {
  if (partie.phase !== 'atelier' || !territoireId || !ressource) return false;
  if (!territoiresPourAtelier(partie, joueurCourant(partie)).includes(territoireId)) return false;
  return ressourcesPourAtelier(partie, territoireId).some((r) => r.type === ressource && !r.verrouillee);
}

export function placerAtelier(partie, territoireId, ressource) {
  if (!peutConfirmerAtelier(partie, territoireId, ressource)) throw new Error('Choix de territoire ou de ressource invalide.');
  const joueur = joueurCourant(partie);
  partie.usines[territoireId] = { joueur, jetons: [ressource].slice(0, CONFIG.capaciteAtelier) };
  if (partie.joueurs[joueur].reserve.usines > 0) partie.joueurs[joueur].reserve.usines -= 1;

  partie.tour += 1;
  if (partie.tour >= partie.ordre.length) {
    partie.phase = 'jeu';
    partie.tour = 0;
  }
}
