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
const COLS = ['nome', 'email', 'empresa', 'segmento', 'local', 'presenca', 'objetivo', 'situacao', 'investimento', 'urgencia', 'decisor', 'interesse', 'avaliacao'] as const;
const LABELS: Record<string, string> = { nome: 'Nome', email: 'E-mail', empresa: 'Empresa', segmento: 'Segmento', local: 'Local', presenca: 'Site/Instagram', objetivo: 'Objetivo', situacao: 'Hoje',
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
  // assunto curto: cabe numa linha de cabeçalho (RFC 5322) mesmo com nome e segmento longos
  const subject = `Novo lead do site: ${`${r.lead.nome || 'sem nome'}${r.lead.segmento ? `, ${r.lead.segmento}` : ''}`.slice(0, 60)}${av ? ` · ${av}` : ''} · Ref. ${r.ref}`;
  const text = [
    `Um visitante conversou com a Maia e foi encaminhado ao WhatsApp. A mensagem dele chega com "Ref. ${r.ref}".`, '',
    ...COLS.filter((k) => r.lead[k]?.trim()).map((k) => `${LABELS[k]}: ${r.lead[k].trim()}`),
    `Idioma: ${r.lang.toUpperCase()}`, `Página: ${r.pagina || '-'}`, '',
    `Conversa completa: ${PANEL}/${r.ref}`,
  ].join('\n');
  // texto + HTML (multipart/alternative); os campos vêm do visitante, então tudo passa por esc() no HTML
  const boundary = `mw-${r.ref}-${Date.now()}`;
  const part = (type: string, body: string) => [`--${boundary}`, `Content-Type: ${type}; charset=UTF-8`, 'Content-Transfer-Encoding: base64', '',
    b64(body).replace(/.{76}/g, '$&\r\n')].join('\r\n');
  const raw = [`From: =?UTF-8?B?${b64('Maia · Site Makewell')}?= <chat@makewell.agency>`, `To: ${env.NOTIFY_TO}`, `Subject: =?UTF-8?B?${b64(subject)}?=`,
    `Date: ${new Date().toUTCString()}`, `Message-ID: <${r.ref}.${Date.now()}@makewell.agency>`, 'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
    part('text/plain', text), part('text/html', emailHtml(r, av)), `--${boundary}--`, ''].join('\r\n');
  await env.EMAIL.send(new EmailMessage('chat@makewell.agency', env.NOTIFY_TO, raw)).catch((e) => console.error('[leads] email', String(e)));
}

