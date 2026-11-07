import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { MLApiError } from '../../ml/erro-ml.ts';
import {
  avancarSaga, criarTransferencia, quarentenaDoEnv,
  type AlvoSaga, type DepsSaga, type PassoSaga, type ResultadoPasso, type TransferenciaSaga,
} from '../saga.ts';
import type { PedidoPendente } from '../conciliacao.ts';

// Tudo falso: banco em memória e ML em memória. `chamadas` registra cada escrita no ML, em ordem.
interface ItemFalso { id: string; status: string; subStatus: string[] }
interface UpFalso { quantidade: number; itens: ItemFalso[]; locais?: string[] }

const T = 300;
const INICIO = Date.parse('2026-11-07T12:00:00.000Z');

function alvo(up_id: string, codigo: string, papel: 'origem' | 'destino', delta: number, item_ids: string[]): AlvoSaga {
  return {
    up_id, codigo, papel, delta, item_ids, qtd_passo1: null, passo1_em: null, ids_passo1: null,
    valor_anterior: null, valor_alvo: null, pausado_pela_saga: [], intencao_escrita_em: null,
    recusa_definitiva_em: null, escrita_em: null, confirmada_em: null,
  };
}

const ativo = (id: string): ItemFalso => ({ id, status: 'active', subStatus: [] });

function cenario() {
  const ups: Record<string, UpFalso> = {
    'UP-P': { quantidade: 5, itens: [ativo('MLB-P')] },
    'UP-B': { quantidade: 5, itens: [ativo('MLB-B'), ativo('MLB-BC')] },
    'UP-K': { quantidade: 2, itens: [ativo('MLB-K')] },
  };
  const saldo: Record<string, number> = { P: 5, B: 5, K: 2 };
  const t: TransferenciaSaga = {
    id: 'T1', org_id: 'ORG', tipo: 'montar', passo: 'pausar', estado: 'ativa', versao_politica: 7,
    passo_em: new Date(INICIO).toISOString(), alerta: null,
  };
  const alvos = [
    alvo('UP-P', 'P', 'origem', -1, ['MLB-P']),
    alvo('UP-B', 'B', 'origem', -1, ['MLB-B', 'MLB-BC']),
    alvo('UP-K', 'K', 'destino', 1, ['MLB-K']),
  ];
  const s = {
    ups, saldo, t, alvos,
    agora: INICIO,
    versaoPolitica: 7,
    semReativar: [] as string[],
    pendentes: [] as PedidoPendente[],
    falhasImportacao: [] as string[],
    baixas: [] as Array<{ orderId: string; resultado: never }>,
    chamadas: [] as string[],
    rpcs: [] as string[],
    alertas: [] as string[],
    filas: [] as number[],
    token: null as string | null,
    reservado: false,
    creditado: false,
    /** Falha injetada no PUT de quantidade: devolve o erro a lançar (e se aplica antes) ou null. */
    falhaPut: (_itemId: string, _q: number): { erro: Error; aplica: boolean } | null => null,
    /** Pausa que o ML ignora (item `out_of_stock` sem efeito do PUT). */
    pausaIgnorada: new Set<string>(),
    falhaSalvarAlvo: (_patch: Partial<AlvoSaga>): Error | null => null,
    seq: 0,
  };

  const upDoItem = (itemId: string) => Object.values(ups).find((u) => u.itens.some((i) => i.id === itemId))!;
  const itemPorId = (itemId: string) => upDoItem(itemId).itens.find((i) => i.id === itemId)!;

  const deps: DepsSaga = {
    repo: {
      async reivindicar(_id, token) {
        if (s.token !== null || s.t.estado !== 'ativa') return false;
        s.token = token;
        return true;
      },
      async carregar() {
        return { transferencia: structuredClone(s.t), alvos: structuredClone(s.alvos) };
      },
      async salvarTransferencia(_id, token, patch) {
        if (token !== s.token) throw new Error('perdeu a execução');
        Object.assign(s.t, patch);
      },
      async salvarAlvo(_id, upId, patch) {
        const erro = s.falhaSalvarAlvo(patch);
        if (erro) throw erro;
        Object.assign(s.alvos.find((a) => a.up_id === upId)!, structuredClone(patch));
      },
      async liberar(_id, token) {
        if (s.token === token) s.token = null;
      },
      async politica() {
        return { versao: s.versaoPolitica, semReativar: s.semReativar };
      },
      async saldoLocal(codigo) {
        return s.saldo[codigo];
      },
      async rpc(nome) {
        s.rpcs.push(nome);
        if (nome === 'kit_reservar_transferencia' && !s.reservado) {
          s.reservado = true; s.saldo.P -= 1; s.saldo.B -= 1;
        }
        if (nome === 'kit_creditar_transferencia' && !s.creditado) {
          s.creditado = true; s.saldo.K += 1;
        }
        return { ok: true };
      },
    },
    ml: {
      async lerOferta(upId, esperados) {
        const u = ups[upId];
        for (const id of esperados) if (!u.itens.some((i) => i.id === id)) throw new Error(`sem ${id}`);
        const locais = (u.locais ?? ['selling_address']).map((type) => ({ type, quantity: u.quantidade }));
        return {
          upId, versao: 1, locais, quantidade: u.quantidade,
          itens: structuredClone(u.itens),
          somenteSellingAddress: locais.every((l) => l.type === 'selling_address'),
        };
      },
      async listarPendentes() {
        return s.pendentes;
      },
      async importarPedidos() {
        return { pagos: [], naoPagos: [], falhas: s.falhasImportacao, baixas: s.baixas };
      },
      async putQuantidade(itemId, q) {
        s.chamadas.push(`qtd ${itemId} ${q}`);
        const f = s.falhaPut(itemId, q);
        if (!f || f.aplica) upDoItem(itemId).quantidade = q;
        if (f) throw f.erro;
      },
      async putStatus(itemId, status) {
        s.chamadas.push(`${status} ${itemId}`);
        if (s.pausaIgnorada.has(itemId)) return;
        const i = itemPorId(itemId);
        if (status === 'paused') {
          i.status = 'paused';
          if (!i.subStatus.includes('paused_by_seller')) i.subStatus.push('paused_by_seller');
        } else {
          i.status = 'active';
          i.subStatus = i.subStatus.filter((x) => x !== 'paused_by_seller');
        }
      },
    },
    async enfileirar(_id, delayS) { s.filas.push(delayS); },
    async alertar(texto) { s.alertas.push(texto); },
    agora: () => new Date(s.agora),
    quarentenaS: T,
    novoToken: () => `tok-${++s.seq}`,
  };
  return { s, deps };
}

