import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  motivosDosGrupos, fetchMovimentosEstoque, GRUPOS_MOTIVO,
} from '@/lib/movimentos-estoque';
import { supabase } from '@/lib/supabase';

// Cadeia fluente do PostgREST: cada método devolve o próprio objeto, e o `await` no final
// resolve pelo `then`. Assim um único espião registra a query inteira que foi montada.
const chamadas: Record<string, unknown[][]> = {};
function registrar(nome: string, args: unknown[]) {
  (chamadas[nome] ??= []).push(args);
}

const resposta = { data: [], error: null, count: 0 };

const cadeia: Record<string, unknown> = {};
for (const m of ['select', 'eq', 'in', 'gte', 'lte', 'order', 'range']) {
  cadeia[m] = vi.fn((...args: unknown[]) => { registrar(m, args); return cadeia; });
}
cadeia.then = (resolve: (v: typeof resposta) => unknown) => Promise.resolve(resposta).then(resolve);

vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn(() => cadeia) },
}));

describe('lib/movimentos-estoque', () => {
  beforeEach(() => {
    for (const k of Object.keys(chamadas)) delete chamadas[k];
    resposta.count = 0;
    resposta.data = [];
  });

  it('mapeia cada grupo para os motivos do ledger', () => {
    expect(motivosDosGrupos(['entradas'])).toEqual(['entrada']);
    expect(motivosDosGrupos(['vendas'])).toEqual([
      'venda', 'venda_sku_nao_encontrado', 'venda_cancelada_antes',
    ]);
    expect(motivosDosGrupos(['estornos'])).toEqual([
      'estorno_venda', 'estorno_sku_nao_encontrado', 'cancelamento_sem_baixa',
    ]);
  });

  it('sem grupo escolhido não recorta motivo nenhum', () => {
    expect(motivosDosGrupos([])).toEqual([]);
    // Todos os grupos juntos cobrem os 7 motivos — nenhum fica órfão de classificação.
    expect(motivosDosGrupos([...GRUPOS_MOTIVO])).toHaveLength(7);
  });

  it('pede o range da página pedida e devolve o total', async () => {
    resposta.count = 956;
    const r = await fetchMovimentosEstoque('00000004', 3, 20);
    expect(chamadas.range).toEqual([[40, 59]]);
    expect(chamadas.order).toEqual([['criado_em', { ascending: false }]]);
    expect(r.total).toBe(956);
  });

  it('não manda filtro de motivo quando nenhum grupo foi escolhido', async () => {
    await fetchMovimentosEstoque('00000004', 1, 20, { grupos: [] });
    expect(chamadas.in).toBeUndefined();
  });

  it('recorta por motivo, janela e SKU quando pedidos', async () => {
    await fetchMovimentosEstoque('00000004', 1, 20, {
      grupos: ['entradas'],
      janela: { desde: '2026-08-01T00:00:00.000Z', ate: '2026-08-07T23:59:59.999Z' },
      codigo: '00000005',
    });
    expect(chamadas.in).toEqual([['motivo', ['entrada']]]);
    expect(chamadas.gte).toEqual([['criado_em', '2026-08-01T00:00:00.000Z']]);
    expect(chamadas.lte).toEqual([['criado_em', '2026-08-07T23:59:59.999Z']]);
    expect(chamadas.eq).toEqual([['codigo_pai', '00000004'], ['codigo', '00000005']]);
  });

  it('inverte a ordem quando pedido do mais antigo', async () => {
    await fetchMovimentosEstoque('00000004', 1, 20, { ordem: 'antigos' });
    expect(chamadas.order).toEqual([['criado_em', { ascending: true }]]);
  });

  it('página zero ou negativa cai na primeira, sem offset negativo', async () => {
    await fetchMovimentosEstoque('00000004', 0, 20);
    expect(chamadas.range).toEqual([[0, 19]]);
  });

  it('propaga o erro do banco em vez de devolver lista vazia', async () => {
    resposta.error = { message: 'boom' } as never;
    await expect(fetchMovimentosEstoque('00000004')).rejects.toBeTruthy();
    resposta.error = null;
  });

  it('usa o cliente supabase do projeto', async () => {
    await fetchMovimentosEstoque('00000004');
    expect(supabase.from).toHaveBeenCalledWith('estoque_movimentos');
  });
});
