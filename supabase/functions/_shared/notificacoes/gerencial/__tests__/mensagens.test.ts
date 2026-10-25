import { describe, expect, it } from 'vitest';
import {
  brl, linhaCrescimento, montarHoje, montarMensagemCarrinho, montarMes, montarResumoDiario, montarTop,
  TEXTO_AJUDA, TEXTO_ERRO, TEXTO_SEM_ACESSO, TEXTO_SO_PRIVADO, TEXTO_VOLUME,
  type DadosResumo, type KpisPeriodo,
} from '../mensagens.ts';
import { urlVendaML } from '../../telegram.ts';
import type { LucroPeriodo, ResultadoCarrinho } from '../resultado.ts';

const COMPRADOR = 'Fulano Comprador da Silva';
const k: KpisPeriodo = {
  hoje: { faturamento: 2340, pedidos: 14, ticket: 167.14 },
  mes: { faturamento: 41200, pedidos: 260, ticket: 158.46 },
  anterior: { faturamento: 36700, pedidos: 240, ticket: 152.9 },
  rotuloMes: 'Outubro', rotuloAnterior: '1–24/set',
};
const estado = { parcial: null, composicaoIncerta: false };
const carrinho: ResultadoCarrinho = {
  venda: 189.8, itens: 2, lucro: 54.82, motivo: null, margemSobreVenda: 54.82 / 189.8, markup: 0.4321,
  prejuizos: [], semCusto: [],
};
const L1 = '💼 Venda R$ 189,80 — 2 itens';
const rodape = [
  'Hoje: R$ 2.340,00 · 14 pedidos · ticket R$ 167,14',
  'Outubro: R$ 41.200,00 · 260 pedidos · ticket R$ 158,46 · +12,3% vs 1–24/set',
  'Pedido 2000000001',
  urlVendaML(2000000001),
];

describe('brl / linhaCrescimento', () => {
  it('formata dinheiro', () => {
    expect(brl(1234.5)).toBe('R$ 1.234,50');
    expect(brl(0)).toBe('R$ 0,00');
    expect(brl(1234567.891)).toBe('R$ 1.234.567,89');
    expect(brl(-4.1)).toBe('−R$ 4,10');
  });
  it('crescimento', () => {
    expect(linhaCrescimento(41200, 36700, '1–24/set')).toBe('+12,3% vs 1–24/set');
    expect(linhaCrescimento(96, 100, '1–24/set')).toBe('−4,0% vs 1–24/set');
    expect(linhaCrescimento(100, 0, '1–24/set')).toBe('sem base de comparação');
  });
});