type Cenario = ReturnType<typeof cenario>;

/** Uma invocação; o relógio anda o atraso que a saga pediu à fila. */
async function passo(c: Cenario): Promise<ResultadoPasso> {
  const antes = c.s.filas.length;
  const r = await avancarSaga(c.deps, 'T1');
  if (c.s.filas.length > antes) c.s.agora += c.s.filas[c.s.filas.length - 1] * 1000;
  return r;
}

async function rodar(c: Cenario, ate?: (c: Cenario) => boolean, limite = 40): Promise<void> {
  for (let i = 0; i < limite; i++) {
    if (c.s.t.estado !== 'ativa' || (ate && ate(c))) return;
    await passo(c);
  }
}

const noPasso = (p: PassoSaga) => (c: Cenario) => c.s.t.passo === p;
const qtdPuts = (c: Cenario, itemId: string) => c.s.chamadas.filter((x) => x.startsWith(`qtd ${itemId} `)).length;

describe('avancarSaga', () => {
  it('sequência feliz: pausa, espera T, reduz, confirma, aumenta, credita e reativa', async () => {
    const c = cenario();
    await rodar(c);

    expect(c.s.t).toMatchObject({ estado: 'concluida', passo: 'fim' });
    expect([c.s.ups['UP-P'].quantidade, c.s.ups['UP-B'].quantidade, c.s.ups['UP-K'].quantidade]).toEqual([4, 4, 3]);
    expect(c.s.chamadas).toEqual([
      'paused MLB-P', 'paused MLB-B', 'paused MLB-BC', 'paused MLB-K',
      'qtd MLB-P 4', 'qtd MLB-B 4', 'qtd MLB-K 3',
      'active MLB-P', 'active MLB-B', 'active MLB-BC', 'active MLB-K',
    ]);
    expect(c.s.rpcs).toEqual(['kit_reservar_transferencia', 'kit_creditar_transferencia', 'kit_soltar_exclusao']);
    expect(c.s.alvos.map((a) => [a.valor_anterior, a.valor_alvo])).toEqual([[5, 4], [5, 4], [2, 3]]);
    // Quarentena: nenhuma conciliação antes de T depois da pausa confirmada.
    expect(c.s.filas).toContain(T);
    expect(c.s.agora - Date.parse(c.s.alvos[0].passo1_em!)).toBeGreaterThanOrEqual(T * 1000);
    expect(c.s.alertas).toEqual([]);
  });

  it('grava qtd_passo1, instante e ids_passo1 da leitura que confirma a pausa', async () => {
    const c = cenario();
    c.s.pendentes = [{ id: 99, order_items: [{ item: { id: 'MLB-B' }, quantity: 1 }], payments: [{ status: 'rejected' }] } as PedidoPendente];
    await rodar(c, noPasso('aguardar'));
    expect(c.s.alvos.map((a) => [a.qtd_passo1, a.ids_passo1])).toEqual([[5, []], [5, ['99']], [2, []]]);
    expect(c.s.alvos.every((a) => a.passo1_em === new Date(c.s.agora - T * 1000).toISOString())).toBe(true);
  });

  it('reentrega do mesmo passo não duplica escrita nem movimento', async () => {
    const c = cenario();
    for (let i = 0; i < 60 && c.s.t.estado === 'ativa'; i++) {
      const anterior = c.s.t.passo;
      await passo(c);
      // A mesma mensagem chega de novo, como se o avanço não tivesse sido gravado.
      if (c.s.t.estado === 'ativa') c.s.t.passo = anterior;
      await passo(c);
    }
    expect(c.s.t.estado).toBe('concluida');
    for (const id of ['MLB-P', 'MLB-B', 'MLB-K']) expect(qtdPuts(c, id)).toBe(1);
    expect(c.s.chamadas.filter((x) => x.startsWith('paused')).length).toBe(4);
    expect(c.s.chamadas.filter((x) => x.startsWith('active')).length).toBe(4);
    expect(c.s.saldo).toEqual({ P: 4, B: 4, K: 3 });
  });

  it('timeout com leitura igual ao alvo conclui', async () => {
    const c = cenario();
    c.s.falhaPut = (id) => (id === 'MLB-P' ? { erro: new TypeError('network timeout'), aplica: true } : null);
    await rodar(c);
    expect(c.s.t.estado).toBe('concluida');
    expect(qtdPuts(c, 'MLB-P')).toBe(1);
  });

  it('timeout com leitura igual ao anterior trava sem reenviar (caso do Grok)', async () => {
    const c = cenario();
    c.s.falhaPut = (id) => (id === 'MLB-P' ? { erro: new TypeError('network timeout'), aplica: false } : null);
    await rodar(c);
    expect(c.s.t.estado).toBe('travada');
    expect(c.s.t.alerta).toMatch(/P/);
    expect(qtdPuts(c, 'MLB-P')).toBe(1);
    expect(qtdPuts(c, 'MLB-K')).toBe(0);
    expect(c.s.rpcs).not.toContain('kit_soltar_exclusao');
    expect(c.s.chamadas.some((x) => x.startsWith('active'))).toBe(false);
    expect(c.s.alertas).toHaveLength(1);
  });

  it('alerta que falha não apaga o motivo da trava nem o passo', async () => {
    const c = cenario();
    c.s.falhaPut = (id) => (id === 'MLB-P' ? { erro: new TypeError('network timeout'), aplica: false } : null);
    c.deps.alertar = async () => { throw new Error('telegram fora'); };
    await rodar(c);
    expect(c.s.t).toMatchObject({ estado: 'travada', passo: 'confirmar_reducao' });
    expect(c.s.t.alerta).toMatch(/P: ML com 5, esperado 4/);
  });

  it('408 também é incerto: não reenvia', async () => {
    const c = cenario();
    c.s.falhaPut = (id) => (id === 'MLB-P' ? { erro: new MLApiError(408, 'timeout'), aplica: false } : null);
    await rodar(c);
    expect(c.s.t.estado).toBe('travada');
    expect(qtdPuts(c, 'MLB-P')).toBe(1);
  });

  it('4xx grava a recusa e repete', async () => {
    const c = cenario();
    let recusas = 1;
    c.s.falhaPut = (id) => (id === 'MLB-P' && recusas-- > 0 ? { erro: new MLApiError(400, 'recusado'), aplica: false } : null);
    await rodar(c);
    expect(c.s.t.estado).toBe('concluida');
    expect(qtdPuts(c, 'MLB-P')).toBe(2);
    expect(c.s.ups['UP-P'].quantidade).toBe(4);
  });

  it('queda depois do PUT e antes de persistir a resposta não reenvia', async () => {
    const c = cenario();
    let quedas = 1;
    c.s.falhaSalvarAlvo = (patch) => ('escrita_em' in patch && quedas-- > 0 ? new Error('conexão caiu') : null);
    await rodar(c);
    expect(c.s.t.estado).toBe('concluida');
    expect(qtdPuts(c, 'MLB-P')).toBe(1);
  });

  it('dúvida na conciliação bloqueia: não reserva nem escreve, e reagenda', async () => {
    const c = cenario();
    await rodar(c, noPasso('conciliar'));
    c.s.pendentes = [{ id: 1, order_items: [{ item: { id: 'MLB-P' }, quantity: 1 }], payments: [{ status: 'in_process' }] } as PedidoPendente];
    for (let i = 0; i < 3; i++) expect((await passo(c)).acao).toBe('reagendada');
    expect(c.s.t.passo).toBe('conciliar');
    expect(c.s.rpcs).toEqual([]);
    expect(c.s.chamadas.some((x) => x.startsWith('qtd'))).toBe(false);
  });

  it('falha na importação de pedidos bloqueia', async () => {
    const c = cenario();
    await rodar(c, noPasso('conciliar'));
    c.s.falhasImportacao = ['pedido 1: SKU fora do catálogo: X'];
    expect((await passo(c)).acao).toBe('reagendada');
    expect(c.s.t.passo).toBe('conciliar');
    expect(c.s.rpcs).toEqual([]);
    expect(c.s.alertas.join()).toMatch(/fora do catálogo/);
  });

  it('baixa importada com venda acima do saldo vira alerta', async () => {
    const c = cenario();
    await rodar(c, noPasso('conciliar'));
    c.s.baixas = [{ orderId: '5', resultado: { vendaAcimaSaldo: [{ codigo: 'P', pedido: 2, anterior: 1, aplicado: 1 }], desyncMl: [] } as never }];
    await passo(c);
    expect(c.s.alertas.join()).toMatch(/acima do saldo em P \(pedido 5\)/);
  });

  it('pedido pendente que come a peça da origem aborta sem reservar', async () => {
    const c = cenario();
    c.s.saldo.P = 1;
    await rodar(c, noPasso('conciliar'));
    c.s.pendentes = [{ id: 1, order_items: [{ item: { id: 'MLB-P' }, quantity: 1 }], payments: [{ status: 'pending' }] } as PedidoPendente];
    await rodar(c);
    expect(c.s.t.estado).toBe('abortada');
    expect(c.s.rpcs).not.toContain('kit_reservar_transferencia');
    expect(c.s.chamadas.some((x) => x.startsWith('qtd'))).toBe(false);
    // Aborto comum devolve ao ar o que a saga pausou.
    expect(c.s.chamadas.filter((x) => x.startsWith('active')).length).toBe(4);
  });

  it('versao_politica velha aborta sem reativar', async () => {
    const c = cenario();
    await rodar(c, noPasso('conciliar'));
    c.s.versaoPolitica = 8;
    await rodar(c);
    expect(c.s.t.estado).toBe('abortada');
    expect(c.s.chamadas.some((x) => x.startsWith('active') || x.startsWith('qtd'))).toBe(false);
    expect(c.s.rpcs).toEqual(['kit_cancelar_transferencia', 'kit_soltar_exclusao']);
  });

  it('política que muda antes do início aborta sem pausar nada', async () => {
    const c = cenario();
    c.s.versaoPolitica = 8;
    await rodar(c);
    expect(c.s.t.estado).toBe('abortada');
    expect(c.s.chamadas).toEqual([]);
  });

  it('reentrega antecipada não fura a quarentena', async () => {
    const c = cenario();
    await rodar(c, noPasso('aguardar'));
    c.s.agora -= 100_000;
    expect(await avancarSaga(c.deps, 'T1')).toMatchObject({ acao: 'reagendada', passo: 'aguardar' });
    expect(c.s.filas.at(-1)).toBe(100);
    expect(c.s.t.passo).toBe('aguardar');
  });

  it('política que muda depois do crédito conclui sem reativar', async () => {
    const c = cenario();
    await rodar(c, noPasso('reativar'));
    c.s.versaoPolitica = 8;
    await rodar(c);
    expect(c.s.t.estado).toBe('concluida');
    expect(c.s.chamadas.some((x) => x.startsWith('active'))).toBe(false);
    expect(c.s.alertas).toHaveLength(1);
  });

  it('SKU que a política vigente bloqueia não é reativado', async () => {
    const c = cenario();
    c.s.semReativar = ['P'];
    await rodar(c);
    expect(c.s.t.estado).toBe('concluida');
    expect(c.s.chamadas).not.toContain('active MLB-P');
    expect(c.s.chamadas).toContain('active MLB-K');
  });

  it('item com pausa manual antes da saga não é reativado (Review Focus 1)', async () => {
    const c = cenario();
    c.s.ups['UP-B'].itens[1] = { id: 'MLB-BC', status: 'paused', subStatus: ['paused_by_seller'] };
    await rodar(c);
    expect(c.s.t.estado).toBe('concluida');
    expect(c.s.chamadas).not.toContain('paused MLB-BC');
    expect(c.s.chamadas).not.toContain('active MLB-BC');
    expect(c.s.chamadas).toContain('active MLB-B');
    expect(c.s.alvos[1].pausado_pela_saga).toEqual(['MLB-B']);
  });

  it('item moderado durante a saga trava e nunca reativa (Review Focus 3)', async () => {
    const c = cenario();
    await rodar(c, noPasso('conciliar'));
    // Mantém `paused_by_seller`: só a regra de moderação pega.
    c.s.ups['UP-K'].itens[0] = { id: 'MLB-K', status: 'paused', subStatus: ['paused_by_seller', 'forbidden'] };
    await rodar(c);
    expect(c.s.t.estado).toBe('travada');
    expect(c.s.t.alerta).toMatch(/MLB-K moderado/);
    expect(c.s.chamadas.some((x) => x.startsWith('active') || x.startsWith('qtd'))).toBe(false);
    expect(c.s.rpcs).not.toContain('kit_soltar_exclusao');
    expect(await passo(c)).toMatchObject({ acao: 'ocupada' });
  });

  it('item moderado entre o crédito e a reativação não volta ao ar', async () => {
    const c = cenario();
    await rodar(c, noPasso('reativar'));
    c.s.ups['UP-K'].itens[0] = { id: 'MLB-K', status: 'paused', subStatus: ['paused_by_seller', 'forbidden'] };
    await rodar(c);
    expect(c.s.t.estado).toBe('concluida');
    expect(c.s.chamadas).not.toContain('active MLB-K');
    expect(c.s.chamadas).toContain('active MLB-P');
  });

  it('duas invocações simultâneas agem uma vez', async () => {
    const c = cenario();
    const r = await Promise.all([avancarSaga(c.deps, 'T1'), avancarSaga(c.deps, 'T1')]);
    expect(r.map((x) => x.acao).sort()).toEqual(['ocupada', 'reagendada']);
    expect(c.s.chamadas.filter((x) => x.startsWith('paused')).length).toBe(4);
  });

  it('origem não confirmada impede qualquer chamada ao destino', async () => {
    const c = cenario();
    // Leitura com outro número na origem: trava antes do destino.
    c.s.falhaPut = (id) => (id === 'MLB-B' ? { erro: new TypeError('reset'), aplica: false } : null);
    c.s.ups['UP-B'].quantidade = 5;
    await rodar(c);
    expect(c.s.t.estado).toBe('travada');
    expect(c.s.chamadas.filter((x) => x.includes('MLB-K') && !x.startsWith('paused'))).toEqual([]);

    // Mesmo forçando o passo, sem `confirmada_em` em todas as origens o destino não recebe nada.
    const d = cenario();
    await rodar(d, noPasso('aumentar'));
    d.s.alvos[0].confirmada_em = null;
    await passo(d);
    expect(d.s.t.estado).toBe('travada');
    expect(d.s.chamadas.filter((x) => x.startsWith('qtd MLB-K'))).toEqual([]);
    expect(d.s.rpcs).not.toContain('kit_creditar_transferencia');
  });

  it('out_of_stock sem paused_by_seller não passa de pausar', async () => {
    const c = cenario();
    c.s.ups['UP-K'].itens[0] = { id: 'MLB-K', status: 'paused', subStatus: ['out_of_stock'] };
    c.s.pausaIgnorada.add('MLB-K');
    for (let i = 0; i < 5; i++) await passo(c);
    expect(c.s.t.passo).toBe('pausar');
    expect(c.s.chamadas.filter((x) => x === 'paused MLB-K').length).toBe(5);
    // Religaria sozinho com saldo: a saga pausou, então é ela quem devolve.
    expect(c.s.alvos[2].pausado_pela_saga).toEqual(['MLB-K']);
    expect(c.s.alvos.every((a) => a.qtd_passo1 === null)).toBe(true);
  });

  it('outro local de estoque trava em pausar', async () => {
    const c = cenario();
    c.s.ups['UP-P'].locais = ['selling_address', 'meli_facility'];
    await rodar(c);
    expect(c.s.t.estado).toBe('travada');
    expect(c.s.chamadas.some((x) => x.startsWith('qtd'))).toBe(false);
  });

  it('transferência travada não é reivindicada: segue ocupando o UP', async () => {
    const c = cenario();
    c.s.t.estado = 'travada';
    expect(await passo(c)).toMatchObject({ acao: 'ocupada' });
    expect(c.s.chamadas).toEqual([]);
  });
});

