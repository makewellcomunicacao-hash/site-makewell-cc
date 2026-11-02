// Maia, o chat de vendas do site da Makewell (chat.makewell.agency). O navegador manda só { sid, lang, text }; a conversa
// fica guardada aqui (KV, 90 dias), então ninguém consegue forjar o histórico. O modelo roda pela kie.ai, como no MakeWorks
// (mesma chave, no Secrets Store da conta): MODEL "grok-4-7" usa o formato Responses (/grok/v1/responses) e um modelo
// "claude-*" usa o formato de mensagens da Anthropic (/claude/v1/messages). O resumo do lead vem numa linha
// "[[WHATSAPP]] {json}" no fim da resposta (ver prompt.ts), que sai daqui como o link do WhatsApp.
// Proteções: origem permitida, limite por IP e limite global por minuto (este último deixa o gasto máximo previsível,
// já que o contador diário no KV não é atômico), teto de gasto diário, tamanho da mensagem e turnos por conversa.
import { SYSTEM } from './prompt';

type Limiter = { limit(o: { key: string }): Promise<{ success: boolean }> };
export interface Env {
  KIE_API_KEY: { get(): Promise<string> }; // Secrets Store da conta
  CHAT: KVNamespace;
  RL: Limiter;
  RL_GLOBAL: Limiter;
  MODEL: string;
  DAILY_CAP_USD: string;
  ALLOWED_ORIGINS: string;
  WHATSAPP: string;
}

type Lang = 'br' | 'en' | 'es' | 'pt';
type Msg = { role: 'user' | 'assistant'; content: string };
type Conv = { lang: Lang; created: string; messages: Msg[]; handoff?: boolean };
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
};
const MARK = '[[WHATSAPP]]';

const LABEL: Record<Lang, { lead: string; cap: string; error: string; end: string }> = {
  br: { lead: 'Olá! Vim pelo site da Makewell (conversa com a Maia).', cap: 'Nosso chat está com muita procura agora. Fale direto com o time pelo WhatsApp, que respondemos rapidinho.', error: 'Tive um problema para responder agora. Pode falar direto com o time pelo WhatsApp?', end: 'Já conversamos bastante por aqui! Para seguir, o melhor é falar com o time pelo WhatsApp.' },
  en: { lead: 'Hi! I came from the Makewell website (chat with Maia).', cap: 'Our chat is very busy right now. Please reach the team directly on WhatsApp.', error: "I couldn't reply just now. Could you reach the team directly on WhatsApp?", end: "We've covered a lot here! The best next step is to talk to the team on WhatsApp." },
  es: { lead: '¡Hola! Vengo del sitio de Makewell (conversación con Maia).', cap: 'Nuestro chat tiene mucha demanda ahora. Habla directo con el equipo por WhatsApp.', error: 'Tuve un problema para responder. ¿Puedes hablar directo con el equipo por WhatsApp?', end: '¡Ya conversamos bastante! Lo mejor ahora es hablar con el equipo por WhatsApp.' },
  pt: { lead: 'Olá! Vim pelo site da Makewell (conversa com a Maia).', cap: 'O nosso chat está com muita procura. Fale diretamente com a equipa pelo WhatsApp.', error: 'Tive um problema a responder. Pode falar diretamente com a equipa pelo WhatsApp?', end: 'Já conversámos bastante! O melhor agora é falar com a equipa pelo WhatsApp.' },
};
const FIELDS: [string, Record<Lang, string>][] = [
  ['nome', { br: 'Nome', en: 'Name', es: 'Nombre', pt: 'Nome' }], ['empresa', { br: 'Empresa', en: 'Company', es: 'Empresa', pt: 'Empresa' }],
  ['segmento', { br: 'Segmento', en: 'Segment', es: 'Segmento', pt: 'Segmento' }], ['local', { br: 'Local', en: 'Location', es: 'Ubicación', pt: 'Local' }],
  ['objetivo', { br: 'Objetivo', en: 'Goal', es: 'Objetivo', pt: 'Objetivo' }], ['situacao', { br: 'Hoje', en: 'Today', es: 'Hoy', pt: 'Hoje' }],
  ['investimento', { br: 'Investimento', en: 'Budget', es: 'Inversión', pt: 'Investimento' }], ['urgencia', { br: 'Urgência', en: 'Timing', es: 'Urgencia', pt: 'Urgência' }],
  ['decisor', { br: 'Decide', en: 'Decision maker', es: 'Decide', pt: 'Decide' }], ['interesse', { br: 'Interesse', en: 'Interest', es: 'Interés', pt: 'Interesse' }],
];

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
      const r = (await fetch(url).then((x) => (x.ok ? x.json() : null)).catch(() => null)) as { value?: { cotacaoVenda: number }[] } | null;
      const v = r?.value?.at(-1)?.cotacaoVenda;
      if (v) { rates.push(`1 ${cur} ≈ R$ ${v.toFixed(2)}`); break; }
    }
  }
  const out = rates.length ? `${rates.join('; ')} (PTAX do Banco Central)` : 'cotação indisponível agora: não converta, dê só o valor em reais';
  await env.CHAT.put('fx', out, { expirationTtl: 60 * 60 * 12 });
  return out;
}

// Gasto do dia (aproximado: o KV não é atômico; o limite global por minuto é o que segura o pior caso)
async function spend(env: Env, usd?: number): Promise<number> {
  const k = `spend:${today()}`;
  const cur = Number((await env.CHAT.get(k)) ?? 0);
  if (usd) await env.CHAT.put(k, String(cur + usd), { expirationTtl: 60 * 60 * 48 });
  return cur + (usd ?? 0);
}

