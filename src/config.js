// Constantes de départ de la partie — à modifier librement ici (rien d'autre à toucher).
// Voir src/partie.js pour la façon dont elles sont utilisées.

export const CONFIG = {
  nbJoueurs: 3,
  richesseDepart: 10,
  // Ressources en main de chaque joueur au départ.
  ressourcesEnMainDepart: { 'Énergie': 0, 'Minerais': 0, 'Denrées': 0, 'Terres rares': 0 },
  // Réserve du marché au départ.
  marcheDepart: { 'Énergie': 60, 'Minerais': 60, 'Denrées': 60, 'Terres rares': 0 },
  // Les Terres rares restent verrouillées (marché, production) jusqu'à cet Âge.
  ageDeblocageTerresRares: 5,
  ageDepart: 1,
  roundDepart: 1,
  // Nombre de territoires que chaque joueur prend dans la région de sa puissance au départ.
  territoiresDepart: 2,
  // Capacité (en jetons de production) de l'usine de départ, dite "Atelier".
  capaciteAtelier: 1,
  // Bonus d'une région intégrée (le joueur contrôle tous ses territoires) — valeurs encore à
  // chiffrer : null = pas encore défini, aucun effet appliqué.
  bonusRegionIntegree: { production: null, deplacement: null },
};

// Couleurs des joueurs, dans l'ordre (seules les CONFIG.nbJoueurs premières sont utilisées).
// Teintes vives, choisies pour trancher sur l'image satellite : pas de vert ni de bleu-vert,
// qui se confondaient avec la végétation une fois posés en transparence sur les territoires.
export const COULEURS_JOUEURS = ['#e63946', '#2f6fe0', '#9b4dff', '#f4a261', '#f15bb5', '#00b8d9'];

// Puissances à choisir en début de partie. `region` = nom de région de data/territoires.js
// (le joueur y choisit ensuite CONFIG.territoiresDepart territoires) ; `villesDepart` = villes
// de la région, affichées sur la carte de la puissance — le joueur en prend une à l'étape
// "ville de départ" s'il possède son territoire (voir choisirVille dans src/partie.js).
export const PUISSANCES = [
  { id: 'usa', nom: 'États-Unis', region: 'États-Unis', villesDepart: ['us-nordest', 'us-ouest'] },
  { id: 'chine', nom: 'Chine', region: 'Chine', villesDepart: ['cn-nord', 'cn-cotiere'] },
  { id: 'russie', nom: 'Russie & Eurasie', region: 'Russie & Eurasie', villesDepart: ['ru-occidentale', 'ru-siboccidentale'] },
];

// Chiffres romains pour l'affichage des Âges.
export function ageEnChiffresRomains(age) {
  return ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][age] || String(age);
}
