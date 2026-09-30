import { describe, expect, it, vi } from 'vitest';
import { SemAcessoRodada, rotear, type Acumulado } from '../../_shared/rodada/rodada.ts';
import type { ConexaoCanal } from '../../_shared/canais/conexao.ts';
import type { PedidoML } from '../../_shared/faturamento/venda.ts';
import type { ClaimML } from '../../_shared/faturamento/devolucao.ts';
import { LOTE_PENDENCIAS } from '../../_shared/faturamento/pendencias.ts';
import { LOTE_CLAIMS, LOTE_PEDIDOS, desfechoPedido, passoReconciliar, resultadoVazio, type DepsReconciliar, type ParamsReconciliar } from '../passo.ts';

const PARAMS: ParamsReconciliar = { desde: '2026-09-24T12:00:00.000Z', ate: '2026-09-27T12:00:00.000Z', hojeBRT: '2026-09-27' };
const CX: ConexaoCanal = { id: 'cx-1', orgId: 'org-1', canal: 'mercado_livre', contaExternaId: '999', expiresAt: null };
const INICIO = '2026-09-27T12:00:00.000Z';

const embaralhar = <T>(xs: T[]): T[] => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const pedidos = (n: number): PedidoML[] => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));
const claims = (n: number): ClaimML[] => Array.from({ length: n }, (_, i) => ({ id: 100 + i + 1, status: 'opened' }));
// Pendências vêm por order_id em ordem de TEXTO (lerPendencias), 'o01'..'oNN'.
const idsPend = (n: number) => Array.from({ length: n }, (_, i) => `o${String(i + 1).padStart(2, '0')}`);

function criarDeps(over: Partial<DepsReconciliar> = {}, pend: string[] = []) {
  const deps = {
    conexao: vi.fn(async () => ({ cx: CX, userId: 'user-1' as string | null })),
    token: vi.fn(async () => 'tok'),
    perguntas: vi.fn(async () => 4),
    claimsPendentes: vi.fn(async () => embaralhar(claims(23))),
    processarClaims: vi.fn(async (_t: string, _cx: ConexaoCanal, _u: string, _o: string, cs: ClaimML[]) => cs.length),
    pedidosDaJanela: vi.fn(async () => embaralhar(pedidos(60))),
    pedidoPorId: vi.fn(async (_t: string, id: string): Promise<PedidoML> => ({ id })),
    pendencias: vi.fn(async (depoisDe: string, limite: number) => pend.filter((id) => id > depoisDe).slice(0, limite)),
    registrarPendencias: vi.fn(async () => 0),
    pendentesAtivos: vi.fn(async () => 0),
    agora: vi.fn(() => INICIO),
    processarPedidos: vi.fn(async (_t: string, _cx: ConexaoCanal, _u: string, _o: string, ps: PedidoML[]) =>
      ({ ok: ps.map((p) => String(p.id)), falhas: [] as string[], mpFalhou: [] as string[] })),
    liberacoes: vi.fn(async () => 3),
    ...over,
  };
  return deps;
}

const rodar = (deps: DepsReconciliar, cursor: string | null, acumulado: Acumulado = {}) =>
  passoReconciliar(deps, 'org-1')({ cursor, acumulado, params: PARAMS });

const lotePedidos = (deps: ReturnType<typeof criarDeps>) =>
  (deps.processarPedidos.mock.calls.at(-1)![4] as PedidoML[]).map((p) => Number(p.id));

