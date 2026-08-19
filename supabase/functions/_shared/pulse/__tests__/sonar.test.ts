import { describe, expect, it } from 'vitest';
import { extrairPalavrasChave, montarPainelSonar, parseFichasBusca, parseVisitasJanela, resumoPrecos, type ResultadoFicha } from '../sonar.ts';

describe('parseFichasBusca', () => {
  it('extrai id/nome/domain e ignora entradas sem id', () => {
    const json = { results: [
      { id: 'MLB60128399', name: 'Tecido Oxford Liso 10m', domain_id: 'MLB-FABRICS' },
      { name: 'sem id' },
    ] };
    expect(parseFichasBusca(json)).toEqual([
      { product_id: 'MLB60128399', nome: 'Tecido Oxford Liso 10m', domain_id: 'MLB-FABRICS' },
    ]);
  });
  it('devolve [] para corpo inválido', () => {
    expect(parseFichasBusca(null)).toEqual([]);
    expect(parseFichasBusca({})).toEqual([]);
  });
});

describe('parseVisitasJanela', () => {
  it('extrai total e série diária', () => {
    const json = { total_visits: 42, results: [
      { date: '2026-07-30T00:00:00Z', total: 2 },
      { date: '2026-08-08T00:00:00Z', total: 5 },
    ] };
    expect(parseVisitasJanela(json)).toEqual({ total: 42, por_dia: [
      { data: '2026-07-30', total: 2 },
      { data: '2026-08-08', total: 5 },
    ] });
  });
  it('null quando o corpo não tem total_visits numérico', () => {
    expect(parseVisitasJanela({ message: 'forbidden' })).toBeNull();
  });
});

describe('extrairPalavrasChave', () => {
  it('conta termos normalizados sem stopwords e respeita o limite', () => {
    const nomes = ['Tecido Oxford Liso 10m', 'Tecido Oxford Estampado', 'Rolo de Tecido'];
    const r = extrairPalavrasChave(nomes, 2);
    expect(r[0]).toEqual({ termo: 'tecido', contagem: 3 });
    expect(r[1]).toEqual({ termo: 'oxford', contagem: 2 });
    expect(r).toHaveLength(2);
  });
});

describe('resumoPrecos', () => {
  it('min/mediana/max com mediana de lista par = média dos centrais', () => {
    expect(resumoPrecos([10, 30, 20, 40])).toEqual({ min: 10, mediana: 25, max: 40 });
  });
  it('min/mediana/max com mediana de lista ímpar = valor central', () => {
    expect(resumoPrecos([10, 30, 20])).toEqual({ min: 10, mediana: 20, max: 30 });
  });
  it('null para lista vazia', () => {
    expect(resumoPrecos([])).toBeNull();
  });
});

describe('montarPainelSonar', () => {
  it('agrega 2 fichas: soma séries por data desalinhadas, não soma visitas_30d null, % frete grátis ponderado, vendedores distintos', () => {
    const busca = { paging: { total: 137 }, results: [
      { id: 'A1', name: 'Tecido Oxford Liso', domain_id: 'MLB-FABRICS' },
      { id: 'B1', name: 'Tecido Oxford Estampado', domain_id: 'MLB-FABRICS' },
    ] };
    const resultados: ResultadoFicha[] = [
      {
        category_id: 'MLB1',
        ofertas: 10,
        preco: { min: 10, mediana: 15, max: 20 },
        frete_gratis_pct: 50,
        visitas_30d: 100,
        visitas_por_dia: [{ data: '2026-08-01', total: 5 }, { data: '2026-08-02', total: 3 }],
        vendedores: [
          { seller_id: 1, uf: 'SP', transacoes_total: 50, loja_oficial: false },
          { seller_id: 2, uf: 'RJ', transacoes_total: 10, loja_oficial: false },
        ],
        item_ids: ['MLB100', 'MLB200'],
      },
      {
        category_id: null,
        ofertas: 5,
        preco: null,
        frete_gratis_pct: 0,
        visitas_30d: null, // endpoint falhou para este item — não pode virar 0 na soma
        visitas_por_dia: [{ data: '2026-08-02', total: 2 }, { data: '2026-08-03', total: 1 }],
        vendedores: [
          { seller_id: 2, uf: 'RJ', transacoes_total: 10, loja_oficial: false },
          { seller_id: 3, uf: null, transacoes_total: null, loja_oficial: true },
        ],
        item_ids: [],
      },
    ];

    const painel = montarPainelSonar('tecido oxford', busca, resultados);

    expect(painel.termo).toBe('tecido oxford');
    expect(painel.total_catalogo).toBe(137);
    expect(painel.fichas).toHaveLength(2);
    expect(painel.fichas[0]).toMatchObject({ product_id: 'A1', nome: 'Tecido Oxford Liso', category_id: 'MLB1', item_ids: ['MLB100', 'MLB200'] });
    expect(painel.fichas[1]).toMatchObject({ product_id: 'B1', nome: 'Tecido Oxford Estampado', category_id: null, item_ids: [] });

    expect(painel.agregado.visitas_30d_total).toBe(100); // só a ficha A soma; B (null) não vira 0
    expect(painel.agregado.visitas_por_dia).toEqual([
      { data: '2026-08-01', total: 5 },
      { data: '2026-08-02', total: 5 }, // 3 (A) + 2 (B), datas desalinhadas
      { data: '2026-08-03', total: 1 },
    ]);
    expect(painel.agregado.ofertas_total).toBe(15);
    expect(painel.agregado.vendedores_distintos).toBe(3); // seller 2 repete entre fichas
    expect(painel.agregado.frete_gratis_pct).toBe(33); // (50%*10 + 0%*5) / 15 = 33.3% → arredondado
  });
});
