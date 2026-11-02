// Registro único de páginas, idiomas e textos fixos (menu, rodapé). Rotas idênticas às do site estático.
export type Lang = 'br' | 'en' | 'es' | 'pt';
export type PageKey = 'home' | 'about' | 'services' | 'framework' | 'method' | 'cases' | 'casaHunter' | 'howWeCreate' | 'privacy' | 'terms';

export const ORIGIN = { br: 'https://makewell.com.br', agency: 'https://makewell.agency' } as const;

const BR_PATH: Record<PageKey, string> = {
  home: '/', about: '/sobre/', services: '/servicos/', framework: '/framework/', method: '/metodo/', cases: '/cases/',
  casaHunter: '/cases/casa-hunter-casa-dos-raros/', howWeCreate: '/como-criamos/', privacy: '/politica-de-privacidade/', terms: '/termos-de-uso/',
};
const INTL_SLUG: Record<PageKey, string> = {
  home: '', about: 'about/', services: 'services/', framework: 'framework/', method: 'method/', cases: 'cases/',
  casaHunter: 'cases/casa-hunter-casa-dos-raros/', howWeCreate: 'how-we-create/', privacy: 'privacy-policy/', terms: 'terms-of-use/',
};

/** Caminho da página no domínio do idioma (relativo ao domínio). */
export const path = (key: PageKey, lang: Lang) => (lang === 'br' ? BR_PATH[key] : `/${lang}/${INTL_SLUG[key]}`);
/** URL absoluta (para links entre os dois domínios). */
export const url = (key: PageKey, lang: Lang) => (lang === 'br' ? ORIGIN.br : ORIGIN.agency) + path(key, lang);

/** Rota do build ("sobre/", "en/about/", "") → página e idioma. */
export function fromRoute(route: string): { key: PageKey; lang: Lang } | null {
  const p = '/' + route;
  for (const key of Object.keys(BR_PATH) as PageKey[]) {
    if (BR_PATH[key] === p) return { key, lang: 'br' };
    for (const lang of ['en', 'es', 'pt'] as Lang[]) if (path(key, lang) === p) return { key, lang };
  }
  return null;
}

export const NAV_KEYS: PageKey[] = ['about', 'services', 'framework', 'method', 'cases'];

