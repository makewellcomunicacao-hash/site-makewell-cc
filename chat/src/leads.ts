// Leads da Maia: cada encaminhamento vira uma linha no D1 (o resumo fica 2 anos, como diz a política; a conversa
// completa fica no KV por 90 dias), o time recebe um aviso por e-mail e há um painel privado em /leads.
// O painel só abre atrás do Cloudflare Access: além do Access na frente, o Worker confere a assinatura do token
// (Cf-Access-Jwt-Assertion) e o "aud" da aplicação. Sem ACCESS_TEAM e ACCESS_AUD configurados, o painel fica fechado.
import { EmailMessage } from 'cloudflare:email';

export type Lead = Record<string, string>;
export type LeadEnv = {
  DB: D1Database;
  CHAT: KVNamespace;
  EMAIL?: { send(m: EmailMessage): Promise<void> }; // só existe depois de ativar o Email Routing no makewell.agency
  NOTIFY_TO: string;
  // aviso no WhatsApp pela API oficial (número do app da Maia Connect na Meta, modelo "novo_lead_site" aprovado);
  // sem token, id do número ou destinatários, não envia
  META_WA_TOKEN?: { get(): Promise<string> };
  META_PHONE_ID: string;
  NOTIFY_WA: string; // celulares que recebem, separados por vírgula, só dígitos com DDI (ex.: 5582999999999)
  ACCESS_TEAM: string; // ex.: makewell.cloudflareaccess.com
  ACCESS_AUD: string;
};
type Row = Lead & { ref: string; sid: string; created: string; lang: string; pagina: string };

const PANEL = 'https://chat.makewell.agency/leads';
const COLS = ['nome', 'empresa', 'segmento', 'local', 'presenca', 'objetivo', 'situacao', 'investimento', 'urgencia', 'decisor', 'interesse', 'avaliacao'] as const;
const LABELS: Record<string, string> = { nome: 'Nome', empresa: 'Empresa', segmento: 'Segmento', local: 'Local', presenca: 'Site/Instagram', objetivo: 'Objetivo', situacao: 'Hoje',
  investimento: 'Investimento', urgencia: 'Urgência', decisor: 'Decide', interesse: 'Interesse', avaliacao: 'Avaliação da IA' };

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const b64 = (s: string) => { let bin = ''; for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b); return btoa(bin); };
const brt = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Maceio', dateStyle: 'short', timeStyle: 'short' });

