// Maia, o chat de vendas do site da Makewell (chat.makewell.agency). O navegador manda só { sid, lang, text }; a conversa
// fica guardada aqui (KV, 90 dias), então ninguém consegue forjar o histórico. O modelo roda pela kie.ai, como no MakeWorks
// (mesma chave, no Secrets Store da conta): MODEL "grok-4-7" usa o formato Responses (/grok/v1/responses) e um modelo
// "claude-*" usa o formato de mensagens da Anthropic (/claude/v1/messages). O resumo do lead vem numa linha
// "[[WHATSAPP]] {json}" no fim da resposta (ver prompt.ts), que sai daqui como o link do WhatsApp.
// No encaminhamento, o lead vai para o D1 e o time recebe um aviso (ver leads.ts); o visitante leva só a saudação e a referência.
// Proteções: origem permitida, limite por IP e limite global por minuto (este último deixa o gasto máximo previsível,
// já que o contador diário no KV não é atômico), teto de gasto diário, tamanho da mensagem e turnos por conversa.
import { SYSTEM } from './prompt';
import { panel, purge, saveLead, type LeadEnv } from './leads';

type Limiter = { limit(o: { key: string }): Promise<{ success: boolean }> };
export interface Env extends LeadEnv {
  KIE_API_KEY: { get(): Promise<string> }; // Secrets Store da conta
  RL: Limiter;
  RL_GLOBAL: Limiter;
  MODEL: string;
  DAILY_CAP_USD: string;
  ALLOWED_ORIGINS: string;
  WHATSAPP: string;
  // anti-robô: chave secreta no Secrets Store
  TURNSTILE_SECRET?: { get(): Promise<string> };
  TURNSTILE_SITEKEY: string;
  TURNSTILE_ENFORCE: string; // "0" só registra o resultado (observação antes de ligar); qualquer outro valor bloqueia
}

type Lang = 'br' | 'en' | 'es' | 'pt';
type Msg = { role: 'user' | 'assistant'; content: string };
type Conv = { lang: Lang; created: string; page?: string; messages: Msg[]; handoff?: boolean; ref?: string; notified?: boolean; lead?: Record<string, string> };
type Reply = { ok: true; text: string; usd: number } | { ok: false; error: string };

const TTL = 60 * 60 * 24 * 90; // 90 dias, como diz a política de privacidade
const MAX_TURNS = 30;
const MAX_TEXT = 1200;
// Preço na kie.ai em US$ por 1M de tokens (a entrada tem o mesmo desconto da saída)
const PRICE: Record<string, { input: number; output: number }> = {
  'grok-4-7': { input: 0.8, output: 2.4 },
  'claude-opus-5-5': { input: 1.6, output: 8 },
  'claude-sonnet-5-5': { input: 0.8, output: 4 },
  'claude-haiku-5-5': { input: 0.06, output: 0.3 },
  'gemini-3-8-flash': { input: 0.15, output: 0.6 }, // aproximado; conferir na tabela da kie.ai
};
const MARK = '[[WHATSAPP]]';
// pedido explícito de atendimento humano ou de como contratar/seguir, nos 4 idiomas (termos soltos como "equipe" ou
// "pessoa" disparavam encaminhamento por engano)
const HUMAN = /(falar|conversar) com (uma pessoa|algu[eé]m|um humano|um atendente|um consultor|o time|a equipe|a equipa|voc[eê]s)|atendimento humano|quero contratar|como (fa[cç]o|posso) (pra|para) (contratar|seguir|fechar|come[cç]ar)|(talk|speak|chat) (to|with) (a (person|human|real person)|someone|your team|the team|sales)|how (do|can) i (hire|sign up|get started)|hablar con (una persona|alguien|un humano|un asesor|el equipo|ustedes)|c[oó]mo (contrato|puedo contratar|empiezo)/i;

