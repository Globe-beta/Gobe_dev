// État de la partie et règles de la phase de mise en place — sans rien d'affichage (voir
// main.js pour l'interface), pour pouvoir les lire, les tester et les faire évoluer à part.
//
// Déroulé : 'ordre' (tirage de l'ordre de jeu) → 'puissances' (chaque joueur choisit une
// puissance, dans l'ordre tiré) → 'atelier' (chaque joueur pose son usine de départ) → 'ville'
// (chaque joueur choisit sa ville de départ parmi celles de sa région) → 'rail' (chaque joueur
// pose un rail entre deux de ses territoires voisins) → 'jeu'. Chaque étape se joue dans l'ordre
// tiré ; un joueur qui n'a aucun choix possible à une étape est passé.

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
    // Rails posés : { joueur, a, b } relie les territoires a et b.
    rails: [],
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
  // Les villes de la région ne sont pas attribuées ici : le joueur en choisit une à l'étape
  // 'ville' (voir choisirVille).

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

  passerAuJoueurSuivant(partie);
}

// Enchaînement des étapes posées une fois par joueur (atelier, ville, rail) : joueur suivant
// dans l'ordre tiré ; à la fin du tour de table, étape suivante. Un joueur sans aucun choix
// possible à une étape est passé automatiquement.
const ETAPES_PAR_JOUEUR = ['atelier', 'ville', 'rail'];
function aUnChoix(partie, joueur) {
  if (partie.phase === 'atelier') return territoiresPourAtelier(partie, joueur).length > 0;
  if (partie.phase === 'ville') return villesPossibles(partie, joueur).length > 0;
  if (partie.phase === 'rail') return territoiresPourRail(partie, joueur).length > 0;
  return true;
}
function passerAuJoueurSuivant(partie) {
  partie.tour += 1;
  for (;;) {
    if (partie.tour >= partie.ordre.length) {
      const i = ETAPES_PAR_JOUEUR.indexOf(partie.phase);
      partie.phase = i >= 0 && i < ETAPES_PAR_JOUEUR.length - 1 ? ETAPES_PAR_JOUEUR[i + 1] : 'jeu';
      partie.tour = 0;
      if (partie.phase === 'jeu') return;
    }
    if (aUnChoix(partie, joueurCourant(partie))) return;
    partie.tour += 1;
  }
}

// Étape 4 : villes que le joueur peut choisir — celles de ses territoires qui n'appartiennent
// encore à personne.
export function villesPossibles(partie, joueur) {
  return TERRITOIRES
    .filter((t) => t.ville && partie.proprietaire[t.id] === joueur && partie.villes[t.id] === undefined)
    .map((t) => t.id);
}

export function choisirVille(partie, territoireId) {
  if (partie.phase !== 'ville') throw new Error("Ce n'est pas le moment de choisir une ville.");
  const joueur = joueurCourant(partie);
  if (!villesPossibles(partie, joueur).includes(territoireId)) throw new Error('Ville non disponible.');
  partie.villes[territoireId] = joueur;
  if (partie.joueurs[joueur].reserve.villes > 0) partie.joueurs[joueur].reserve.villes -= 1;
  passerAuJoueurSuivant(partie);
}

// Étape 5 : un rail relie deux territoires VOISINS du joueur. La géométrie (qui touche qui)
// n'est pas connue ici : main.js la fournit une fois pour toutes via definirVoisinage.
let sontVoisins = () => false;
export function definirVoisinage(fonction) {
  sontVoisins = fonction;
}

const railExiste = (partie, a, b) => partie.rails.some((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a));

// Territoires du joueur qu'un rail peut relier à `depuis` (ou, sans `depuis`, ceux qui ont au
// moins un tel voisin : premier territoire touché).
export function territoiresPourRail(partie, joueur, depuis = null) {
  const siens = TERRITOIRES.filter((t) => t.type !== 'maritime' && partie.proprietaire[t.id] === joueur).map((t) => t.id);
  const relie = (a, b) => a !== b && sontVoisins(a, b) && !railExiste(partie, a, b);
  if (depuis) return siens.filter((id) => relie(depuis, id));
  return siens.filter((a) => siens.some((b) => relie(a, b)));
}

export function peutPoserRail(partie, a, b) {
  if (partie.phase !== 'rail' || !a || !b) return false;
  return territoiresPourRail(partie, joueurCourant(partie), a).includes(b);
}

export function placerRail(partie, a, b) {
  if (!peutPoserRail(partie, a, b)) throw new Error('Rail impossible entre ces deux territoires.');
  partie.rails.push({ joueur: joueurCourant(partie), a, b });
  passerAuJoueurSuivant(partie);
}
