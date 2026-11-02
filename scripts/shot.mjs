// Captura de tela com viewport real (desktop 1440 ou celular 390 com emulação de toque), via Chrome headless + CDP.
// Uso: node scripts/shot.mjs <url> <saida.png> [mobile|desktop] [altura]
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, out, mode = 'desktop', height = '1600'] = process.argv.slice(2);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'shot-'))}`, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let t;
  for (let i = 0; i < 40 && !t; i++) { await sleep(250); t = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json()).catch(() => null); }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0; const wait = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m.result); wait.delete(m.id); } });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const mobile = mode === 'mobile';
  await send('Emulation.setDeviceMetricsOverride', { width: mobile ? 390 : 1440, height: +height, deviceScaleFactor: 1, mobile });
  if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await send('Page.enable');
  await send('Page.navigate', { url });
  await sleep(2500);
  const w = await send('Runtime.evaluate', { expression: 'document.documentElement.scrollWidth', returnByValue: true });
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`${out}  largura do conteúdo=${w.result.value}px (viewport ${mobile ? 390 : 1440})`);
  ws.close();
} finally { chrome.kill(); }