// a resposta convida para o WhatsApp do time (e não só fala de WhatsApp como canal de venda do cliente)
const INVITE = /(continuar|seguir|continue|sigue|segue|siga|falar|hablar|talk|chat)[^.?!]{0,40}(no|pelo|en el|por|on|via) whats\s?app|bot[ãa]o|button|bot[óo]n/i;

const LABEL: Record<Lang, { lead: string; cap: string; error: string; end: string }> = {
  br: { lead: 'Olá! Vim pelo site da Makewell (conversa com a Maia).', cap: 'Nosso chat está com muita procura agora. Fale direto com o time pelo WhatsApp, que respondemos rapidinho.', error: 'Tive um problema para responder agora. Pode falar direto com o time pelo WhatsApp?', end: 'Já conversamos bastante por aqui! Para seguir, o melhor é falar com o time pelo WhatsApp.' },
  en: { lead: 'Hi! I came from the Makewell website (chat with Maia).', cap: 'Our chat is very busy right now. Please reach the team directly on WhatsApp.', error: "I couldn't reply just now. Could you reach the team directly on WhatsApp?", end: "We've covered a lot here! The best next step is to talk to the team on WhatsApp." },
  es: { lead: '¡Hola! Vengo del sitio de Makewell (conversación con Maia).', cap: 'Nuestro chat tiene mucha demanda ahora. Habla directo con el equipo por WhatsApp.', error: 'Tuve un problema para responder. ¿Puedes hablar directo con el equipo por WhatsApp?', end: '¡Ya conversamos bastante! Lo mejor ahora es hablar con el equipo por WhatsApp.' },
  pt: { lead: 'Olá! Vim pelo site da Makewell (conversa com a Maia).', cap: 'O nosso chat está com muita procura. Fale diretamente com a equipa pelo WhatsApp.', error: 'Tive um problema a responder. Pode falar diretamente com a equipa pelo WhatsApp?', end: 'Já conversámos bastante! O melhor agora é falar com a equipa pelo WhatsApp.' },
};

const today = () => new Date().toISOString().slice(0, 10);
const cors = (origin: string): Record<string, string> =>
  origin ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', vary: 'origin' } : {};
const json = (body: unknown, status: number, origin: string) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors(origin) } });
const waLink = (env: Env, text: string) => `https://wa.me/${env.WHATSAPP}?text=${encodeURIComponent(text)}`;

// Cotação PTAX do Banco Central (venda), guardada por 12h; volta pelo último dia útil se hoje não houver
async function fx(env: Env): Promise<string> {
  const cached = await env.CHAT.get('fx');
  if (cached) return cached;
  const rates: string[] = [];
  for (const cur of ['USD', 'EUR']) {
    for (let back = 0; back < 7; back++) {
      const d = new Date(Date.now() - back * 864e5);
      const ds = `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}-${d.getUTCFullYear()}`;
      const url = `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoMoedaDia(moeda=@moeda,dataCotacao=@dataCotacao)?@moeda='${cur}'&@dataCotacao='${ds}'&$format=json`;
      const r = (await fetch(url, { signal: AbortSignal.timeout(3000) }).then((x) => (x.ok ? x.json() : null)).catch(() => null)) as { value?: { cotacaoVenda: number }[] } | null;
      const v = r?.value?.at(-1)?.cotacaoVenda;
      if (v) { rates.push(`1 ${cur} ≈ R$ ${v.toFixed(2)}`); break; }
    }
  }
  const out = rates.length ? `${rates.join('; ')} (PTAX do Banco Central)` : 'cotação indisponível agora: não converta, dê só o valor em reais';
  await env.CHAT.put('fx', out, { expirationTtl: rates.length ? 60 * 60 * 12 : 600 });
  return out;
}

// Gasto do dia no D1, com soma atômica (o KV aceita uma gravação por segundo na mesma chave e perdia incrementos).
// Falha aqui nunca derruba a conversa
async function spentToday(env: Env): Promise<number> {
  return (await env.DB.prepare('SELECT usd FROM spend WHERE day = ?').bind(today()).first<number>('usd').catch(() => 0)) ?? 0;
}
async function addSpend(env: Env, usd: number) {
  await env.DB.prepare('INSERT INTO spend (day, usd) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET usd = usd + excluded.usd')
    .bind(today(), usd).run().catch((e) => console.error('[maia] spend', String(e)));
}

