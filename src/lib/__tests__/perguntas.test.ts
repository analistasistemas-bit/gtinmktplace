import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchPerguntasPagina, pergCasaStatus } from '@/lib/perguntas';
import { supabase } from '@/lib/supabase';

// Duas tabelas envolvidas: ml_perguntas (busca paginada) e ml_vendas (nome civil do comprador,
// via nomesPorComprador). Cada uma tem sua própria cadeia fluente espiada — mesmo padrão do
// mock em tests/lib/movimentos-estoque.test.ts.
const chamadas: Record<string, unknown[][]> = {};
function registrar(nome: string, args: unknown[]) {
  (chamadas[nome] ??= []).push(args);
}

const respostaPerguntas: { data: unknown[]; error: { message: string } | null; count: number } = {
  data: [], error: null, count: 0,
};
const cadeiaPerguntas: Record<string, unknown> = {};
for (const m of ['select', 'eq', 'neq', 'order', 'range']) {
  cadeiaPerguntas[m] = vi.fn((...args: unknown[]) => { registrar(m, args); return cadeiaPerguntas; });
}
cadeiaPerguntas.then = (resolve: (v: typeof respostaPerguntas) => unknown) =>
  Promise.resolve(respostaPerguntas).then(resolve);

const respostaVendas: { data: { comprador_id: number; comprador_nome: string }[] } = { data: [] };
const cadeiaVendas: Record<string, unknown> = {};
for (const m of ['select', 'in', 'not']) {
  cadeiaVendas[m] = vi.fn((...args: unknown[]) => { registrar(`vendas.${m}`, args); return cadeiaVendas; });
}
cadeiaVendas.then = (resolve: (v: typeof respostaVendas) => unknown) =>
  Promise.resolve(respostaVendas).then(resolve);

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((tabela: string) => (tabela === 'ml_vendas' ? cadeiaVendas : cadeiaPerguntas)),
  },
}));

function pergunta(i: number, over: Partial<{ status: string; comprador_id: number | null }> = {}) {
  return {
    id: `p${i}`, question_id: i, item_id: 'MLB1', item_titulo: 'Produto',
    comprador_id: i, comprador_nick: `nick${i}`, texto: `pergunta ${i}`,
    status: 'UNANSWERED', resposta: null, respondida_em: null,
    criada_em: new Date(Date.UTC(2026, 7, 8, 12, 0, 0) - i * 60_000).toISOString(),
    ...over,
  };
}

describe('lib/perguntas — fetchPerguntasPagina', () => {
  beforeEach(() => {
    for (const k of Object.keys(chamadas)) delete chamadas[k];
    respostaPerguntas.count = 0;
    respostaPerguntas.data = [];
    respostaPerguntas.error = null;
    respostaVendas.data = [];
  });

  it('pede o range da página pedida e devolve o total', async () => {
    respostaPerguntas.count = 47;
    const r = await fetchPerguntasPagina(3, 20);
    expect(chamadas.range).toEqual([[40, 59]]);
    expect(r.total).toBe(47);
  });

  it('sem filtro de status não recorta a query', async () => {
    await fetchPerguntasPagina(1, 20);
    expect(chamadas.eq).toBeUndefined();
    expect(chamadas.neq).toBeUndefined();
  });

  it('filtro "pendentes" manda status = UNANSWERED', async () => {
    await fetchPerguntasPagina(1, 20, { status: 'pendentes' });
    expect(chamadas.eq).toEqual([['status', 'UNANSWERED']]);
  });

  it('filtro "respondidas" manda status <> UNANSWERED', async () => {
    await fetchPerguntasPagina(1, 20, { status: 'respondidas' });
    expect(chamadas.neq).toEqual([['status', 'UNANSWERED']]);
  });

  it('filtro "todas" não recorta a query', async () => {
    await fetchPerguntasPagina(1, 20, { status: 'todas' });
    expect(chamadas.eq).toBeUndefined();
    expect(chamadas.neq).toBeUndefined();
  });

  it('ordena por criada_em decrescente', async () => {
    await fetchPerguntasPagina(1, 20);
    expect(chamadas.order).toEqual([['criada_em', { ascending: false }]]);
  });

  it('página zero ou negativa cai na primeira, sem offset negativo', async () => {
    await fetchPerguntasPagina(0, 20);
    expect(chamadas.range).toEqual([[0, 19]]);
  });

  it('propaga o erro do banco em vez de devolver lista vazia', async () => {
    respostaPerguntas.error = { message: 'boom' };
    await expect(fetchPerguntasPagina(1, 20)).rejects.toThrow('boom');
  });

  it('resolve o nome civil só para os compradores da página', async () => {
    respostaPerguntas.data = [pergunta(1, { comprador_id: 10 }), pergunta(2, { comprador_id: 20 })];
    respostaPerguntas.count = 2;
    respostaVendas.data = [{ comprador_id: 10, comprador_nome: 'Maria Silva' }];

    const r = await fetchPerguntasPagina(1, 20);
    expect(chamadas['vendas.in']).toEqual([['comprador_id', [10, 20]]]);
    expect(r.itens.find((p) => p.comprador_id === 10)?.comprador_nome).toBe('Maria Silva');
    expect(r.itens.find((p) => p.comprador_id === 20)?.comprador_nome).toBeNull();
  });

  it('usa o cliente supabase do projeto na tabela certa', async () => {
    await fetchPerguntasPagina(1, 20);
    expect(supabase.from).toHaveBeenCalledWith('ml_perguntas');
  });
});

describe('lib/perguntas — pergCasaStatus', () => {
  it('pendentes só casa com UNANSWERED', () => {
    expect(pergCasaStatus('UNANSWERED', 'pendentes')).toBe(true);
    expect(pergCasaStatus('ANSWERED', 'pendentes')).toBe(false);
  });

  it('respondidas casa com qualquer status diferente de UNANSWERED', () => {
    expect(pergCasaStatus('ANSWERED', 'respondidas')).toBe(true);
    expect(pergCasaStatus('CLOSED_UNANSWERED', 'respondidas')).toBe(true);
    expect(pergCasaStatus('UNANSWERED', 'respondidas')).toBe(false);
  });

  it('todas casa com qualquer status', () => {
    expect(pergCasaStatus('UNANSWERED', 'todas')).toBe(true);
    expect(pergCasaStatus('ANSWERED', 'todas')).toBe(true);
  });
});