describe('passoReconciliar', () => {
  it('1. cursor null sem pendências → perguntas| sem processar; com 3 → processa e perguntas|; perguntas → claims|', async () => {
    const vazio = criarDeps();
    const r0 = await rodar(vazio, null);
    expect(r0.proximo).toBe('perguntas|');
    expect(vazio.processarPedidos).not.toHaveBeenCalled();
    expect(vazio.registrarPendencias).not.toHaveBeenCalled();

    const tres = criarDeps({}, idsPend(3));
    const r1 = await rodar(tres, null);
    expect(r1.proximo).toBe('perguntas|');
    expect(tres.pendencias).toHaveBeenCalledWith('', LOTE_PENDENCIAS);
    expect(tres.pedidoPorId.mock.calls.map((c) => c[1])).toEqual(['o01', 'o02', 'o03']);
    expect(lotePedidos(tres).length).toBe(3);
    expect(tres.processarPedidos).toHaveBeenCalledWith('tok', CX, 'user-1', 'org-1', expect.any(Array));
    expect(tres.registrarPendencias).toHaveBeenCalledWith(['o01', 'o02', 'o03'], INICIO, [], null);
    expect(r1.acumulado.reconciliados).toBe(3);

    const r2 = await rodar(tres, 'perguntas|', r1.acumulado);
    expect(r2.proximo).toBe('claims|');
    expect(tres.perguntas).toHaveBeenCalledWith('tok', 'user-1', 'org-1');
    expect(r2.acumulado.perguntas).toBe(4);
  });

  it('2. conexão null ou userId null → fim sem pedir token', async () => {
    const semCx = criarDeps({ conexao: vi.fn(async () => null) });
    expect((await rodar(semCx, null)).proximo).toBeNull();
    expect(semCx.token).not.toHaveBeenCalled();

    const semDono = criarDeps({ conexao: vi.fn(async () => ({ cx: CX, userId: null })) });
    expect((await rodar(semDono, 'vendas|20')).proximo).toBeNull();
    expect(semDono.token).not.toHaveBeenCalled();
  });

  it('3. 23 claims pendentes → 10/10/3 por id numérico, depois vendas|; processarClaims recebe objetos', async () => {
    expect(LOTE_CLAIMS).toBe(10);
    const deps = criarDeps();
    const lote = () => (deps.processarClaims.mock.calls.at(-1)![4] as ClaimML[]);

    const r1 = await rodar(deps, 'claims|');
    expect(lote().map((c) => c.id)).toEqual(Array.from({ length: 10 }, (_, i) => 101 + i));
    expect(lote()[0]).toEqual({ id: 101, status: 'opened' });
    expect(r1.proximo).toBe('claims|110');
    expect(deps.claimsPendentes).toHaveBeenCalledWith('tok', 'user-1', '999');
    expect(deps.processarClaims).toHaveBeenCalledWith('tok', CX, 'user-1', 'org-1', expect.any(Array));

    const r2 = await rodar(deps, r1.proximo, r1.acumulado);
    expect(lote().map((c) => c.id)).toEqual(Array.from({ length: 10 }, (_, i) => 111 + i));
    expect(r2.proximo).toBe('claims|120');

    const r3 = await rodar(deps, r2.proximo, r2.acumulado);
    expect(lote().map((c) => c.id)).toEqual([121, 122, 123]);
    expect(r3.proximo).toBe('claims|123');
    expect(r3.acumulado.claims).toBe(23);

    const r4 = await rodar(deps, r3.proximo, r3.acumulado);
    expect(r4.proximo).toBe('vendas|');
    expect(deps.processarClaims).toHaveBeenCalledTimes(3);
  });

  it('4. vendas com 60 pedidos → 25/25/10, depois liberacoes|', async () => {
    expect(LOTE_PEDIDOS).toBe(25);
    const deps = criarDeps();
    const r1 = await rodar(deps, 'vendas|');
    expect(lotePedidos(deps)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect(r1.proximo).toBe('vendas|25');
    expect(deps.pedidosDaJanela).toHaveBeenCalledWith('tok', { desde: PARAMS.desde, ate: PARAMS.ate });

    const r2 = await rodar(deps, r1.proximo, r1.acumulado);
    expect(lotePedidos(deps)).toEqual(Array.from({ length: 25 }, (_, i) => i + 26));
    expect(r2.proximo).toBe('vendas|50');

    const r3 = await rodar(deps, r2.proximo, r2.acumulado);
    expect(lotePedidos(deps)).toEqual(Array.from({ length: 10 }, (_, i) => i + 51));
    expect(r3.proximo).toBe('vendas|60');
    expect(r3.acumulado.reconciliados).toBe(60);
    // Sucesso também passa por registrarPendencias: o `ok` limpa pendência anterior do mesmo pedido.
    expect(deps.registrarPendencias).toHaveBeenCalledTimes(3);
    expect(deps.registrarPendencias.mock.calls[2]).toEqual([lotePedidos(deps).map(String), INICIO, [], null]);

    const r4 = await rodar(deps, r3.proximo, r3.acumulado);
    expect(r4.proximo).toBe('liberacoes|');
    expect(deps.processarPedidos).toHaveBeenCalledTimes(3);
  });

  it('5. liberacoes → fim, soma liberacoesCorrigidas com o hojeBRT gravado na abertura', async () => {
    const deps = criarDeps();
    const r = await rodar(deps, 'liberacoes|', { reconciliados: 7 });
    expect(r.proximo).toBeNull();
    expect(r.parcial).toBeNull();
    expect(r.acumulado).toEqual({ reconciliados: 7, liberacoesCorrigidas: 3 });
    expect(deps.liberacoes).toHaveBeenCalledWith('tok', CX, 'org-1', '2026-09-27');
  });

  it('6. token em toda etapa; SemAcessoRodada propaga de qualquer uma', async () => {
    const deps = criarDeps();
    const cursores = [null, 'perguntas|', 'claims|', 'vendas|', 'liberacoes|'];
    for (const c of cursores) await rodar(deps, c);
    expect(deps.token).toHaveBeenCalledTimes(cursores.length);

    for (const c of cursores) {
      const morto = criarDeps({ token: vi.fn(async () => { throw new SemAcessoRodada('invalid_grant'); }) }, idsPend(3));
      await expect(rodar(morto, c)).rejects.toBeInstanceOf(SemAcessoRodada);
      expect(morto.processarPedidos).not.toHaveBeenCalled();
      expect(morto.perguntas).not.toHaveBeenCalled();
      expect(morto.liberacoes).not.toHaveBeenCalled();
    }
  });

  it('7. pedidosDaJanela lança → rejeita, sem processar nem registrar', async () => {
    const deps = criarDeps({ pedidosDaJanela: vi.fn(async () => { throw new Error('ML 429'); }) });
    await expect(rodar(deps, 'vendas|')).rejects.toThrow('ML 429');
    expect(deps.processarPedidos).not.toHaveBeenCalled();
    expect(deps.registrarPendencias).not.toHaveBeenCalled();
  });

  it('7b. etapa desconhecida ou pos de vendas/claims não numérico → rejeita (nunca pula em silêncio)', async () => {
    await expect(rodar(criarDeps(), 'xyz|')).rejects.toThrow();
    await expect(rodar(criarDeps(), 'vendas|abc')).rejects.toThrow();
    await expect(rodar(criarDeps(), 'claims|abc')).rejects.toThrow();
  });

  describe('8. pendências', () => {
    it('falha em vendas → registrarPendencias(ok, inicio, [id]) com inicio capturado antes do processamento', async () => {
      const deps = criarDeps({
        processarPedidos: vi.fn(async (_t: string, _cx: ConexaoCanal, _u: string, _o: string, ps: PedidoML[]) =>
          ({ ok: ps.filter((p) => p.id !== 7).map((p) => String(p.id)), falhas: ['7'], mpFalhou: [] as string[] })),
        registrarPendencias: vi.fn(async () => 1),
      });
      const r = await rodar(deps, 'vendas|');
      const ok = Array.from({ length: 25 }, (_, i) => String(i + 1)).filter((id) => id !== '7');
      expect(deps.registrarPendencias).toHaveBeenCalledWith(ok, INICIO, ['7'], expect.stringMatching(/^reconciliar: /));
      expect(deps.agora.mock.invocationCallOrder[0]).toBeLessThan(deps.pedidosDaJanela.mock.invocationCallOrder[0]);
      expect(deps.agora.mock.invocationCallOrder[0]).toBeLessThan(deps.processarPedidos.mock.invocationCallOrder[0]);
      expect(r.acumulado).toMatchObject({ reconciliados: 24, pedidosComFalha: 1, pedidosDescartados: 1 });
    });

    it('inicio da etapa pendencias é capturado antes de ler as pendências e os pedidos', async () => {
      const deps = criarDeps({}, idsPend(2));
      await rodar(deps, null);
      const t = deps.agora.mock.invocationCallOrder[0];
      expect(t).toBeLessThan(deps.pendencias.mock.invocationCallOrder[0]);
      expect(t).toBeLessThan(deps.pedidoPorId.mock.invocationCallOrder[0]);
      expect(deps.registrarPendencias.mock.calls[0][1]).toBe(INICIO);
    });

    it('fim com pendentesAtivos() > 0 → parcial', async () => {
      const deps = criarDeps({ pendentesAtivos: vi.fn(async () => 2) });
      const r = await rodar(deps, 'liberacoes|', { pedidosDescartados: 1 });
      expect(r.proximo).toBeNull();
      expect(r.parcial).toBe('2 pedido(s) pendente(s)');
    });

    it('fim sem pendência ativa mas com descartados → parcial de descarte', async () => {
      const r = await rodar(criarDeps(), 'liberacoes|', { pedidosDescartados: 3 });
      expect(r.parcial).toBe('3 pedido(s) descartado(s) após 5 tentativas');
    });

    it('25 pendências → 20 e pendencias|<20º>, depois 5 e perguntas|', async () => {
      expect(LOTE_PENDENCIAS).toBe(20);
      const pend = idsPend(25);
      const deps = criarDeps({}, pend);
      const r1 = await rodar(deps, null);
      expect(deps.pedidoPorId).toHaveBeenCalledTimes(20);
      expect(r1.proximo).toBe(`pendencias|${pend[19]}`);

      const r2 = await rodar(deps, r1.proximo, r1.acumulado);
      expect(deps.pendencias).toHaveBeenLastCalledWith(pend[19], LOTE_PENDENCIAS);
      expect(deps.pedidoPorId).toHaveBeenCalledTimes(25);
      expect(r2.proximo).toBe('perguntas|');
      expect(r2.acumulado.reconciliados).toBe(25);
    });

    it('pedidoPorId que lança conta como falha; o resto segue', async () => {
      const deps = criarDeps({
        pedidoPorId: vi.fn(async (_t: string, id: string): Promise<PedidoML> => {
          if (id === 'o02') throw new Error('ML 500');
          return { id };
        }),
      }, idsPend(3));
      const r = await rodar(deps, null);
      expect((deps.processarPedidos.mock.calls[0][4] as PedidoML[]).map((p) => p.id)).toEqual(['o01', 'o03']);
      expect(deps.registrarPendencias).toHaveBeenCalledWith(['o01', 'o03'], INICIO, ['o02'], expect.stringMatching(/^reconciliar: /));
      expect(r.proximo).toBe('perguntas|');
      expect(r.acumulado.pedidosComFalha).toBe(1);
    });

    it('todas as leituras falham → não chama processarPedidos, registra as falhas', async () => {
      const deps = criarDeps({ pedidoPorId: vi.fn(async () => { throw new Error('ML 500'); }) }, idsPend(2));
      await rodar(deps, null);
      expect(deps.processarPedidos).not.toHaveBeenCalled();
      expect(deps.registrarPendencias).toHaveBeenCalledWith([], INICIO, ['o01', 'o02'], expect.stringMatching(/^reconciliar: /));
    });
  });
});

describe('10. MP não lido (carregarLiquidoMPDoPedido null) → nem ok nem falha', () => {
  it('desfechoPedido: MP ok → ok; MP null → mpFalhou; exceção → falhas (e devolve o erro)', async () => {
    const r = resultadoVazio();
    expect(await desfechoPedido(r, '1', async () => true)).toBeNull();
    expect(await desfechoPedido(r, '2', async () => false)).toBeNull();
    const boom = new Error('upsert falhou');
    expect(await desfechoPedido(r, '3', async () => { throw boom; })).toBe(boom);
    expect(r).toEqual({ ok: ['1'], falhas: ['3'], mpFalhou: ['2'] });
  });

  // processarPedidos falso que classifica com o helper real: o id 2 teve MP null, o 3 lançou.
  const processarComMP = () => vi.fn(async (_t: string, _cx: ConexaoCanal, _u: string, _o: string, ps: PedidoML[]) => {
    const r = resultadoVazio();
    for (const p of ps) {
      await desfechoPedido(r, String(p.id), async () => {
        if (String(p.id) === '3' || p.id === 'o03') throw new Error('ML 500');
        return !(String(p.id) === '2' || p.id === 'o02');
      });
    }
    return r;
  });

  it('vendas: id com MP null fica fora de ok e de falhas em registrarPendencias; mpFalhou conta', async () => {
    const deps = criarDeps({ pedidosDaJanela: vi.fn(async () => pedidos(4)), processarPedidos: processarComMP() });
    const r = await rodar(deps, 'vendas|');
    const [ok, inicio, falhas] = deps.registrarPendencias.mock.calls[0];
    expect(ok).toEqual(['1', '4']);
    expect(falhas).toEqual(['3']);
    expect(inicio).toBe(INICIO);
    expect(ok).not.toContain('2');
    expect(falhas).not.toContain('2');
    expect(r.acumulado).toMatchObject({ reconciliados: 2, pedidosComFalha: 1, mpFalhou: 1 });
  });

  it('pendencias: idem — a pendência do MP null não é apagada nem ganha tentativa; fim sai parcial', async () => {
    const deps = criarDeps({ processarPedidos: processarComMP(), pendentesAtivos: vi.fn(async () => 2) }, idsPend(4));
    const r = await rodar(deps, null);
    expect(deps.registrarPendencias).toHaveBeenCalledWith(['o01', 'o04'], INICIO, ['o03'], expect.stringMatching(/^reconciliar: /));
    expect(r.acumulado.mpFalhou).toBe(1);
    const f = await rodar(deps, 'liberacoes|', r.acumulado);
    expect(f.parcial).toBe('2 pedido(s) pendente(s)');
  });
});

describe('9. rotear no reconciliar', () => {
  const MSG = { modo: 'org', job: 'reconciliar', org_id: 'org-1', ciclo: '2026-09-27T12', params: PARAMS };
  it('MsgOrg → org com e sem flag', () => {
    expect(rotear(true, MSG, true)).toBe('org');
    expect(rotear(true, MSG, false)).toBe('org');
  });
  it("{modo:'org'} malformado → invalida", () => {
    expect(rotear(true, { modo: 'org' }, false)).toBe('invalida');
    expect(rotear(true, { ...MSG, params: null }, true)).toBe('invalida');
  });
  it('body do schedule: sem flag → legado, com flag → disparo', () => {
    expect(rotear(true, {}, false)).toBe('legado');
    expect(rotear(true, {}, true)).toBe('disparo');
  });
});
