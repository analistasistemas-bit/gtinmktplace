import { describe, it, expect } from 'vitest';
import { passosProgresso, margemSimulada, fichasAtivas, fichasSemVendedor, ETAPAS_SONAR, itensDaAmostra, normalizarSerieVisitas } from '../sonar';
import type { PainelSonar } from '../sonar';

describe('passosProgresso — máquina dos 4 passos (ADR-0120/0127; busca de fichas morreu)', () => {
  it('início (0ms, sem resposta): 1º passo ativo, resto pendente', () => {
    expect(passosProgresso(0, false)).toEqual([
      { label: ETAPAS_SONAR[0], status: 'ativa' },
      { label: ETAPAS_SONAR[1], status: 'pendente' },
      { label: ETAPAS_SONAR[2], status: 'pendente' },
      { label: ETAPAS_SONAR[3], status: 'pendente' },
    ]);
  });

  it('avança um passo a cada 2,5s', () => {
    expect(passosProgresso(2500, false).map((p) => p.status)).toEqual(['concluida', 'ativa', 'pendente', 'pendente']);
    expect(passosProgresso(5000, false).map((p) => p.status)).toEqual(['concluida', 'concluida', 'ativa', 'pendente']);
  });

  it('trava na penúltima etapa enquanto a resposta não chega, por mais tempo que passe', () => {
    expect(passosProgresso(50_000, false).map((p) => p.status)).toEqual(['concluida', 'concluida', 'ativa', 'pendente']);
  });

  it('resposta chegando conclui todas as 4 etapas, mesmo com pouco tempo decorrido', () => {
    expect(passosProgresso(300, true).map((p) => p.status)).toEqual(['concluida', 'concluida', 'concluida', 'concluida']);
  });
});

describe('ETAPAS_SONAR — 4 etapas (a busca de fichas morreu, ADR-0127)', () => {
  it('tem 4 etapas e nenhuma menciona ficha/catálogo', () => {
    expect(ETAPAS_SONAR).toHaveLength(4);
    for (const e of ETAPAS_SONAR) expect(e.toLowerCase()).not.toMatch(/ficha|catálogo/);
  });
});

describe('normalizarSerieVisitas — D9 (medido 19/08: API omite dias sem visita e embaralha)', () => {
  // Fixture com a forma real do defeito: 7 pontos, fora de ordem, numa janela de 30 dias.
  const bagunçado = [
    { data: '2026-08-15', total: 3 }, { data: '2026-07-22', total: 1 },
    { data: '2026-08-19', total: 7 }, { data: '2026-08-01', total: 2 },
    { data: '2026-07-25', total: 4 }, { data: '2026-08-10', total: 5 },
    { data: '2026-08-03', total: 6 },
  ];
  const hoje = new Date('2026-08-19T12:00:00.000Z');

  it('devolve a janela completa (30 pontos), ordenada, com 0 nos dias ausentes', () => {
    const serie = normalizarSerieVisitas(bagunçado, 30, hoje);
    expect(serie).toHaveLength(30);
    expect(serie[0].data).toBe('2026-07-21');
    expect(serie[29]).toEqual({ data: '2026-08-19', total: 7 });
    expect(serie.find((p) => p.data === '2026-08-15')).toEqual({ data: '2026-08-15', total: 3 });
    expect(serie.find((p) => p.data === '2026-08-18')).toEqual({ data: '2026-08-18', total: 0 });
    const datas = serie.map((p) => p.data);
    expect(datas).toEqual([...datas].sort());
  });

  it('série vazia vira 30 zeros (zero medido dentro de janela fechada, não "sem dado")', () => {
    const serie = normalizarSerieVisitas([], 30, hoje);
    expect(serie).toHaveLength(30);
    expect(serie.every((p) => p.total === 0)).toBe(true);
  });

  it('não desliza a janela com `hoje` fora do meio-dia UTC (23h em Brasília = 02h UTC do dia seguinte)', () => {
    const hojeNoite = new Date('2026-08-20T02:00:00.000Z'); // 19/08 23h em America/Sao_Paulo (UTC-3)
    const serie = normalizarSerieVisitas([], 30, hojeNoite);
    expect(serie[0].data).toBe('2026-07-21');
    expect(serie[29].data).toBe('2026-08-19');
  });
});

