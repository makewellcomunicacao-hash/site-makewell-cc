// Prova de não-regressão da migração: compara o build (dist/<site>) com o site estático atual.
// 1) inventário: todo arquivo publicado hoje existe no build; 2) HTML idêntico (ou só espaços diferentes);
// 3) SEO: title, metas, canonical, hreflang, og/twitter e JSON-LD iguais, página a página.
// Uso: node scripts/verify.mjs [--seo-only]   (sai com código 1 se algo falhar)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const SOURCES = { br: join(homedir(), 'Downloads/site-makewell-cc'), agency: join(homedir(), 'Downloads/makewell-agency') };
// arquivos do repositório que não são site (deixam de ser publicados de propósito)
const NOT_SITE = /^(AGENTS\.md|CLAUDE\.md|generate_og\.py|\.gitignore|\.claude\/.*)$/;
const SEO_ONLY = process.argv.includes('--seo-only');
// mudanças de SEO intencionais e aprovadas no plano (não contam como falha)
const INTENTIONAL = {
  'agency/index.html': 'raiz do .agency vai direto para /en/ (antes: dois saltos via makewell.com.br/en/)',
};

const SEO_RE = /<title>[\s\S]*?<\/title>|<meta\s[^>]*(?:name|property|http-equiv)="(?:description|keywords|robots|refresh|geo\.[^"]+|og:[^"]+|twitter:[^"]+)"[^>]*>|<link\s[^>]*rel="(?:canonical|alternate)"[^>]*>|<script type="application\/ld\+json">[\s\S]*?<\/script>|<html[^>]*>/g;
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const seo = (html) => (html.match(SEO_RE) ?? []).map((t) => (t.startsWith('<script') ? JSON.stringify(JSON.parse(t.replace(/<\/?script[^>]*>/g, ''))) : norm(t)));

// 4) texto: toda frase do conteúdo atual (entre o </header> e o <footer>, sem scripts) precisa estar na página nova.
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', rarr: '→', larr: '←', mdash: '—', ndash: '–', copy: '©', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', times: '×', laquo: '«', raquo: '»' };
const decode = (s) => s.replace(/&(#x?[\da-f]+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m));
const visible = (html) => decode(html.replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' '));
const words = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}%+$€]+/gu, ' ').trim();
function content(html) {
  const body = html.slice(html.indexOf('<body'));
  const start = body.indexOf('</header>'), end = body.search(/<footer[\s>]/);
  return body.slice(start > 0 ? start : 0, end > 0 ? end : undefined);
}
function lostSentences(oldHtml, newHtml) {
  const have = ' ' + words(visible(newHtml.slice(newHtml.indexOf('<body')))) + ' ';
  return visible(content(oldHtml)).split(/(?<=[.!?:;])\s+|\n+/).map((s) => s.trim())
    .filter((s) => words(s).split(' ').length >= 3 && !have.includes(' ' + words(s) + ' '));
}

let fail = 0;
for (const [site, src] of Object.entries(SOURCES)) {
  const files = execFileSync('git', ['-C', src, 'ls-files'], { encoding: 'utf8' }).split('\n').filter((f) => f && !NOT_SITE.test(f));
  let missing = 0, same = 0, ws = 0, ogChanged = 0;
  for (const f of files) {
    const out = join(process.env.DIST ?? 'dist', site, f);
    if (!existsSync(out)) { console.log(`FALTA  ${site}/${f}`); missing++; fail++; continue; }
    if (!f.endsWith('.html')) continue;
    const a = readFileSync(join(src, f), 'utf8'), b = readFileSync(out, 'utf8');
    // a troca da og-image (imagem de compartilhamento) por página é intencional; o resto do SEO tem de ser idêntico
    const OG = /^<meta (?:property="og:image"|name="twitter:image") content=/;
    const all_a = seo(a), all_b = seo(b);
    const sa = all_a.filter((t) => !OG.test(t)), sb = all_b.filter((t) => !OG.test(t));
    if (all_a.filter((t) => OG.test(t)).join() !== all_b.filter((t) => OG.test(t)).join()) ogChanged++;
    if (JSON.stringify(sa) !== JSON.stringify(sb)) {
      if (INTENTIONAL[`${site}/${f}`]) { console.log(`INTENC ${site}/${f}: ${INTENTIONAL[`${site}/${f}`]}`); continue; }
      fail++;
      const diff = sa.filter((x) => !sb.includes(x)).concat(sb.filter((x) => !sa.includes(x)).map((x) => '+ ' + x));
      console.log(`SEO    ${site}/${f}\n        ${diff.slice(0, 4).map((x) => x.slice(0, 160)).join('\n        ')}`);
      continue;
    }
    if (SEO_ONLY) { same++; continue; }
    if (a === b) same++;
    else if (norm(a) === norm(b)) ws++;
    else {
      const lost = lostSentences(a, b);
      if (lost.length) { fail++; console.log(`TEXTO  ${site}/${f}: ${lost.length} frase(s) sumiram\n        ${lost.slice(0, 5).map((x) => x.slice(0, 140)).join('\n        ')}`); }
      else console.log(`NOVO   ${site}/${f} (redesenhada: SEO igual, nenhum texto perdido)`);
    }
  }
  console.log(`${site}: ${files.length} arquivos do site atual | faltando ${missing} | HTML idêntico ${same} | só espaços ${ws} | og-image nova (intencional) ${ogChanged}`);
}
console.log(fail ? `\n${fail} FALHA(S)` : '\nOK: nada se perdeu');
process.exit(fail ? 1 : 0);
