// Importa as 40 páginas do site estático atual (os dois repositórios) para src/legacy/<site>/<rota>.json:
// atributos do <html> e do <body>, conteúdo do <head> e do <body>, sem alterar nada.
// Uso: node scripts/import-legacy.mjs [pasta-br] [pasta-agency]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const BR = process.argv[2] ?? join(homedir(), 'Downloads/site-makewell-cc');
const AG = process.argv[3] ?? join(homedir(), 'Downloads/makewell-agency');
const SLUGS = ['', 'about/', 'services/', 'framework/', 'method/', 'cases/', 'cases/casa-hunter-casa-dos-raros/', 'how-we-create/', 'privacy-policy/', 'terms-of-use/'];
const BR_ROUTES = ['', 'sobre/', 'servicos/', 'framework/', 'metodo/', 'cases/', 'cases/casa-hunter-casa-dos-raros/', 'como-criamos/', 'politica-de-privacidade/', 'termos-de-uso/'];

const pages = [
  ...BR_ROUTES.map((r) => ({ site: 'br', route: r, file: join(BR, r, 'index.html') })),
  ...['en', 'es', 'pt'].flatMap((l) => SLUGS.map((s) => ({ site: 'agency', route: `${l}/${s}`, file: join(AG, l, s, 'index.html') }))),
];

const one = (re, s, what, file) => {
  const m = s.match(re);
  if (!m) throw new Error(`${file}: ${what} não encontrado`);
  return m;
};

for (const p of pages) {
  const src = readFileSync(p.file, 'utf8');
  if (!/^<!DOCTYPE html>\s*<html/i.test(src)) throw new Error(`${p.file}: não começa com <!DOCTYPE html><html`);
  const html = one(/<html([^>]*)>/i, src, '<html>', p.file);
  const head = one(/<head>([\s\S]*?)<\/head>/i, src, '<head>', p.file);
  const body = one(/<body([^>]*)>([\s\S]*)<\/body>\s*<\/html>\s*$/i, src, '<body>', p.file);
  const dir = join('src/legacy', p.site);
  mkdirSync(dir, { recursive: true });
  const key = p.route.replace(/\/$/, '').replaceAll('/', '__') || 'index';
  writeFileSync(join(dir, `${key}.json`), JSON.stringify({ route: p.route, htmlAttrs: html[1], head: head[1], bodyAttrs: body[1], body: body[2] }));
}
console.log(`${pages.length} páginas importadas`);