// Uma chamada ao modelo pela kie.ai, sempre em streaming (SSE): o texto chega aos pedaços em onDelta, para o site mostrar
// a resposta enquanto ela é escrita. MODEL escolhe o formato: "grok-*" (Responses), "claude-*" (mensagens da Anthropic)
// ou "gemini-*" (streamGenerateContent)
async function ask(env: Env, system: string, messages: Msg[], onDelta?: (d: string) => void): Promise<Reply> {
  const t0 = Date.now(); let tFirst = 0;
  const key = await env.KIE_API_KEY.get();
  const m = env.MODEL, kind = m.startsWith('claude') ? 'claude' : m.startsWith('gemini') ? 'gemini' : 'grok';
  const [url, body] = kind === 'claude'
    ? ['https://api.kie.ai/claude/v1/messages', { model: m, max_tokens: 1500, stream: true, system, messages }]
    : kind === 'gemini'
      ? [`https://api.kie.ai/gemini/v1/models/${m}:streamGenerateContent`, { stream: true, systemInstruction: { parts: [{ text: system }] },
          contents: messages.map((x) => ({ role: x.role === 'assistant' ? 'model' : 'user', parts: [{ text: x.content }] })),
          generationConfig: { maxOutputTokens: 1500, thinkingConfig: { thinkingLevel: 'low' } } }]
      : ['https://api.kie.ai/grok/v1/responses', { model: m, stream: true, reasoning: { effort: 'low' }, max_output_tokens: 1500, input: [{ role: 'system', content: system }, ...messages] }];
  const r = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(40_000) })
    .catch((e) => (console.error('[maia] fetch', String(e)), null));
  const tHead = Date.now() - t0;
  // erro da kie.ai vem como JSON (às vezes com HTTP 200 e "code"), não como SSE
  if (!r?.ok || !r.body || !(r.headers.get('content-type') ?? '').includes('event-stream')) {
    return { ok: false, error: `HTTP ${r?.status} ${(await r?.text().catch(() => ''))?.slice(0, 300)}` };
  }
  let text = '', inTok = 0, outTok = 0, buf = '', err = '';
  const handle = (o: any) => {
    let d = '';
    if (o.error) err = JSON.stringify(o.error).slice(0, 300);
    if (kind === 'grok') {
      if (o.type === 'response.output_text.delta') d = o.delta ?? '';
      if (o.type === 'response.completed') { inTok = o.response?.usage?.input_tokens ?? 0; outTok = o.response?.usage?.output_tokens ?? 0; }
    } else if (kind === 'claude') {
      if (o.type === 'content_block_delta' && o.delta?.type === 'text_delta') d = o.delta.text ?? '';
      if (o.type === 'message_start') { const u = o.message?.usage ?? {}; inTok = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) * 0.1 + (u.cache_creation_input_tokens ?? 0) * 1.25; }
      if (o.type === 'message_delta') outTok = o.usage?.output_tokens ?? outTok;
    } else {
      for (const part of o.candidates?.[0]?.content?.parts ?? []) if (!part.thought) d += part.text ?? '';
      if (o.usageMetadata) { inTok = o.usageMetadata.promptTokenCount ?? 0; outTok = (o.usageMetadata.candidatesTokenCount ?? 0) + (o.usageMetadata.thoughtsTokenCount ?? 0); }
    }
    if (d) { if (!tFirst) tFirst = Date.now() - t0; text += d; onDelta?.(d); }
  };
  try {
    const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const data = buf.slice(0, i).split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
        buf = buf.slice(i + 2);
        if (data && data !== '[DONE]') { try { handle(JSON.parse(data)); } catch { /* evento incompleto ou de controle */ } }
      }
    }
  } catch (e) { err ||= String(e); }
  console.log('[maia] tempo', m, 'cabeçalho', tHead, 'ms, 1º texto', tFirst, 'ms, fim', Date.now() - t0, 'ms');
  if (err && !text) return { ok: false, error: err };
  if (!text.trim()) return { ok: false, error: 'resposta vazia' };
  // sem o evento de uso no fim do streaming, estima pelo tamanho (~3,5 caracteres por token): nunca registra custo zero,
  // senão o teto diário de gasto deixaria de proteger
  if (!inTok && !outTok) {
    console.error('[maia] uso não veio; custo estimado');
    inTok = (system.length + messages.reduce((n, x) => n + x.content.length, 0)) / 3.5; outTok = text.length / 3.5;
  }
  const p = PRICE[m] ?? PRICE['claude-opus-5-5'];
  return { ok: true, text: text.trim(), usd: (inTok * p.input + outTok * p.output) / 1e6 };
}

