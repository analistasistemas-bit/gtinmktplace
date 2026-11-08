import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { MLApiError } from '../../ml/erro-ml.ts';
import {
  avancarSaga, criarTransferencia, quarentenaDoEnv,
  type AlvoSaga, type DepsSaga, type PassoSaga, type ResultadoPasso, type TransferenciaSaga,
} from '../saga.ts';
import type { PedidoPago, PedidoPendente } from '../conciliacao.ts';

// Tudo falso: banco em memória e ML em memória. `chamadas` registra cada escrita no ML, em ordem.
interface ItemFalso { id: string; status: string; subStatus: string[] }
interface UpFalso { quantidade: number; itens: ItemFalso[]; locais?: string[] }

const T = 300;
const INICIO = Date.parse('2026-11-07T12:00:00.000Z');

function alvo(up_id: string, codigo: string, papel: 'origem' | 'destino', delta: number, item_ids: string[]): AlvoSaga {
  return {
    up_id, codigo, papel, delta, item_ids, qtd_passo1: null, passo1_em: null, ids_passo1: null,
    valor_anterior: null, valor_alvo: null, pausado_pela_saga: [], intencao_escrita_em: null,
    recusa_definitiva_em: null, escrita_em: null, confirmada_em: null, item_escrita: null, recusas: 0, repausar: [], fase: null, marca_ordem: null,
    criar: false, up_criado: null, item_criado: null,
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
    /** SKUs em Guardado (Task 14): pausa que fica é da automação, sem alerta. */
    guardados: new Set<string>(),
    /** Pausas automáticas gravadas por `finalizar`. */
    pausas: [] as Array<{ codigo: string; itemId: string }>,
    pendentes: [] as PedidoPendente[],
    /** Pedidos pagos que a importação devolve (o fake não baixa nada: o saldo é do teste). */
    pagos: [] as PedidoPago[],
    falhasImportacao: [] as string[],
    baixas: [] as Array<{ orderId: string; resultado: never }>,
    chamadas: [] as string[],
    rpcs: [] as string[],
    alertas: [] as string[],
    filas: [] as number[],
    token: null as string | null,
    execucaoAte: 0,
    exclusaoSolta: false,
    falhaFinalizar: null as Error | null,
    /** Chamado a cada leitura do ML: o teste muda o mundo no meio de um passo. */
    aoLer: (_upId: string) => {},
    aoAtivar: (_itemId: string) => {},
    aoSalvarAlvo: (_patch: Partial<AlvoSaga>) => {},
    /** Falha injetada no PUT de status (e se aplica antes). */
    falhaStatus: (_itemId: string, _status: string): { erro: Error; aplica: boolean } | null => null,
    /** Falha injetada em `podeReativar`. */
    falhaPode: (_codigo: string): Error | null => null,
    /** Baixas que a importação faz, cada uma depois de `antesDeBaixar`; o relógio anda `passoBaixaMs` entre elas. */
    baixasNaImportacao: 0,
    passoBaixaMs: 0,
    baixasFeitas: 0,
    reservado: false,
    creditado: false,
    /** Falha injetada no PUT de quantidade: devolve o erro a lançar (e se aplica antes) ou null. */
    falhaPut: (_itemId: string, _q: number): { erro: Error; aplica: boolean } | null => null,
    /** Pausa que o ML ignora (item `out_of_stock` sem efeito do PUT). */
    pausaIgnorada: new Set<string>(),
    falhaSalvarAlvo: (_patch: Partial<AlvoSaga>): Error | null => null,
    seq: 0,
    /** CREATE do item de kit (alvo `criar`): falha injetada por tentativa (1, 2, …) e o que a busca enxerga. */
    falhaCriar: (_n: number): { erro: Error; aplica: boolean } | null => null,
    criacoes: 0,
    buscaVe: true,
    buscaAmbigua: false,
    aoBuscar: () => {},
    registros: [] as string[],
    registroFalha: null as string | null,
    aoRegistrar: () => {},
    falhaPreparar: null as Error | null,
    copiaNoCriado: false,
    criados: {} as Record<string, { itemId: string; upId: string }>,
    /** Ledger falso: só o que a marca d'água olha. */
    movs: [] as Array<{ codigo: string; ordem: number; qtd: number; motivo: string; transf: string | null }>,
    ordemSeq: 100,
    marca: {} as Record<string, number>,
    mov(codigo: string, qtd: number, motivo: string, transf: string | null = null) {
      s.movs.push({ codigo, qtd, motivo, transf, ordem: ++s.ordemSeq });
    },
    /** Espelho de kit_saga_conferir_saldo. */
    conferir(codigo: string) {
      const marca = codigo in s.marca ? s.marca[codigo] : null;
      const ordem = Math.max(0, ...s.movs.filter((m) => m.codigo === codigo).map((m) => m.ordem));
      const confirmado = (m: { transf: string | null }) =>
        m.transf === s.t.id && !!s.alvos.find((a) => a.codigo === codigo)?.confirmada_em;
      const pendente = s.movs
        .filter((m) => m.codigo === codigo && ['entrada', 'ajuste', 'estorno_venda', 'kit_saida', 'kit_entrada'].includes(m.motivo))
        .filter((m) => (m.transf === s.t.id || (marca !== null && m.ordem > marca)) && !confirmado(m))
        .reduce((soma, m) => soma + m.qtd, 0);
      return { saldo: s.saldo[codigo], marca, pendente, ordem };
    },
  };

  // Espelho de kit_saga_validar: token, prazo vigente, estado e exclusão.
  const validar = (token: string) => {
    if (token !== s.token || s.agora >= s.execucaoAte || s.t.estado !== 'ativa' || s.exclusaoSolta) {
      throw new Error('kit_execucao_vencida');
    }
  };
  const upDoItem = (itemId: string) => Object.values(ups).find((u) => u.itens.some((i) => i.id === itemId))!;
  const itemPorId = (itemId: string) => upDoItem(itemId).itens.find((i) => i.id === itemId)!;

  const deps: DepsSaga = {
    repo: {
      async reivindicar(_id, token, prazoS) {
        if (s.t.estado !== 'ativa' || (s.token !== null && s.agora < s.execucaoAte)) return false;
        s.token = token;
        s.execucaoAte = s.agora + prazoS * 1000;
        return true;
      },
      async carregar() {
        return { transferencia: structuredClone(s.t), alvos: structuredClone(s.alvos) };
      },
      async salvarTransferencia(_id, token, patch) {
        validar(token);
        if (patch.passo) s.t.passo = patch.passo;
        if (patch.alerta) s.t.alerta = patch.alerta;
        if (patch.travar) s.t.estado = 'travada';
      },
      async salvarAlvo(_id, token, upId, patch) {
        const erro = s.falhaSalvarAlvo(patch);
        if (erro) throw erro;
        validar(token);
        const a = s.alvos.find((x) => x.up_id === upId)!;
        // Espelho de kit_saga_salvar_alvo: confirmar avança a marca, que nunca recua.
        if (!a.confirmada_em && patch.confirmada_em) {
          const o = a.marca_ordem ?? patch.marca_ordem!;
          s.marca[a.codigo] = Math.max(s.marca[a.codigo] ?? 0, o);
        }
        Object.assign(a, structuredClone(patch));
        s.aoSalvarAlvo(patch);
      },
      async finalizar(_id, token, estado, alerta, pausas) {
        if (s.falhaFinalizar) { const e = s.falhaFinalizar; s.falhaFinalizar = null; throw e; }
        validar(token);
        // Espelho de kit_saga_finalizar: repausa pendente recusa.
        if (s.alvos.some((a) => a.repausar.length > 0)) throw new Error('kit_repausa_pendente');
        s.rpcs.push('finalizar');
        s.pausas.push(...(pausas ?? []));
        s.exclusaoSolta = true;
        Object.assign(s.t, { estado, passo: 'fim', alerta: alerta ?? s.t.alerta });
        s.token = null;
      },
      async ledger(_id, token, op) {
        validar(token);
        s.rpcs.push(op);
        if (op === 'reservar' && !s.reservado) {
          s.reservado = true; s.saldo.P -= 1; s.saldo.B -= 1;
          s.mov('P', -1, 'kit_saida', s.t.id); s.mov('B', -1, 'kit_saida', s.t.id);
        }
        if (op === 'creditar' && !s.creditado) {
          s.creditado = true; s.saldo.K += 1;
          s.mov('K', 1, 'kit_entrada', s.t.id);
        }
        return { ok: true };
      },
      async podeReativar(_id, token, codigo) {
        validar(token);
        const erro = s.falhaPode(codigo);
        if (erro) throw erro;
        return s.versaoPolitica === s.t.versao_politica && !s.semReativar.includes(codigo);
      },
      async liberar(_id, token) {
        if (s.token === token) s.token = null;
      },
      async versaoPolitica() {
        return s.versaoPolitica;
      },
      async guardados(codigos) {
        return new Set(codigos.filter((c) => s.guardados.has(c)));
      },
      async conferirSaldo(_id, token, codigo) {
        validar(token);
        return s.conferir(codigo);
      },
      async registrarItem(codigo, itemId, upId) {
        s.aoRegistrar();
        s.registros.push(`${codigo} ${itemId} ${upId}`);
        return s.registroFalha ? { ok: false, motivo: s.registroFalha } : { ok: true };
      },
    },
    ml: {
      async lerOferta(upId, esperados) {
        s.aoLer(upId);
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
      async importarPedidos(_itemIds, _desde, _ids, antesDeBaixar) {
        for (let i = 0; i < s.baixasNaImportacao; i++) {
          antesDeBaixar();
          s.baixasFeitas++;
          s.agora += s.passoBaixaMs;
        }
        const pagos = s.pagos.filter((o) => (o.order_items ?? []).some((oi) => _itemIds.includes(oi?.item?.id ?? '')));
        return { pagos, naoPagos: [], falhas: s.falhasImportacao, baixas: s.baixas };
      },
      async putQuantidade(itemId, q) {
        s.chamadas.push(`qtd ${itemId} ${q}`);
        const f = s.falhaPut(itemId, q);
        if (!f || f.aplica) upDoItem(itemId).quantidade = q;
        if (f) throw f.erro;
      },
      async prepararItem(codigo, quantidade) {
        if (s.falhaPreparar) throw s.falhaPreparar;
        return async () => {
          s.chamadas.push(`criar ${codigo} ${quantidade}`);
          const f = s.falhaCriar(++s.criacoes);
          if (!f || f.aplica) {
            const n = Object.keys(ups).filter((u) => u.startsWith('UP-NOVO')).length + 1;
            ups[`UP-NOVO${n}`] = { quantidade, itens: [ativo(`MLB-NOVO${n}`)] };
            s.criados[codigo] = { itemId: `MLB-NOVO${n}`, upId: `UP-NOVO${n}` };
            // O ML pode anexar uma cópia de catálogo ativa ao UP recém-criado.
            if (s.copiaNoCriado) ups[`UP-NOVO${n}`].itens.push(ativo(`MLB-NOVO${n}C`));
          }
          if (f) throw f.erro;
          return s.criados[codigo];
        };
      },
      async buscarItemCriado(codigo) {
        s.aoBuscar();
        if (s.buscaAmbigua) return { tipo: 'ambiguo' as const };
        const c = s.criados[codigo];
        if (!c || !s.buscaVe) return { tipo: 'nenhum' as const };
        return { tipo: 'um' as const, ...c };
      },
      async putStatus(itemId, status) {
        s.chamadas.push(`${status} ${itemId}`);
        if (s.pausaIgnorada.has(itemId)) return;
        const f = s.falhaStatus(itemId, status);
        if (f && !f.aplica) throw f.erro;
        const i = itemPorId(itemId);
        if (status === 'paused') {
          i.status = 'paused';
          if (!i.subStatus.includes('paused_by_seller')) i.subStatus.push('paused_by_seller');
        } else {
          s.aoAtivar(itemId);
          i.status = 'active';
          i.subStatus = i.subStatus.filter((x) => x !== 'paused_by_seller');
        }
        if (f) throw f.erro;
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
    expect(c.s.rpcs).toEqual(['reservar', 'creditar', 'finalizar']);
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
    expect(c.s.rpcs).not.toContain('finalizar');
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

  // Revisão final, achado 3: venda paga às 11h59, já baixada no ML e localmente; passo 1 às 12h00 com saldo 4;
  // conciliação às 12h05 (corte = passo 1 − 2 min inclui a venda).
  const vendaDas1159 = (): PedidoPago => ({
    id: 'O-1159', date_closed: new Date(INICIO - 60_000).toISOString(),
    order_items: [{ item: { id: 'MLB-P' }, quantity: 1 }],
  } as PedidoPago);

  it('pago já incorporado ao passo 1 (baixado no ML e local) não prende a transferência (achado 3)', async () => {
    const c = cenario();
    c.s.ups['UP-P'].quantidade = 4;
    c.s.saldo.P = 4;
    c.s.pagos = [vendaDas1159()];
    await rodar(c);
    expect(c.s.t.estado).toBe('concluida');
    expect(c.s.chamadas).toContain('qtd MLB-P 3');
    expect(c.s.alvos.find((a) => a.codigo === 'P')!.pagos_passo1).toEqual(['O-1159']);
  });

  it('pago sem prova no passo 1 (local ainda sem a baixa) continua bloqueando (achado 3)', async () => {
    const c = cenario();
    c.s.ups['UP-P'].quantidade = 4;   // ML já descontou; o local não
    c.s.pagos = [vendaDas1159()];
    for (let i = 0; i < 4; i++) await passo(c);   // pausar, confirmar a pausa, aguardar, conciliar
    expect(c.s.alvos.find((a) => a.codigo === 'P')!.pagos_passo1).toEqual([]);
    expect(c.s.t.passo).toBe('conciliar');
    expect(c.s.t.alerta).toContain('comprometida');
    expect(c.s.rpcs).not.toContain('reservar');
    expect(c.s.chamadas.filter((x) => x.startsWith('qtd '))).toEqual([]);
  });

  it('redução para 0 confirmada no ML dispara o aviso de zerado, nunca antes (achado 5)', async () => {
    const c = cenario();
    c.s.ups['UP-P'].quantidade = 1;
    c.s.saldo.P = 1;
    const avisos: Array<{ codigos: string[]; confirmado: boolean; ml: number }> = [];
    c.deps.avisarZerados = async (codigos) => {
      avisos.push({ codigos, confirmado: !!c.s.alvos.find((a) => a.codigo === 'P')!.confirmada_em, ml: c.s.ups['UP-P'].quantidade });
    };
    await rodar(c, noPasso('confirmar_reducao'));
    expect(avisos).toEqual([]);
    await rodar(c);
    expect(c.s.t.estado).toBe('concluida');
    expect(avisos).toEqual([{ codigos: ['P'], confirmado: true, ml: 0 }]);
  });

  it('aviso de zerado que falha não derruba a saga (achado 5)', async () => {
    const c = cenario();
    c.s.ups['UP-P'].quantidade = 1;
    c.s.saldo.P = 1;
    c.deps.avisarZerados = async () => { throw new Error('telegram fora'); };
    await rodar(c);
    expect(c.s.t.estado).toBe('concluida');
  });

  it('pedido pendente do UP bloqueia até sair da lista, sem reservar nem escrever (achado 1)', async () => {
    // Pendente conhecido que paga antes do PUT: local cai, ML cai, e o alvo congelado ofereceria uma peça a mais.
    const c = cenario();
    await rodar(c, noPasso('conciliar'));
    c.s.pendentes = [{ id: 1, order_items: [{ item: { id: 'MLB-P' }, quantity: 1 }], payments: [{ status: 'pending' }] } as PedidoPendente];
    for (let i = 0; i < 3; i++) expect((await passo(c)).acao).toBe('reagendada');
    expect(c.s.t.passo).toBe('conciliar');
    expect(c.s.rpcs).toEqual([]);
    expect(c.s.chamadas.some((x) => x.startsWith('qtd'))).toBe(false);
    c.s.pendentes = [];
    await rodar(c);
    expect(c.s.t.estado).toBe('concluida');
  });

  it('execução com prazo vencido não grava alvo nem chama PUT (achado 2)', async () => {
    const c = cenario();
    await rodar(c, noPasso('reduzir'));
    // A leitura antes do PUT demora mais que o lease: outra execução pode ter o claim.
    c.s.aoLer = () => { c.s.agora += 200_000; c.s.aoLer = () => {}; };
    await expect(avancarSaga(c.deps, 'T1')).rejects.toThrow(/prazo|vencida/);
    expect(c.s.chamadas.some((x) => x.startsWith('qtd'))).toBe(false);
    expect(c.s.alvos.every((a) => a.intencao_escrita_em === null)).toBe(true);
  });

  it('prazo da invocação vencido entre a intenção e o PUT não envia (achado 2)', async () => {
    const c = cenario();
    await rodar(c, noPasso('reduzir'));
    // Dentro do lease (180 s), fora do prazo da invocação (120 s): só a checagem local segura o PUT.
    c.s.aoSalvarAlvo = (patch) => { if ('intencao_escrita_em' in patch) c.s.agora += 130_000; };
    await expect(avancarSaga(c.deps, 'T1')).rejects.toThrow(/prazo/);
    expect(c.s.chamadas.some((x) => x.startsWith('qtd'))).toBe(false);
  });

  it('pausa perdida depois do cálculo bloqueia o PUT e mantém a exclusão (achado 4)', async () => {
    const c = cenario();
    await rodar(c, noPasso('reduzir'));
    c.s.ups['UP-P'].itens[0] = ativo('MLB-P');
    await rodar(c);
    expect(c.s.t.estado).toBe('travada');
    expect(c.s.t.alerta).toMatch(/MLB-P perdeu a pausa/);
    expect(c.s.chamadas.some((x) => x.startsWith('qtd'))).toBe(false);
    expect(c.s.exclusaoSolta).toBe(false);
  });

  it('quantidade do ML que mudou depois do cálculo bloqueia o PUT (achado 4)', async () => {
    const c = cenario();
    await rodar(c, noPasso('reduzir'));
    c.s.ups['UP-P'].quantidade = 4;
    await rodar(c);
    expect(c.s.t.estado).toBe('travada');
    expect(c.s.chamadas.some((x) => x.startsWith('qtd'))).toBe(false);
  });

  it('falha ao finalizar não solta a exclusão nem conclui pela metade (achado 5)', async () => {
    const c = cenario();
    await rodar(c, noPasso('reativar'));
    c.s.falhaFinalizar = new Error('conexão caiu');
    expect((await passo(c)).acao).toBe('reagendada');
    expect(c.s.t.estado).toBe('ativa');
    expect(c.s.exclusaoSolta).toBe(false);
    await rodar(c);
    expect(c.s.t.estado).toBe('concluida');
    expect(c.s.chamadas.filter((x) => x.startsWith('active')).length).toBe(4);
  });

  it('política que muda durante a reativação repausa o item e para (achado 6)', async () => {
    const c = cenario();
    c.s.aoAtivar = (id) => { if (id === 'MLB-P') c.s.versaoPolitica = 8; };
    await rodar(c);
    expect(c.s.t.estado).toBe('concluida');
    expect(c.s.chamadas.slice(-2)).toEqual(['active MLB-P', 'paused MLB-P']);
    expect(c.s.chamadas).not.toContain('active MLB-K');
    expect(c.s.alertas).toHaveLength(1);
  });

  it('prazo que vence no meio da importação não faz baixa depois (achado 2)', async () => {
    const c = cenario();
    await rodar(c, noPasso('conciliar'));
    c.s.baixasNaImportacao = 3;
    c.s.passoBaixaMs = 70_000;
    await expect(avancarSaga(c.deps, 'T1')).rejects.toThrow(/prazo/);
    expect(c.s.baixasFeitas).toBe(2);
  });

  const politicaMudaAoAtivarP = (c: Cenario) => {
    c.s.aoAtivar = (id) => { if (id === 'MLB-P') c.s.versaoPolitica = 8; };
  };
  const pausadoNoFim = (c: Cenario, id: string) =>
    Object.values(c.s.ups).flatMap((u) => u.itens).find((i) => i.id === id)!.subStatus.includes('paused_by_seller');

  it('repausa que falha é retomada e só então a saga finaliza (achado 6)', async () => {
    const c = cenario();
    politicaMudaAoAtivarP(c);
    let falhas = 1;
    c.s.falhaStatus = (id, st) => (id === 'MLB-P' && st === 'paused' && c.s.versaoPolitica === 8 && falhas-- > 0
      ? { erro: new MLApiError(500, 'fora'), aplica: false } : null);
    await rodar(c, (x) => x.s.chamadas.filter((y) => y === 'paused MLB-P').length === 2);
    expect(c.s.t.estado).toBe('ativa');
    expect(c.s.exclusaoSolta).toBe(false);
    expect(c.s.alertas.join()).toMatch(/repausa de MLB-P falhou/);
    await rodar(c);
    expect(c.s.t.estado).toBe('concluida');
    expect(pausadoNoFim(c, 'MLB-P')).toBe(true);
    expect(c.s.alvos[0].repausar).toEqual([]);
  });

  it('checagem depois do PUT active que lança vira repausa na retomada (achado 6)', async () => {
    const c = cenario();
    let ativou = false;
    c.s.aoAtivar = (id) => { if (id === 'MLB-P') { ativou = true; c.s.versaoPolitica = 8; } };
    let falhas = 1;
    c.s.falhaPode = (codigo) => (codigo === 'P' && ativou && falhas-- > 0 ? new Error('banco fora') : null);
    await rodar(c);
    expect(c.s.t.estado).toBe('concluida');
    expect(pausadoNoFim(c, 'MLB-P')).toBe(true);
    expect(c.s.chamadas.filter((x) => x.endsWith('MLB-P')).slice(-2)).toEqual(['active MLB-P', 'paused MLB-P']);
  });

  it('PUT active incerto com a política mudada é repausado (achado 6)', async () => {
    const c = cenario();
    politicaMudaAoAtivarP(c);
    c.s.falhaStatus = (id, st) => (id === 'MLB-P' && st === 'active' ? { erro: new TypeError('timeout'), aplica: true } : null);
    await rodar(c);
    expect(c.s.t.estado).toBe('concluida');
    expect(pausadoNoFim(c, 'MLB-P')).toBe(true);
    expect(c.s.chamadas).not.toContain('active MLB-K');
  });

  it('versão 7 autoriza, 8 bloqueia, 9 volta a permitir: repausa, porque vale só a versão exata', async () => {
    const c = cenario();
    // PUT active com a 7, política vai a 8 e a checagem posterior cai; antes da retomada, a 9 desbloqueia.
    c.s.aoAtivar = (id) => { if (id === 'MLB-P') c.s.versaoPolitica = 8; };
    let falhas = 1;
    c.s.falhaPode = (codigo) => (codigo === 'P' && c.s.versaoPolitica === 8 && falhas-- > 0 ? new Error('banco fora') : null);
    await rodar(c, (x) => falhas < 0 || (falhas === 0 && x.s.chamadas.includes('active MLB-P')));
    c.s.versaoPolitica = 9;
    await rodar(c);
    expect(c.s.t.estado).toBe('concluida');
    expect(pausadoNoFim(c, 'MLB-P')).toBe(true);
    expect(c.s.chamadas.filter((x) => x.endsWith('MLB-P')).slice(-2)).toEqual(['active MLB-P', 'paused MLB-P']);
  });

  // Emenda pós-Task 5: fase pelo sinal de (valor_alvo − ML lido no cálculo), não por origem/destino.
  const reducoesConfirmadasNoAumento = (c: Cenario) => {
    const vistos: boolean[] = [];
    const put = c.deps.ml.putQuantidade;
    c.deps.ml.putQuantidade = async (itemId, q) => {
      const alvo = c.s.alvos.find((a) => a.item_ids.includes(itemId))!;
      if (alvo.fase === 'aumento') vistos.push(c.s.alvos.filter((a) => a.fase === 'reducao').every((a) => a.confirmada_em));
      return put(itemId, q);
    };
    return vistos;
  };

  it('entrada pura (local 10, ML 5) escreve 10 na fase de aumento', async () => {
    const c = cenario();
    c.s.t.tipo = 'entrada';
    Object.assign(c.s.ups, { 'UP-A': { quantidade: 5, itens: [ativo('MLB-A')] } });
    c.s.saldo.A = 10;
    c.s.marca.A = 0;
    c.s.mov('A', 5, 'entrada');
    c.s.alvos.splice(0, 3, alvo('UP-A', 'A', 'destino', 0, ['MLB-A']));
    await rodar(c);
    expect(c.s.t.estado).toBe('concluida');
    expect(c.s.alvos[0]).toMatchObject({ fase: 'aumento', valor_anterior: 5, valor_alvo: 10 });
    expect(c.s.chamadas.filter((x) => x.startsWith('qtd'))).toEqual(['qtd MLB-A 10']);
  });

  it('montar com origem cujo local ficou acima do ML: o aumento dela vem depois das reduções', async () => {
    const c = cenario();
    c.s.saldo.P = 7;   // local 7, ML 5: depois da reserva, alvo 6 > 5
    c.s.marca.P = 0;
    c.s.mov('P', 2, 'entrada');
    const vistos = reducoesConfirmadasNoAumento(c);
    await rodar(c);
    expect(c.s.t.estado).toBe('concluida');
    expect(c.s.alvos.map((a) => a.fase)).toEqual(['aumento', 'reducao', 'aumento']);
    expect(c.s.chamadas.filter((x) => x.startsWith('qtd'))).toEqual(['qtd MLB-B 4', 'qtd MLB-P 6', 'qtd MLB-K 3']);
    expect(vistos).toEqual([true, true]);
  });

  it('local 10 × ML 5 com transferência de 1 nunca aumenta antes das reduções confirmadas', async () => {
    const c = cenario();
    c.s.saldo.P = 10;
    c.s.marca.P = 0;
    c.s.mov('P', 5, 'entrada');
    const vistos = reducoesConfirmadasNoAumento(c);
    // Redução de B fica incerta e a leitura diverge: trava sem nenhum aumento.
    c.s.falhaPut = (id) => (id === 'MLB-B' ? { erro: new TypeError('timeout'), aplica: false } : null);
    await rodar(c);
    expect(c.s.t.estado).toBe('travada');
    expect(vistos).toEqual([]);
    expect(c.s.chamadas.filter((x) => x.startsWith('qtd'))).toEqual(['qtd MLB-B 4']);
  });

  it('ML acima do local é redução, inclusive no destino', async () => {
    const c = cenario();
    c.s.ups['UP-K'].quantidade = 5;   // local 2 + 1 = 3 < 5
    c.s.marca.K = 0;
    c.s.mov('K', -3, 'ajuste');
    await rodar(c);
    expect(c.s.t.estado).toBe('concluida');
    expect(c.s.alvos.map((a) => a.fase)).toEqual(['reducao', 'reducao', 'reducao']);
    expect(c.s.chamadas.filter((x) => x.startsWith('qtd'))).toEqual(['qtd MLB-P 4', 'qtd MLB-B 4', 'qtd MLB-K 3']);
    expect(c.s.rpcs).toContain('creditar');
  });

  // Emenda 2: divergência ledger × ML classificada pela marca d'água (spec, "Divergência entre ledger e ML").
  const travouPorDivergencia = (c: Cenario) => {
    expect(c.s.t.estado).toBe('travada');
    expect(c.s.t.alerta).toMatch(/divergência sem explicação/);
    expect(c.s.rpcs).not.toContain('reservar');
    expect(c.s.chamadas.some((x) => x.startsWith('qtd'))).toBe(false);
    expect(c.s.exclusaoSolta).toBe(false);
  };

  it('diferença sem movimento trava, sem reservar nem escrever', async () => {
    const c = cenario();
    c.s.saldo.P = 7;
    c.s.marca.P = 0;
    await rodar(c);
    travouPorDivergencia(c);
  });

  it('entrada mais uma diferença sem explicação trava', async () => {
    const c = cenario();
    c.s.saldo.P = 10;   // ML 5: diferença 5, efeito pendente só 3
    c.s.marca.P = 0;
    c.s.mov('P', 3, 'entrada');
    await rodar(c);
    travouPorDivergencia(c);
  });

  it('SKU sem marca exige local igual ao ML', async () => {
    const c = cenario();
    c.s.saldo.P = 7;
    c.s.mov('P', 2, 'entrada');   // sem marca, nem a entrada explica
    await rodar(c);
    travouPorDivergencia(c);
  });

  it('SKU sem marca com local igual ao ML segue, e a confirmação grava a marca', async () => {
    const c = cenario();
    await rodar(c);
    expect(c.s.t.estado).toBe('concluida');
    // Origem: até o próprio kit_saida, lido sob o lock no cálculo. Destino: idem; o crédito vem depois e já está no ML.
    expect(c.s.marca).toEqual({ P: c.s.alvos[0].marca_ordem, B: c.s.alvos[1].marca_ordem, K: c.s.alvos[2].marca_ordem });
    expect(['P', 'B', 'K'].map((x) => c.s.conferir(x).pendente)).toEqual([0, 0, 0]);
  });

  it('a marca avança na confirmação e o mesmo efeito não é aplicado duas vezes', async () => {
    const c = cenario();
    c.s.t.tipo = 'entrada';
    Object.assign(c.s.ups, { 'UP-A': { quantidade: 5, itens: [ativo('MLB-A')] } });
    c.s.saldo.A = 10;
    c.s.marca.A = 0;
    c.s.mov('A', 5, 'entrada');
    const ordemEntrada = c.s.ordemSeq;
    c.s.alvos.splice(0, 3, alvo('UP-A', 'A', 'destino', 0, ['MLB-A']));
    await rodar(c);
    expect(c.s.t.estado).toBe('concluida');
    expect(c.s.marca.A).toBe(ordemEntrada);
    // Nova transferência com o ML de volta a 5: a entrada já aplicada não explica mais nada.
    Object.assign(c.s.t, { id: 'T2', estado: 'ativa', passo: 'pausar', alerta: null });
    c.s.alvos.splice(0, 1, alvo('UP-A', 'A', 'destino', 0, ['MLB-A']));
    c.s.exclusaoSolta = false;
    c.s.ups['UP-A'].quantidade = 5;
    c.s.chamadas.length = 0;
    c.s.rpcs.length = 0;
    await rodar(c);
    travouPorDivergencia(c);
  });

  it('diferença que surge entre a conciliação e o cálculo trava antes de gravar o alvo', async () => {
    const c = cenario();
    await rodar(c, noPasso('calcular'));
    c.s.saldo.B += 1;   // saldo mudou sem movimento no ledger
    await rodar(c);
    expect(c.s.t.estado).toBe('travada');
    expect(c.s.t.alerta).toMatch(/B: divergência sem explicação/);
    expect(c.s.alvos[1].valor_alvo).toBeNull();
    expect(c.s.chamadas.some((x) => x.startsWith('qtd'))).toBe(false);
  });

  it('estorno durante a transferência, depois do cálculo, fica pendente para a próxima', async () => {
    const c = cenario();
    await rodar(c, noPasso('reduzir'));
    c.s.saldo.P += 1;
    c.s.mov('P', 1, 'estorno_venda');
    await rodar(c);
    expect(c.s.t.estado).toBe('concluida');
    expect(c.s.ups['UP-P'].quantidade).toBe(4);
    expect(c.s.conferir('P').pendente).toBe(1);
    expect(c.s.conferir('P').saldo - c.s.ups['UP-P'].quantidade).toBe(1);
  });

  it('PUT vai para um item aberto do UP e grava o destino (achado 7)', async () => {
    const c = cenario();
    c.s.ups['UP-B'].itens = [{ id: 'MLB-B0', status: 'closed', subStatus: [] }, ativo('MLB-B')];
    c.s.alvos[1].item_ids = ['MLB-B0', 'MLB-B'];
    await rodar(c);
    expect(c.s.t.estado).toBe('concluida');
    expect(qtdPuts(c, 'MLB-B0')).toBe(0);
    expect(qtdPuts(c, 'MLB-B')).toBe(1);
    expect(c.s.alvos[1].item_escrita).toBe('MLB-B');
  });

  it('5ª recusa 4xx trava com um alerta só e mantém a exclusão (achado 7)', async () => {
    const c = cenario();
    c.s.falhaPut = (id) => (id === 'MLB-P' ? { erro: new MLApiError(400, 'recusado'), aplica: false } : null);
    await rodar(c);
    expect(c.s.t.estado).toBe('travada');
    expect(qtdPuts(c, 'MLB-P')).toBe(5);
    expect(c.s.alvos[0].recusas).toBe(5);
    expect(c.s.alertas).toHaveLength(1);
    expect(c.s.exclusaoSolta).toBe(false);
  });

  it('versao_politica velha aborta sem reativar', async () => {
    const c = cenario();
    await rodar(c, noPasso('conciliar'));
    c.s.versaoPolitica = 8;
    await rodar(c);
    expect(c.s.t.estado).toBe('abortada');
    expect(c.s.chamadas.some((x) => x.startsWith('active') || x.startsWith('qtd'))).toBe(false);
    expect(c.s.rpcs).toEqual(['cancelar', 'finalizar']);
  });

  it('Fix 1 (P1-2): abortar por política registra as pausas que a saga fez, para a reposição recuperar', async () => {
    const c = cenario();
    c.s.ups['UP-B'].itens[1] = { id: 'MLB-BC', status: 'paused', subStatus: ['paused_by_seller'] };   // manual, anterior
    await rodar(c, noPasso('conciliar'));   // pausa confirmada (ligar → sair_sobra)
    c.s.versaoPolitica = 8;                 // operador desliga na quarentena
    await rodar(c);
    expect(c.s.t.estado).toBe('abortada');
    expect(c.s.chamadas.some((x) => x.startsWith('active'))).toBe(false);
    expect(c.s.pausas).toEqual([
      { codigo: 'P', itemId: 'MLB-P' }, { codigo: 'B', itemId: 'MLB-B' }, { codigo: 'K', itemId: 'MLB-K' },
    ]);
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

  it('Task 14: SKU Guardado fica pausado sem alerta, e a pausa é gravada como da automação', async () => {
    const c = cenario();
    c.s.semReativar = ['P'];
    c.s.guardados.add('P');
    await rodar(c);
    expect(c.s.t.estado).toBe('concluida');
    expect(c.s.chamadas).not.toContain('active MLB-P');
    expect(c.s.alertas).toEqual([]);
    expect(c.s.pausas).toEqual([{ codigo: 'P', itemId: 'MLB-P' }]);
  });

  it('Task 14: bloqueio que não é Guardado segue alertando, e a pausa também é gravada', async () => {
    const c = cenario();
    c.s.semReativar = ['P'];
    await rodar(c);
    expect(c.s.alertas.some((a) => a.includes('MLB-P'))).toBe(true);
    expect(c.s.pausas).toEqual([{ codigo: 'P', itemId: 'MLB-P' }]);
  });

  it('Task 14: pausa manual anterior nunca entra nas pausas da automação', async () => {
    const c = cenario();
    c.s.ups['UP-B'].itens[1] = { id: 'MLB-BC', status: 'paused', subStatus: ['paused_by_seller'] };
    c.s.semReativar = ['B'];
    c.s.guardados.add('B');
    await rodar(c);
    expect(c.s.pausas).toEqual([{ codigo: 'B', itemId: 'MLB-B' }]);
    expect(c.s.chamadas).not.toContain('active MLB-BC');
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
    expect(c.s.rpcs).not.toContain('finalizar');
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
    expect(d.s.rpcs).not.toContain('creditar');
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

/** Kit novo: o destino K ainda não tem item no ML. O passo `aumentar` cria com o saldo, depois das reduções. */
function cenarioCriar() {
  const c = cenario();
  delete c.s.ups['UP-K'];
  c.s.saldo.K = 0;
  c.s.alvos[2] = { ...alvo('criar:K', 'K', 'destino', 1, []), criar: true };
  return c;
}
const criacoes = (c: Cenario) => c.s.chamadas.filter((x) => x.startsWith('criar ')).length;

describe('avancarSaga: destino sem item (CREATE do kit)', () => {
  it('cria só depois das reduções confirmadas, com o saldo, pausado, registrado e depois reativado', async () => {
    const c = cenarioCriar();
    await rodar(c);
    expect(c.s.t).toMatchObject({ estado: 'concluida', passo: 'fim' });
    expect(c.s.chamadas).toEqual([
      'paused MLB-P', 'paused MLB-B', 'paused MLB-BC',
      'qtd MLB-P 4', 'qtd MLB-B 4',
      'criar K 1', 'paused MLB-NOVO1',
      'active MLB-P', 'active MLB-B', 'active MLB-BC', 'active MLB-NOVO1',
    ]);
    expect(c.s.ups['UP-NOVO1'].quantidade).toBe(1);
    expect(c.s.registros).toContain('K MLB-NOVO1 UP-NOVO1');
    expect(c.s.alvos[2]).toMatchObject({ item_criado: 'MLB-NOVO1', up_criado: 'UP-NOVO1', valor_anterior: 0, valor_alvo: 1, fase: 'aumento' });
    expect(c.s.rpcs).toEqual(['reservar', 'creditar', 'finalizar']);
    expect(c.s.saldo).toEqual({ P: 4, B: 4, K: 1 });
  });

  it('origem não confirmada impede o CREATE', async () => {
    const c = cenarioCriar();
    c.s.falhaPut = (id) => (id === 'MLB-P' ? { erro: new TypeError('network timeout'), aplica: false } : null);
    await rodar(c);
    expect(c.s.t.estado).toBe('travada');
    expect(criacoes(c)).toBe(0);
    expect(c.s.rpcs).not.toContain('creditar');

    // Mesmo forçando o passo, sem `confirmada_em` em todas as origens não há POST.
    const d = cenarioCriar();
    await rodar(d, noPasso('aumentar'));
    d.s.alvos[0].confirmada_em = null;
    await passo(d);
    expect(d.s.t.estado).toBe('travada');
    expect(criacoes(d)).toBe(0);
  });

  it('CREATE repetido não duplica: reentrega de cada passo', async () => {
    const c = cenarioCriar();
    for (let i = 0; i < 60 && c.s.t.estado === 'ativa'; i++) {
      const anterior = c.s.t.passo;
      await passo(c);
      if (c.s.t.estado === 'ativa') c.s.t.passo = anterior;
      await passo(c);
    }
    expect(c.s.t.estado).toBe('concluida');
    expect(criacoes(c)).toBe(1);
    expect(Object.keys(c.s.ups).filter((u) => u.startsWith('UP-NOVO'))).toEqual(['UP-NOVO1']);
    expect(c.s.saldo.K).toBe(1);
  });

  it('criação incerta: a retomada busca, acha e adota, sem novo POST', async () => {
    const c = cenarioCriar();
    c.s.falhaCriar = (n) => (n === 1 ? { erro: new TypeError('network timeout'), aplica: true } : null);
    await rodar(c);
    expect(c.s.t.estado).toBe('concluida');
    expect(criacoes(c)).toBe(1);
    expect(c.s.alvos[2]).toMatchObject({ item_criado: 'MLB-NOVO1', up_criado: 'UP-NOVO1' });
    expect(c.s.chamadas).toContain('paused MLB-NOVO1');
  });

  it('criação incerta que a busca ainda não enxerga: espera sem reenviar e adota quando aparece', async () => {
    const c = cenarioCriar();
    c.s.falhaCriar = (n) => (n === 1 ? { erro: new TypeError('network timeout'), aplica: true } : null);
    c.s.buscaVe = false;
    await rodar(c, (x) => criacoes(x) === 1 && x.s.t.passo === 'aumentar' && x.s.filas.length > 12, 60);
    expect(c.s.t.estado).toBe('ativa');
    c.s.buscaVe = true;
    await rodar(c);
    expect(c.s.t.estado).toBe('concluida');
    expect(criacoes(c)).toBe(1);
  });

  it('criação incerta sem item na busca não reenvia: depois da janela trava', async () => {
    const c = cenarioCriar();
    c.s.falhaCriar = (n) => (n === 1 ? { erro: new TypeError('network timeout'), aplica: false } : null);
    await rodar(c, undefined, 80);
    expect(c.s.t.estado).toBe('travada');
    expect(c.s.t.alerta).toMatch(/K: criação incerta/);
    expect(criacoes(c)).toBe(1);
    expect(c.s.rpcs).not.toContain('creditar');
  });

  it('recusa 4xx permite repetir, depois de buscar, sem criar dois itens', async () => {
    const c = cenarioCriar();
    c.s.falhaCriar = (n) => (n === 1 ? { erro: new MLApiError(400, 'invalid picture'), aplica: false } : null);
    await rodar(c);
    expect(c.s.t.estado).toBe('concluida');
    expect(criacoes(c)).toBe(2);
    expect(Object.keys(c.s.ups).filter((u) => u.startsWith('UP-NOVO'))).toEqual(['UP-NOVO1']);
    expect(c.s.alvos[2].recusas).toBe(1);
  });

  it('busca ambígua trava sem criar', async () => {
    const c = cenarioCriar();
    c.s.buscaAmbigua = true;
    await rodar(c);
    expect(c.s.t.estado).toBe('travada');
    expect(criacoes(c)).toBe(0);
  });

  it('registro recusado (family_id divergente) trava sem creditar', async () => {
    const c = cenarioCriar();
    c.s.registroFalha = 'family_id divergente';
    await rodar(c);
    expect(c.s.t.estado).toBe('travada');
    expect(c.s.t.alerta).toMatch(/family_id divergente/);
    expect(c.s.rpcs).not.toContain('creditar');
    // Estado remoto: o item criado ficou pausado pelo vendedor antes do registro que recusou.
    expect(c.s.ups['UP-NOVO1'].itens[0]).toMatchObject({ status: 'paused', subStatus: ['paused_by_seller'] });
  });

  it('cópia de catálogo ativa no UP criado também é pausada e confirmada antes do registro (que recusa)', async () => {
    const c = cenarioCriar();
    c.s.copiaNoCriado = true;
    c.s.registroFalha = 'family_id divergente';
    await rodar(c);
    expect(c.s.t.estado).toBe('travada');
    for (const item of c.s.ups['UP-NOVO1'].itens) {
      expect(item).toMatchObject({ status: 'paused', subStatus: ['paused_by_seller'] });
    }
    expect(c.s.alvos[2].pausado_pela_saga).toEqual(['MLB-NOVO1', 'MLB-NOVO1C']);
  });

  it('cópia de catálogo que não pausa: não registra; backoff 5 s → 30 s → 60 s → 5 min e alerta por faixa de tempo', async () => {
    const c = cenarioCriar();
    c.s.copiaNoCriado = true;
    c.s.pausaIgnorada.add('MLB-NOVO1C');
    await rodar(c, (x) => criacoes(x) === 1);
    const desde = c.s.filas.length;
    for (let i = 0; i < 40; i++) await passo(c);
    expect(c.s.registros).toEqual([]);
    expect(c.s.t.passo).toBe('aumentar');
    const atrasos = new Set(c.s.filas.slice(desde));
    expect([...atrasos].sort((a, b) => a - b)).toEqual([5, 30, 60, 300]);
    const alertas = c.s.alertas.filter((a) => a.includes('pausa do item criado não confirmada'));
    // Uma por faixa (agora, 1, 5, 15 min, horas): repete, mas não a cada tentativa.
    expect(alertas.length).toBeGreaterThanOrEqual(4);
    expect(alertas.length).toBeLessThan(10);
    // A obrigação segue: liberada a pausa, conclui.
    c.s.pausaIgnorada.delete('MLB-NOVO1C');
    await rodar(c, undefined, 80);
    expect(c.s.t.estado).toBe('concluida');
  });

  it('principal ativo que recusa a pausa: a cópia é pausada na mesma rodada, nada é registrado, alerta e backoff', async () => {
    const c = cenarioCriar();
    c.s.copiaNoCriado = true;
    let recusa = true;
    c.s.falhaStatus = (id, st) => (recusa && id === 'MLB-NOVO1' && st === 'paused'
      ? { erro: new MLApiError(400, 'pausa recusada'), aplica: false } : null);
    await rodar(c, (x) => criacoes(x) === 1);
    expect(c.s.ups['UP-NOVO1'].itens[1].subStatus).toContain('paused_by_seller');
    expect(c.s.ups['UP-NOVO1'].itens[0].subStatus).not.toContain('paused_by_seller');
    expect(c.s.registros).toEqual([]);
    expect(c.s.alertas.some((a) => /pausa do item criado não confirmada .*MLB-NOVO1.*pausa recusada/.test(a))).toBe(true);
    expect(c.s.filas.at(-1)).toBe(5);
    recusa = false;
    await rodar(c, undefined, 80);
    expect(c.s.t.estado).toBe('concluida');
    expect(c.s.registros).toHaveLength(1);
  });

  it('principal closed que recusa a pausa não impede descobrir e pausar a cópia ativa antes do registro', async () => {
    const c = cenarioCriar();
    c.s.copiaNoCriado = true;
    c.s.falhaStatus = (id, st) => {
      if (id !== 'MLB-NOVO1' || st !== 'paused') return null;
      c.s.ups['UP-NOVO1'].itens[0] = { id: 'MLB-NOVO1', status: 'closed', subStatus: [] };
      return { erro: new MLApiError(400, 'item closed'), aplica: false };
    };
    await rodar(c, (x) => x.s.registros.length > 0);
    expect(c.s.chamadas).toContain('paused MLB-NOVO1C');
    expect(c.s.ups['UP-NOVO1'].itens[1].subStatus).toContain('paused_by_seller');
    expect(c.s.registros).toEqual(['K MLB-NOVO1 UP-NOVO1']);
  });

  it('leitura do UP criado que lança: o principal já foi pausado, nada é registrado e sai alerta com backoff', async () => {
    const c = cenarioCriar();
    let falhas = 3;
    c.s.aoLer = (up) => { if (up === 'UP-NOVO1' && falhas-- > 0) throw new Error('busca do UP com 0 itens'); };
    await rodar(c, (x) => criacoes(x) === 1 && falhas === 2);
    const iPausa = c.s.chamadas.indexOf('paused MLB-NOVO1');
    expect(iPausa).toBeGreaterThan(c.s.chamadas.indexOf('criar K 1'));
    expect(c.s.ups['UP-NOVO1'].itens[0].subStatus).toContain('paused_by_seller');
    expect(c.s.registros).toEqual([]);
    expect(c.s.alertas.filter((a) => /K: pausa do item criado não confirmada .*busca do UP com 0 itens/.test(a))).toHaveLength(1);
    expect(c.s.filas.at(-1)).toBe(5);
    await rodar(c, undefined, 80);
    expect(c.s.t.estado).toBe('concluida');
    expect(c.s.registros).toHaveLength(1);
  });

  it('registro que lança: o item criado é pausado e confirmado antes; a retomada não deixa vendável', async () => {
    const c = cenarioCriar();
    let falhas = 2;
    c.s.aoRegistrar = () => { if (falhas-- > 0) throw new Error('banco fora'); };
    await rodar(c, (x) => criacoes(x) === 1 && falhas === 1);
    expect(c.s.ups['UP-NOVO1'].itens[0].subStatus).toContain('paused_by_seller');
    expect(c.s.alvos[2].escrita_em).toBeNull();
    await rodar(c);
    expect(c.s.t.estado).toBe('concluida');
    expect(criacoes(c)).toBe(1);
  });

  it('pausa do item criado que o ML ignora: não registra nem avança até a leitura confirmar', async () => {
    const c = cenarioCriar();
    c.s.pausaIgnorada.add('MLB-NOVO1');
    for (let i = 0; i < 25; i++) await passo(c);
    expect(c.s.registros).toEqual([]);
    expect(c.s.alvos[2].escrita_em).toBeNull();
    expect(c.s.t.passo).toBe('aumentar');
    c.s.pausaIgnorada.delete('MLB-NOVO1');
    await rodar(c);
    expect(c.s.t.estado).toBe('concluida');
  });

  it('kit com 20 SKUs: item já registrado não é refeito, e cada invocação cria o seu', async () => {
    const c = cenarioCriar();
    c.s.alvos.splice(2, 1);
    for (let i = 1; i <= 20; i++) {
      c.s.saldo[`K${i}`] = 0;
      c.s.alvos.push({ ...alvo(`criar:K${i}`, `K${i}`, 'destino', 1, []), criar: true });
    }
    c.s.aoRegistrar = () => { c.s.agora += 4_000; };
    await rodar(c, undefined, 200);
    expect(c.s.t.estado).toBe('concluida');
    expect(criacoes(c)).toBe(20);
    expect(c.s.registros).toHaveLength(20);
  });

  it('falha ao preparar o item (foto, guia) alerta e não posta', async () => {
    const c = cenarioCriar();
    c.s.falhaPreparar = new Error('foto recusada');
    await rodar(c, (x) => x.s.t.passo === 'aumentar' && x.s.alertas.length > 0);
    await passo(c);
    expect(criacoes(c)).toBe(0);
    expect(c.s.alvos[2].intencao_escrita_em).toBeNull();
    expect(c.s.alertas.filter((a) => /K: não foi possível preparar o item: foto recusada/.test(a))).toHaveLength(1);
    expect(c.s.t.estado).toBe('ativa');
  });

  it('pouco prazo na invocação não grava intenção nem posta', async () => {
    const c = cenarioCriar();
    await rodar(c, noPasso('aumentar'));
    let uma = true;
    c.s.aoBuscar = () => { if (uma) { uma = false; c.s.agora += 70_000; } };
    await passo(c);
    expect(criacoes(c)).toBe(0);
    expect(c.s.alvos[2].intencao_escrita_em).toBeNull();
    await rodar(c);
    expect(c.s.t.estado).toBe('concluida');
    expect(criacoes(c)).toBe(1);
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
