// Gera as imagens de compartilhamento (og:image, 1200x630) das 40 páginas a partir do build: título = H1 da própria página,
// visual à direita por tipo de página (gráfico na home, números em Cases/Casa Hunter, símbolo da marca nas demais).
// Uso: npm run build && node scripts/og.mjs   (grava em public-*/images/og/; rode o build de novo depois)
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OG = JSON.parse(readFileSync(join(ROOT, 'src/data/og-images.json'), 'utf8'));
const L = {
  br: { cta: 'Agendar diagnóstico', roi: 'ROI', voice: 'brasileiros com voz', yrs: 'anos de parceria', fol: 'seguidores' },
  en: { cta: 'Schedule a Diagnosis', roi: 'ROI', voice: 'Brazilians given a voice', yrs: 'years of partnership', fol: 'followers' },
  es: { cta: 'Agendar diagnóstico', roi: 'ROI', voice: 'brasileños con voz', yrs: 'años de alianza', fol: 'seguidores' },
  pt: { cta: 'Agendar diagnóstico', roi: 'ROI', voice: 'brasileiros com voz', yrs: 'anos de parceria', fol: 'seguidores' },
};
const MARK = '<svg viewBox="4.4 4.4 23.3 23.3"><path d="M23.4,14.7v6.69c0,.26-.25.43-.48.3l-6.83-3.87v4.6l8.36,4.74c1.34.75,2.96-.21,2.96-1.74v-12.98l-4.01,2.26h0Z" fill="#f1ca29"/><path d="M7.68,4.93c-1.34-.75-3.01.21-3.01,1.74v12.97l4.01-2.26v-6.69c0-.26.3-.43.53-.3l6.88,3.87v-4.6L7.68,4.93Z" fill="#f0c950"/><path d="M9.22,21.69s-.03,0-.04.01l-4.5,2.54v1.17c0,1.53,1.67,2.5,3.01,1.74l8.41-4.74v-4.6l-6.87,3.87h0Z" fill="#d88d1b"/><path d="M27.41,7.84v-1.17c0-1.53-1.620-2.5-2.96-1.74l-8.36,4.74v4.6s11.32-6.43,11.32-6.43Z" fill="#d88d1b"/></svg>';
const CHART = '<svg viewBox="0 0 400 420"><defs><linearGradient id="b" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#F5A623" stop-opacity=".5"/><stop offset="1" stop-color="#F07820" stop-opacity="0"/></linearGradient><linearGradient id="a" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#F07820" stop-opacity=".3"/><stop offset="1" stop-color="#F07820" stop-opacity="0"/></linearGradient></defs>'
  + [60, 95, 80, 130, 120, 170, 160, 215, 250, 240, 300, 340].map((h, i) => `<rect x="${8 + i * 33}" y="${420 - h}" width="20" height="${h}" rx="3" fill="url(#b)"/>`).join('')
  + '<path d="M0,380 L60,350 L120,358 L180,300 L240,250 L300,190 L360,110 L400,70 L400,420 L0,420Z" fill="url(#a)"/><polyline points="0,380 60,350 120,358 180,300 240,250 300,190 360,110 400,70" fill="none" stroke="#F5A623" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/><circle cx="360" cy="110" r="9" fill="#F5A623" stroke="#0E0D0B" stroke-width="4"/></svg>';

