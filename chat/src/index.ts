// Chat de vendas do site da Makewell (chat.makewell.agency). O navegador manda só { sid, lang, text }; a conversa fica
// guardada aqui (KV, 90 dias), então ninguém consegue forjar o histórico. O modelo é o Claude pela kie.ai (mesma chave
// do MakeWorks), no formato de mensagens da Anthropic. Proteções: origem permitida, limite por IP, teto de gasto diário,
// tamanho da mensagem e número de turnos por conversa.
import { HANDOFF_TOOL, SYSTEM } from './prompt';

export interface Env {
  KIE_API_KEY: { get(): Promise<string> };  // Secrets Store da conta
  CHAT: KVNamespace;
  RL: { limit(o: { key: string }): Promise<{ success: boolean }> };
  MODEL: string;
  DAILY_CAP_USD: string;
  ALLOWED_ORIGINS: string;
  WHATSAPP: string;
}

type Lang = 'br' | 'en' | 'es' | 'pt';
type Block = { type: string; [k: string]: unknown };
type Msg = { role: 'user' | 'assistant'; content: string | Block[] };
type Conv = { lang: Lang; created: string; messages: Msg[]; handoff?: boolean };

const TTL = 60 * 60 * 24 * 90; // 90 dias, como diz a política de privacidade
const MAX_TURNS = 30;
const MAX_TEXT = 1200;
// Preço da kie.ai para o Claude Opus 5.5 (US$ por 1M de tokens; a entrada tem o mesmo desconto da saída)
const PRICE = { input: 1.6, output: 8, cacheRead: 0.16, cacheWrite: 2 };

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
const json = (body: unknown, status: number, origin: string) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors(origin) } });
const cors = (origin: string): Record<string, string> =>
  origin ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', vary: 'origin' } : {};
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
      const r = await fetch(url).then((x) => (x.ok ? x.json() : null)).catch(() => null) as { value?: { cotacaoVenda: number }[] } | null;
      const v = r?.value?.at(-1)?.cotacaoVenda;
      if (v) { rates.push(`1 ${cur} ≈ R$ ${v.toFixed(2)}`); break; }
    }
  }
  const out = rates.length ? `${rates.join('; ')} (PTAX do Banco Central)` : 'cotação indisponível agora: não converta, dê só o valor em reais';
  await env.CHAT.put('fx', out, { expirationTtl: 60 * 60 * 12 });
  return out;
}

async function spend(env: Env, usd?: number): Promise<number> {
  const k = `spend:${today()}`;
  const cur = Number((await env.CHAT.get(k)) ?? 0);
  if (usd) await env.CHAT.put(k, String(cur + usd), { expirationTtl: 60 * 60 * 48 });
  return cur + (usd ?? 0);
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
    if ((await spend(env)) >= Number(env.DAILY_CAP_USD)) return fallback(L.cap);

    const sid = /^[a-zA-Z0-9-]{16,64}$/.test(body?.sid ?? '') ? body!.sid! : crypto.randomUUID();
    const conv: Conv = (await env.CHAT.get<Conv>(`conv:${sid}`, 'json')) ?? { lang, created: new Date().toISOString(), messages: [] };
    if (conv.messages.length >= MAX_TURNS * 2) return fallback(L.end);
    conv.messages.push({ role: 'user', content: text });

    const context = `# Contexto da conversa\nIdioma: ${lang}\nData de hoje: ${today()}\nCotação de referência: ${await fx(env)}`;
    const upstream = await fetch('https://api.kie.ai/claude/v1/messages', {
      method: 'POST',
      headers: { authorization: `Bearer ${await env.KIE_API_KEY.get()}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: env.MODEL,
        max_tokens: 4000,
        output_config: { effort: 'low' },
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }, { type: 'text', text: context }],
        tools: [HANDOFF_TOOL],
        messages: conv.messages,
      }),
      signal: AbortSignal.timeout(60_000),
    }).catch((e) => (console.error('[chat] fetch', e), null));
    const r = (await upstream?.json().catch(() => null)) as { content?: Block[]; stop_reason?: string; usage?: Record<string, number>; error?: unknown; code?: number; msg?: string } | null;
    if (!upstream?.ok || !r?.content) {
      console.error('[chat] kie', upstream?.status, JSON.stringify(r)?.slice(0, 500));
      return fallback(L.error);
    }

    const u = r.usage ?? {};
    await spend(env, ((u.input_tokens ?? 0) * PRICE.input + (u.output_tokens ?? 0) * PRICE.output
      + (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead + (u.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite) / 1e6);

    const reply = r.content.filter((b) => b.type === 'text').map((b) => b.text as string).join('\n').trim();
    const tool = r.content.find((b) => b.type === 'tool_use' && b.name === HANDOFF_TOOL.name) as (Block & { id: string; input: Record<string, string> }) | undefined;
    conv.messages.push({ role: 'assistant', content: r.content });
    let whatsapp: string | undefined;
    if (tool) {
      // o histórico precisa da resposta da ferramenta para a próxima mensagem ser válida (sem nova chamada ao modelo)
      conv.messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: tool.id, content: 'Botão do WhatsApp exibido ao visitante.' }] });
      conv.handoff = true;
      const i = tool.input ?? {};
      const lines = FIELDS.filter(([k]) => i[k]?.trim()).map(([k, lab]) => `${lab[lang]}: ${i[k].trim()}`);
      whatsapp = waLink(env, [L.lead, ...lines, `Idioma: ${lang.toUpperCase()}`, `Avaliação da IA: ${(i.avaliacao ?? '').toUpperCase()}`].join('\n'));
    }
    await env.CHAT.put(`conv:${sid}`, JSON.stringify(conv), { expirationTtl: TTL });
    return json({ sid, reply: reply || (whatsapp ? '' : L.error), whatsapp }, 200, origin);
  },
};
