// QA funcional no Chrome headless (celular 320px): sem rolagem lateral, tudo visível depois de rolar,
// menu mobile abre em tela cheia e fecha pelo próprio botão. Uso: node scripts/qa.mjs <base-url> <rota>...
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [base, ...routes] = process.argv.slice(2);
const port = 9500 + Math.floor(Math.random() * 300);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'qa-'))}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
try {
  let t; for (let i = 0; i < 40 && !t; i++) { await sleep(250); t = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json()).catch(() => null); }
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0; const w = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && w.has(m.id)) { w.get(m.id)(m.result); w.delete(m.id); } });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; w.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = (expression) => send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).then((r) => r.result.value);
  await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 700, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await send('Page.enable');
  for (const r of routes) {
    await send('Page.navigate', { url: base + r }); await sleep(1500);
    await ev(`localStorage.setItem('mw-consent-v2','declined'); document.getElementById('mw-consent').hidden = true`);
    const res = await ev(`(async () => {
      const sw = document.documentElement.scrollWidth;
      for (let y = 0; y < document.documentElement.scrollHeight; y += 300) { scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); }
      await new Promise(r => setTimeout(r, 3000));
      const hidden = [...document.querySelectorAll('main h1, main h2, main .card, main .eyebrow')].filter(el => +getComputedStyle(el).opacity < 0.9 && el.offsetParent).map(el => (el.textContent || '').trim().slice(0, 40));
      scrollTo(0, 0); await new Promise(r => setTimeout(r, 300));
      const ham = document.getElementById('hamburger'); ham.click(); await new Promise(r => setTimeout(r, 300));
      const menu = document.getElementById('mobileMenu'), mh = menu.getBoundingClientRect().height;
      const b = ham.getBoundingClientRect(), top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      const onTop = ham.contains(top); ham.click(); await new Promise(r => setTimeout(r, 300));
      return { sw, hidden, mh, onTop, closed: !menu.classList.contains('open') && document.body.style.overflow === '' };
    })()`);
    const ok = res.sw <= 320 && !res.hidden.length && res.mh >= 690 && res.onTop && res.closed;
    if (!ok) fail++;
    console.log(`${ok ? 'OK  ' : 'FALHA'} ${r}  largura=${res.sw} menu=${Math.round(res.mh)}px botão-por-cima=${res.onTop} fechou=${res.closed}${res.hidden.length ? ' INVISÍVEIS: ' + res.hidden.slice(0, 3).join(' | ') : ''}`);
  }
  ws.close();
} finally { chrome.kill(); }
console.log(fail ? `${fail} FALHA(S)` : 'TUDO OK');
process.exit(fail ? 1 : 0);
