# CLAUDE.md — Makewell Comunicação

Instruções e contexto para o assistente Codex neste projeto.

## Sobre o Projeto

Site institucional da **Makewell Comunicação** — agência de marketing digital.
- **Domínios:** makewell.com.br (PT-BR) e makewell.agency (EN/ES/PT-PT), gerados deste mesmo código
- **Stack (nov/2026):** Astro 7, site 100% estático (HTML + CSS inline + JS inline mínimo). Sem frameworks de UI
- **Deploy:** push na `main` → GitHub Actions (`.github/workflows/deploy.yml`): `dist/br` vai para o GitHub Pages
  deste repositório e `dist/agency` é enviado à `main` do repositório `makewell-agency` (deploy key `AGENCY_DEPLOY_KEY`)
- **Sem dependências externas no site** (exceto GTM e Meta Pixel, só após consentimento LGPD/GDPR)

## Estrutura
- `src/views/<página>.astro` + `src/content/<página>.ts`: layout e textos de cada página nos 4 idiomas
- `src/layouts/Page.astro`, `src/components/{Nav,Footer,VideoModal,LegalPage}.astro`, `src/styles/global.css`: compartilhados
- `src/lib/site.ts`: rotas e textos fixos por idioma (BR em .com.br; `/en/`, `/es/`, `/pt/` em .agency)
- `src/legacy/<site>/<rota>.json`: **fonte do `<head>` de SEO de cada página** (title, metas, canonical, hreflang,
  JSON-LD) e do bloco de consentimento. Mudança de SEO = editar esse JSON
- `public-br/`, `public-agency/`: arquivos copiados como estão (imagens, ícones, robots, sitemap, CNAME, cascas de redirect)
- `scripts/verify.mjs`: prova que nenhuma URL, SEO ou frase sumiu em relação ao site anterior; `scripts/qa.mjs`: QA no celular

## Comandos
```bash
npm ci && npm run build          # gera dist/br e dist/agency
node scripts/verify.mjs          # tem que terminar em "OK: nada se perdeu"
```

## Regras Obrigatórias

### A cada publicação (git push):
1. **Sempre atualizar `public-br/sitemap.xml` e `public-agency/sitemap.xml`** com `<lastmod>` do dia atual
2. Incluir os sitemaps no mesmo commit das alterações
3. Rodar `npm run build` e `node scripts/verify.mjs` antes do push

### Nunca fazer:
- Adicionar bibliotecas externas sem aprovação explícita do usuário
- Usar `!important` desnecessariamente
- Criar arquivos novos sem necessidade
- Quebrar SEO ou Lighthouse score

## Rastreamento Instalado

- **Google Tag Manager:** GTM-NFGD8X8
- **Meta Pixel:** ID `2571294026447618` — eventos `Lead` nos botões de CTA
- **Schema.org JSON-LD:** MarketingAgency

## Decisões de Design

- **Fontes:** System fonts (`'Segoe UI', system-ui, -apple-system`) — sem Google Fonts para performance
- **Cores:** `--gold: #F07820`, `--gold-light: #F5A623`, `--dark: #080808`
- **Hero h1:** `clamp(38px, 5vw, 72px)` desktop / `clamp(36px, 9vw, 52px)` mobile
- **Hero h1 em:** `display: block`, `padding-bottom: 0.15em` (evita corte nos descenders)
- **Hero-left:** `overflow: hidden; min-width: 0` (evita overflow em Windows/Segoe UI)
- **Grain texture:** `body::after` com SVG noise, `will-change: transform` (sem `mix-blend-mode` — causa scroll lag)
- **Hero card:** glassmorphism com `backdrop-filter: blur(24px)`
- **Menu mobile:** `justify-content: flex-start; padding-top: 100px`

## Endereço

R. Prof. Lourenço Peixoto, 36, Sala 04, Jatiúca, Maceió, AL.

## Informações da Empresa

- CNPJ: 27.238.877/0001-71
- WhatsApp: +55 82 99910-3246
- E-mail: contato@makewell.com.br
- Fundação: 2017 (São Paulo/SP). Expansão para o Nordeste em 2020, com sede em Maceió (AL) e operação estratégica em São Paulo (SP).

## Deploy

```bash
git add -A && git commit -m "mensagem" && git push origin main
```
O GitHub Actions publica os dois domínios em poucos minutos (aba Actions do repositório).
