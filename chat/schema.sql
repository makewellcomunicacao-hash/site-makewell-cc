-- Leads da Maia (D1 makewell-leads). Aplicar: npx wrangler d1 execute makewell-leads --remote --file schema.sql
CREATE TABLE IF NOT EXISTS leads (
  ref TEXT PRIMARY KEY, sid TEXT NOT NULL, created TEXT NOT NULL, lang TEXT NOT NULL, pagina TEXT,
  nome TEXT, empresa TEXT, segmento TEXT, local TEXT, presenca TEXT, objetivo TEXT, situacao TEXT, investimento TEXT,
  urgencia TEXT, decisor TEXT, interesse TEXT, avaliacao TEXT
);
CREATE INDEX IF NOT EXISTS leads_created ON leads (created);
-- gasto diário com o modelo (soma atômica; teto em DAILY_CAP_USD)
CREATE TABLE IF NOT EXISTS spend (day TEXT PRIMARY KEY, usd REAL NOT NULL);
