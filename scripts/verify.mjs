// Prova de não-regressão da migração: compara o build (dist/<site>) com o site estático atual.
// 1) inventário: todo arquivo publicado hoje existe no build; 2) HTML idêntico (ou só espaços diferentes);
// 3) SEO: title, metas, canonical, hreflang, og/twitter e JSON-LD iguais, página a página.
// Uso: node scripts/verify.mjs [--seo-only]   (sai com código 1 se algo falhar)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// base de comparação: o site estático anterior à migração (branch legacy e tag de backup do .agency)
const SOURCES = {
  br: { repo: join(homedir(), 'Downloads/site-makewell-cc'), ref: 'legacy' },
  agency: { repo: join(homedir(), 'Downloads/makewell-agency'), ref: 'backup-pre-astro-2026-11-01' },
};
const git = (src, ...args) => execFileSync('git', ['-C', src.repo, ...args], { encoding: 'utf8', maxBuffer: 64 << 20 });
// arquivos do repositório que não são site (deixam de ser publicados de propósito)
const NOT_SITE = /^(AGENTS\.md|CLAUDE\.md|generate_og\.py|\.gitignore|\.claude\/.*)$/;
const SEO_ONLY = process.argv.includes('--seo-only');
// mudanças de SEO intencionais e aprovadas no plano (não contam como falha)
const INTENTIONAL = {
  'agency/index.html': 'raiz do .agency vai direto para /en/ (antes: dois saltos via makewell.com.br/en/)',
};
// ajuste de tom aprovado em 02/11/2026 (sem promessa de "previsível", sem "não é pra todo mundo", "nós" no lugar de "A Makewell"):
// aplicado ao texto antigo antes de comparar, para o verificador continuar provando que nada mais sumiu
const TONE = [
  ['receita mensurável e previsível', 'receita mensurável'], ['faturação mensurável e previsível', 'faturação mensurável'],
  ['measurable and predictable revenue', 'measurable revenue'], ['ingresos medibles y predecibles', 'ingresos medibles'],
  ['eficiente e previsível', 'eficiente e mensurável'], ['efficient and predictable', 'efficient and measurable'], ['eficiente y predecible', 'eficiente y medible'],
  ['crescimento previsível', 'crescimento consistente'], ['predictable growth', 'consistent growth'], ['crecimiento predecible', 'crecimiento consistente'],
  ['receita previsível?', 'receita?'], ['predictable revenue?', 'revenue?'], ['ingresos predecibles?', 'ingresos?'],
  ['A Makewell existe pra resolver', 'Existimos pra resolver'], ['Makewell exists to close', 'We exist to close'],
  ['Makewell existe para cerrar', 'Existimos para cerrar'], ['A Makewell existe para fechar', 'Existimos para fechar'],
  ['O que a Makewell faz', 'O que nós fazemos'], ['What Makewell does', 'What we do'], ['Lo que hace Makewell', 'Lo que hacemos'], ['Implanta um', 'Implantamos um'],
  ['A Makewell não é pra todo mundo, e faz parte da nossa proposta ser clara sobre isso.', ''],
  ['Makewell isn’t for everyone, and being clear about that is part of our proposition.', ''], ["Makewell isn't for everyone, and being clear about that is part of our proposition.", ''],
  ['Makewell no es para todos, y ser claros sobre eso es parte de nuestra propuesta.', ''], ['A Makewell não é para todos, e ser claros sobre isso faz parte da nossa proposta.', ''],
  ['motor de receita previsível', 'motor de receita'], ['predictable revenue engine', 'revenue engine'], ['motor de ingresos predecibles', 'motor de ingresos'],
  ['Aquisição previsível', 'Aquisição consistente'], ['Predictable acquisition', 'Consistent acquisition'], ['Adquisición predecible', 'Adquisición constante'],
  ['CAC previsível', 'CAC sob controle'], ['predictable CAC', 'controlled CAC'], ['CAC predecible', 'CAC controlado'],
  ['A previsibilidade é o produto', 'A transparência é o produto'], ['Previsibilidade é o produto', 'Transparência é o produto'],
  ['Predictability is the product', 'Transparency is the product'], ['La previsibilidad es el producto', 'La transparencia es el producto'],
  ['Previsibilidade', 'Maturidade'], ['Predictability', 'Maturity'], ['Previsibilidad', 'Madurez'],
  ['gerar receita previsível', 'gerar receita'], ['generate predictable revenue', 'generate revenue'], ['generar ingresos predecibles', 'generar ingresos'],
  ['A Makewell não entrega serviços isolados', 'Não entregamos serviços isolados'], ["Makewell doesn't deliver isolated services", "We don't deliver isolated services"],
  ['Makewell doesn’t deliver isolated services', 'We don’t deliver isolated services'], ['Makewell no entrega servicios aislados', 'No entregamos servicios aislados'],
  ['leads qualificados e previsibilidade', 'leads qualificados'], ['leads qualificados com previsibilidade', 'leads qualificados'],
  ['lead generation and predictability', 'lead generation'], ['leads calificados y previsibilidad', 'leads calificados'],
  ['e previsibilidade sobre o ciclo', 'e clareza sobre o ciclo'], ['and predictability over the sales cycle', 'and clarity over the sales cycle'],
  ['y previsibilidad en el ciclo de ventas', 'y claridad sobre el ciclo de ventas'],
  // padrão de CTA em inglês: "Schedule a Diagnosis" (02/11/2026); os nomes dos eventos Lead não mudam
  ['Schedule a Free Diagnostic', 'Schedule a Free Diagnosis'], ['Schedule Free Diagnostic', 'Schedule a Free Diagnosis'],
  ['Schedule a Diagnostic', 'Schedule a Diagnosis'], ['Schedule Diagnostic', 'Schedule a Diagnosis'], ['Schedule diagnostic', 'Schedule diagnosis'],
  ['Schedule a strategic diagnostic', 'Schedule a strategic diagnosis'],
  // +20x é o case da Dra. Thielen (cirurgia vascular), como em Home e Cases; o Método dizia endocrinologia (corrigido em 02/11/2026)
  ['ROI em endocrinologia com o Funil Médico', 'ROI em cirurgia vascular, Dra. Thielen'], ['ROI in endocrinology with the Medical Funnel', 'ROI in vascular surgery, Dr. Thielen'],
  ['ROI en endocrinología con el Embudo Médico', 'ROI en cirugía vascular, Dra. Thielen'], ['em endocrinologia, dezenas', 'em cirurgia vascular, dezenas'],
  ['in endocrinology, dozens', 'in vascular surgery, dozens'], ['en endocrinología, decenas', 'en cirugía vascular, decenas'], ['Schedule a free diagnostic and', 'Schedule a free diagnosis and'], ['FREE DIAGNOSTIC', 'FREE DIAGNOSIS'], ['Free Diagnostic', 'Free Diagnosis'],
];
const tone = (s) => TONE.reduce((t, [a, b]) => t.split(a).join(b), s);

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
  return tone(visible(content(oldHtml))).split(/(?<=[.!?:;])\s+|\n+/).map((s) => s.trim())
    .filter((s) => words(s).split(' ').length >= 3 && !have.includes(' ' + words(s) + ' '));
}

let fail = 0;
for (const [site, src] of Object.entries(SOURCES)) {
  const files = git(src, 'ls-tree', '-r', '--name-only', src.ref).split('\n').filter((f) => f && !NOT_SITE.test(f));
  let missing = 0, same = 0, ws = 0, ogChanged = 0;
  for (const f of files) {
    const out = join(process.env.DIST ?? 'dist', site, f);
    if (!existsSync(out)) { console.log(`FALTA  ${site}/${f}`); missing++; fail++; continue; }
    if (!f.endsWith('.html')) continue;
    const a = git(src, 'show', `${src.ref}:${f}`), b = readFileSync(out, 'utf8');
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