describe('montarMensagemCarrinho', () => {
  it('caso feliz', () => {
    const markup = (carrinho.markup! * 100).toFixed(1).replace('.', ',');
    expect(montarMensagemCarrinho(carrinho, k, 2000000001, estado)).toBe([
      L1,
      `Lucro R$ 54,82 · Margem s/ venda 28,9% · Markup ${markup}%`,
      ...rodape,
    ].join('\n'));
  });
  it('sem custo', () => {
    const c = { ...carrinho, lucro: null, motivo: 'sem_custo' as const, margemSobreVenda: null, markup: null, semCusto: ['Máscara X'] };
    expect(montarMensagemCarrinho(c, k, 2000000001, estado)).toBe([
      L1, 'Lucro: — (sem custo em 1 item)', '⚠️ Máscara X: sem custo cadastrado', ...rodape,
    ].join('\n'));
  });
  it('frete e alíquota', () => {
    const base = { ...carrinho, lucro: null, margemSobreVenda: null, markup: null };
    expect(montarMensagemCarrinho({ ...base, motivo: 'frete_nao_lido' }, k, 2000000001, estado))
      .toContain('\nLucro: — (frete não lido no ML)\n');
    expect(montarMensagemCarrinho({ ...base, motivo: 'aliquota_nao_confirmada' }, k, 2000000001, estado))
      .toContain('\nLucro: — (alíquotas de imposto não confirmadas)\n');
  });
  it('prejuízo', () => {
    const c = { ...carrinho, prejuizos: [{ titulo: 'Máscara X', valor: -4.1 }] };
    expect(montarMensagemCarrinho(c, k, 2000000001, estado)).toContain('\n⚠️ Máscara X: prejuízo de R$ 4,10\n');
  });
  it('parcial e composição incerta', () => {
    expect(montarMensagemCarrinho(carrinho, k, 2000000001, { parcial: { recebidos: 2, total: 3 }, composicaoIncerta: false }).split('\n')[0])
      .toBe(`${L1} (parcial: 2 de 3 itens)`);
    expect(montarMensagemCarrinho(carrinho, k, 2000000001, { parcial: null, composicaoIncerta: true }).split('\n')[0])
      .toBe(`${L1} (composição do carrinho não confirmada)`);
  });
  it('parcial ou composição incerta: lucro vira "carrinho incompleto" (o líquido já descontou o frete do envio inteiro)', () => {
    const semCusto = { ...carrinho, lucro: null, margemSobreVenda: null, markup: null, motivo: 'sem_custo' as const };
    for (const c of [carrinho, semCusto]) {
      for (const e of [{ parcial: { recebidos: 2, total: 3 }, composicaoIncerta: false }, { parcial: null, composicaoIncerta: true }]) {
        expect(montarMensagemCarrinho(c, k, 2000000001, e).split('\n')[1]).toBe('Lucro: — (carrinho incompleto)');
      }
    }
  });
  it('carrinho incompleto não lista prejuízo por item, mas mantém sem custo', () => {
    const c = { ...carrinho, prejuizos: [{ titulo: 'Máscara X', valor: -4.1 }], semCusto: ['Touca Y'] };
    for (const e of [{ parcial: { recebidos: 2, total: 3 }, composicaoIncerta: false }, { parcial: null, composicaoIncerta: true }]) {
      const m = montarMensagemCarrinho(c, k, 2000000001, e);
      expect(m).toContain('Lucro: — (carrinho incompleto)');
      expect(m).toContain('⚠️ Touca Y: sem custo cadastrado');
      expect(m).not.toContain('prejuízo de');
    }
  });
  it('nunca traz o comprador', () => {
    const comComprador = <T extends object>(o: T): T => ({ ...o, comprador_nome: COMPRADOR });
    const saidas = [
      montarMensagemCarrinho(comComprador(carrinho), comComprador(k), 2000000001, estado),
      montarResumoDiario(comComprador(resumo)),
      montarHoje(comComprador(k), comComprador(lucro)),
      montarMes(comComprador(k), comComprador(lucro)),
      montarTop(resumo.top.map(comComprador), 'Outubro', comComprador(lucro)),
    ];
    for (const t of saidas) expect(t).not.toContain(COMPRADOR);
  });
});

const lucro: LucroPeriodo = {
  lucro: 1020, motivo: null, pctVendaComLucro: 0.96, vendaSemCusto: 180, vendaSemImposto: 0,
  vendaCustoEstimado: 40, pedidosFreteNaoLido: 2, markup: 0.34,
};
const resumo: DadosResumo = {
  dia: '2026-10-23', ontem: { faturamento: 4870, pedidos: 31, ticket: 157.1 }, lucroOntem: lucro,
  mes: k.mes, anterior: k.anterior, rotuloMes: 'Outubro', rotuloAnterior: '1–23/set',
  top: [{ titulo: 'Shampoo X', lucro: 210 }, { titulo: 'Máscara Y', lucro: 150 }, { titulo: 'Kit Z', lucro: 90 }],
  atencao: { abaixoMinimo: 3, prejuizo: 1, semCusto: 2 },
  devolucoes: { estornado: 120, prazoProximo: 2 },
  promocoes: { prejuizo: 2, prazo: 1 },
  freteSubiu: ['Produto A', 'Produto B'],
  apuradoAte: '08:00',
};