// E-mail em tabelas e estilos inline (o que os leitores de e-mail aceitam), nas cores do site
function emailHtml(r: { ref: string; lang: string; pagina: string; lead: Lead }, av: string) {
  const badge: Record<string, string> = { QUENTE: '#F07820', MORNO: '#C9A227', FRIO: '#8A8F98' };
  const rows = COLS.filter((k) => k !== 'avaliacao' && r.lead[k]?.trim()).map((k) => [LABELS[k], r.lead[k].trim()])
    .concat([['Idioma', r.lang.toUpperCase()], ['Página', r.pagina || '-']])
    .map(([l, v]) => `<tr><td style="padding:10px 0;border-bottom:1px solid #EEE9E1;color:#7A7268;font-size:13px;width:130px;vertical-align:top">${esc(l)}</td>
<td style="padding:10px 0;border-bottom:1px solid #EEE9E1;color:#1A1714;font-size:15px;vertical-align:top">${esc(v)}</td></tr>`).join('');
  const quem = [r.lead.nome || 'Sem nome', r.lead.empresa].filter(Boolean).join(' · ');
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><body style="margin:0;padding:0;background:#F4F1EC">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F1EC;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFFFF;border-radius:16px;overflow:hidden;font-family:'Segoe UI',system-ui,-apple-system,Arial,sans-serif">
<tr><td style="background:#0E0D0B;padding:22px 28px">
<span style="color:#F07820;font-size:13px;font-weight:700;letter-spacing:.14em;text-transform:uppercase">Novo lead do site</span>
<div style="color:#F4F1EC;font-size:22px;font-weight:800;margin-top:6px">${esc(quem)}</div>
<div style="margin-top:12px"><span style="display:inline-block;background:${badge[av] ?? '#8A8F98'};color:#0E0D0B;font-size:12px;font-weight:800;padding:4px 10px;border-radius:999px">${esc(av || 'SEM AVALIAÇÃO')}</span>
<span style="color:#A8A196;font-size:13px;margin-left:8px">Ref. ${esc(r.ref)}</span></div></td></tr>
<tr><td style="padding:22px 28px 6px;color:#3D3832;font-size:15px;line-height:1.5">O visitante conversou com a Maia e foi encaminhado ao WhatsApp. A mensagem dele chega com <b>Ref. ${esc(r.ref)}</b>.</td></tr>
<tr><td style="padding:6px 28px 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>
<tr><td style="padding:18px 28px 28px"><a href="${PANEL}/${esc(r.ref)}" style="display:inline-block;background:#F07820;color:#0E0D0B;font-weight:700;font-size:15px;text-decoration:none;padding:13px 22px;border-radius:999px">Abrir conversa completa</a></td></tr>
<tr><td style="padding:16px 28px;background:#FAF8F5;color:#9A9288;font-size:12px">Aviso automático do chat do site makewell.com.br · makewell.agency</td></tr>
</table></td></tr></table></body></html>`;
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
a{color:#F5A623}h1{font-size:24px;margin:0 0 4px}.sub{color:#A8A196;margin:0 0 20px}.flt{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 12px}.flt input,.flt select,.flt button{font:inherit;color:#F4F1EC;background:#1c1a17;border:1px solid #3a3530;border-radius:10px;padding:8px 10px}.flt input[type=search]{flex:1;min-width:240px}.flt label{color:#A8A196;font-size:13px;display:flex;gap:6px;align-items:center}.flt button{background:#F07820;color:#0E0D0B;border-color:#F07820;font-weight:700;cursor:pointer}.chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 18px}.chip{padding:6px 12px;border-radius:999px;border:1px solid #3a3530;text-decoration:none;color:#F4F1EC;font-size:14px}.chip b{color:#F5A623;margin-left:4px}.chip.on{background:#F07820;color:#0E0D0B;border-color:#F07820}.chip.on b{color:#0E0D0B}.chip.exp{margin-left:auto;color:#F5A623}table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:10px 8px;border-bottom:1px solid #2a2724;vertical-align:top;min-width:90px;max-width:260px}th{white-space:nowrap}th{color:#A8A196;font-weight:600}.wrap{overflow-x:auto}
.av{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:700;background:#2a2724}.quente{background:#F07820;color:#080808}.morno{background:#5a4220}
dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px}dt{color:#A8A196}.msg{max-width:720px;padding:10px 14px;border-radius:14px;margin:8px 0;white-space:pre-wrap;background:#1c1a17}
.me{background:#3a2a18;margin-left:auto}</style><main>${body}</main></html>`,
  { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex',
    // painel com dados pessoais: não pode ser embutido em moldura, não carrega nada de fora e não vaza o endereço
    'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'" } });

// Filtros da lista (e da planilha): busca por texto, avaliação, idioma e período. Tudo vai por parâmetro no SQL
type Filter = { q: string; av: string; lang: string; de: string; ate: string };
function readFilter(url: URL): Filter {
  const g = (k: string) => (url.searchParams.get(k) ?? '').trim();
  const day = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
  return { q: g('q').slice(0, 80), av: ['quente', 'morno', 'frio'].includes(g('av')) ? g('av') : '',
    lang: ['br', 'en', 'es', 'pt'].includes(g('lang')) ? g('lang') : '', de: day(g('de')), ate: day(g('ate')) };
}
function where(f: Filter, withAv = true): { sql: string; args: string[] } {
  const c: string[] = [], args: string[] = [];
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, '\\$&')}%`;
    const cols = ['ref', 'nome', 'empresa', 'segmento', 'local', 'presenca', 'objetivo', 'interesse', 'situacao'];
    c.push(`(${cols.map((k) => `${k} LIKE ? ESCAPE '\\'`).join(' OR ')})`); args.push(...cols.map(() => like));
  }
  if (withAv && f.av) { c.push('avaliacao = ?'); args.push(f.av); }
  if (f.lang) { c.push('lang = ?'); args.push(f.lang); }
  // datas na hora de Maceió (UTC-3), como a lista mostra
  if (f.de) { c.push("date(created, '-3 hours') >= ?"); args.push(f.de); }
  if (f.ate) { c.push("date(created, '-3 hours') <= ?"); args.push(f.ate); }
  return { sql: c.length ? `WHERE ${c.join(' AND ')}` : '', args };
}

export async function panel(req: Request, env: LeadEnv): Promise<Response> {
  if (!(await accessOk(req, env))) return new Response('forbidden', { status: 403 });
  const url = new URL(req.url);
  const ref = url.pathname.replace(/^\/leads\/?/, '');

  if (ref === 'planilha.csv') {
    const w = where(readFilter(url));
    const { results } = await env.DB.prepare(`SELECT * FROM leads ${w.sql} ORDER BY created DESC`).bind(...w.args).all<Row>();
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

  const f = readFilter(url), w = where(f), wc = where(f, false);
  const { results } = await env.DB.prepare(`SELECT * FROM leads ${w.sql} ORDER BY created DESC LIMIT 500`).bind(...w.args).all<Row>();
  // contagem por avaliação com os demais filtros, para os atalhos
  const counts = Object.fromEntries((await env.DB.prepare(`SELECT avaliacao, COUNT(*) AS n FROM leads ${wc.sql} GROUP BY avaliacao`).bind(...wc.args)
    .all<{ avaliacao: string; n: number }>()).results.map((x) => [x.avaliacao, x.n]));
  const qs = (o: Partial<Filter>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ ...f, ...o })) if (v) p.set(k, v); const t = p.toString(); return t ? `?${t}` : ''; };
  const opt = (v: string, label: string, cur: string) => `<option value="${v}"${v === cur ? ' selected' : ''}>${label}</option>`;
  const chip = (v: string, label: string) => `<a class="chip${f.av === v ? ' on' : ''}" href="/leads${qs({ av: v })}">${label}${v ? ` <b>${counts[v] ?? 0}</b>` : ''}</a>`;
  const filters = `<form class="flt" method="get" action="/leads">
<input type="search" name="q" value="${esc(f.q)}" placeholder="Buscar nome, empresa, segmento, cidade, @ ou ref." aria-label="Buscar">
<select name="av" aria-label="Avaliação">${opt('', 'Todas as avaliações', f.av)}${opt('quente', 'Quentes', f.av)}${opt('morno', 'Mornos', f.av)}${opt('frio', 'Frios', f.av)}</select>
<select name="lang" aria-label="Idioma">${opt('', 'Todos os idiomas', f.lang)}${opt('br', 'BR', f.lang)}${opt('en', 'EN', f.lang)}${opt('es', 'ES', f.lang)}${opt('pt', 'PT', f.lang)}</select>
<label>De <input type="date" name="de" value="${esc(f.de)}"></label><label>Até <input type="date" name="ate" value="${esc(f.ate)}"></label>
<button type="submit">Filtrar</button><a href="/leads">Limpar</a></form>
<p class="chips">${chip('', 'Todos')}${chip('quente', 'Quentes')}${chip('morno', 'Mornos')}${chip('frio', 'Frios')}<a class="chip exp" href="/leads/planilha.csv${qs({})}">Exportar planilha</a></p>`;
  // a lista mostra tudo o que a Maia levantou; o nome leva à conversa completa
  const info = COLS.filter((k) => k !== 'nome' && k !== 'avaliacao');
  const rows = results.map((r) => `<tr><td>${esc(brt(r.created))}</td><td><span class="av ${esc(r.avaliacao)}">${esc(r.avaliacao)}</span></td>
<td><a href="/leads/${esc(r.ref)}">${esc(r.nome || 'Sem nome')}</a></td>${info.map((k) => `<td>${esc(r[k])}</td>`).join('')}
<td>${esc(r.pagina)}</td><td>${esc(r.lang.toUpperCase())}</td><td>${esc(r.ref)}</td></tr>`).join('');
  const head = ['Data', 'Avaliação', 'Nome', ...info.map((k) => LABELS[k]), 'Página', 'Idioma', 'Ref.'];
  return page('Leads do site', `<h1>Leads do site</h1><p class="sub">${results.length} lead(s) · conversas com a Maia encaminhadas ao WhatsApp</p>
${filters}
<div class="wrap"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
<tbody>${rows || `<tr><td colspan="${head.length}">${f.q || f.av || f.lang || f.de || f.ate ? 'Nenhum lead com esses filtros.' : 'Nenhum lead ainda.'}</td></tr>`}</tbody></table></div>`);
}

// limpeza diária: o resumo do lead fica 2 anos (a conversa já some do KV em 90 dias)
export const purge = (env: LeadEnv) => env.DB.batch([
  env.DB.prepare("DELETE FROM leads WHERE created < datetime('now', '-2 years')"),
  env.DB.prepare("DELETE FROM spend WHERE day < date('now', '-90 days')"),
]);