/** Textos fixos por idioma, copiados do site atual. */
export const UI: Record<Lang, {
  htmlLang: string; code: string; nav: string[]; navAria: string; logoAria: string; logoAlt: string;
  cta: string; ctaAria: string; ctaHref: string; langTrigger: string; langMenu: string; menuOpen: string; menuClose: string; mobileMenu: string; videoKicker: string; videoTitle: string; videoCta: string;
  skip: string; partners: string; copyright: string; legal: [string, string]; taxId: string; places: string;
}> = {
  br: {
    htmlLang: 'pt-BR', code: 'BR', nav: ['Sobre', 'Serviços', 'Framework', 'Método', 'Cases'], navAria: 'Menu principal',
    logoAria: 'Makewell Comunicação — página inicial', logoAlt: 'Makewell Comunicação',
    cta: 'Agendar diagnóstico', ctaAria: 'Agendar diagnóstico gratuito',
    ctaHref: 'https://wa.me/5582999103246?text=Ol%C3%A1!%20Quero%20agendar%20um%20diagn%C3%B3stico%20gratuito%20com%20a%20Makewell.',
    langTrigger: 'Mudar idioma', langMenu: 'Selecionar idioma', menuOpen: 'Abrir menu', menuClose: 'Fechar menu', mobileMenu: 'Menu mobile', videoKicker: 'Vídeo institucional · 40s', videoTitle: 'Conheça a Makewell em 40 segundos', videoCta: 'Assistir apresentação',
    skip: 'Pular para o conteúdo', partners: 'Parceiros &amp; Certificações Oficiais',
    copyright: '&copy; 2026 Makewell Comunicação. Todos os direitos reservados.', legal: ['Política de Privacidade', 'Termos de Uso'],
    taxId: 'CNPJ 27.238.877/0001-71', places: 'Maceió · São Paulo · makewell.com.br',
  },
  en: {
    htmlLang: 'en', code: 'EN', nav: ['About', 'Services', 'Framework', 'Method', 'Cases'], navAria: 'Main menu',
    logoAria: 'Makewell Communications — home', logoAlt: 'Makewell Communications',
    cta: 'Schedule a Diagnosis', ctaAria: 'Schedule a free diagnosis',
    ctaHref: 'https://wa.me/5582999103246?text=Hello!%20I%27d%20like%20to%20schedule%20a%20free%20diagnosis%20with%20Makewell.',
    langTrigger: 'Change language', langMenu: 'Select language', menuOpen: 'Open menu', menuClose: 'Close menu', mobileMenu: 'Mobile menu', videoKicker: 'Brand video · 40s', videoTitle: 'Meet Makewell in 40 seconds', videoCta: 'Watch the presentation',
    skip: 'Skip to content', partners: 'Official Partners &amp; Certifications',
    copyright: '&copy; 2026 Makewell Comunicação. All rights reserved.', legal: ['Privacy Policy', 'Terms of Use'],
    taxId: 'Tax ID (CNPJ): 27.238.877/0001-71', places: 'Brazil · Florida · makewell.agency',
  },
  es: {
    htmlLang: 'es', code: 'ES', nav: ['Nosotros', 'Servicios', 'Framework', 'Método', 'Casos'], navAria: 'Menú principal',
    logoAria: 'Makewell Comunicação — inicio', logoAlt: 'Makewell Comunicação',
    cta: 'Agendar Diagnóstico', ctaAria: 'Agendar un diagnóstico gratuito',
    ctaHref: 'https://wa.me/5582999103246?text=Hola!%20Quiero%20agendar%20un%20diagn%C3%B3stico%20gratuito%20con%20Makewell.',
    langTrigger: 'Cambiar idioma', langMenu: 'Seleccionar idioma', menuOpen: 'Abrir menú', menuClose: 'Cerrar menú', mobileMenu: 'Menú móvil', videoKicker: 'Video institucional · 40s', videoTitle: 'Conoce Makewell en 40 segundos', videoCta: 'Ver la presentación',
    skip: 'Saltar al contenido', partners: 'Socios y Certificaciones Oficiales',
    copyright: '&copy; 2026 Makewell Comunicação. Todos los derechos reservados.', legal: ['Política de Privacidad', 'Términos de Uso'],
    taxId: 'CNPJ: 27.238.877/0001-71', places: 'Brasil · España · Latinoamérica · makewell.agency',
  },
  pt: {
    htmlLang: 'pt-PT', code: 'PT', nav: ['Sobre', 'Serviços', 'Framework', 'Método', 'Cases'], navAria: 'Menu principal',
    logoAria: 'Makewell Comunicação — início', logoAlt: 'Makewell Comunicação',
    cta: 'Agendar Diagnóstico', ctaAria: 'Agendar um diagnóstico gratuito',
    ctaHref: 'https://wa.me/5582999103246?text=Ol%C3%A1!%20Quero%20agendar%20um%20diagn%C3%B3stico%20gratuito%20com%20a%20Makewell.',
    langTrigger: 'Mudar idioma', langMenu: 'Selecionar idioma', menuOpen: 'Abrir menu', menuClose: 'Fechar menu', mobileMenu: 'Menu mobile', videoKicker: 'Vídeo institucional · 40s', videoTitle: 'Conheça a Makewell em 40 segundos', videoCta: 'Ver a apresentação',
    skip: 'Saltar para o conteúdo', partners: 'Parceiros e Certificações Oficiais',
    copyright: '&copy; 2026 Makewell Comunicação. Todos os direitos reservados.', legal: ['Política de Privacidade', 'Termos de Uso'],
    taxId: 'NIF/CNPJ: 27.238.877/0001-71', places: 'Brasil · Portugal · makewell.agency',
  },
};
