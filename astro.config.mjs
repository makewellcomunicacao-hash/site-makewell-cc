// Um só código, dois sites: SITE=br → makewell.com.br (PT-BR); SITE=agency → makewell.agency (EN/ES/PT-PT).
// URLs com barra final e pasta/index.html, como no site estático original; nada de compressão que mude o HTML.
import { defineConfig } from 'astro/config';

const SITE = process.env.SITE === 'agency' ? 'agency' : 'br';

export default defineConfig({
  site: SITE === 'br' ? 'https://makewell.com.br' : 'https://makewell.agency',
  publicDir: `./public-${SITE}`,
  // DIST/CACHE permitem builds em paralelo sem um sobrescrever o outro (ex.: DIST=tmp/agente1)
  outDir: `./${process.env.DIST ?? 'dist'}/${SITE}`,
  cacheDir: process.env.CACHE ?? './node_modules/.astro',
  trailingSlash: 'always',
  compressHTML: false,
  build: { format: 'directory', assets: 'assets', inlineStylesheets: 'always' },
  devToolbar: { enabled: false },
});
