import { describe, expect, it } from 'vitest';
import {
  brl, encurtar, linhaCrescimento, montarHoje, montarMensagemCarrinho, montarMes, montarResumoDiario, montarTop,
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
  '',
  '📅 Hoje', 'R$ 2.340,00 · 14 pedidos', 'Ticket médio: R$ 167,14',
  '',
  '📆 Outubro', 'R$ 41.200,00 · 260 pedidos', 'Ticket médio: R$ 158,46', '📈 +12,3% vs 1–24/set',
  '',
  '🔗 Pedido 2000000001',
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
      '💵 Lucro: R$ 54,82', '📊 Margem s/ venda: 28,9%', `📈 Markup: ${markup}%`,
      ...rodape,
    ].join('\n'));
  });
  it('percentuais negativos usam o sinal tipográfico', () => {
    const c = { ...carrinho, lucro: -19.95, margemSobreVenda: -0.04, markup: -0.075 };
    const m = montarMensagemCarrinho(c, k, 2000000001, estado);
    expect(m).toContain('💵 Lucro: −R$ 19,95\n📊 Margem s/ venda: −4,0%\n📈 Markup: −7,5%');
  });
  it('sem custo', () => {
    const c = { ...carrinho, lucro: null, motivo: 'sem_custo' as const, margemSobreVenda: null, markup: null, semCusto: ['Máscara X'] };
    expect(montarMensagemCarrinho(c, k, 2000000001, estado)).toBe([
      L1, '💵 Lucro: — (sem custo em 1 item)', '', '⚠️ Máscara X: sem custo cadastrado', ...rodape,
    ].join('\n'));
  });
  it('frete e alíquota', () => {
    const base = { ...carrinho, lucro: null, margemSobreVenda: null, markup: null };
    expect(montarMensagemCarrinho({ ...base, motivo: 'frete_nao_lido' }, k, 2000000001, estado))
      .toContain('\n💵 Lucro: — (frete não lido no ML)\n');
    expect(montarMensagemCarrinho({ ...base, motivo: 'aliquota_nao_confirmada' }, k, 2000000001, estado))
      .toContain('\n💵 Lucro: — (alíquotas de imposto não confirmadas)\n');
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
        expect(montarMensagemCarrinho(c, k, 2000000001, e).split('\n')[1]).toBe('💵 Lucro: — (carrinho incompleto)');
      }
    }
  });
  it('carrinho incompleto não lista prejuízo por item, mas mantém sem custo', () => {
    const c = { ...carrinho, prejuizos: [{ titulo: 'Máscara X', valor: -4.1 }], semCusto: ['Touca Y'] };
    for (const e of [{ parcial: { recebidos: 2, total: 3 }, composicaoIncerta: false }, { parcial: null, composicaoIncerta: true }]) {
      const m = montarMensagemCarrinho(c, k, 2000000001, e);
      expect(m).toContain('💵 Lucro: — (carrinho incompleto)');
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
  atencao: { abaixoMinimo: 3, prejuizo: 1, semCusto: 2, prejuizos: [] },
  estoque: null,
  devolucoes: { estornado: 120, prazoProximo: 2 },
  promocoes: { prejuizo: 2, prazo: 1 },
  freteSubiu: ['Produto A', 'Produto B'],
  apuradoAte: '08:00',
};

describe('montarResumoDiario', () => {
  it('completo', () => {
    expect(montarResumoDiario(resumo)).toBe([
      '📊 Ontem · 23/10',
      '',
      '💰 Faturamento: R$ 4.870,00', '🧾 Pedidos: 31', '🎟️ Ticket médio: R$ 157,10',
      '💵 Lucro: R$ 1.020,00', '📈 Markup: 34,0%',
      '',
      '📆 Outubro', 'R$ 41.200,00 · 260 pedidos', 'Ticket médio: R$ 158,46', '📈 +12,3% vs 1–23/set',
      '',
      '🏆 Top lucro', '1. Shampoo X — R$ 210,00', '2. Máscara Y — R$ 150,00', '3. Kit Z — R$ 90,00',
      '',
      '⚠️ Atenção', '• 3 abaixo do mínimo', '• 1 com prejuízo', '• 2 sem custo',
      '',
      '↩️ Devoluções', '• R$ 120,00 estornados', '• 2 reclamações com prazo em até 48 h',
      '',
      '🏷️ Promoções', '• 2 com prejuízo', '• 1 oportunidade com adesão vencendo',
      '',
      '🚚 Frete subiu', '• Produto A', '• Produto B',
      '',
      'Lucro calculado em 96% das vendas', '• R$ 180,00 sem custo', '• R$ 40,00 com custo estimado', '• 2 pedidos sem frete lido',
      'Apurado às 08:00',
    ].join('\n'));
  });
  it('linhas somem quando vazias', () => {
    const r = montarResumoDiario({
      ...resumo, top: [], atencao: { abaixoMinimo: 0, prejuizo: 0, semCusto: 0, prejuizos: [] },
      devolucoes: { estornado: 0, prazoProximo: 0 }, promocoes: null, freteSubiu: [],
      lucroOntem: { ...lucro, vendaSemCusto: 0, vendaCustoEstimado: 0, pedidosFreteNaoLido: 0 },
    });
    expect(r).toBe([
      '📊 Ontem · 23/10',
      '',
      '💰 Faturamento: R$ 4.870,00', '🧾 Pedidos: 31', '🎟️ Ticket médio: R$ 157,10',
      '💵 Lucro: R$ 1.020,00', '📈 Markup: 34,0%',
      '',
      '📆 Outubro', 'R$ 41.200,00 · 260 pedidos', 'Ticket médio: R$ 158,46', '📈 +12,3% vs 1–23/set',
      '',
      'Lucro calculado em 96% das vendas',
      'Apurado às 08:00',
    ].join('\n'));
  });
  it('alíquota não confirmada', () => {
    expect(montarResumoDiario({ ...resumo, lucroOntem: { ...lucro, lucro: null, motivo: 'aliquota_nao_confirmada', markup: null } }).split('\n')[5])
      .toBe('💵 Lucro: — (alíquotas de imposto não confirmadas)');
  });
  it('venda sem alíquota na cobertura, entre custo estimado e frete', () => {
    const r = montarResumoDiario({ ...resumo, lucroOntem: { ...lucro, vendaSemImposto: 75 } });
    expect(r).toContain('• R$ 40,00 com custo estimado\n• R$ 75,00 sem alíquota de imposto\n• 2 pedidos sem frete lido');
  });
});

describe('hoje / mes / top / textos fixos', () => {
  it('hoje', () => {
    expect(montarHoje(k, lucro)).toBe([
      '📅 Hoje',
      '',
      '💰 Faturamento: R$ 2.340,00', '🧾 Pedidos: 14', '🎟️ Ticket médio: R$ 167,14',
      '💵 Lucro: R$ 1.020,00', '📈 Markup: 34,0%',
      '',
      'Lucro calculado em 96% das vendas', '• R$ 180,00 sem custo', '• R$ 40,00 com custo estimado', '• 2 pedidos sem frete lido',
    ].join('\n'));
  });
  it('mes', () => {
    expect(montarMes(k, lucro)).toBe([
      '📆 Outubro',
      '',
      '💰 Faturamento: R$ 41.200,00', '🧾 Pedidos: 260', '🎟️ Ticket médio: R$ 158,46',
      '📈 +12,3% vs 1–24/set',
      '💵 Lucro: R$ 1.020,00', '📈 Markup: 34,0%',
      '',
      'Lucro calculado em 96% das vendas', '• R$ 180,00 sem custo', '• R$ 40,00 com custo estimado', '• 2 pedidos sem frete lido',
    ].join('\n'));
  });
  it('top', () => {
    expect(montarTop(resumo.top, 'Outubro', lucro)).toBe([
      '🏆 Top lucro — Outubro', '', '1. Shampoo X — R$ 210,00', '2. Máscara Y — R$ 150,00', '3. Kit Z — R$ 90,00',
      '',
      'Lucro calculado em 96% das vendas', '• R$ 180,00 sem custo', '• R$ 40,00 com custo estimado', '• 2 pedidos sem frete lido',
    ].join('\n'));
    expect(montarTop([], 'Outubro', lucro)).toBe('Sem lucro calculado em Outubro até agora.');
    expect(montarTop(resumo.top, 'Outubro', { ...lucro, lucro: null, motivo: 'aliquota_nao_confirmada' }))
      .toBe('🏆 Top lucro — Outubro\n\n💵 Lucro: — (alíquotas de imposto não confirmadas)');
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

const LONGO = 'Protetor Solar Facial Eucerin Pigment Control Fps 60 50ml';
describe('encurtar / títulos nas mensagens', () => {
  it('corta no último espaço antes do limite e põe reticências', () => {
    expect(encurtar(LONGO)).toBe('Protetor Solar Facial Eucerin Pigment…');
    expect(encurtar('  Curto  ')).toBe('Curto');
    expect(encurtar('X'.repeat(50))).toBe(`${'X'.repeat(40)}…`);
  });
  it('aplica em top, /top, atenção e frete subiu', () => {
    const e = 'Protetor Solar Facial Eucerin Pigment…';
    const top = [{ titulo: LONGO, lucro: 35.27 }];
    expect(montarResumoDiario({ ...resumo, top, freteSubiu: [LONGO] })).toContain(`🏆 Top lucro\n1. ${e} — R$ 35,27`);
    expect(montarResumoDiario({ ...resumo, top, freteSubiu: [LONGO] })).toContain(`🚚 Frete subiu\n• ${e}`);
    expect(montarTop(top, 'Outubro', lucro)).toContain(`1. ${e} — R$ 35,27`);
    const c = { ...carrinho, prejuizos: [{ titulo: LONGO, valor: -4.1 }], semCusto: [LONGO] };
    const m = montarMensagemCarrinho(c, k, 2000000001, { parcial: null, composicaoIncerta: false });
    expect(m).toContain(`⚠️ ${e}: prejuízo de R$ 4,10`);
    expect(m).toContain(`⚠️ ${e}: sem custo cadastrado`);
  });
});

describe('resumo: estoque acabando e prejuízo nomeado', () => {
  const it4 = [
    { codigo: 'A', nome: 'Shampoo X', estoque: 0, porDia: 3, cobertura: 0, zerado: true, lucro30: 900 },
    { codigo: 'B', nome: 'Máscara Y', estoque: 8, porDia: 2.25, cobertura: 3, zerado: false, lucro30: 700 },
    { codigo: 'C', nome: 'Touca Z', estoque: 1, porDia: 0.5, cobertura: 1, zerado: false, lucro30: 500 },
    { codigo: 'D', nome: 'Pente W', estoque: 5, porDia: 1, cobertura: 5, zerado: false, lucro30: 400 },
  ];
  const prej = [
    { nome: 'Item A', valor: -40.5, vendas: 3 }, { nome: 'Item B', valor: -20, vendas: 1 },
    { nome: 'Item C', valor: -10, vendas: 2 }, { nome: 'Item D', valor: -4.1, vendas: 1 },
  ];
  const base = { ...resumo, atencao: { abaixoMinimo: 3, prejuizo: 4, semCusto: 2, prejuizos: prej } };

  it('bloco 📦 com 3 itens + e mais, entre o mês e o top', () => {
    const r = montarResumoDiario({ ...base, estoque: it4 });
    expect(r).toContain([
      '📦 Estoque acabando',
      '• Shampoo X — zerado (vendia 3/dia)',
      '• Máscara Y — 8 un. · 2,3/dia · 3 dias',
      '• Touca Z — 1 un. · 0,5/dia · 1 dia',
      '• e mais 1',
    ].join('\n'));
    const pos = ['📆 Outubro', '📦 Estoque', '🏆 Top', '⚠️ Atenção'].map((s) => r.indexOf(s));
    expect(pos.every((x) => x >= 0) && [...pos].sort((a, b) => a - b).join() === pos.join()).toBe(true);
  });
  it('estoque null ou vazio → sem seção', () => {
    expect(montarResumoDiario({ ...base, estoque: null })).not.toContain('📦');
    expect(montarResumoDiario({ ...base, estoque: [] })).not.toContain('📦');
  });
  it('prejuízo nomeado: 3 linhas + e mais N com prejuízo; outras contagens seguem', () => {
    expect(montarResumoDiario(base)).toContain([
      '⚠️ Atenção', '• 3 abaixo do mínimo',
      '• Prejuízo: Item A — −R$ 40,50 (3 vendas)',
      '• Prejuízo: Item B — −R$ 20,00 (1 venda)',
      '• Prejuízo: Item C — −R$ 10,00 (2 vendas)',
      '• e mais 1 com prejuízo', '• 2 sem custo',
    ].join('\n'));
  });
  it('prejuizos vazio com contagem > 0 → linha contada antiga', () => {
    expect(montarResumoDiario({ ...base, atencao: { ...base.atencao, prejuizos: [] } })).toContain('• 4 com prejuízo');
  });
});
