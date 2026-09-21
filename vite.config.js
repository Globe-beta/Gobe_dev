import { defineConfig } from 'vite';

// Chemins relatifs : le build doit fonctionner aussi bien à la racine (dev)
// que dans un sous-dossier (GitHub Pages sert le repo sous /Gobe_dev/).
export default defineConfig({
  base: './',
});
