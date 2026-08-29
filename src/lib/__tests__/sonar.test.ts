import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  passosProgresso, margemSimulada, ETAPAS_SONAR, itensDaAmostra, normalizarSerieVisitas, linkDoAnuncio,
  formatarFaturamentoSecoes237, formatarMedianaVendasMesSecoes237, formatarProporcaoCobertura,
  fetchSecoes237Sonar, itensParaSecoes237,
} from '../sonar';
import { supabase } from '../supabase';

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

describe('linkDoAnuncio — href do anúncio na coluna de ações (ADR-0127/D15)', () => {
  it('link normal (bem formado, domínio do ML) é preservado', () => {
    const link = 'https://produto.mercadolivre.com.br/MLB-4445303151-produto-x';
    expect(linkDoAnuncio(link, 'MLB4445303151')).toBe(link);
  });

  it('domínio duplicado no path (caso real medido 19/08) cai para a URL canônica via item_id', () => {
    const malformado = 'https://www.mercadolivre.com.br/produto.mercadolivre.com.br/MLB-4445303151-produto-x';
    expect(linkDoAnuncio(malformado, 'MLB4445303151')).toBe('https://produto.mercadolivre.com.br/MLB-4445303151');
  });

  it('link nulo cai para a URL canônica via item_id', () => {
    expect(linkDoAnuncio(null, 'MLB4445303151')).toBe('https://produto.mercadolivre.com.br/MLB-4445303151');
  });

  it('link vazio ou não-URL também cai para o fallback', () => {
    expect(linkDoAnuncio('', 'MLB4445303151')).toBe('https://produto.mercadolivre.com.br/MLB-4445303151');
    expect(linkDoAnuncio('não é url', 'MLB4445303151')).toBe('https://produto.mercadolivre.com.br/MLB-4445303151');
  });

  it('link de domínio fora do Mercado Livre cai para o fallback', () => {
    expect(linkDoAnuncio('https://exemplo.com/produto', 'MLB4445303151')).toBe('https://produto.mercadolivre.com.br/MLB-4445303151');
  });

  it('itemId inválido (não casa com MLB\\d+) e sem link utilizável devolve null', () => {
    expect(linkDoAnuncio(null, 'XYZ123')).toBeNull();
    expect(linkDoAnuncio('', '')).toBeNull();
  });
});

describe('formatarFaturamentoSecoes237 / formatarMedianaVendasMesSecoes237 — ADR-0142', () => {
  it('sem_dado devolve mensagem, nunca zero', () => {
    expect(formatarFaturamentoSecoes237({ estado: 'sem_dado', mensagem: 'nenhum vendedor na amostra' }))
      .toBe('nenhum vendedor na amostra');
    expect(formatarMedianaVendasMesSecoes237({ estado: 'sem_dado', mensagem: 'não dá para estimar o volume deste nicho' }))
      .toBe('não dá para estimar o volume deste nicho');
  });

  it('valor formata faturamento em BRL e mediana em un./mês', () => {
    expect(formatarFaturamentoSecoes237({
      estado: 'valor',
      faturamento_mes: 12500.5,
      vendedores_com_estimativa: 3,
      vendedores_distintos: 5,
      rotulo: 'faturamento de 3 vendedores com estimativa (vendas/mês — loja inteira, janela 365d)',
    })).toBe('R$ 12.500,50');
    expect(formatarMedianaVendasMesSecoes237({
      estado: 'valor',
      vendas_mes_mediana: 42.7,
      vendedores_com_estimativa: 3,
      rotulo: 'mediana de vendas/mês — loja inteira, janela 365d (3 vendedores)',
    })).toBe('43 un./mês');
  });

  it('formatarProporcaoCobertura arredonda percentual ou traço', () => {
    expect(formatarProporcaoCobertura(0.667)).toBe('67%');
    expect(formatarProporcaoCobertura(null)).toBe('—');
  });
});

describe('itensParaSecoes237 — identidade da amostra', () => {
  const itens = [{ titulo: 'X', preco: 10, vendidos: 5, link: null, imagem: null, vendedor: null,
    frete_gratis: null, loja_oficial: null, internacional: null, full: null, item_id: 'MLB1',
    catalog_product_id: null, avaliacao_nota: null, avaliacao_qtd: null, posicao: 1,
    patrocinado: null, selo: null, preco_anterior: null, desconto_pct: null, flex: null }];
  it('passa a amostra sem transformar', () => {
    expect(itensParaSecoes237(itens)).toBe(itens);
  });
});

describe('fetchSecoes237Sonar — POST pulse-analise-secoes237', () => {
  const item = { titulo: 'Prod', preco: 99, vendidos: 10, link: null, imagem: null, vendedor: 'Loja',
    seller_id: 123, frete_gratis: true, loja_oficial: false, internacional: false, full: true,
    item_id: 'MLB999', catalog_product_id: null, avaliacao_nota: 4.5, avaliacao_qtd: 20, posicao: 1,
    patrocinado: false, selo: null, preco_anterior: null, desconto_pct: null, flex: null };

  beforeEach(() => {
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: { session: { access_token: 'tok-test' } },
      error: null,
    } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('monta URL, auth e body { itens } corretamente', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ secoes237: {}, meta: { vendedores_distintos: 1, sem_seller_id: 0, serie_linhas: 0 } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchSecoes237Sonar([item]);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/functions/v1/pulse-analise-secoes237'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok-test' }),
        body: JSON.stringify({ itens: [item] }),
      }),
    );
  });
});