// Uma chamada ao modelo pela kie.ai (sem streaming, como no MakeWorks)
async function ask(env: Env, system: string, messages: Msg[]): Promise<Reply> {
  const key = await env.KIE_API_KEY.get();
  const claude = env.MODEL.startsWith('claude');
  const [url, body] = claude
    ? ['https://api.kie.ai/claude/v1/messages', { model: env.MODEL, max_tokens: 2000, stream: false, system, messages }]
    : ['https://api.kie.ai/grok/v1/responses', { model: env.MODEL, stream: false, reasoning: { effort: 'low' }, input: [{ role: 'system', content: system }, ...messages] }];
  const r = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) })
    .catch((e) => (console.error('[maia] fetch', String(e)), null));
  const j = (await r?.json().catch(() => null)) as Record<string, unknown> | null;
  if (!r?.ok || !j || (typeof j.code === 'number' && j.code !== 200)) {
    return { ok: false, error: `HTTP ${r?.status} ${JSON.stringify(j)?.slice(0, 300)}` };
  }
  const u = (j.usage ?? {}) as Record<string, number>;
  const p = PRICE[env.MODEL] ?? PRICE['claude-opus-5-5'];
  const usd = ((u.input_tokens ?? 0) * p.input + (u.output_tokens ?? 0) * p.output) / 1e6;
  const text = claude
    ? ((j.content as { type: string; text?: string }[] | undefined) ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
    : ((j.output as { type: string; content?: { type: string; text?: string }[] }[] | undefined) ?? [])
        .filter((o) => o.type === 'message').flatMap((o) => o.content ?? []).filter((x) => x.type === 'output_text').map((x) => x.text ?? '').join('');
  return { ok: true, text: text.trim(), usd };
}

// Separa a resposta visível da linha [[WHATSAPP]] {json} (que nunca aparece para o visitante)
function splitHandoff(text: string): { reply: string; lead?: Record<string, string> } {
  const i = text.indexOf(MARK);
  if (i < 0) return { reply: text };
  const reply = text.slice(0, i).trim();
  const raw = text.slice(i + MARK.length);
  const lead: Record<string, string> = {};
  try {
    const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as Record<string, unknown>;
    for (const [k, v] of Object.entries(parsed)) if (typeof v === 'string') lead[k] = v.slice(0, 300);
  } catch { /* resumo ilegível: o botão sai mesmo assim, só com a saudação */ }
  return { reply, lead };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const reqOrigin = req.headers.get('origin') ?? '';
    const origin = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).includes(reqOrigin) ? reqOrigin : '';
    if (req.method === 'OPTIONS') return new Response(null, { status: origin ? 204 : 403, headers: cors(origin) });
    if (url.pathname === '/health') return new Response('ok');
    if (url.pathname !== '/chat' || req.method !== 'POST') return new Response('not found', { status: 404 });
    if (!origin) return new Response('forbidden', { status: 403 });

    const body = (await req.json().catch(() => null)) as { sid?: string; lang?: string; text?: string } | null;
    const lang = (['br', 'en', 'es', 'pt'].includes(body?.lang ?? '') ? body!.lang : 'br') as Lang;
    const text = (body?.text ?? '').trim();
    if (!text || text.length > MAX_TEXT) return json({ error: 'invalid' }, 400, origin);
    const ip = req.headers.get('cf-connecting-ip') ?? 'anon';
    if (!(await env.RL.limit({ key: ip })).success) return json({ error: 'rate' }, 429, origin);

    const L = LABEL[lang];
    const fallback = (reply: string) => json({ reply, whatsapp: waLink(env, L.lead) }, 200, origin);
    if (!(await env.RL_GLOBAL.limit({ key: 'all' })).success || (await spend(env)) >= Number(env.DAILY_CAP_USD)) return fallback(L.cap);

    const sid = /^[a-zA-Z0-9-]{16,64}$/.test(body?.sid ?? '') ? body!.sid! : crypto.randomUUID();
    const conv: Conv = (await env.CHAT.get<Conv>(`conv:${sid}`, 'json')) ?? { lang, created: new Date().toISOString(), messages: [] };
    if (conv.messages.length >= MAX_TURNS * 2) return fallback(L.end);
    conv.messages.push({ role: 'user', content: text });

    const system = `${SYSTEM}\n\n# Contexto da conversa\nIdioma: ${lang}\nData de hoje: ${today()}\nCotação de referência: ${await fx(env)}`;
    const r = await ask(env, system, conv.messages);
    if (!r.ok) { console.error('[maia] kie', r.error); return fallback(L.error); }
    await spend(env, r.usd);

    const { reply, lead } = splitHandoff(r.text);
    let whatsapp: string | undefined;
    if (lead) {
      conv.handoff = true;
      const lines = FIELDS.filter(([k]) => lead[k]?.trim()).map(([k, lab]) => `${lab[lang]}: ${lead[k].trim()}`);
      const rating = ['quente', 'morno', 'frio'].includes(lead.avaliacao) ? lead.avaliacao.toUpperCase() : '';
      whatsapp = waLink(env, [L.lead, ...lines, `Idioma: ${lang.toUpperCase()}`, ...(rating ? [`Avaliação da IA: ${rating}`] : [])].join('\n'));
    }
    // no histórico fica só o que o visitante viu (e uma nota quando houve encaminhamento)
    conv.messages.push({ role: 'assistant', content: reply + (lead ? '\n\n(Encaminhado ao WhatsApp do time.)' : '') });
    await env.CHAT.put(`conv:${sid}`, JSON.stringify(conv), { expirationTtl: TTL });
    return json({ sid, reply: reply || (whatsapp ? '' : L.error), whatsapp }, 200, origin);
  },
};