// Anti-robô (Turnstile). O widget roda numa página deste endereço, embutida no chat (o makewell.com.br não pode entrar na
// lista de hosts do widget): ela devolve o token ao site por postMessage, só para a origem permitida. O token é exigido
// na primeira mensagem de cada conversa e conferido aqui, inclusive o host em que foi emitido
const verifyPage = (siteKey: string, parent: string) => new Response(`<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex">
<style>html,body{margin:0;background:transparent}</style><div id="t"></div><script>
var O=${JSON.stringify(parent)},post=function(m){parent.postMessage(m,O)};
window.onTs=function(){turnstile.render('#t',{sitekey:${JSON.stringify(siteKey)},appearance:'interaction-only',
callback:function(k){post({mwToken:k})},'before-interactive-callback':function(){post({mwShow:true})},
'after-interactive-callback':function(){post({mwShow:false})},'expired-callback':function(){turnstile.reset()},
'error-callback':function(){post({mwFail:true})},'unsupported-callback':function(){post({mwFail:true})}})};
</script><script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTs&render=explicit" async defer onerror="post({mwFail:true})"></script>`,
  { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': `frame-ancestors ${parent}`, 'cache-control': 'no-store' } });

async function human(env: Env, token: string, ip: string): Promise<boolean> {
  // bloqueia por padrão: só deixa passar sem verificação quando TURNSTILE_ENFORCE for exatamente "0" (fase de observação).
  // Token ausente ou recusado bloqueia; falha da própria Cloudflare (cofre ou siteverify fora do ar) libera, com log,
  // para uma queda deles não tirar o chat do ar (os limites de requisição e de gasto continuam valendo)
  const observeOnly = env.TURNSTILE_ENFORCE === '0';
  if (!token) { console.log('[maia] turnstile sem token'); return observeOnly; }
  let secret: string;
  try { secret = await env.TURNSTILE_SECRET!.get(); } catch (e) { console.error('[maia] turnstile cofre', String(e)); return true; }
  const form = new FormData();
  form.append('secret', secret); form.append('response', token.slice(0, 2048)); form.append('remoteip', ip);
  const r = (await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form, signal: AbortSignal.timeout(8000) })
    .then((x) => x.json()).catch(() => null)) as { success?: boolean; hostname?: string } | null;
  if (!r) { console.error('[maia] turnstile siteverify indisponível'); return true; }
  const ok = !!r.success && r.hostname === 'chat.makewell.agency';
  console.log('[maia] turnstile', ok ? 'ok' : 'falhou', token ? '' : '(sem token)', JSON.stringify(r)?.slice(0, 200));
  return ok || observeOnly;
}

