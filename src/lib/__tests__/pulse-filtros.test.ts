import { describe, it, expect } from 'vitest';
import {
  contarPulse, filtrarProdutos, temFiltroAtivo, FILTROS_VAZIOS, type FiltrosPulse,
} from '../pulse-filtros';
import type { PulseProduto } from '../pulse';

const produto = (over: Partial<PulseProduto>): PulseProduto => ({
  id: 'p1', catalog_product_id: 'MLB1', codigo_pai: '000001', titulo: 'Produto X', gtin: '789000000001',
  origem: 'auto', status: 'ativo', catalogo_status: 'vinculado',
  ptw_status: null, ptw_preco_sugerido: null, ptw_custos: null,
  ultimo_snapshot_em: '2026-08-16T00:00:00Z', meu_preco: 100, meu_preco_em: '2026-08-16T00:00:00Z',
  anuncio_status: 'active', anuncio_sub_status: [], anuncio_status_em: '2026-08-16T00:00:00Z',
  comissao_pct: 14, comissao_fixa: 0, comissao_em: '2026-08-16T00:00:00Z',
  ...over,
});

const filtros = (over: Partial<FiltrosPulse>): FiltrosPulse => ({ ...FILTROS_VAZIOS, ...over });
const menorFixo = (v: number | null) => () => v;

describe('filtrarProdutos — busca', () => {
  const lista = [
    produto({ id: 'a', titulo: 'Gel de Limpeza', gtin: '111', codigo_pai: '000010' }),
    produto({ id: 'b', titulo: 'Protetor Solar', gtin: '222', codigo_pai: '000020' }),
  ];

  it('acha por nome, sem diferenciar maiúsculas', () => {
    expect(filtrarProdutos(lista, filtros({ busca: 'GEL' }), menorFixo(null)).map((p) => p.id)).toEqual(['a']);
  });

  it('acha por EAN e por código', () => {
    expect(filtrarProdutos(lista, filtros({ busca: '222' }), menorFixo(null)).map((p) => p.id)).toEqual(['b']);
    expect(filtrarProdutos(lista, filtros({ busca: '000010' }), menorFixo(null)).map((p) => p.id)).toEqual(['a']);
  });

  it('busca só de espaços não filtra nada', () => {
    expect(filtrarProdutos(lista, filtros({ busca: '   ' }), menorFixo(null))).toHaveLength(2);
  });
});

describe('filtrarProdutos — situação do anúncio no ML', () => {
  const lista = [
    produto({ id: 'ativo', anuncio_status: 'active' }),
    produto({ id: 'sem_estoque', anuncio_status: 'paused', anuncio_sub_status: ['out_of_stock'] }),
    produto({ id: 'fechado', anuncio_status: 'closed' }),
  ];

  it('separa ativos de parados, e "todos" devolve todos', () => {
    expect(filtrarProdutos(lista, filtros({ status: 'ativo' }), menorFixo(null)).map((p) => p.id)).toEqual(['ativo']);
    expect(filtrarProdutos(lista, filtros({ status: 'pausado' }), menorFixo(null)).map((p) => p.id))
      .toEqual(['sem_estoque', 'fechado']);
    expect(filtrarProdutos(lista, filtros({ status: 'todos' }), menorFixo(null))).toHaveLength(3);
  });

  // O pedido original foi lido como situação NO RADAR e devolvia lista vazia: nenhum produto
  // jamais foi pausado ali, enquanto metade dos anúncios estava parada no ML por estoque zerado.
  it('não olha o status do produto dentro do radar', () => {
    const pausadoNoRadar = [produto({ id: 'x', status: 'pausado', anuncio_status: 'active' })];
    expect(filtrarProdutos(pausadoNoRadar, filtros({ status: 'pausado' }), menorFixo(null))).toHaveLength(0);
    expect(filtrarProdutos(pausadoNoRadar, filtros({ status: 'ativo' }), menorFixo(null))).toHaveLength(1);
  });

  it('situação ainda não lida fica fora dos dois recortes — não afirmamos sem o dado', () => {
    const semLeitura = [produto({ id: 'y', anuncio_status: null })];
    expect(filtrarProdutos(semLeitura, filtros({ status: 'ativo' }), menorFixo(null))).toHaveLength(0);
    expect(filtrarProdutos(semLeitura, filtros({ status: 'pausado' }), menorFixo(null))).toHaveLength(0);
    expect(filtrarProdutos(semLeitura, filtros({ status: 'todos' }), menorFixo(null))).toHaveLength(1);
  });
});

