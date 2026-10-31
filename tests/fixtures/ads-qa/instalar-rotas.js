// Fixtures reproduzíveis do QA visual do /ads (2026-10-31). Não é teste de vitest: é um script do Playwright.
//
// Uso (sessão própria, nunca o Chrome do usuário):
//   pnpm dev                                          # Vite em :5173, com .env.local
//   playwright-cli -s=adsqa open
//   playwright-cli -s=adsqa run-code --filename=<login>  # login com VALIDATION_* de .env.local
//   playwright-cli -s=adsqa run-code --filename=tests/fixtures/ads-qa/instalar-rotas.js
//   playwright-cli -s=adsqa run-code --filename=tests/fixtures/ads-qa/capturas.js
// As rotas ficam no contexto da sessão: instalar uma vez, depois navegar e capturar.
//
// O que é real e o que é injetado:
// - Real: login, vendas do ML (ml_vendas), catálogo (vendas_sku_catalogo). Os códigos das famílias vêm do catálogo
//   real da organização logada (as de venda mais recente), então nomes, custo e lucro são reais.
// - Injetado (page.route): `ads-metricas` (escopos conta, campanhas), RPC `ads_painel` (conta diária e 6 grupos)
//   e `vendas_sku_codigos_mlbs`. Gasto, receita Ads, campanhas e MLBs dos grupos são FICTÍCIOS.
// - Cenários: comparação provisória, famílias com gasto alto (candidatas a "acima do equilíbrio"), campanha ativa
//   e pausada, gasto compartilhado e gasto não identificado.
// - Polimentos 2026-10-31: campanha pausada sem gasto no período (sem denominador / sem base), anúncios patrocinados
//   no detalhe (um sem período anterior) e coleta R$ 0,18 abaixo da leitura ao vivo (conciliação dentro da tolerância).
async page => {
  const MLB = (i) => `MLB900000${i}`;
  const val = (v) => ({ valor: v, motivo: null });
  const dias = (desde, ate) => {
    const r = []; const d = new Date(`${desde}T12:00:00Z`); const fim = new Date(`${ate}T12:00:00Z`);
    for (; d <= fim; d.setUTCDate(d.getUTCDate() + 1)) r.push(d.toISOString().slice(0, 10));
    return r;
  };
  const onda = (i, k) => 0.65 + 0.35 * Math.abs(Math.sin((i + 1) * k)); // determinístico, sem Math.random
  const metricasDia = (i, escala) => {
    const cost = +(95 * escala * onda(i, 1.7)).toFixed(2);
    const total = +(cost * (3.6 + onda(i, 0.9))).toFixed(2);
    const direct = +(total * 0.7).toFixed(2);
    const prints = Math.round(9000 * escala * onda(i, 1.3));
    const clicks = Math.round(prints * 0.021);
    const itens = Math.round(clicks * 0.05) + 1;
    return { cost, total_amount: total, direct_amount: direct, indirect_amount: +(total - direct).toFixed(2),
      prints, clicks, advertising_items_quantity: itens, direct_items_quantity: Math.round(itens * 0.7),
      indirect_items_quantity: itens - Math.round(itens * 0.7), direct_units_quantity: itens, indirect_units_quantity: 0,
      units_quantity: itens, cvr: 0.045 };
  };
  const bloco = (desde, ate, escala, provisorio) => {
    const ds = dias(desde, ate);
    const serie = ds.map((dia, i) => {
      const m = metricasDia(i, escala);
      return { dia, metricas: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, val(v)])) };
    });
    const soma = (k) => serie.reduce((a, s) => a + s.metricas[k].valor, 0);
    const resumo = Object.fromEntries(['cost', 'prints', 'clicks', 'direct_amount', 'indirect_amount', 'total_amount',
      'direct_items_quantity', 'indirect_items_quantity', 'advertising_items_quantity', 'direct_units_quantity',
      'indirect_units_quantity', 'units_quantity'].map((k) => [k, val(+soma(k).toFixed(2))]));
    resumo.cvr = val(0.045);
    return { janela: { desde, ate }, resumo, serie, completo: true, lidoEm: new Date().toISOString(), provisorio };
  };
  const anteriorDe = (desde, ate) => {
    const n = dias(desde, ate).length; const d = new Date(`${desde}T12:00:00Z`);
    const fim = new Date(d); fim.setUTCDate(fim.getUTCDate() - 1);
    const ini = new Date(fim); ini.setUTCDate(ini.getUTCDate() - (n - 1));
    return [ini.toISOString().slice(0, 10), fim.toISOString().slice(0, 10)];
  };

  await page.route('**/functions/v1/ads-metricas', async (route) => {
    const p = JSON.parse(route.request().postData() || '{}');
    const comparar = p.comparar === 'anterior';
    const [ad, af] = anteriorDe(p.desde, p.ate);
    const base = { ok: true, estado: 'ok', escopo: p.escopo, avisos: [],
      disponibilidade: { desde: '2026-04-01', ate: p.ate, fuso: 'America/Sao_Paulo' },
      comparacao: { estado: comparar ? 'provisoria' : 'desligada', motivo: null }, campanhas: [] };
    if (p.escopo === 'campanhas') {
      base.atual = null; base.anterior = null;
      base.campanhas = [[7001, 'Moda Praia Verão', 'active', 1.0], [7002, 'Perfumaria Dia dos Pais', 'paused', 0.45],
        [7003, 'Inverno Pausada', 'paused', 0]]
        .map(([id, nome, statusAtual, esc]) => ({ id, nome, statusAtual, atual: bloco(p.desde, p.ate, esc),
          anterior: comparar ? bloco(ad, af, esc * 0.85) : null }));
    } else {
      base.atual = bloco(p.desde, p.ate, 1);
      base.anterior = comparar ? bloco(ad, af, 0.9) : null;
      if (p.escopo === 'campanha') {
        // Anúncio novo no período: a linha anterior existe, mas zerada (sem base e sem denominador).
        base.anuncios = [[MLB(0), 'Biquíni Cortininha Estampado', 0.6, 0.5], [MLB(1), 'Saída de Praia Kimono Longo', 0.4, 0]]
          .map(([itemId, titulo, esc, escAnt]) => ({ itemId, titulo, statusAds: 'active', atual: bloco(p.desde, p.ate, esc),
            anterior: comparar ? bloco(ad, af, escAnt) : null }));
        base.anunciosMotivo = null;
      }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(base) });
  });

  // Famílias reais: lê o catálogo de verdade e guarda os códigos de venda mais recente.
  let resolverCodigos; const codigos = new Promise((r) => { resolverCodigos = r; });
  await page.route('**/rest/v1/rpc/vendas_sku_catalogo**', async (route) => {
    const resp = await route.fetch(); const linhas = await resp.json();
    const porPai = new Map();
    for (const l of [...linhas].sort((a, b) => String(b.ultima_venda).localeCompare(String(a.ultima_venda)))) {
      if (!porPai.has(l.codigo_pai) && l.codigo) porPai.set(l.codigo_pai, l.codigo);
    }
    resolverCodigos([...porPai.values()].slice(0, 6));
    await route.fulfill({ response: resp, json: linhas });
  });
  await page.route('**/rest/v1/rpc/vendas_sku_codigos_mlbs**', async (route) => {
    const cs = await codigos;
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(Object.fromEntries(cs.map((c, i) => [MLB(i), [c]]))) });
  });
  await page.route('**/rest/v1/rpc/ads_painel**', async (route) => {
    const p = JSON.parse(route.request().postData() || '{}');
    const ds = dias(p.p_desde, p.p_ate);
    // Coleta R$ 0,18 abaixo da leitura ao vivo no 1º dia: dentro da tolerância de conciliação (ADR-0179, 2026-10-31).
    const conta = ds.map((dia, i) => { const m = metricasDia(i, 1);
      return { dia, cost: i === 0 ? +(m.cost - 0.18).toFixed(2) : m.cost, clicks: m.clicks, prints: m.prints, direct_amount: m.direct_amount,
        indirect_amount: m.indirect_amount, total_amount: m.total_amount, coletado_em: new Date().toISOString() }; });
    // Do maior ao menor gasto (Σ R$ 2.168, abaixo da conta: composição fecha); os maiores tendem a passar do equilíbrio.
    const custos = [1040, 480, 304, 192, 96, 56];
    const grupos = custos.map((cost, i) => ({ ad_group_id: 500 + i, tipo: 'ITEM', status: 'active', cost,
      clicks: Math.round(cost * 2), prints: Math.round(cost * 90), direct_amount: Math.round(cost * 3.2),
      indirect_amount: Math.round(cost * 1.1), total_amount: Math.round(cost * 4.3), membros: [MLB(i)] }));
    const corpo = { sync: { erro: null, estado: 'ok', ultimo_ok_em: new Date().toISOString(),
      cobertura_desde: '2026-06-29', carga_inicial_ok: true, conta_cobertura_desde: '2026-07-06' }, conta, grupos };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpo) });
  });
  return 'rotas do QA do /ads instaladas';
}