describe('montarResumoDiario', () => {
  it('completo', () => {
    expect(montarResumoDiario(resumo)).toBe([
      '📊 Ontem (23/10)',
      'R$ 4.870,00 · 31 pedidos · ticket R$ 157,10',
      'Lucro R$ 1.020,00 · Markup 34,0%',
      'Outubro: R$ 41.200,00 · 260 pedidos · ticket R$ 158,46 · +12,3% vs 1–23/set',
      'Custo: 96% das vendas com lucro calculado · R$ 180,00 sem custo · R$ 40,00 com custo estimado · 2 pedidos sem frete lido',
      '🏆 Top lucro: Shampoo X (R$ 210,00), Máscara Y (R$ 150,00), Kit Z (R$ 90,00)',
      '⚠️ 3 abaixo do mínimo · 1 com prejuízo · 2 sem custo',
      '↩️ Devoluções: R$ 120,00 estornados · 2 reclamações com prazo em até 48 h',
      '🏷️ Promoções: 2 com prejuízo · 1 oportunidade com adesão vencendo',
      '🚚 Frete subiu: Produto A, Produto B',
      'Dados apurados até 08:00',
    ].join('\n'));
  });
  it('linhas somem quando vazias', () => {
    const r = montarResumoDiario({
      ...resumo, top: [], atencao: { abaixoMinimo: 0, prejuizo: 0, semCusto: 0 },
      devolucoes: { estornado: 0, prazoProximo: 0 }, promocoes: null, freteSubiu: [],
      lucroOntem: { ...lucro, vendaSemCusto: 0, vendaCustoEstimado: 0, pedidosFreteNaoLido: 0 },
    });
    expect(r).toBe([
      '📊 Ontem (23/10)',
      'R$ 4.870,00 · 31 pedidos · ticket R$ 157,10',
      'Lucro R$ 1.020,00 · Markup 34,0%',
      'Outubro: R$ 41.200,00 · 260 pedidos · ticket R$ 158,46 · +12,3% vs 1–23/set',
      'Custo: 96% das vendas com lucro calculado',
      'Dados apurados até 08:00',
    ].join('\n'));
  });
  it('alíquota não confirmada', () => {
    expect(montarResumoDiario({ ...resumo, lucroOntem: { ...lucro, lucro: null, motivo: 'aliquota_nao_confirmada', markup: null } }).split('\n')[2])
      .toBe('Lucro: — (alíquotas de imposto não confirmadas)');
  });
  it('venda sem alíquota na cobertura, entre custo estimado e frete', () => {
    const r = montarResumoDiario({ ...resumo, lucroOntem: { ...lucro, vendaSemImposto: 75 } });
    expect(r).toContain('R$ 40,00 com custo estimado · R$ 75,00 sem alíquota de imposto · 2 pedidos sem frete lido');
  });
});

describe('hoje / mes / top / textos fixos', () => {
  it('hoje', () => {
    expect(montarHoje(k, lucro)).toBe([
      '📅 Hoje',
      'R$ 2.340,00 · 14 pedidos · ticket R$ 167,14',
      'Lucro R$ 1.020,00 · Markup 34,0%',
      'Custo: 96% das vendas com lucro calculado · R$ 180,00 sem custo · R$ 40,00 com custo estimado · 2 pedidos sem frete lido',
    ].join('\n'));
  });
  it('mes', () => {
    expect(montarMes(k, lucro)).toBe([
      '📅 Outubro',
      'R$ 41.200,00 · 260 pedidos · ticket R$ 158,46 · +12,3% vs 1–24/set',
      'Lucro R$ 1.020,00 · Markup 34,0%',
      'Custo: 96% das vendas com lucro calculado · R$ 180,00 sem custo · R$ 40,00 com custo estimado · 2 pedidos sem frete lido',
    ].join('\n'));
  });
  it('top', () => {
    expect(montarTop(resumo.top, 'Outubro', lucro)).toBe([
      '🏆 Top lucro — Outubro', '1. Shampoo X — R$ 210,00', '2. Máscara Y — R$ 150,00', '3. Kit Z — R$ 90,00',
      'Custo: 96% das vendas com lucro calculado · R$ 180,00 sem custo · R$ 40,00 com custo estimado · 2 pedidos sem frete lido',
    ].join('\n'));
    expect(montarTop([], 'Outubro', lucro)).toBe('Sem lucro calculado em Outubro até agora.');
    expect(montarTop(resumo.top, 'Outubro', { ...lucro, lucro: null, motivo: 'aliquota_nao_confirmada' }))
      .toBe('🏆 Top lucro — Outubro\nLucro: — (alíquotas de imposto não confirmadas)');
  });
  it('textos', () => {
    expect(TEXTO_AJUDA.split('\n')).toEqual(expect.arrayContaining([
      expect.stringMatching(/^\/hoje\b/), expect.stringMatching(/^\/ontem\b/), expect.stringMatching(/^\/mes\b/),
      expect.stringMatching(/^\/top\b/), expect.stringMatching(/^\/ajuda\b/),
    ]));
    expect(TEXTO_VOLUME).toBe('O volume do mês passou do limite do bot. Veja os números no PubliAI.');
    for (const t of [TEXTO_SEM_ACESSO, TEXTO_SO_PRIVADO, TEXTO_ERRO]) expect(t.length).toBeGreaterThan(5);
  });
});