describe('itensDaAmostra — lista da tabela com fallback para cache v4 antigo', () => {
  const item = { titulo: 'X', preco: 1, vendidos: null, link: null, imagem: null, vendedor: null,
    frete_gratis: null, loja_oficial: null, internacional: null, full: null, item_id: 'MLB1',
    catalog_product_id: null, avaliacao_nota: null, avaliacao_qtd: null, posicao: 1,
    patrocinado: null, selo: null, preco_anterior: null, desconto_pct: null, flex: null };
  const base = { configurado: true as const, termo: 't', gerado_em: 'g', itens_analisados: 1,
    itens_com_vendas: 0, vendas_totais: 0, valor_mercado: 0, produto_destaque: null,
    palavras_chave_titulos: [], raio_x: { total_anuncios: null, ticket_medio: null,
    lojas_oficiais: 0, full: 0, frete_gratis: 0, internacionais: 0 } };

  it('usa `itens` quando presente; cai para por_anuncio quando não (cache antigo)', () => {
    expect(itensDaAmostra({ ...base, itens: [item], por_anuncio: {} })).toEqual([item]);
    expect(itensDaAmostra({ ...base, por_anuncio: { MLB1: item } })).toEqual([item]);
    expect(itensDaAmostra({ ...base })).toEqual([]);
  });
});

describe('margemSimulada — recebe/imposto/margem sobre custo (não sobre preço, ver brief Task 4 #4)', () => {
  it('calcula recebe (preço − comissão − frete), imposto (alíquota × preço) e margem sobre o custo', () => {
    // recebe = 100 - 15 - 5 = 80; imposto = 8% de 100 = 8; líquido = 80 - 8 - 40 = 32; margem = 32/40 = 80%
    const r = margemSimulada({
      precoAlvo: 100, custo: 40, aliquotaPct: 8, tarifa: { comissao: 15, frete: 5 },
    });
    expect(r).toEqual({ recebe: 80, imposto: 8, liquido: 32, margemPct: 80 });
  });

  it('alíquota importado (16%) — imposto maior reduz a margem', () => {
    const r = margemSimulada({
      precoAlvo: 100, custo: 40, aliquotaPct: 16, tarifa: { comissao: 15, frete: 5 },
    });
    expect(r.imposto).toBe(16);
    expect(r.liquido).toBe(24);
    expect(r.margemPct).toBe(60);
  });

  it('custo zero não estoura (margem 0, não Infinity/NaN)', () => {
    const r = margemSimulada({ precoAlvo: 100, custo: 0, aliquotaPct: 8, tarifa: { comissao: 15, frete: 5 } });
    expect(r.margemPct).toBe(0);
  });
});

describe('fichasAtivas / fichasSemVendedor — separação por ofertas > 0 (ruling: ficha vazia não entra no painel principal)', () => {
  const ficha = (over: Partial<PainelSonar['fichas'][number]>): PainelSonar['fichas'][number] => ({
    product_id: 'MLB1', nome: 'Produto', category_id: 'MLB100', ofertas: 3,
    preco: { min: 10, mediana: 15, max: 20 }, frete_gratis_pct: 50, visitas_30d: 100,
    visitas_por_dia: [], vendedores: [{ seller_id: 1, uf: 'SP', transacoes_total: 10, loja_oficial: false }],
    ...over,
  });

  const painel = (fichas: PainelSonar['fichas']): PainelSonar => ({
    termo: 'x', gerado_em: '2026-08-17T00:00:00Z', total_catalogo: fichas.length, fichas,
    agregado: { visitas_30d_total: 0, visitas_por_dia: [], ofertas_total: 0, vendedores_distintos: 0, frete_gratis_pct: 0 },
    palavras_chave: [],
  });

  it('separa fichas com oferta ativa das vazias (ofertas: 0)', () => {
    const vazia = ficha({
      product_id: 'MLB2', ofertas: 0, category_id: null, preco: null, visitas_30d: null, vendedores: [],
    });
    const p = painel([ficha({}), vazia]);
    expect(fichasAtivas(p)).toEqual([ficha({})]);
    expect(fichasSemVendedor(p)).toEqual([vazia]);
  });

  it('painel sem fichas vazias: fichasSemVendedor vazio', () => {
    const p = painel([ficha({})]);
    expect(fichasSemVendedor(p)).toEqual([]);
  });
});
