import { describe, expect, it, vi } from 'vitest';
import { SemAcessoRodada, type Acumulado } from '../../_shared/rodada/rodada.ts';
import type { ConexaoCanal } from '../../_shared/canais/conexao.ts';
import type { PedidoML } from '../../_shared/faturamento/venda.ts';
import type { PackVenda } from '../../_shared/faturamento/mensagens-io.ts';
import { LOTE_PACKS, LOTE_PEDIDOS, passoBackfill, type DepsBackfill, type ParamsBackfill } from '../passo.ts';

const JANELA: ParamsBackfill = { desde: '2026-09-01T00:00:00.000Z', ate: '2026-09-27T00:00:00.000Z' };
const CX: ConexaoCanal = { id: 'cx-1', orgId: 'org-1', canal: 'mercado_livre', contaExternaId: '999', expiresAt: null };

const embaralhar = <T>(xs: T[]): T[] => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const pedidos = (n: number): PedidoML[] => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));
const packs = (n: number): PackVenda[] => Array.from({ length: n }, (_, i) => ({
  packId: `p${String(i + 1).padStart(3, '0')}`, orderId: String(i + 1),
  itemId: null, itemTitulo: null, compradorNome: null, compradorNick: null, orderStatus: null,
}));

function criarDeps(over: Partial<DepsBackfill> = {}) {
  const deps = {
    conexao: vi.fn(async () => ({ cx: CX, userId: 'user-1' as string | null })),
    token: vi.fn(async () => 'tok'),
    pedidosDaJanela: vi.fn(async () => embaralhar(pedidos(45))),
    processarPedidos: vi.fn(async (_t: string, _cx: ConexaoCanal, _u: string, ps: PedidoML[]) =>
      ({ ok: ps.map((p) => String(p.id)), falhas: [] as string[], mpFalhou: false })),
    registrarFalhas: vi.fn(async () => 0),
    packs: vi.fn(async () => embaralhar(packs(50))),
    processarPacks: vi.fn(async (_t: string, _u: string, _o: string, _c: string, ps: PackVenda[]) => ps.length),
    ...over,
  };
  return deps;
}

const rodar = (deps: DepsBackfill, cursor: string | null, acumulado: Acumulado = {}) =>
  passoBackfill(deps, 'org-1')({ cursor, acumulado, params: JANELA });

const idsDoLote = (deps: ReturnType<typeof criarDeps>) =>
  (deps.processarPedidos.mock.calls.at(-1)![3] as PedidoML[]).map((p) => Number(p.id));