const strip = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').replace(/ ([:;,.!?])/g, '$1').trim();
function page(route, url) {
  const site = url.includes('makewell.com.br') ? 'br' : 'agency';
  const html = readFileSync(join(ROOT, 'dist', site, route, 'index.html'), 'utf8');
  const lang = site === 'br' ? 'br' : route.split('/')[0];
  const h1 = strip(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)[1]);
  const kicker = strip((html.match(/<p class="eyebrow[^"]*"[^>]*>([\s\S]*?)<\/p>/) ?? ['', ''])[1]);
  const key = url.split('/').pop().replace(/-(br|en|es|pt)\.jpg$/, '');
  const out = join(ROOT, site === 'br' ? 'public-br' : 'public-agency', 'images/og', url.split('/').pop());
  const logo = join(ROOT, 'public-agency/images', lang === 'en' ? 'logo-makewell-mi-branca-en.webp' : 'logo-makewell-mi-branca.webp');
  return { site, lang, h1, kicker, key, out, logo, domain: site === 'br' ? 'makewell.com.br' : `makewell.agency/${lang}` };
}
function visual(p) {
  const t = L[p.lang];
  const stat = (n, l) => `<div class="st"><b>${n}</b><span>${l}</span></div>`;
  if (p.key === 'home') return `<div class="chart">${CHART}<div class="chip">+26x <small>${t.roi}</small></div></div>`;
  if (p.key === 'cases') return `<div class="stats">${stat('+26x', `${t.roi} · Felipe Vilela`)}${stat('+20x', `${t.roi} · Dra. Thielen`)}${stat('13M', t.voice)}</div>`;
  if (p.key === 'casaHunter') return `<div class="stats">${stat('13M', t.voice)}${stat('4+', t.yrs)}${stat('50K+', t.fol)}</div>`;
  return `<div class="mark">${MARK}</div>`;
}
function html(p) {
  const size = p.h1.length > 90 ? 50 : p.h1.length > 60 ? 58 : 68;
  return `<!doctype html><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0} body{width:1200px;height:630px;overflow:hidden;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;color:#F4F1EC;
  background:radial-gradient(520px 420px at 92% 78%,rgba(240,120,32,.38),transparent 70%),linear-gradient(rgba(244,241,236,.035) 1px,transparent 1px) 0 0/60px 60px,linear-gradient(90deg,rgba(244,241,236,.035) 1px,transparent 1px) 0 0/60px 60px,linear-gradient(120deg,#1B1714,#0E0D0B 60%);position:relative}
  .l{position:absolute;left:72px;top:60px;bottom:56px;width:640px;display:flex;flex-direction:column}
  .logo{height:56px;width:auto;align-self:flex-start} .k{margin-top:auto;font-size:18px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#F07820;display:flex;gap:14px;align-items:center}
  .k:before{content:"";width:28px;height:2px;background:#F07820} h1{margin-top:18px;font-size:${size}px;line-height:1.04;letter-spacing:-.035em;font-weight:800;text-wrap:balance}
  .f{margin-top:auto;padding-top:28px;display:flex;align-items:center;gap:22px;font-size:20px;font-weight:600;color:#A8A196}
  .cta{background:#F07820;color:#080808;font-weight:700;padding:12px 24px;border-radius:999px;font-size:19px}
  .r{position:absolute;right:64px;top:70px;bottom:70px;width:400px;display:flex;align-items:center;justify-content:center}
  .chart{position:relative;width:400px;height:420px} .chart svg{width:100%;height:100%}
  .chip{position:absolute;left:10px;top:20px;padding:14px 22px;border-radius:20px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);font-size:46px;font-weight:800;letter-spacing:-.03em;color:#F5A623}
  .chip small{font-size:20px;color:#F4F1EC;letter-spacing:.06em}
  .stats{display:grid;gap:14px;width:100%} .st{padding:18px 24px;border-radius:20px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);display:flex;align-items:baseline;gap:18px}
  .st b{font-size:52px;font-weight:800;letter-spacing:-.04em;color:#F5A623;min-width:150px} .st span{font-size:19px;color:#C9C2B7}
  .mark svg{width:300px;height:300px;filter:drop-shadow(0 0 60px rgba(240,120,32,.55))}
  </style><body><div class="l"><img class="logo" src="file://${p.logo}"><p class="k">${p.kicker}</p><h1>${p.h1}</h1>
  <div class="f"><span class="cta">${L[p.lang].cta} →</span><span>${p.domain}</span></div></div><div class="r">${visual(p)}</div></body>`;
}

const port = 9600 + Math.floor(Math.random() * 300);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'og-'))}`, '--allow-file-access-from-files', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let t; for (let i = 0; i < 40 && !t; i++) { await sleep(250); t = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json()).catch(() => null); }
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0; const w = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && w.has(m.id)) { w.get(m.id)(m.result); w.delete(m.id); } });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; w.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false });
  await send('Page.enable');
  const tmp = mkdtempSync(join(tmpdir(), 'ogh-'));
  for (const [route, url] of Object.entries(OG)) {
    const p = page(route, url);
    const f = join(tmp, 'p.html'); writeFileSync(f, html(p));
    await send('Page.navigate', { url: 'file://' + f }); await sleep(700);
    const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
    writeFileSync(p.out, Buffer.from(shot.data, 'base64'));
    console.log('ok', p.out.split('/images/og/')[1], '|', p.h1.slice(0, 60));
  }
  ws.close();
} finally { chrome.kill(); }
