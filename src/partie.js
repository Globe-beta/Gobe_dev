// État de la partie et règles de la phase de mise en place — sans rien d'affichage (voir
// main.js pour l'interface), pour pouvoir les lire, les tester et les faire évoluer à part.
//
// Déroulé : 'ordre' (tirage de l'ordre de jeu) → 'puissances' (chaque joueur choisit une
// puissance) → 'territoires' (chaque joueur prend CONFIG.territoiresDepart territoires de la
// région de sa puissance — pas la région entière : pas de région intégrée, donc pas de bonus, au
// départ) → 'atelier' (usine de départ) → 'ville' (ville de départ) → 'rail' (un rail) → 'port'
// (un port et un premier bateau sur une case mer voisine) → 'jeu'. Chaque étape se joue dans
// l'ordre tiré ; un joueur qui n'a aucun choix possible à une étape est passé.
//
// Par la suite, un territoire neutre ne se colonise qu'en y construisant un bâtiment (règle à
// venir) : rien ici ne donne un territoire en dehors du choix de départ.

import { CONFIG, PUISSANCES } from './config.js';
import { TERRITOIRES, TERRITOIRE_PAR_ID } from './data/territoires.js';
import { BARRIERES_MER, PASSAGES_MER } from './data/mers.js';

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
    // territoireId -> { joueur, mer } pour chaque port (mer = case mer qu'il dessert).
    ports: {},
    // Bateaux : { joueur, type: 'navires' | 'transports', mer }.
    bateaux: [],
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

// Étape 2 : le joueur courant prend une puissance libre. Il n'en reçoit pas encore de
// territoires : il en choisira CONFIG.territoiresDepart dans sa région à l'étape suivante.
export function choisirPuissance(partie, puissanceId) {
  if (partie.phase !== 'puissances') throw new Error("Ce n'est pas le moment de choisir une puissance.");
  const puissance = PUISSANCES.find((p) => p.id === puissanceId);
  if (!puissance) throw new Error(`Puissance inconnue : ${puissanceId}`);
  if (puissancePrisePar(partie, puissanceId) !== null) throw new Error(`${puissance.nom} est déjà prise.`);
  const joueur = joueurCourant(partie);

  partie.joueurs[joueur].puissance = puissanceId;

  partie.tour += 1;
  // Tous les joueurs ont une puissance (ou il n'y en a plus à prendre) : étape suivante.
  if (partie.tour >= partie.ordre.length || PUISSANCES.every((p) => puissancePrisePar(partie, p.id) !== null)) {
    partie.phase = 'territoires';
    partie.tour = 0;
  }
}

// Une région est intégrée quand un même joueur possède tous ses territoires (bonus de région).
// Recalculé après chaque changement de propriétaire.
export function majRegionsIntegrees(partie) {
  const parRegion = {};
  for (const t of TERRITOIRES) (parRegion[t.region] ??= []).push(t.id);
  for (const [region, ids] of Object.entries(parRegion)) {
    const j = partie.proprietaire[ids[0]];
    const integree = j !== undefined && ids.every((id) => partie.proprietaire[id] === j);
    if (integree && partie.regionsIntegrees[region]?.joueur !== j) {
      partie.regionsIntegrees[region] = { joueur: j, bonus: { ...CONFIG.bonusRegionIntegree } };
    } else if (!integree) {
      delete partie.regionsIntegrees[region];
    }
  }
}

// Étape 2 bis : territoires de départ — ceux de la région de sa puissance, encore libres.
export function territoiresDepartPossibles(partie, joueur) {
  const puissance = PUISSANCES.find((p) => p.id === partie.joueurs[joueur]?.puissance);
  if (!puissance) return [];
  return TERRITOIRES
    .filter((t) => t.region === puissance.region && t.type !== 'maritime' && partie.proprietaire[t.id] === undefined)
    .map((t) => t.id);
}

export function peutChoisirTerritoiresDepart(partie, ids) {
  if (partie.phase !== 'territoires' || !Array.isArray(ids)) return false;
  const possibles = territoiresDepartPossibles(partie, joueurCourant(partie));
  const nb = Math.min(CONFIG.territoiresDepart, possibles.length);
  return new Set(ids).size === nb && ids.length === nb && ids.every((id) => possibles.includes(id));
}