// Separa a resposta visível da linha [[WHATSAPP]] {json} (que nunca aparece para o visitante)
function splitHandoff(text: string): { reply: string; lead?: Record<string, string> } {
  const i = text.indexOf(MARK);
  if (i < 0) return { reply: text };
  return { reply: text.slice(0, i).trim(), lead: parseLead(text.slice(i + MARK.length)) ?? {} }; // ilegível: botão só com a saudação
}
function parseLead(raw: string): Record<string, string> | undefined {
  try {
    const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as Record<string, unknown>;
    const lead: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === 'string') lead[k] = v.slice(0, 300);
    return lead;
  } catch { return undefined; }
}

export default {
  async scheduled(_: ScheduledController, env: Env) { await purge(env); },
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const tReq = Date.now();
    const url = new URL(req.url);
    const reqOrigin = req.headers.get('origin') ?? '';
    const origin = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).includes(reqOrigin) ? reqOrigin : '';
    if (req.method === 'OPTIONS') return new Response(null, { status: origin ? 204 : 403, headers: cors(origin) });
    if (url.pathname === '/health') return new Response('ok');
    if (url.pathname === '/verify') {
      const parent = url.searchParams.get('o') ?? '';
      return env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).includes(parent) ? verifyPage(env.TURNSTILE_SITEKEY, parent) : new Response('forbidden', { status: 403 });
    }
    if (url.pathname === '/leads' || url.pathname.startsWith('/leads/')) return panel(req, env);
    if (url.pathname !== '/chat' || req.method !== 'POST') return new Response('not found', { status: 404 });
    if (!origin) return new Response('forbidden', { status: 403 });

    const body = (await req.json().catch(() => null)) as { sid?: string; lang?: string; text?: string; page?: string; ts?: string; stream?: boolean } | null;
    const lang = (['br', 'en', 'es', 'pt'].includes(body?.lang ?? '') ? body!.lang : 'br') as Lang;
    const text = (body?.text ?? '').trim();
    if (!text || text.length > MAX_TEXT) return json({ error: 'invalid' }, 400, origin);
    const ip = req.headers.get('cf-connecting-ip') ?? 'anon';
    if (!(await env.RL.limit({ key: ip })).success) return json({ error: 'rate' }, 429, origin);

    const L = LABEL[lang];
    const fallback = (reply: string) => json({ reply, whatsapp: waLink(env, L.lead) }, 200, origin);
    if (!(await env.RL_GLOBAL.limit({ key: 'all' })).success || (await spentToday(env)) >= Number(env.DAILY_CAP_USD)) return fallback(L.cap);

    const sid = /^[a-zA-Z0-9-]{16,64}$/.test(body?.sid ?? '') ? body!.sid! : crypto.randomUUID();
    const saved = await env.CHAT.get<Conv>(`conv:${sid}`, 'json');
    // conversa nova só começa com o token do anti-robô
    if (!saved && !(await human(env, String(body?.ts ?? ''), ip))) return json({ error: 'verify', reply: L.error, whatsapp: waLink(env, L.lead) }, 403, origin);
    const conv: Conv = saved ?? { lang, created: new Date().toISOString(), page: String(body?.page ?? '').slice(0, 200), messages: [] };
    if (conv.messages.length >= MAX_TURNS * 2) return fallback(L.end);
    conv.messages.push({ role: 'user', content: text });

    console.log('[maia] tempo antes do modelo', Date.now() - tReq, 'ms');
    const system = `${SYSTEM}\n\n# Contexto da conversa\nIdioma: ${lang}\nData de hoje: ${today()}\nCotação de referência: ${await fx(env)}`;

    // O trabalho é o mesmo nos dois modos; no streaming, cada pedaço visível vai ao site assim que chega. A linha
    // [[WHATSAPP]] {json} nunca sai: o texto é enviado só até um "[[" (e um "[" solto no fim fica retido até o próximo pedaço)
    const work = async (emit?: (d: string) => void) => {
      let full = '', sent = 0;
      const onDelta = emit && ((d: string) => {
        full += d;
        const cut = full.indexOf('[[');
        const safe = cut >= 0 ? cut : full.endsWith('[') ? full.length - 1 : full.length;
        if (safe > sent) { emit(full.slice(sent, safe)); sent = safe; }
      });
      // uma nova tentativa cobre as falhas passageiras da kie.ai, desde que nada tenha sido mostrado ainda
      let r = await ask(env, system, conv.messages, onDelta);
      if (!r.ok && !sent) { console.error('[maia] kie', r.error); full = ''; r = await ask(env, system, conv.messages, onDelta); }
      if (!r.ok) { console.error('[maia] kie (2ª)', r.error); return { reply: L.error, whatsapp: waLink(env, L.lead) }; }
      ctx.waitUntil(addSpend(env, r.usd));
      return finish(r.text);
    };
    const finish = async (out: string) => {
      let { reply, lead } = splitHandoff(out);
      // o modelo às vezes convida para o WhatsApp sem a linha do resumo: se a pessoa pediu atendimento ou a resposta convida
      // para o WhatsApp do time, pede só o resumo numa chamada à parte (sem isso o botão não aparece)
      if (!lead && !conv.handoff && (HUMAN.test(text) || INVITE.test(reply))) {
        const ex = await ask(env, `${SYSTEM}\n\n# Tarefa agora\nNão responda à pessoa. Escreva apenas a linha ${MARK} com o JSON do resumo desta conversa.`, [...conv.messages, { role: 'assistant', content: reply }, { role: 'user', content: '(sistema: gere o resumo)' }]);
        // o modelo às vezes devolve só o JSON, sem a marcação
        if (ex.ok) { ctx.waitUntil(addSpend(env, ex.usd)); lead = splitHandoff(ex.text).lead ?? parseLead(ex.text); }
        if (!lead) console.error('[maia] resumo não veio', ex.ok ? ex.text.slice(0, 200) : ex.error);
      }
      let whatsapp: string | undefined;
      if (lead) {
        // O visitante leva só a saudação e uma referência (gerada aqui: o sid vem do navegador); o resumo e a avaliação da
        // IA ficam no D1. Um lead por conversa: um novo encaminhamento atualiza o mesmo. O time é avisado uma vez, e só
        // quando a conversa tem pelo menos 2 mensagens e um nome ou empresa (corta disparo automatizado de uma linha só)
        const ref = (conv.ref ??= crypto.randomUUID().slice(0, 8).toUpperCase());
        const real = conv.messages.filter((m) => m.role === 'user').length >= 2 && !!(lead.nome?.trim() || lead.empresa?.trim());
        const notify = real && !conv.notified;
        if (notify) conv.notified = true;
        conv.handoff = true; conv.lead = lead;
        whatsapp = waLink(env, `${L.lead} Ref. ${ref}`);
        ctx.waitUntil(saveLead(env, { ref, sid, lang, pagina: conv.page ?? '', lead }, notify).catch((e) => console.error('[leads] save', String(e))));
      }
      // no histórico fica só o que o visitante viu (e uma nota quando houve encaminhamento)
      conv.messages.push({ role: 'assistant', content: reply + (lead ? '\n\n(Encaminhado ao WhatsApp do time.)' : '') });
      await env.CHAT.put(`conv:${sid}`, JSON.stringify(conv), { expirationTtl: TTL });
      return { sid, reply: reply || (whatsapp ? '' : L.error), whatsapp };
    };

    if (!body?.stream) return json(await work(), 200, origin);
    // streaming: uma linha JSON por evento ({"d": pedaço} e, no fim, {"done": true, ...resposta final})
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const w = writable.getWriter(), enc = new TextEncoder();
    const line = (o: unknown) => w.write(enc.encode(JSON.stringify(o) + '\n')).catch(() => {});
    ctx.waitUntil((async () => {
      const out = await work((d) => { line({ d }); }).catch((e) => (console.error('[maia] stream', String(e)), { reply: L.error, whatsapp: waLink(env, L.lead) }));
      await line({ done: true, ...out });
      await w.close().catch(() => {});
    })());
    return new Response(readable, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', ...cors(origin) } });
  },
};