describe('filtrarProdutos — recortes dos KPIs', () => {
  it('mais caro: só quem está acima do menor concorrente', () => {
    const lista = [produto({ id: 'caro', meu_preco: 110 }), produto({ id: 'barato', meu_preco: 90 })];
    expect(filtrarProdutos(lista, filtros({ foco: 'mais_caro' }), menorFixo(100)).map((p) => p.id)).toEqual(['caro']);
  });

  it('menor preço: só quem está abaixo', () => {
    const lista = [produto({ id: 'caro', meu_preco: 110 }), produto({ id: 'barato', meu_preco: 90 })];
    expect(filtrarProdutos(lista, filtros({ foco: 'menor_preco' }), menorFixo(100)).map((p) => p.id)).toEqual(['barato']);
  });

  it('empate técnico não entra em nenhum dos dois recortes', () => {
    const lista = [produto({ id: 'empate', meu_preco: 100.2 })];
    expect(filtrarProdutos(lista, filtros({ foco: 'mais_caro' }), menorFixo(100))).toHaveLength(0);
    expect(filtrarProdutos(lista, filtros({ foco: 'menor_preco' }), menorFixo(100))).toHaveLength(0);
  });

  it('sem preço nosso não é "o mais barato" — sem comparação, fora dos dois', () => {
    const lista = [produto({ id: 'sem', meu_preco: null })];
    expect(filtrarProdutos(lista, filtros({ foco: 'menor_preco' }), menorFixo(100))).toHaveLength(0);
    expect(filtrarProdutos(lista, filtros({ foco: 'mais_caro' }), menorFixo(100))).toHaveLength(0);
  });

  it('sem vínculo: qualquer status de catálogo diferente de vinculado', () => {
    const lista = [
      produto({ id: 'ok', catalogo_status: 'vinculado' }),
      produto({ id: 'div', catalogo_status: 'ficha_divergente' }),
      produto({ id: 'nulo', catalogo_status: null }),
    ];
    expect(filtrarProdutos(lista, filtros({ foco: 'sem_vinculo' }), menorFixo(null)).map((p) => p.id)).toEqual(['div']);
  });
});

describe('filtrarProdutos — combinação', () => {
  it('busca, situação e recorte se acumulam', () => {
    const lista = [
      produto({ id: 'alvo', titulo: 'Gel', anuncio_status: 'active', meu_preco: 120 }),
      produto({ id: 'pausado', titulo: 'Gel', anuncio_status: 'paused', meu_preco: 120 }),
      produto({ id: 'outro', titulo: 'Solar', anuncio_status: 'active', meu_preco: 120 }),
      produto({ id: 'barato', titulo: 'Gel', anuncio_status: 'active', meu_preco: 80 }),
    ];
    const r = filtrarProdutos(lista, filtros({ busca: 'gel', status: 'ativo', foco: 'mais_caro' }), menorFixo(100));
    expect(r.map((p) => p.id)).toEqual(['alvo']);
  });
});

describe('contarPulse', () => {
  const lista = [
    produto({ id: 'caro', meu_preco: 130 }),
    produto({ id: 'barato', meu_preco: 70 }),
    produto({ id: 'divergente', meu_preco: 130, catalogo_status: 'ficha_divergente' }),
    produto({ id: 'sem_preco', meu_preco: null }),
  ];

  // Se contagem e filtro divergirem, clicar num card de "3" devolve outra quantidade de linhas —
  // é o defeito que separar as duas implementações produz.
  it('cada contagem bate exatamente com o que o filtro correspondente devolve', () => {
    const c = contarPulse(lista, menorFixo(100));
    expect(c.total).toBe(lista.length);
    expect(c.maisCaro).toBe(filtrarProdutos(lista, filtros({ foco: 'mais_caro' }), menorFixo(100)).length);
    expect(c.menorPreco).toBe(filtrarProdutos(lista, filtros({ foco: 'menor_preco' }), menorFixo(100)).length);
    expect(c.semVinculo).toBe(filtrarProdutos(lista, filtros({ foco: 'sem_vinculo' }), menorFixo(100)).length);
  });

  it('comparáveis conta só quem tem os dois preços', () => {
    expect(contarPulse(lista, menorFixo(100)).comparaveis).toBe(3);
    expect(contarPulse(lista, menorFixo(null)).comparaveis).toBe(0);
  });
});

describe('temFiltroAtivo', () => {
  it('reconhece cada eixo, e ignora busca em branco', () => {
    expect(temFiltroAtivo(FILTROS_VAZIOS)).toBe(false);
    expect(temFiltroAtivo(filtros({ busca: '  ' }))).toBe(false);
    expect(temFiltroAtivo(filtros({ busca: 'x' }))).toBe(true);
    expect(temFiltroAtivo(filtros({ status: 'pausado' }))).toBe(true);
    expect(temFiltroAtivo(filtros({ foco: 'mais_caro' }))).toBe(true);
  });
});