export function choisirTerritoiresDepart(partie, ids) {
  if (!peutChoisirTerritoiresDepart(partie, ids)) throw new Error(`Choisissez ${CONFIG.territoiresDepart} territoires de votre région.`);
  const joueur = joueurCourant(partie);
  for (const id of ids) partie.proprietaire[id] = joueur;
  majRegionsIntegrees(partie);
  passerAuJoueurSuivant(partie);
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

// Enchaînement des étapes jouées une fois par joueur : joueur suivant dans l'ordre tiré ; à la
// fin du tour de table, étape suivante. Un joueur sans aucun choix possible à une étape (ex. pas
// de territoire avec slot Industrie, pas de côte) est passé automatiquement.
const ETAPES_PAR_JOUEUR = ['territoires', 'atelier', 'ville', 'rail', 'port'];
function aUnChoix(partie, joueur) {
  if (partie.phase === 'territoires') return territoiresDepartPossibles(partie, joueur).length > 0;
  if (partie.phase === 'port') return territoiresPourPort(partie, joueur).length > 0;
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

// Étape 5 : un rail relie deux territoires voisins PAR LA TERRE (frontière terrestre commune),
// dont au moins un appartient au joueur, l'autre étant à lui aussi ou neutre — jamais un
// territoire d'un autre joueur. La géométrie (qui touche qui) n'est pas connue ici : main.js la
// fournit une fois pour toutes via definirVoisinage.
let sontVoisins = () => false;
export function definirVoisinage(fonction) {
  sontVoisins = fonction;
}

const railExiste = (partie, a, b) => partie.rails.some((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a));
const territoiresTerrestres = TERRITOIRES.filter((t) => t.type !== 'maritime').map((t) => t.id);

function railAutorise(partie, joueur, a, b) {
  if (a === b || railExiste(partie, a, b)) return false;
  const pa = partie.proprietaire[a];
  const pb = partie.proprietaire[b];
  const accessible = (p) => p === undefined || p === joueur; // à lui, ou neutre
  if (!accessible(pa) || !accessible(pb)) return false;
  if (pa !== joueur && pb !== joueur) return false; // au moins un des deux à lui
  return sontVoisins(a, b);
}

// Territoires qu'un rail peut relier à `depuis` ; sans `depuis`, ceux qui peuvent servir de
// premier territoire touché (au moins un partenaire possible).
export function territoiresPourRail(partie, joueur, depuis = null) {
  if (depuis) return territoiresTerrestres.filter((id) => railAutorise(partie, joueur, depuis, id));
  const siens = territoiresTerrestres.filter((id) => partie.proprietaire[id] === joueur);
  const premiers = new Set();
  for (const a of siens) {
    for (const b of territoiresTerrestres) {
      if (railAutorise(partie, joueur, a, b)) { premiers.add(a); premiers.add(b); }
    }
  }
  return territoiresTerrestres.filter((id) => premiers.has(id));
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

// Étape 6 : port et premier bateau. Le port se pose sur un territoire du joueur voisin d'au
// moins une case mer ; le bateau (de guerre ou de transport, pris dans sa réserve) se place sur
// une de ces cases mer voisines.
export const TYPES_BATEAU = ['navires', 'transports'];
const casesMer = TERRITOIRES.filter((t) => t.type === 'maritime').map((t) => t.id);

export function mersVoisines(territoireId) {
  return casesMer.filter((mer) => sontVoisins(territoireId, mer));
}

export function territoiresPourPort(partie, joueur) {
  return territoiresTerrestres.filter((id) => partie.proprietaire[id] === joueur && !partie.ports[id] && mersVoisines(id).length > 0);
}

export function peutPlacerPort(partie, territoireId, mer, typeBateau) {
  if (partie.phase !== 'port' || !territoireId || !mer || !TYPES_BATEAU.includes(typeBateau)) return false;
  const joueur = joueurCourant(partie);
  if (!territoiresPourPort(partie, joueur).includes(territoireId)) return false;
  if (!mersVoisines(territoireId).includes(mer)) return false;
  const reserve = partie.joueurs[joueur].reserve;
  return !(typeBateau in reserve) || reserve[typeBateau] > 0;
}

export function placerPort(partie, territoireId, mer, typeBateau) {
  if (!peutPlacerPort(partie, territoireId, mer, typeBateau)) throw new Error('Port ou case mer invalide.');
  const joueur = joueurCourant(partie);
  const reserve = partie.joueurs[joueur].reserve;
  partie.ports[territoireId] = { joueur, mer };
  partie.bateaux.push({ joueur, type: typeBateau, mer });
  if (reserve.ports > 0) reserve.ports -= 1;
  if (reserve[typeBateau] > 0) reserve[typeBateau] -= 1;
  passerAuJoueurSuivant(partie);
}

// Communications entre cases mer (déplacement des bateaux, voir data/mers.js) : les cases mer
// qui se touchent, sauf celles séparées par une barrière, plus celles reliées par un canal.
const paire = (x, a, b) => (x.a === a && x.b === b) || (x.a === b && x.b === a);
export function barriereEntre(a, b) {
  return BARRIERES_MER.find((x) => paire(x, a, b)) || null;
}
export function passageEntre(a, b) {
  return PASSAGES_MER.find((x) => paire(x, a, b)) || null;
}
// [{ mer, passage }] : passage = nom du canal, ou null pour une simple frontière commune.
export function mersConnectees(mer) {
  const out = [];
  for (const autre of casesMer) {
    if (autre === mer) continue;
    const canal = passageEntre(mer, autre);
    if (canal) out.push({ mer: autre, passage: canal.nom });
    else if (sontVoisins(mer, autre) && !barriereEntre(mer, autre)) out.push({ mer: autre, passage: null });
  }
  return out;
}
// Cases mer voisines mais fermées : [{ mer, raison }].
export function mersFermees(mer) {
  return casesMer
    .filter((autre) => autre !== mer && barriereEntre(mer, autre) && sontVoisins(mer, autre))
    .map((autre) => ({ mer: autre, raison: barriereEntre(mer, autre).raison }));
}
