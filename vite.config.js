import { defineConfig } from 'vite';

// Chemins relatifs : le build doit fonctionner aussi bien à la racine (dev)
// que dans un sous-dossier (GitHub Pages sert le repo sous /Gobe_dev/).
export default defineConfig({
  base: './',
  // Sert à vérifier côté écran qu'on regarde bien la dernière version déployée
  // (et pas une copie mise en cache par le navigateur/CDN).
  define: {
    __BUILD_ID__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')),
  },
});
