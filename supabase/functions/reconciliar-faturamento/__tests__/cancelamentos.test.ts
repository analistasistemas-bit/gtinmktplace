// ADR-0211: drenagem da obrigação de cancelamento. Casos F1–F32 do plano
// (docs/superpowers/plans/2026-11-24-backfill-cancelamento-fila-propria.md, Task 2).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PedidoML } from '../../_shared/faturamento/venda.ts';
import { refBaixa } from '../../_shared/estoque/baixa.ts';
import { tratarPedidoCancelado, type DepsCancelamento, type ResultadoCancelamento } from '../../_shared/estoque/cancelamento.ts';
import { classificarItensKit, gravarIdentidades } from '../../_shared/kit-variacao/venda.ts';
import {
  PRAZO_FINAL_MS, depsDaFila, drenagemLigada, drenarCancelamentos,
  type IoFila, type Ledger, type Obrigacao, type PedidoDaFila, type Registro,
} from '../cancelamentos.ts';

const CONTA = '999';
const v = (s: number) => `2026-11-20T10:00:${String(s).padStart(2, '0')}.000-04:00`;
const ob = (id: string, versao: string | null = v(30), g = `g-${id}`): Obrigacao => ({ id: `v-${id}`, orderId: id, geracao: g, versao });
const aberta = (codigoRef = 'SKU1', quantidade = 1) => ({ codigoRef, quantidade, estornada: false });
const estornada = (codigoRef = 'SKU1', quantidade = 1) => ({ codigoRef, quantidade, estornada: true });
const nunca = <T>() => new Promise<T>(() => {});

type Baixa = Ledger['baixas'][number];

/** IO falso em memória. `baixas` é o ledger vivo (mutável pelos testes e pelo `tratar`). */
function criarIo(obrigacoes: Obrigacao[], over: Partial<IoFila> = {}, baixasIniciais?: Record<string, Baixa[]>) {
  const baixas = new Map<string, Baixa[]>(
    obrigacoes.map((o) => [o.orderId, baixasIniciais?.[o.orderId] ?? [aberta()]]),
  );
  let leituras = 0;
  const io = {
    contaExternaId: CONTA,
    reivindicar: vi.fn(async (_l: string) => obrigacoes),
    ledger: vi.fn(async (ids: string[]) => {
      leituras++;
      return new Map(ids.filter((id) => baixas.has(id))
        .map((id) => [id, { lidoEm: `L${leituras}`, baixas: baixas.get(id)!.map((b) => ({ ...b })) } as Ledger]));
    }),
    pedido: vi.fn(async (id: string): Promise<PedidoML> =>
      ({ id, status: 'cancelled', last_updated: v(30), seller: { id: 999 }, shipping: { id: `S${id}` } } as PedidoML)),
    envio: vi.fn(async (_s: number | string) => ({ status: 'ready_to_ship' } as { status: string | null } | null)),
    aindaPendente: vi.fn(async (_o: Obrigacao) => true),
    kitLigado: vi.fn(async () => false),
    tratar: vi.fn(async (_p: PedidoDaFila): Promise<ResultadoCancelamento> => 'avisado'),
    // Como a RPC: devolve quantas conclusões foram aceitas.
    registrar: vi.fn(async (i: Registro[]) => i.filter((r) => r.concluir).length),
    agora: () => Date.now(),
    ...over,
  };
  /** Estorna tudo o que está aberto no ledger do pedido (o que o tratamento real faz em `reposto`). */
  const estornar = (id: string) => baixas.set(id, (baixas.get(id) ?? []).map((b) => ({ ...b, estornada: true })));
  const registros = () => io.registrar.mock.calls.flatMap((c) => c[0] as Registro[]);
  const reg = (id: string) => registros().find((r) => r.id === `v-${id}`);
  return { io, baixas, estornar, registros, reg };
}

afterEach(() => { vi.useRealTimers(); });