describe('passoBackfill', () => {
  it('1. conexão null ou userId null → fim sem pedir token', async () => {
    const semCx = criarDeps({ conexao: vi.fn(async () => null) });
    expect((await rodar(semCx, null)).proximo).toBeNull();
    expect(semCx.token).not.toHaveBeenCalled();

    const semDono = criarDeps({ conexao: vi.fn(async () => ({ cx: CX, userId: null })) });
    expect((await rodar(semDono, 'vendas|20')).proximo).toBeNull();
    expect(semDono.token).not.toHaveBeenCalled();
  });

  it('2. vendas em lotes de 20 por id numérico: null → 1..20, vendas|40 → 41..45, vendas|45 → mensagens|', async () => {
    expect(LOTE_PEDIDOS).toBe(20);
    const deps = criarDeps();
    const r1 = await rodar(deps, null);
    expect(idsDoLote(deps)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(r1.proximo).toBe('vendas|20');
    expect(r1.acumulado.sincronizados).toBe(20);
    expect(deps.pedidosDaJanela).toHaveBeenCalledWith('tok', JANELA);
    expect(deps.processarPedidos).toHaveBeenCalledWith('tok', CX, 'user-1', expect.any(Array));

    const r2 = await rodar(deps, 'vendas|40', r1.acumulado);
    expect(idsDoLote(deps)).toEqual([41, 42, 43, 44, 45]);
    expect(r2.proximo).toBe('vendas|45');
    expect(r2.acumulado.sincronizados).toBe(25);

    const chamadas = deps.processarPedidos.mock.calls.length;
    const r3 = await rodar(deps, 'vendas|45', r2.acumulado);
    expect(r3.proximo).toBe('mensagens|');
    expect(deps.processarPedidos.mock.calls.length).toBe(chamadas);
    expect(deps.token).toHaveBeenCalledTimes(3); // token em toda mensagem
  });

  it('3. pedidosDaJanela lança → rejeita', async () => {
    const deps = criarDeps({ pedidosDaJanela: vi.fn(async () => { throw new Error('ML 429'); }) });
    await expect(rodar(deps, null)).rejects.toThrow('ML 429');
    expect(deps.processarPedidos).not.toHaveBeenCalled();
  });

  it('4. reordenação: o lote depende só do cursor, não da ordem devolvida', async () => {
    const lotes: number[][] = [];
    for (let i = 0; i < 5; i++) {
      const deps = criarDeps();
      await rodar(deps, 'vendas|8');
      lotes.push(idsDoLote(deps));
    }
    for (const l of lotes) expect(l).toEqual(Array.from({ length: 20 }, (_, i) => i + 9));
  });

  it('5. mensagens: 50 packs → 40, 10, fim; contaExternaId null → fim', async () => {
    expect(LOTE_PACKS).toBe(40);
    const deps = criarDeps();
    const r1 = await rodar(deps, 'mensagens|');
    const lote1 = deps.processarPacks.mock.calls[0][4] as PackVenda[];
    expect(lote1.map((p) => p.packId)).toEqual(packs(40).map((p) => p.packId));
    expect(deps.processarPacks).toHaveBeenCalledWith('tok', 'user-1', 'org-1', '999', expect.any(Array));
    expect(r1).toMatchObject({ proximo: 'mensagens|p040', acumulado: { packs: 40 } });

    const r2 = await rodar(deps, r1.proximo, r1.acumulado);
    expect((deps.processarPacks.mock.calls[1][4] as PackVenda[]).length).toBe(10);
    expect(r2).toMatchObject({ proximo: 'mensagens|p050', acumulado: { packs: 50 } });

    const r3 = await rodar(deps, r2.proximo, r2.acumulado);
    expect(r3.proximo).toBeNull();
    expect(deps.processarPacks).toHaveBeenCalledTimes(2);

    const semConta = criarDeps({ conexao: vi.fn(async () => ({ cx: { ...CX, contaExternaId: null }, userId: 'user-1' })) });
    expect((await rodar(semConta, 'mensagens|')).proximo).toBeNull();
    expect(semConta.packs).not.toHaveBeenCalled();
  });

  it('6. processarPacks lança → rejeita; token lança SemAcessoRodada → rejeita com SemAcessoRodada', async () => {
    const deps = criarDeps({ processarPacks: vi.fn(async () => { throw new Error('ML 500'); }) });
    await expect(rodar(deps, 'mensagens|')).rejects.toThrow('ML 500');

    const semAcesso = criarDeps({ token: vi.fn(async () => { throw new SemAcessoRodada('invalid_grant'); }) });
    await expect(rodar(semAcesso, null)).rejects.toBeInstanceOf(SemAcessoRodada);
  });

  it('7. falha de pedido: registra a falha (ok=[] fica no deps) e o cursor anda; nunca remove pendência', async () => {
    const deps = criarDeps({
      pedidosDaJanela: vi.fn(async () => pedidos(10)),
      processarPedidos: vi.fn(async (_t: string, _cx: ConexaoCanal, _u: string, ps: PedidoML[]) => ({
        ok: ps.map((p) => String(p.id)).filter((id) => id !== '7'), falhas: ['7'], mpFalhou: true,
      })),
      registrarFalhas: vi.fn(async () => 1),
    });
    const r = await rodar(deps, null);
    expect(deps.registrarFalhas).toHaveBeenCalledTimes(1);
    expect(deps.registrarFalhas.mock.calls[0][0]).toEqual(['7']);
    expect(deps.registrarFalhas.mock.calls[0][1]).toMatch(/^backfill: /);
    expect(r.proximo).toBe('vendas|10');
    expect(r.acumulado).toMatchObject({ sincronizados: 9, pedidosComFalha: 1, pedidosDescartados: 1, mpFalhou: 1 });
    // DepsBackfill não tem nenhuma operação de remoção: a única escrita de pendência é registrarFalhas.
    expect(Object.keys(deps).sort()).toEqual(
      ['conexao', 'packs', 'pedidosDaJanela', 'processarPacks', 'processarPedidos', 'registrarFalhas', 'token']);
  });

  it('7b. sem falhas → não chama registrarFalhas', async () => {
    const deps = criarDeps();
    await rodar(deps, null);
    expect(deps.registrarFalhas).not.toHaveBeenCalled();
  });

  it('8. fim: parcial com as falhas da rodada; sem falhas → null', async () => {
    const deps = criarDeps();
    const comFalha = await rodar(deps, 'mensagens|p050', { sincronizados: 43, pedidosComFalha: 2 });
    expect(comFalha).toMatchObject({ proximo: null, parcial: '2 pedido(s) com falha, registrados para o reconciliar' });

    const limpo = await rodar(deps, 'mensagens|p050', { sincronizados: 45 });
    expect(limpo.proximo).toBeNull();
    expect(limpo.parcial).toBeNull();
  });

  it('etapa desconhecida → lança (nunca reinicia o ciclo em silêncio)', async () => {
    await expect(rodar(criarDeps(), 'pendencias|3')).rejects.toThrow(/etapa/);
    await expect(rodar(criarDeps(), 'vendas|abc')).rejects.toThrow(/cursor de vendas/);
  });
});
