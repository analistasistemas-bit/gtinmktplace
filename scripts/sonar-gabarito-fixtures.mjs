// Recalibração D12 (ADR-0127): roda os 3 termos-gabarito na pulse-sonar-vendas de PRODUÇÃO e
// congela os payloads como fixtures. CUSTO REAL: US$ 0,30 exatos (3 × US$0,10) — medido em
// 19/08/2026: nenhum dos 3 termos em cache. Após o run, cada termo fica cacheado 7 dias —
// re-rodar no mesmo dia NÃO cobra de novo.
//
// Guarda o mapa de visitas POR ITEM (não só a soma): soma sobre "quantos itens responderam" é
// censurada pelo tamanho da amostra — exatamente o defeito que o D11 mata. Regra LOUD: nenhum
// item medido → null, nunca 0; `total: 0` com HTTP 200 é zero medido e conta.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const URL_BASE = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const EMAIL = env.VALIDATION_EMAIL;
const SENHA = env.VALIDATION_PASSWORD;
if (!URL_BASE || !ANON || !EMAIL || !SENHA) {
  throw new Error('Faltam VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / VALIDATION_EMAIL / VALIDATION_PASSWORD no .env.local');
}

const login = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: ANON },
  body: JSON.stringify({ email: EMAIL, password: SENHA }),
});
const { access_token } = await login.json();
if (!access_token) throw new Error('Login da conta VALIDATION falhou');

const chamar = async (fn, body) => {
  const r = await fetch(`${URL_BASE}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access_token}` },
    body: JSON.stringify(body),
  });
  return r.json();
};

const TERMOS = [
  ['eucerin-protetor-solar', 'EUCERIN protetor solar'],
  ['protetor-solar-facial', 'protetor solar facial'],
  ['tecido-oxford-10-metros', 'tecido oxford 10 metros'],
];
const DESTINO = 'src/lib/__tests__/fixtures/sonar-gabarito';
mkdirSync(DESTINO, { recursive: true });

for (const [slug, termo] of TERMOS) {
  const vendas = await chamar('pulse-sonar-vendas', { termo });
  if (!vendas?.configurado || !vendas.por_anuncio) {
    throw new Error(`Vendas falhou para "${termo}": ${JSON.stringify(vendas).slice(0, 300)}`);
  }
  // Preferir `vendas.itens` (ordem da busca, inclui item sem item_id); a edge de PRODUÇÃO ainda
  // pode ser a versão sem esse campo (deploy só na Task 13) → cai em por_anuncio.
  const amostra = Array.isArray(vendas.itens) ? vendas.itens : Object.values(vendas.por_anuncio);
  const itemIds = amostra.map((i) => i.item_id).filter((id) => id != null).slice(0, 20);
  let visitasPorItem = null;
  let visitasMedidos = 0;
  let visitasTotal = null;
  if (itemIds.length > 0) {
    const visitas = await chamar('pulse-sonar-visitas', { item_ids: itemIds });
    if (visitas?.conectado) {
      visitasPorItem = visitas.por_item;
      const medidos = Object.values(visitas.por_item).filter((v) => v != null);
      visitasMedidos = medidos.length;
      visitasTotal = medidos.length > 0 ? medidos.reduce((a, v) => a + v.total, 0) : null;
    } else {
      console.warn(`AVISO: visitas indisponíveis para "${termo}" (conectado:false — org da conta sem conexão ML)`);
    }
  }
  writeFileSync(
    `${DESTINO}/${slug}.json`,
    JSON.stringify({
      vendas,
      visitas_por_item: visitasPorItem,
      visitas_itens_consultados: itemIds.length,
      visitas_medidos: visitasMedidos,
      visitas_total: visitasTotal,
    }, null, 2),
  );
  console.log(`${termo}: ${vendas.itens_analisados} itens, com_vendas=${vendas.itens_com_vendas}, visitas_total=${visitasTotal} (${visitasMedidos}/${itemIds.length} medidos)`);
}
