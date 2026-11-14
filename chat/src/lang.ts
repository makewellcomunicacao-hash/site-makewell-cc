// Palpite do idioma de quem escreve, só para as mensagens fixas (erro, chat cheio, fim, saudação do WhatsApp). A IA já
// responde na língua da pessoa; isto evita que o texto fixo saia em outra. Sem sinal claro, fica o idioma do site.
type Lang = 'br' | 'en' | 'es' | 'pt';
const word = (list: string) => new RegExp(`(?<!\\p{L})(${list})(?!\\p{L})`, 'u');
const ES = word('hola|quiero|tengo|necesito|cómo|qué|gracias|tienda|empresa mía|mi empresa|clientes nuevos|usted|vosotros');
const EN = word("hi|hello|the|and|my|want|need|business|company|how|what|thanks|i'm|i am|we are|our");
const PT = word('olá|oi|quero|tenho|preciso|negócio|obrigad[oa]|você|vocês|não|meu|minha|nosso|nossa|gostaria|estou|também|clínica|loja');

// null = sem sinal claro (ex.: "ok", "10 mil"): quem chama usa o idioma do site e tenta de novo na próxima mensagem.
// Português segue a variante do site (Portugal só no site pt)
export function guessLang(text: string, site: Lang): Lang | null {
  const s = text.toLowerCase();
  if (/[¿¡ñ]/.test(s) || ES.test(s)) return 'es';
  if (PT.test(s) || /[ãõç]/.test(s)) return site === 'pt' ? 'pt' : 'br';
  if (EN.test(s)) return 'en';
  return null;
}
