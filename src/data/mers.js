// Communications entre cases mer (déplacement des bateaux). Par défaut, deux cases mer qui se
// touchent communiquent. Deux exceptions, pour donner du relief stratégique à la carte :
//
// - BARRIERES_MER : cases qui se touchent mais NE communiquent PAS (banquise, archipel
//   infranchissable). Tracées sur le globe en pointillé blanc le long de leur frontière.
// - PASSAGES_MER : cases qui ne se touchent pas (ou à peine) mais communiquent quand même
//   (canaux, détroits très étroits). Tracés sur le globe par un trait doré (`trace` : lon/lat).

export const BARRIERES_MER = [
  // Banquise : la Route maritime du Nord et le passage du Nord-Ouest sont fermés, et l'Océan
  // Arctique central ne s'atteint que par la mer de Norvège (détroit de Fram).
  { a: 'mer-arctique-est', b: 'mer-arctique-siberie', raison: 'Banquise (route maritime du Nord)' },
  { a: 'mer-arctique-ouest', b: 'mer-baffin', raison: 'Banquise (passage du Nord-Ouest)' },
  { a: 'mer-arctique-centre', b: 'mer-arctique-est', raison: 'Banquise' },
  { a: 'mer-arctique-centre', b: 'mer-arctique-siberie', raison: 'Banquise' },
  { a: 'mer-arctique-centre', b: 'mer-arctique-ouest', raison: 'Banquise' },
  { a: 'mer-arctique-centre', b: 'mer-baffin', raison: 'Banquise' },
  // Archipel indonésien : la mer de Chine méridionale ne rejoint les mers d'Australie qu'en
  // passant par le détroit de Malacca (golfe du Bengale) ou par le Pacifique.
  { a: 'mer-chine-sud', b: 'mer-australie', raison: 'Archipel indonésien' },
];

export const PASSAGES_MER = [
  // Détroit trop étroit (14 km) pour que les deux cases se touchent sur la carte : déclaré ici.
  { a: 'mer-atlantiquenord-est', b: 'mer-mediterranee-ouest', nom: 'Détroit de Gibraltar', trace: [[-6.6, 35.95], [-5.6, 35.95], [-4.6, 36.1]] },
  { a: 'mer-mediterranee-est', b: 'mer-arabie', nom: 'Canal de Suez', trace: [[32.3, 31.4], [32.4, 30.6], [32.6, 29.9], [33.2, 28.9], [33.9, 27.6]] },
  { a: 'mer-caraibes-ouest', b: 'mer-pacifique-centramerique', nom: 'Canal de Panama', trace: [[-79.9, 9.5], [-79.8, 9.2], [-79.6, 8.9], [-79.4, 8.4], [-79.3, 7.8]] },
];