describe('drenarCancelamentos', () => {
  it('F1. cada ResultadoCancelamento: avisado/silenciado concluem; reposto confere o ledger; os demais ficam', async () => {
    const ESPERADO = {
      reposto: 'confere-ledger', avisado: 'conclui', 'sem-baixa': 'fica', silenciado: 'conclui',
      pendente: 'fica', repetir: 'fica', adiado: 'fica', ignorado: 'fica', erro: 'fica',
    } satisfies Record<ResultadoCancelamento, 'conclui' | 'fica' | 'confere-ledger'>;
    for (const [res, esperado] of Object.entries(ESPERADO) as Array<[ResultadoCancelamento, string]>) {
      const f = criarIo([ob('o1')]);
      f.io.tratar.mockImplementation(async () => { if (res === 'reposto') f.estornar('o1'); return res; });
      await drenarCancelamentos(f.io, 'L1');
      const r = f.reg('o1')!;
      expect(r.desfecho, res).toBe(res);
      if (esperado === 'conclui') expect(r, res).toMatchObject({ concluir: true, lido_em: 'L1' });
      else if (esperado === 'confere-ledger') {
        expect(f.io.ledger, res).toHaveBeenCalledTimes(2);
        expect(r, res).toMatchObject({ concluir: true, lido_em: 'L2' });
      } else expect(r.concluir, res).toBe(false);
    }
  });

  it('F2. erro → concluir=false; o ciclo seguinte trata de novo', async () => {
    const f = criarIo([ob('o1')], { tratar: vi.fn(async () => 'erro' as const) });
    await drenarCancelamentos(f.io, 'L1');
    expect(f.reg('o1')).toMatchObject({ concluir: false, desfecho: 'erro', geracao: 'g-o1' });
    await drenarCancelamentos(f.io, 'L2');
    expect(f.io.tratar).toHaveBeenCalledTimes(2);
  });

  it('F3/F3b/F4. versão do ML: paid antigo fica; paid mais novo conclui nao-cancelado; cancelled antigo fica', async () => {
    const casos: Array<[string, string, boolean, string]> = [
      ['paid', v(20), false, 'ml: resposta antiga'],
      ['paid', v(30), false, 'ml: resposta antiga'],
      ['paid', v(40), true, 'nao-cancelado'],
      ['cancelled', v(10), false, 'ml: resposta antiga'],
    ];
    for (const [status, lu, concluir, desfecho] of casos) {
      const f = criarIo([ob('o1')], { pedido: vi.fn(async () => ({ id: 'o1', status, last_updated: lu, seller: { id: 999 }, shipping: { id: 1 } } as PedidoML)) });
      await drenarCancelamentos(f.io, 'L1');
      expect(f.reg('o1'), `${status}@${lu}`).toMatchObject({ concluir, desfecho, lido_em: concluir ? 'L1' : null });
      expect(f.io.tratar).not.toHaveBeenCalled();
    }
  });

  it('F5. aindaPendente falso → não trata e não registra', async () => {
    const f = criarIo([ob('o1'), ob('o2')], { aindaPendente: vi.fn(async (o: Obrigacao) => o.orderId !== 'o1') });
    await drenarCancelamentos(f.io, 'L1');
    expect(f.reg('o1')).toBeUndefined();
    expect(f.io.tratar).toHaveBeenCalledTimes(1);
    expect(f.reg('o2')?.concluir).toBe(true);
  });

  it('F6. outro pedido, outro vendedor, sem vendedor, sem last_updated → fica sem tratar', async () => {
    const respostas: PedidoML[] = [
      { id: 'outro', status: 'cancelled', last_updated: v(30), seller: { id: 999 } } as PedidoML,
      { id: 'o1', status: 'cancelled', last_updated: v(30), seller: { id: 123 } } as PedidoML,
      { id: 'o1', status: 'cancelled', last_updated: v(30) } as PedidoML,
      { id: 'o1', status: 'cancelled', seller: { id: 999 } } as PedidoML,
    ];
    for (const p of respostas) {
      const f = criarIo([ob('o1')], { pedido: vi.fn(async () => p) });
      await drenarCancelamentos(f.io, 'L1');
      expect(f.reg('o1')?.concluir).toBe(false);
      expect(f.reg('o1')?.desfecho).toMatch(/^ml: /);
      expect(f.io.tratar).not.toHaveBeenCalled();
    }
    // Resposta sem last_updated também não conclui.
    const f = criarIo([ob('o1')], { pedido: vi.fn(async () => ({ id: 'o1', status: 'paid', seller: { id: 999 } } as PedidoML)) });
    await drenarCancelamentos(f.io, 'L1');
    expect(f.reg('o1')).toMatchObject({ concluir: false, desfecho: 'ml: sem versão' });
  });

  it('F6b. conexão sem contaExternaId → zeros sem reivindicar', async () => {
    const f = criarIo([ob('o1')], { contaExternaId: '' });
    expect(await drenarCancelamentos(f.io, 'L1')).toEqual({ concluidos: 0, pendentes: 0 });
    expect(f.io.reivindicar).not.toHaveBeenCalled();
  });

  it('F7. reposto com 1 de 2 SKUs ainda aberto na releitura → reposicao-incompleta', async () => {
    const f = criarIo([ob('o1')], {}, { o1: [aberta('A'), aberta('B')] });
    f.io.tratar.mockImplementation(async () => { f.baixas.set('o1', [estornada('A'), aberta('B')]); return 'reposto'; });
    await drenarCancelamentos(f.io, 'L1');
    expect(f.reg('o1')).toMatchObject({ concluir: false, desfecho: 'reposicao-incompleta' });
  });

  it('F8/F8b. itens vêm do ledger (código da referência, mesmo com ":")', async () => {
    const f = criarIo([ob('o1')], {}, { o1: [aberta('NOVO', 2), aberta('ABC:01', 1), estornada('VELHO')] });
    f.io.envio.mockResolvedValue({ status: 'handling' });
    await drenarCancelamentos(f.io, 'L1');
    const p = f.io.tratar.mock.calls[0][0];
    expect(p.itens).toEqual([{ codigo: 'NOVO', quantity: 2 }, { codigo: 'ABC:01', quantity: 1 }]);
    expect(refBaixa('mercado_livre', 'o1', p.itens[1].codigo!)).toBe('mercado_livre:o1:ABC:01');
    expect(p).toMatchObject({ orderId: 'o1', statusPedido: 'cancelled', shipmentStatus: 'handling', temEnvio: true, catalogoIncompleto: false });
  });

  it('F9. sem baixa aberta → sem-baixa-aberta sem ML nem estoque; pedido fora do Map → fica sem ML', async () => {
    const f = criarIo([ob('o1'), ob('o2')], {}, { o1: [estornada()], o2: [] });
    await drenarCancelamentos(f.io, 'L1');
    expect(f.reg('o1')).toMatchObject({ concluir: true, desfecho: 'sem-baixa-aberta', lido_em: 'L1' });
    expect(f.reg('o2')).toMatchObject({ concluir: true, desfecho: 'sem-baixa-aberta' });
    expect(f.io.pedido).not.toHaveBeenCalled();
    expect(f.io.envio).not.toHaveBeenCalled();
    expect(f.io.tratar).not.toHaveBeenCalled();

    const g = criarIo([ob('o3')]);
    g.io.ledger.mockResolvedValue(new Map());
    await drenarCancelamentos(g.io, 'L1');
    expect(g.reg('o3')?.concluir).toBe(false);
    expect(g.io.pedido).not.toHaveBeenCalled();
  });

  it('F10. ciclo 1 reposto e conclui; rearmado com envio cancelled no ciclo 2 → sem-baixa-aberta sem tratar', async () => {
    const f = criarIo([ob('o1')]);
    f.io.tratar.mockImplementation(async () => { f.estornar('o1'); return 'reposto'; });
    await drenarCancelamentos(f.io, 'L1');
    expect(f.reg('o1')).toMatchObject({ concluir: true, desfecho: 'reposto' });
    f.io.reivindicar.mockResolvedValue([ob('o1', v(50), 'g2')]);
    f.io.envio.mockResolvedValue({ status: 'cancelled' });
    await drenarCancelamentos(f.io, 'L2');
    expect(f.io.tratar).toHaveBeenCalledTimes(1);
    expect(f.registros().at(-1)).toMatchObject({ geracao: 'g2', concluir: true, desfecho: 'sem-baixa-aberta' });
  });

  it('F11. misto com envio shipped → parcial-sem-pre-despacho; com handling → trata só as abertas', async () => {
    const f = criarIo([ob('o1')], {}, { o1: [estornada('A'), aberta('B')] });
    f.io.envio.mockResolvedValue({ status: 'shipped' });
    await drenarCancelamentos(f.io, 'L1');
    expect(f.reg('o1')).toMatchObject({ concluir: false, desfecho: 'parcial-sem-pre-despacho' });
    expect(f.io.tratar).not.toHaveBeenCalled();
    f.io.envio.mockResolvedValue({ status: 'handling' });
    await drenarCancelamentos(f.io, 'L2');
    expect(f.io.tratar.mock.calls[0][0].itens).toEqual([{ codigo: 'B', quantity: 1 }]);
  });

  describe('F12/F13. kit: crédito pendente fica na fila própria', () => {
    const baseKit = () => ({
      estornarVendaCancelada: vi.fn(async () => ({ pendentesDePush: [], falhas: [{ codigo: 'KIT1', mensagem: 'falhou' }], aplicados: [] })),
      despacharPushPendente: vi.fn(async () => ({ marcados: 0, falhas: 0 })),
      enfileirarSincronizacaoEstoque: vi.fn(async () => 'x'),
      houveBaixaDeVenda: vi.fn(async () => true),
      claimDoPedido: vi.fn(async () => null),
      reservarNotificacao: vi.fn(async () => false),
      notificarCategoria: vi.fn(async () => null),
      skusParticipantes: vi.fn(async () => new Set(['KIT1'])),
      agendarCancelamentoKit: vi.fn(async () => []),
      classificarItensKit: vi.fn(async (_a: unknown, p: { itens: unknown[] }) => ({ certos: p.itens, incertos: [], divergentes: [] })),
      gravarIdentidades: vi.fn(async (_a: unknown, p: { itens: unknown[] }) => p.itens),
      registrarPendenciaKit: vi.fn(async () => {}),
    });

    it('ciclo 1 pendente sem tocar registrarPendenciaKit; ciclo 2 com paid antigo não trata', async () => {
      const base = baseKit();
      const deps = depsDaFila(base as unknown as DepsCancelamento);
      const f = criarIo([ob('o1')], {
        kitLigado: vi.fn(async () => true),
        tratar: vi.fn((p: PedidoDaFila) => tratarPedidoCancelado({} as never, deps, { ...p, orgId: 'org-1', userId: 'u-1', canal: 'mercado_livre' })),
      }, { o1: [aberta('KIT1')] });
      await drenarCancelamentos(f.io, 'L1');
      expect(f.reg('o1')).toMatchObject({ concluir: false, desfecho: 'pendente' });
      expect(base.estornarVendaCancelada).toHaveBeenCalled();
      expect(base.registrarPendenciaKit).not.toHaveBeenCalled();

      f.io.pedido.mockResolvedValue({ id: 'o1', status: 'paid', last_updated: v(20), seller: { id: 999 }, shipping: { id: 1 } } as PedidoML);
      await drenarCancelamentos(f.io, 'L2');
      expect(f.io.tratar).toHaveBeenCalledTimes(1);
      expect(f.registros().at(-1)?.concluir).toBe(false);
      expect(base.registrarPendenciaKit).not.toHaveBeenCalled();
    });
  });

  it('F14/F16. estrutural: a fila não usa a fila comum nem o código de kit da fila comum', () => {
    const texto = readFileSync(resolve(process.cwd(), 'supabase/functions/reconciliar-faturamento/cancelamentos.ts'), 'utf8');
    for (const proibido of ['refazerBaixaAdiada', 'worker_pendencias', 'desfechoKit', 'upsertVenda', 'lerPendenciasKit',
      'ehVendaDaConta', 'lerPendencias', 'registrarPendencias']) {
      expect(texto, proibido).not.toContain(proibido);
    }
    expect(Object.keys(criarIo([]).io).sort()).toEqual(['agora', 'aindaPendente', 'contaExternaId', 'envio', 'kitLigado',
      'ledger', 'pedido', 'registrar', 'reivindicar', 'tratar']);
  });

  it('F15. lote de 20, todos com baixa aberta, 5 de kit: contagem exata de chamadas', async () => {
    const obs = Array.from({ length: 20 }, (_, i) => ob(`o${i + 1}`));
    const kit = Object.fromEntries(obs.slice(0, 5).map((o) => [o.orderId, [aberta('KIT1')]]));
    const f = criarIo(obs, { kitLigado: vi.fn(async () => true) }, kit);
    f.io.tratar.mockImplementation(async (p) => {
      if (Number(String(p.orderId).slice(1)) <= 10) { f.estornar(String(p.orderId)); return 'reposto'; }
      return 'avisado';
    });
    const r = await drenarCancelamentos(f.io, 'L1');
    expect(f.io.reivindicar).toHaveBeenCalledTimes(1);
    expect(f.io.pedido).toHaveBeenCalledTimes(20);
    expect(f.io.envio.mock.calls.length).toBeLessThanOrEqual(20);
    expect(f.io.ledger).toHaveBeenCalledTimes(1 + 10);
    expect(f.io.kitLigado).toHaveBeenCalledTimes(1);
    expect(f.io.registrar).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ concluidos: 20, pendentes: 0 });
  });

  it('F17. drenagemLigada', () => {
    expect(drenagemLigada(undefined, 'a')).toBe(false);
    expect(drenagemLigada('', 'a')).toBe(false);
    expect(drenagemLigada('1', 'a')).toBe(true);
    expect(drenagemLigada('a, b', 'b')).toBe(true);
    expect(drenagemLigada('a,b', 'c')).toBe(false);
  });

  it('F18. item do ledger sem ml_item_id passa por classificarItensKit/gravarIdentidades reais com o mesmo código', async () => {
    const fluxo = { select: () => fluxo, eq: () => fluxo, in: () => fluxo,
      then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok) };
    const admin = { from: () => fluxo } as never;
    const itens = [{ codigo: 'ABC:01', quantity: 1 }];
    const c = await classificarItensKit(admin, { orgId: 'o', canal: 'mercado_livre', orderId: '1', itens, incerto: false });
    expect(c.certos).toEqual(itens);
    expect(await gravarIdentidades(admin, { orgId: 'o', canal: 'mercado_livre', orderId: '1', itens: c.certos })).toEqual(itens);
  });

  it('F19/F20. a versão usada é a armada, não a de raw', async () => {
    const f = criarIo([ob('o1', v(30))]);
    await drenarCancelamentos(f.io, 'L1');
    expect(f.io.tratar).toHaveBeenCalledTimes(1);
    const g = criarIo([ob('o1', v(30))], { pedido: vi.fn(async () => ({ id: 'o1', status: 'paid', last_updated: v(40), seller: { id: 999 } } as PedidoML)) });
    await drenarCancelamentos(g.io, 'L1');
    expect(g.reg('o1')).toMatchObject({ concluir: true, desfecho: 'nao-cancelado' });
  });

  it('F21. baixa depois da conclusão: ciclo 2 (reaberta) trata a baixa nova e conclui avisado', async () => {
    const f = criarIo([ob('o1')], {}, { o1: [] });
    await drenarCancelamentos(f.io, 'L1');
    expect(f.reg('o1')).toMatchObject({ concluir: true, desfecho: 'sem-baixa-aberta' });
    f.baixas.set('o1', [aberta('TARDIA')]);
    f.io.reivindicar.mockResolvedValue([ob('o1', v(30), 'g2')]);
    f.io.envio.mockResolvedValue({ status: 'shipped' });
    await drenarCancelamentos(f.io, 'L2');
    expect(f.io.tratar.mock.calls[0][0].itens).toEqual([{ codigo: 'TARDIA', quantity: 1 }]);
    expect(f.registros().at(-1)).toMatchObject({ geracao: 'g2', concluir: true, desfecho: 'avisado' });
  });

  it('F22. conclusão sem instante do ledger → concluir=false', async () => {
    const f = criarIo([ob('o1')], {}, { o1: [] });
    f.io.ledger.mockResolvedValue(new Map([['o1', { lidoEm: '', baixas: [] }]]));
    await drenarCancelamentos(f.io, 'L1');
    expect(f.reg('o1')).toMatchObject({ concluir: false, desfecho: 'sem instante do ledger' });
  });

  it('F23. pedido que nunca responde → ml: tempo esgotado aos 10 s; as outras 19 seguem', async () => {
    vi.useFakeTimers({ now: 0 });
    const obs = Array.from({ length: 20 }, (_, i) => ob(`o${i + 1}`));
    const f = criarIo(obs);
    const real = f.io.pedido.getMockImplementation()!;
    f.io.pedido.mockImplementation((id: string) => (id === 'o1' ? nunca<PedidoML>() : real(id)));
    const p = drenarCancelamentos(f.io, 'L1');
    await vi.advanceTimersByTimeAsync(10_001);
    const r = await p;
    expect(f.reg('o1')).toMatchObject({ concluir: false, desfecho: 'ml: tempo esgotado' });
    expect(f.registros().filter((x) => x.concluir)).toHaveLength(19);
    expect(r).toEqual({ concluidos: 19, pendentes: 1 });
  });

  it('F24. respostas de 9 s com orçamento de 20 s: as que não começaram ficam sem registro', async () => {
    vi.useFakeTimers({ now: 0 });
    const obs = Array.from({ length: 20 }, (_, i) => ob(`o${i + 1}`));
    const f = criarIo(obs);
    const real = f.io.pedido.getMockImplementation()!;
    f.io.pedido.mockImplementation((id: string) => new Promise((ok) => setTimeout(() => ok(real(id)), 9_000)));
    const p = drenarCancelamentos(f.io, 'L1', 20_000);
    await vi.advanceTimersByTimeAsync(40_000);
    const r = await p;
    expect(f.io.registrar).toHaveBeenCalledTimes(1);
    expect(f.registros()).toHaveLength(15);
    expect(r).toEqual({ concluidos: 15, pendentes: 5 });
  });

  it('F25. corrida: registro com a geração antiga não conclui; ciclo seguinte com @50 trata', async () => {
    const corrente = new Map([['v-o1', 'g1']]);
    const concluidas = new Set<string>();
    const f = criarIo([ob('o1', v(30), 'g1')], {
      pedido: vi.fn(async () => { corrente.set('v-o1', 'g2'); return { id: 'o1', status: 'paid', last_updated: v(40), seller: { id: 999 } } as PedidoML; }),
      registrar: vi.fn(async (itens: Registro[]) => {
        for (const i of itens) if (i.concluir && corrente.get(i.id) === i.geracao) concluidas.add(i.id);
        return concluidas.size;
      }),
    });
    await drenarCancelamentos(f.io, 'L1');
    expect(f.reg('o1')).toMatchObject({ geracao: 'g1', desfecho: 'nao-cancelado' });
    expect(concluidas.size).toBe(0);
    f.io.reivindicar.mockResolvedValue([ob('o1', v(50), 'g2')]);
    f.io.pedido.mockResolvedValue({ id: 'o1', status: 'cancelled', last_updated: v(50), seller: { id: 999 } } as PedidoML);
    await drenarCancelamentos(f.io, 'L2');
    expect(f.io.tratar).toHaveBeenCalledTimes(1);
  });

  it('F26. envio não lido (null ou sem status) fica; pedido sem envio trata com temEnvio=false', async () => {
    for (const envio of [null, { status: null }]) {
      const f = criarIo([ob('o1')], { envio: vi.fn(async () => envio) });
      await drenarCancelamentos(f.io, 'L1');
      expect(f.reg('o1')).toMatchObject({ concluir: false, desfecho: 'ml: envio não lido' });
      expect(f.io.tratar).not.toHaveBeenCalled();
    }
    const f = criarIo([ob('o1')], { pedido: vi.fn(async () => ({ id: 'o1', status: 'cancelled', last_updated: v(30), seller: { id: 999 } } as PedidoML)) });
    await drenarCancelamentos(f.io, 'L1');
    expect(f.io.envio).not.toHaveBeenCalled();
    expect(f.io.tratar.mock.calls[0][0]).toMatchObject({ temEnvio: false, shipmentStatus: null });
  });

  it('F27. tratar que nunca responde → tratamento: tempo esgotado aos 30 s; ciclo seguinte com ledger limpo conclui sem tratar', async () => {
    vi.useFakeTimers({ now: 0 });
    const f = criarIo([ob('o1'), ob('o2')]);
    f.io.tratar.mockImplementation((p) => {
      if (p.orderId === 'o1') { f.estornar('o1'); return nunca(); }
      return Promise.resolve('avisado');
    });
    const p = drenarCancelamentos(f.io, 'L1');
    await vi.advanceTimersByTimeAsync(30_001);
    await p;
    expect(f.reg('o1')).toMatchObject({ concluir: false, desfecho: 'tratamento: tempo esgotado' });
    expect(f.reg('o2')?.concluir).toBe(true);
    vi.useRealTimers();
    f.io.reivindicar.mockResolvedValue([ob('o1')]);
    await drenarCancelamentos(f.io, 'L2');
    expect(f.io.tratar).toHaveBeenCalledTimes(2);
    expect(f.registros().at(-1)).toMatchObject({ id: 'v-o1', concluir: true, desfecho: 'sem-baixa-aberta' });
  });

  it('F28. uma dependência por vez nunca responde: retorna ou lança antes de PRAZO_FINAL_MS + 10 s, sem concluir sem evidência', async () => {
    for (const dep of ['ledger', 'aindaPendente', 'kitLigado', 'registrar', 'reivindicar'] as const) {
      vi.useFakeTimers({ now: 0 });
      const f = criarIo([ob('o1'), ob('o2')], { [dep]: vi.fn(() => nunca()) });
      let fim: { ok?: unknown; erro?: unknown } | null = null;
      drenarCancelamentos(f.io, 'L1').then((ok) => { fim = { ok }; }, (erro) => { fim = { erro }; });
      await vi.advanceTimersByTimeAsync(PRAZO_FINAL_MS + 10_000);
      expect(fim, dep).not.toBeNull();
      if (dep !== 'registrar') expect(f.registros().filter((r) => r.concluir), dep).toHaveLength(0);
      vi.useRealTimers();
    }
  });

  it('F29/F30. prazos contam do início da execução, não do início da drenagem', async () => {
    vi.useFakeTimers({ now: 100_000 });
    const obs = Array.from({ length: 20 }, (_, i) => ob(`o${i + 1}`));
    const f = criarIo(obs);
    const real = f.io.pedido.getMockImplementation()!;
    f.io.pedido.mockImplementation((id: string) => new Promise((ok) => setTimeout(() => ok(real(id)), 9_000)));
    const p = drenarCancelamentos(f.io, 'L1', 60_000, 100_000 - 55_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await p).toEqual({ concluidos: 5, pendentes: 15 });
    expect(f.registros()).toHaveLength(5);

    // Prazo vencido na entrada: lança (a rodada sai `parcial`), sem reivindicar.
    const g = criarIo(obs);
    await expect(drenarCancelamentos(g.io, 'L1', 60_000, Date.now() - 61_000)).rejects.toThrow(/sem tempo/);
    expect(g.io.reivindicar).not.toHaveBeenCalled();
  });

  it('F31. registrar sem resposta = incerto: lança; ciclo seguinte reconfere pelo ledger', async () => {
    vi.useFakeTimers({ now: 0 });
    const f = criarIo([ob('o1'), ob('o2')], { registrar: vi.fn(() => nunca<void>()) });
    f.io.tratar.mockImplementation(async (p) => { if (p.orderId === 'o1') { f.estornar('o1'); return 'reposto'; } return 'avisado'; });
    const p = drenarCancelamentos(f.io, 'L1').then(() => 'ok', (e) => e as Error);
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await p).toBeInstanceOf(Error);
    vi.useRealTimers();
    f.io.registrar.mockImplementation(async () => {});
    f.io.tratar.mockImplementation(async () => 'silenciado');
    await drenarCancelamentos(f.io, 'L2');
    const ultimos = f.io.registrar.mock.calls.at(-1)![0];
    expect(ultimos.find((r) => r.id === 'v-o1')).toMatchObject({ concluir: true, desfecho: 'sem-baixa-aberta' });
    expect(ultimos.find((r) => r.id === 'v-o2')).toMatchObject({ concluir: true, desfecho: 'silenciado' });
  });

  it('F32. resposta sem status (undefined, null, "") com data mais nova → ml: sem status, fica', async () => {
    for (const status of [undefined, null, '']) {
      const f = criarIo([ob('o1')], { pedido: vi.fn(async () => ({ id: 'o1', status, last_updated: v(40), seller: { id: 999 } } as PedidoML)) });
      await drenarCancelamentos(f.io, 'L1');
      expect(f.reg('o1'), String(status)).toMatchObject({ concluir: false, desfecho: 'ml: sem status' });
      expect(f.io.tratar).not.toHaveBeenCalled();
    }
  });

  // ── Revisão Codex de f3fb4fe1 (BLOQUEAR) ──────────────────────────────────────────────────────────────
  it('F33 (r1). geração trocada durante kitLigado → não trata; a contagem usa as conclusões aceitas pela RPC', async () => {
    let pendente = true;
    const f = criarIo([ob('o1')], {
      kitLigado: vi.fn(async () => { pendente = false; return false; }),
      aindaPendente: vi.fn(async () => pendente),
    });
    expect(await drenarCancelamentos(f.io, 'L1')).toEqual({ concluidos: 0, pendentes: 1 });
    expect(f.io.tratar).not.toHaveBeenCalled();
    expect(f.io.aindaPendente.mock.invocationCallOrder[0]).toBeGreaterThan(f.io.kitLigado.mock.invocationCallOrder[0]);

    const g = criarIo([ob('o1'), ob('o2')], { registrar: vi.fn(async () => 1) });
    expect(await drenarCancelamentos(g.io, 'L1')).toEqual({ concluidos: 1, pendentes: 1 });
  });

  it('F34 (r2). status fora da lista do ML (espaços, arbitrário, número, pending_cancel) fica pendente; envio idem', async () => {
    for (const status of ['  ', 'xyz', 7, 'pending_cancel']) {
      const f = criarIo([ob('o1')], { pedido: vi.fn(async () => ({ id: 'o1', status, last_updated: v(40), seller: { id: 999 } } as unknown as PedidoML)) });
      await drenarCancelamentos(f.io, 'L1');
      expect(f.reg('o1')?.concluir, String(status)).toBe(false);
      expect(f.io.tratar).not.toHaveBeenCalled();
    }
    for (const status of [7, 'xyz', ' shipped']) {
      const f = criarIo([ob('o1')], { envio: vi.fn(async () => ({ status } as unknown as { status: string })) });
      await drenarCancelamentos(f.io, 'L1');
      expect(f.reg('o1'), String(status)).toMatchObject({ concluir: false, desfecho: 'ml: envio não lido' });
      expect(f.io.tratar).not.toHaveBeenCalled();
    }
  });

  it('F37 (r5). envio stale_ready_to_ship / stale_shipped é status válido do ML: segue para o tratamento', async () => {
    for (const status of ['stale_ready_to_ship', 'stale_shipped']) {
      const f = criarIo([ob('o1')], { envio: vi.fn(async () => ({ status })) });
      await drenarCancelamentos(f.io, 'L1');
      expect(f.io.tratar, status).toHaveBeenCalledTimes(1);
      expect(f.io.tratar.mock.calls[0][0].shipmentStatus).toBe(status);
    }
  });

  it('F39 (r6). substatus não-texto é normalizado como nos outros chamadores (ready_to_ship + 42 não é pré-despacho)', async () => {
    const f = criarIo([ob('o1')], { envio: vi.fn(async () => ({ status: 'ready_to_ship', substatus: 42 } as unknown as { status: string })) });
    await drenarCancelamentos(f.io, 'L1');
    expect(f.io.tratar.mock.calls[0][0].shipmentSubstatus).toBe('42');
  });

  it('F35 (r3). prazo final vencido antes de tratar: o tratamento nem começa', async () => {
    let relogio = 0;
    const f = criarIo([ob('o1')], {
      agora: () => relogio,
      aindaPendente: vi.fn(async () => { relogio = PRAZO_FINAL_MS + 1; return true; }),
    });
    await drenarCancelamentos(f.io, 'L1', 60_000, 0);
    expect(f.io.tratar).not.toHaveBeenCalled();
    expect(f.reg('o1')).toMatchObject({ concluir: false, desfecho: 'tratamento: tempo esgotado' });
  });

  it('F36 (r4). versão armada nula: cancelled ao vivo trata; outro status não conclui', async () => {
    const f = criarIo([ob('o1', null)]);
    await drenarCancelamentos(f.io, 'L1');
    expect(f.io.tratar).toHaveBeenCalledTimes(1);
    const g = criarIo([ob('o1', null)], { pedido: vi.fn(async () => ({ id: 'o1', status: 'paid', last_updated: v(40), seller: { id: 999 } } as PedidoML)) });
    await drenarCancelamentos(g.io, 'L1');
    expect(g.reg('o1')).toMatchObject({ concluir: false, desfecho: 'ml: sem versão' });
  });

  it('F31b (r8). registrar confirma DEPOIS do prazo: o ciclo seguinte não reivindica o concluído nem repete o estorno', async () => {
    vi.useFakeTimers({ now: 0 });
    const concluidas = new Set<string>();
    const obs = [ob('o1'), ob('o2')];
    const f = criarIo(obs, {
      reivindicar: vi.fn(async () => obs.filter((o) => !concluidas.has(o.id))),
      registrar: vi.fn((itens: Registro[]) => new Promise<number>((ok) => setTimeout(() => {
        for (const i of itens) if (i.concluir) concluidas.add(i.id);
        ok(concluidas.size);
      }, 15_000))),
    });
    f.io.tratar.mockImplementation(async (p) => { if (p.orderId === 'o1') { f.estornar('o1'); return 'reposto'; } return 'erro'; });
    const p = drenarCancelamentos(f.io, 'L1').then(() => 'ok', (e) => e as Error);
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await p).toBeInstanceOf(Error);
    await vi.advanceTimersByTimeAsync(10_000); // a gravação abandonada termina depois
    expect(concluidas.has('v-o1')).toBe(true);
    vi.useRealTimers();
    f.io.registrar.mockImplementation(async (i: Registro[]) => i.filter((r) => r.concluir).length);
    f.io.tratar.mockImplementation(async () => 'avisado');
    await drenarCancelamentos(f.io, 'L2');
    const tratados = f.io.tratar.mock.calls.map((c) => c[0].orderId);
    expect(tratados.filter((id) => id === 'o1')).toHaveLength(1);
    expect(f.io.registrar.mock.calls.at(-1)![0].map((r) => r.id)).toEqual(['v-o2']);
  });

  it('F38 (emenda ADR-0121). substatus do envio chega ao tratamento e decide o pré-despacho no estado misto', async () => {
    const f = criarIo([ob('o1')], { envio: vi.fn(async () => ({ status: 'ready_to_ship', substatus: 'picked_up' })) });
    await drenarCancelamentos(f.io, 'L1');
    expect(f.io.tratar.mock.calls[0][0]).toMatchObject({ shipmentStatus: 'ready_to_ship', shipmentSubstatus: 'picked_up' });

    const g = criarIo([ob('o1')], { envio: vi.fn(async () => ({ status: 'ready_to_ship', substatus: 'picked_up' })) }, { o1: [estornada('A'), aberta('B')] });
    await drenarCancelamentos(g.io, 'L1');
    expect(g.reg('o1')).toMatchObject({ concluir: false, desfecho: 'parcial-sem-pre-despacho' });
    expect(g.io.tratar).not.toHaveBeenCalled();

    const h = criarIo([ob('o1')], { envio: vi.fn(async () => ({ status: 'ready_to_ship', substatus: 'printed' })) }, { o1: [estornada('A'), aberta('B')] });
    await drenarCancelamentos(h.io, 'L1');
    expect(h.io.tratar).toHaveBeenCalledTimes(1);
  });
});