describe('criarTransferencia', () => {
  const admin = (resposta: unknown) => {
    const chamadas: Array<[string, unknown]> = [];
    const a = { rpc: async (nome: string, args: unknown) => { chamadas.push([nome, args]); return { data: resposta, error: null }; } };
    return { chamadas, admin: a as unknown as SupabaseClient };
  };
  const input = {
    orgId: 'ORG', kitId: 'KIT', tipo: 'montar' as const, itens: [{ codigo: 'K', quantidade: 1 }],
    alvos: [{ codigo: 'P', upId: 'UP-P', itemIds: ['MLB-P'] }],
  };

  it('cria na RPC atômica e devolve o id', async () => {
    const { admin: a, chamadas } = admin({ ok: true, id: 'T9' });
    expect(await criarTransferencia(a, input)).toEqual({ id: 'T9' });
    expect(chamadas).toEqual([['kit_criar_transferencia', {
      p_org: 'ORG', p_kit: 'KIT', p_tipo: 'montar', p_itens: input.itens,
      p_alvos: [{ codigo: 'P', up_id: 'UP-P', item_ids: ['MLB-P'] }],
    }]]);
  });

  it('segunda transferência no mesmo UP recebe up_ocupado (Review Focus 4)', async () => {
    const { admin: a } = admin({ ok: false, motivo: 'up_ocupado', codigo: 'P' });
    expect(await criarTransferencia(a, input)).toEqual({ motivo: 'up_ocupado' });
  });

  it('erro da RPC lança', async () => {
    const a = { rpc: async () => ({ data: null, error: { message: 'boom' } }) } as unknown as SupabaseClient;
    await expect(criarTransferencia(a, input)).rejects.toThrow(/boom/);
  });
});

describe('quarentenaDoEnv', () => {
  it('padrão 300 s; aceita inteiro positivo', () => {
    expect([quarentenaDoEnv(undefined), quarentenaDoEnv(''), quarentenaDoEnv('abc'), quarentenaDoEnv('0'), quarentenaDoEnv('120')])
      .toEqual([300, 300, 300, 300, 120]);
  });
});