export async function saveLead(env: LeadEnv, r: { ref: string; sid: string; lang: string; pagina: string; lead: Lead }, notify: boolean) {
  const created = new Date().toISOString();
  // novo encaminhamento da mesma conversa: atualiza o resumo e mantém a data do primeiro
  await env.DB.prepare(`INSERT INTO leads (ref, sid, created, lang, pagina, ${COLS.join(', ')}) VALUES (?, ?, ?, ?, ?, ${COLS.map(() => '?').join(', ')})
    ON CONFLICT(ref) DO UPDATE SET ${COLS.map((k) => `${k} = excluded.${k}`).join(', ')}`)
    .bind(r.ref, r.sid, created, r.lang, r.pagina, ...COLS.map((k) => (r.lead[k] ?? '').trim()))
    .run();
  if (!notify) return;
  // teto de avisos por dia (protege o WhatsApp e o e-mail do time de um disparo em massa)
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM leads WHERE created >= ?").bind(created.slice(0, 10)).first<number>('n').catch(() => 0);
  if ((n ?? 0) > 40) return console.error('[leads] teto de avisos do dia atingido', r.ref);
  // os campos vêm da conversa (texto do visitante): nos avisos, sem links, para não virar isca de golpe
  r = { ...r, lead: Object.fromEntries(Object.entries(r.lead).map(([k, v]) => [k, String(v).replace(/(https?:\/\/|www\.)\S+/gi, '[link]')])) };
  const av = (r.lead.avaliacao ?? '').toUpperCase();
  await notifyWhatsApp(env, r, av).catch((e) => console.error('[leads] whatsapp', String(e)));
  if (!env.EMAIL) return;
  const subject = `Novo lead do site: ${r.lead.nome || 'sem nome'}${r.lead.segmento ? `, ${r.lead.segmento}` : ''}${av ? ` · ${av}` : ''} · Ref. ${r.ref}`;
  const text = [
    `Um visitante conversou com a Maia e foi encaminhado ao WhatsApp. A mensagem dele chega com "Ref. ${r.ref}".`, '',
    ...COLS.filter((k) => r.lead[k]?.trim()).map((k) => `${LABELS[k]}: ${r.lead[k].trim()}`),
    `Idioma: ${r.lang.toUpperCase()}`, `Página: ${r.pagina || '-'}`, '',
    `Conversa completa: ${PANEL}/${r.ref}`,
  ].join('\n');
  const raw = [`From: Maia (site Makewell) <chat@makewell.agency>`, `To: ${env.NOTIFY_TO}`, `Subject: =?UTF-8?B?${b64(subject)}?=`,
    `Date: ${new Date().toUTCString()}`, `Message-ID: <${r.ref}.${Date.now()}@makewell.agency>`, 'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64(text).replace(/.{76}/g, '$&\r\n')].join('\r\n');
  await env.EMAIL.send(new EmailMessage('chat@makewell.agency', env.NOTIFY_TO, raw)).catch((e) => console.error('[leads] email', String(e)));
}

// Modelo aprovado na Meta: "Novo lead do site Makewell: {{1}}. Avaliação da IA: {{2}}. Ref. {{3}}. Conversa completa: {{4}} ..."
async function notifyWhatsApp(env: LeadEnv, r: { ref: string; lead: Lead }, av: string) {
  const to = (env.NOTIFY_WA ?? '').split(',').map((n) => n.replace(/\D/g, '')).filter(Boolean);
  if (!env.META_WA_TOKEN || !env.META_PHONE_ID || !to.length) return;
  const token = await env.META_WA_TOKEN.get();
  // a Meta recusa parâmetro vazio, com quebra de linha ou com mais de 4 espaços seguidos
  const p = (s: string) => ({ type: 'text', text: (s || '-').replace(/\s+/g, ' ').slice(0, 300) });
  const quem = [r.lead.nome, r.lead.segmento, r.lead.local].filter((x) => x?.trim()).join(', ');
  for (const n of to) {
    const res = await fetch(`https://graph.facebook.com/v25.0/${env.META_PHONE_ID}/messages`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ messaging_product: 'whatsapp', to: n, type: 'template', template: { name: 'novo_lead_site', language: { code: 'pt_BR' },
        components: [{ type: 'body', parameters: [p(quem), p(av), p(r.ref), p(`${PANEL}/${r.ref}`)] }] } }),
    });
    const out = (await res.text()).slice(0, 300);
    if (!res.ok) console.error('[leads] whatsapp', n.slice(-4), res.status, out); else console.log('[leads] whatsapp ok', n.slice(-4), out);
  }
}