// Emenda 8 (24/11) ao ADR-0121: envio `cancelled` que nunca saiu, na fila, com o `tratarPedidoCancelado` real.
describe('drenarCancelamentos: envio cancelado que nunca saiu', () => {
  type Envio = { status: string; substatus?: string | null };
  function cenario(o: { ledger: Baixa[]; prova?: 'sim' | 'nao' | 'indisponivel'; envio?: Envio; tentativas?: number; some?: string[]; avisado?: boolean; kit?: boolean; releituraFalha?: boolean; lerEnvio?: () => Promise<Envio | null> }) {
    const textos: string[] = [];
    const estornos: unknown[][] = [];
    let leituras = 0;
    const lerNuncaSaiu = vi.fn(async (_s: number | string) => o.prova ?? ('sim' as const));
    const f = criarIo([ob('o1')], {
      envio: vi.fn(o.lerEnvio ?? (async () => o.envio ?? { status: 'cancelled', substatus: null })),
      kitLigado: vi.fn(async () => !!o.kit),
      aindaPendente: vi.fn(async () => ({ tentativas: o.tentativas ?? 0 })),
      lerNuncaSaiu,
    }, { o1: o.ledger });
    const deps = depsDaFila({
      estornarVendaCancelada: async (_a: unknown, p: { itens: Array<{ codigo: string | null }> }) => {
        estornos.push(p.itens);
        f.baixas.set('o1', f.baixas.get('o1')!.map((b) => (p.itens.some((i) => i.codigo === b.codigoRef) && !o.some?.includes(b.codigoRef) ? { ...b, estornada: true } : b)));
        return { pendentesDePush: [], falhas: [], aplicados: [] };
      },
      despacharPushPendente: async () => ({ marcados: 0, falhas: 0 }),
      enfileirarSincronizacaoEstoque: async () => 'x',
      houveBaixaDeVenda: async () => true,
      claimDoPedido: async () => null,
      reservarNotificacao: async () => true,
      notificarCategoria: async (_a: unknown, _o: string, _c: string, t: string) => { textos.push(t); },
      baixasAbertas: async () => {
        if (leituras++ > 0 && o.releituraFalha) throw new Error('fora');
        const bs = f.baixas.get('o1')!;
        return { abertas: bs.filter((b) => !b.estornada).map((b) => ({ codigoRef: b.codigoRef, codigo: b.codigoRef, quantidade: b.quantidade })), haEstornada: bs.some((b) => b.estornada) };
      },
      saldoMexidoDepois: async () => false,
      notificacaoJaEnviada: async () => !!o.avisado,
      filaAssume: async () => true, // a fila nunca consulta: com isto ela emitiria `adiado`
    } as unknown as DepsCancelamento);
    f.io.tratar.mockImplementation((p) => tratarPedidoCancelado({} as never, deps, { ...p, orgId: 'org-1', userId: 'u-1', canal: 'mercado_livre' }));
    return { ...f, textos, estornos, lerNuncaSaiu, rodar: async () => { await drenarCancelamentos(f.io, 'L1'); return f.reg('o1')!; } };
  }
  const MISTO = () => [estornada('A'), aberta('B', 2)];

  it('F40. com prova repõe e conclui só depois de reler o ledger', async () => {
    const c = cenario({ ledger: [aberta('A'), aberta('B', 2)] });
    expect(await c.rodar()).toMatchObject({ concluir: true, desfecho: 'reposto', lido_em: 'L2' });
    expect(c.estornos).toEqual([[{ codigo: 'A', quantity: 1 }, { codigo: 'B', quantity: 2 }]]);
    expect(c.lerNuncaSaiu.mock.calls).toEqual([['So1']]);
  });

  it('F41. misto com prova: repõe só as abertas, lendo o histórico uma vez e antes de reconferir a geração', async () => {
    const c = cenario({ ledger: MISTO() });
    expect(await c.rodar()).toMatchObject({ concluir: true, desfecho: 'reposto' });
    expect(c.estornos).toEqual([[{ codigo: 'B', quantity: 2 }]]);
    expect(c.lerNuncaSaiu).toHaveBeenCalledTimes(1);
    expect(c.io.aindaPendente.mock.invocationCallOrder[0]).toBeGreaterThan(c.lerNuncaSaiu.mock.invocationCallOrder[0]);
  });

  const SEM_PROVA: Array<[string, { prova?: 'nao' | 'indisponivel'; envio?: Envio }, number]> = [
    ['impressa', { prova: 'nao' }, 1], ['histórico indisponível', { prova: 'indisponivel' }, 1],
    ['despachado', { envio: { status: 'shipped' } }, 0], ['pack_splitted', { envio: { status: 'cancelled', substatus: 'pack_splitted' } }, 0],
  ];
  it.each(SEM_PROVA)('F42. misto sem prova (%s): pendente nas 2 primeiras, avisa só o aberto na 3ª', async (_n, o, leituras) => {
    for (const tentativas of [0, 1]) {
      const c = cenario({ ledger: MISTO(), tentativas, ...o });
      expect(await c.rodar(), String(tentativas)).toMatchObject({ concluir: false, desfecho: 'parcial-sem-pre-despacho' });
      expect(c.io.tratar).not.toHaveBeenCalled();
      expect(c.lerNuncaSaiu).toHaveBeenCalledTimes(leituras);
    }
    const c = cenario({ ledger: MISTO(), tentativas: 2, ...o });
    expect(await c.rodar()).toMatchObject({ concluir: true, desfecho: 'avisado' });
    expect(c.estornos).toEqual([]);
    expect(c.textos).toHaveLength(1);
    expect(c.textos[0]).toContain('• B — 2 un.');
    expect(c.textos[0]).not.toContain('• A');
  });

  it('F43. indisponível sem estado misto: erro nas 2 primeiras, avisa na 3ª; nunca adiado', async () => {
    for (const tentativas of [0, 1]) {
      const c = cenario({ ledger: [aberta('A')], prova: 'indisponivel', tentativas });
      expect(await c.rodar()).toMatchObject({ concluir: false, desfecho: 'erro' });
      expect(c.textos).toEqual([]);
    }
    expect(await cenario({ ledger: [aberta('A')], prova: 'indisponivel', tentativas: 2 }).rodar()).toMatchObject({ concluir: true, desfecho: 'avisado' });
  });

  it('F44. estorno que deixa baixa aberta (variação apagada): pendente nas 2 primeiras, avisa na 3ª', async () => {
    for (const tentativas of [0, 1, 2]) {
      const c = cenario({ ledger: [aberta('A'), aberta('APAGADO', 3)], some: ['APAGADO'], tentativas });
      expect(await c.rodar(), String(tentativas)).toMatchObject(tentativas < 2 ? { concluir: false, desfecho: 'erro' } : { concluir: true, desfecho: 'avisado' });
      expect(c.textos).toHaveLength(tentativas < 2 ? 0 : 1);
      if (tentativas === 2) expect(c.textos[0]).toContain('• APAGADO — 3 un.');
    }
  });

  it('F45. impressa sem estado misto avisa já na 1ª; já avisado silencia e conclui', async () => {
    expect(await cenario({ ledger: [aberta('A')], prova: 'nao' }).rodar()).toMatchObject({ concluir: true, desfecho: 'avisado' });
    const c = cenario({ ledger: [aberta('A')], avisado: true });
    expect(await c.rodar()).toMatchObject({ concluir: true, desfecho: 'silenciado' });
    expect(c.lerNuncaSaiu).not.toHaveBeenCalled();
  });

  it('F46. histórico que não responde no estado misto: solta em 10 s e fica pendente', async () => {
    vi.useFakeTimers({ now: 0 });
    const c = cenario({ ledger: MISTO() });
    c.lerNuncaSaiu.mockImplementation(() => nunca());
    const p = c.rodar();
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await p).toMatchObject({ concluir: false, desfecho: 'parcial-sem-pre-despacho' });
    expect(c.lerNuncaSaiu).toHaveBeenCalledTimes(1);
  });

  it('F47. sem o leitor: como antes da emenda (misto fica sempre; envio cancelled avisa, sem thunk no tratamento)', async () => {
    const c = cenario({ ledger: MISTO(), tentativas: 5 });
    c.io.lerNuncaSaiu = undefined as never;
    expect(await c.rodar()).toMatchObject({ concluir: false, desfecho: 'parcial-sem-pre-despacho' });
    expect(c.io.aindaPendente).not.toHaveBeenCalled();
    const d = cenario({ ledger: [aberta('A')], tentativas: 5 });
    d.io.lerNuncaSaiu = undefined as never;
    expect(await d.rodar()).toMatchObject({ concluir: true, desfecho: 'avisado' });
    expect(d.estornos).toEqual([]);
  });

  it('F48. releitura do ledger que falha depois do estorno: pendente nas 2 primeiras, texto neutro na 3ª', async () => {
    for (const tentativas of [0, 1, 2]) {
      const c = cenario({ ledger: [aberta('A')], releituraFalha: true, tentativas });
      expect(await c.rodar(), String(tentativas)).toMatchObject(tentativas < 2 ? { concluir: false, desfecho: 'erro' } : { concluir: true, desfecho: 'avisado' });
      expect(c.textos).toHaveLength(tentativas < 2 ? 0 : 1);
      if (tentativas === 2) expect(c.textos[0]).toContain('O estoque pode ter voltado em parte');
    }
  });

  const ENVIO_RUIM: Array<[string, () => Promise<Envio | null>]> = [
    ['nulo', async () => null], ['fora da lista', async () => ({ status: 'xyz' })], ['que lança', async () => { throw new Error('rede'); }],
  ];
  it.each(ENVIO_RUIM)('F49. envio %s: pendente nas 2 primeiras; na 3ª avisa sem repor nem ler o histórico, com e sem kit, misto ou não', async (_n, lerEnvio) => {
    for (const kit of [false, true]) for (const ledger of [[aberta('B', 2)], MISTO()]) {
      for (const tentativas of [0, 1]) {
        const c = cenario({ ledger, lerEnvio, kit, tentativas });
        expect(await c.rodar()).toMatchObject({ concluir: false, desfecho: 'ml: envio não lido' });
        expect(c.io.tratar).not.toHaveBeenCalled();
      }
      const c = cenario({ ledger, lerEnvio, kit, tentativas: 2 });
      expect(await c.rodar()).toMatchObject({ concluir: true, desfecho: 'avisado' });
      expect(c.io.tratar.mock.calls[0][0]).toMatchObject({ shipmentStatus: null, shipmentSubstatus: null, temEnvio: true, kitLigado: kit });
      expect(c.textos[0]).toContain('não deu para consultar');
      expect(c.estornos).toEqual([]);
      expect(c.lerNuncaSaiu).not.toHaveBeenCalled();
    }
  });

  it('F50. envio que não responde: tempo esgotado nas 2 primeiras, avisa na 3ª', async () => {
    for (const tentativas of [1, 2]) {
      vi.useFakeTimers({ now: 0 });
      const c = cenario({ ledger: [aberta('A')], lerEnvio: () => nunca(), tentativas });
      const p = c.rodar();
      await vi.advanceTimersByTimeAsync(10_001);
      expect(await p).toMatchObject(tentativas < 2 ? { concluir: false, desfecho: 'ml: tempo esgotado' } : { concluir: true, desfecho: 'avisado' });
      vi.useRealTimers();
    }
  });

  it('F51. sem o leitor do histórico, envio não lido fica pendente sempre (como antes da emenda)', async () => {
    const c = cenario({ ledger: [aberta('A')], lerEnvio: async () => null, tentativas: 9 });
    c.io.lerNuncaSaiu = undefined as never;
    expect(await c.rodar()).toMatchObject({ concluir: false, desfecho: 'ml: envio não lido' });
    expect(c.io.aindaPendente).not.toHaveBeenCalled();
  });
});