// Token do Cloudflare Access: assinatura RS256 pelas chaves públicas do time, "aud" da aplicação, emissor e validade
async function accessOk(req: Request, env: LeadEnv): Promise<boolean> {
  const jwt = req.headers.get('cf-access-jwt-assertion');
  if (!env.ACCESS_TEAM || !env.ACCESS_AUD || !jwt) return false;
  const [h, p, s] = jwt.split('.');
  const dec = (x: string) => Uint8Array.from(atob(x.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  try {
    const head = JSON.parse(new TextDecoder().decode(dec(h))), body = JSON.parse(new TextDecoder().decode(dec(p)));
    const aud = Array.isArray(body.aud) ? body.aud : [body.aud];
    if (!aud.includes(env.ACCESS_AUD) || body.iss !== `https://${env.ACCESS_TEAM}` || body.exp * 1000 < Date.now()) return false;
    const { keys } = (await fetch(`https://${env.ACCESS_TEAM}/cdn-cgi/access/certs`).then((r) => r.json())) as { keys: (JsonWebKey & { kid: string })[] };
    const jwk = keys.find((k) => k.kid === head.kid);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, dec(s), new TextEncoder().encode(`${h}.${p}`));
  } catch { return false; }
}

const page = (title: string, body: string) => new Response(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title><style>
body{margin:0;font:15px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;background:#0E0D0B;color:#F4F1EC}main{max-width:none;margin:0 auto;padding:24px 16px}
a{color:#F5A623}h1{font-size:24px;margin:0 0 4px}.sub{color:#A8A196;margin:0 0 20px}.f a{margin-right:14px}table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:10px 8px;border-bottom:1px solid #2a2724;vertical-align:top;min-width:90px;max-width:260px}th{white-space:nowrap}th{color:#A8A196;font-weight:600}.wrap{overflow-x:auto}
.av{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:700;background:#2a2724}.quente{background:#F07820;color:#080808}.morno{background:#5a4220}
dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px}dt{color:#A8A196}.msg{max-width:720px;padding:10px 14px;border-radius:14px;margin:8px 0;white-space:pre-wrap;background:#1c1a17}
.me{background:#3a2a18;margin-left:auto}</style><main>${body}</main></html>`,
  { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });

export async function panel(req: Request, env: LeadEnv): Promise<Response> {
  if (!(await accessOk(req, env))) return new Response('forbidden', { status: 403 });
  const url = new URL(req.url);
  const ref = url.pathname.replace(/^\/leads\/?/, '');

  if (ref === 'planilha.csv') {
    const { results } = await env.DB.prepare('SELECT * FROM leads ORDER BY created DESC').all<Row>();
    const head = ['ref', 'created', 'lang', 'pagina', ...COLS];
    // célula que começa com = + - @ vira fórmula no Excel/Sheets: o apóstrofo a mantém como texto
    const cell = (v: unknown) => `"${String(v ?? '').replace(/^[=+\-@\t\r]/, "'$&").replace(/"/g, '""')}"`;
    const csv = [head.join(';'), ...results.map((r) => head.map((k) => cell(r[k])).join(';'))].join('\r\n');
    return new Response('﻿' + csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="leads-makewell.csv"', 'cache-control': 'no-store' } });
  }

  if (ref) {
    const r = await env.DB.prepare('SELECT * FROM leads WHERE ref = ?').bind(ref.toUpperCase()).first<Row>();
    if (!r) return page('Lead não encontrado', `<p><a href="/leads">← Leads</a></p><h1>Lead não encontrado</h1>`);
    const conv = await env.CHAT.get<{ messages: { role: string; content: string }[] }>(`conv:${r.sid}`, 'json');
    const msgs = conv ? conv.messages.map((m) => `<p class="msg${m.role === 'user' ? ' me' : ''}">${esc(m.content)}</p>`).join('') : '<p class="sub">A conversa completa é apagada depois de 90 dias; o resumo acima continua guardado.</p>';
    return page(`Lead ${r.ref}`, `<p><a href="/leads">← Leads</a></p><h1>${esc(r.nome || 'Sem nome')} <span class="av ${esc(r.avaliacao)}">${esc(r.avaliacao)}</span></h1>
<p class="sub">Ref. ${esc(r.ref)} · ${esc(brt(r.created))} · ${esc(r.lang.toUpperCase())} · ${esc(r.pagina)}</p>
<dl>${COLS.filter((k) => r[k]).map((k) => `<dt>${LABELS[k]}</dt><dd>${esc(r[k])}</dd>`).join('')}</dl><h2>Conversa</h2>${msgs}`);
  }

  const av = url.searchParams.get('av') ?? '';
  const q = ['quente', 'morno', 'frio'].includes(av)
    ? env.DB.prepare('SELECT * FROM leads WHERE avaliacao = ? ORDER BY created DESC LIMIT 500').bind(av)
    : env.DB.prepare('SELECT * FROM leads ORDER BY created DESC LIMIT 500');
  const { results } = await q.all<Row>();
  // a lista mostra tudo o que a Maia levantou; o nome leva à conversa completa
  const info = COLS.filter((k) => k !== 'nome' && k !== 'avaliacao');
  const rows = results.map((r) => `<tr><td>${esc(brt(r.created))}</td><td><span class="av ${esc(r.avaliacao)}">${esc(r.avaliacao)}</span></td>
<td><a href="/leads/${esc(r.ref)}">${esc(r.nome || 'Sem nome')}</a></td>${info.map((k) => `<td>${esc(r[k])}</td>`).join('')}
<td>${esc(r.pagina)}</td><td>${esc(r.lang.toUpperCase())}</td><td>${esc(r.ref)}</td></tr>`).join('');
  const head = ['Data', 'Avaliação', 'Nome', ...info.map((k) => LABELS[k]), 'Página', 'Idioma', 'Ref.'];
  return page('Leads do site', `<h1>Leads do site</h1><p class="sub">${results.length} lead(s) · conversas com a Maia encaminhadas ao WhatsApp</p>
<p class="f"><a href="/leads">Todos</a><a href="/leads?av=quente">Quentes</a><a href="/leads?av=morno">Mornos</a><a href="/leads?av=frio">Frios</a><a href="/leads/planilha.csv">Exportar planilha</a></p>
<div class="wrap"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
<tbody>${rows || `<tr><td colspan="${head.length}">Nenhum lead ainda.</td></tr>`}</tbody></table></div>`);
}

// limpeza diária: o resumo do lead fica 2 anos (a conversa já some do KV em 90 dias)
export const purge = (env: LeadEnv) => env.DB.batch([
  env.DB.prepare("DELETE FROM leads WHERE created < datetime('now', '-2 years')"),
  env.DB.prepare("DELETE FROM spend WHERE day < date('now', '-90 days')"),
]);
