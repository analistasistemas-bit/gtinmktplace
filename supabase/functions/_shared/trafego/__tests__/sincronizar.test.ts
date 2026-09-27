import { describe, expect, it, vi } from 'vitest';
import {
  SemAcessoTrafego, sincronizarTrafegoOrg,
  type DepsTrafego, type PontoVisitasGravar, type RespostaML,
} from '../sincronizar.ts';
import type { FontesInventario } from '../inventario.ts';

const T0 = Date.parse('2026-09-27T12:00:00Z'); // 09:00 BRT → hoje = 2026-09-27
const RODADA = '2026-09-27T09:17:00.123Z';
const ORG = 'org-1';
const vazio: FontesInventario = {
  familias: [], anunciosExternos: [], itensUp: [], kitsVirtuais: [], catalogoVariacoes: [],
  catalogoItensUp: [], pxvAnteriores: [], vendidos: [],
};
const ok = (corpo: unknown): RespostaML => ({ status: 200, retryAfterMs: null, corpo });
const visitas200 = ok({ results: [{ date: '2026-09-22T00:00:00Z', total: 5 }] });
const preco200 = ok({ amount: 49.9, regular_amount: 59.9, currency_id: 'BRL' });

type Fake = DepsTrafego & Record<keyof DepsTrafego, ReturnType<typeof vi.fn>> & { relogio: { t: number } };
function fake(o: Partial<DepsTrafego> = {}, mlbs = ['MLB3', 'MLB1', 'MLB2']): Fake {
  const relogio = { t: T0 };
  return {
    relogio,
    agora: vi.fn(() => relogio.t),
    esperar: vi.fn(async (ms: number) => { relogio.t += ms; }),
    reservarPosse: vi.fn(async () => ({ rodada: RODADA, cursor: null })),
    avancarCursor: vi.fn(async () => true),
    lerEstadoSync: vi.fn(async () => ({ cargaInicialConcluida: true, ultimoDiaOk: '2026-09-25' })),
    lerInventario: vi.fn(async () => ({ fontes: { ...vazio, familias: mlbs }, encerradosHaMaisDe30d: new Set<string>() })),
    lerStatusItens: vi.fn(async (ids: string[]) => ids.map((id) => ({ ml_item_id: id, status: 'active' }))),
    buscarVisitas: vi.fn(async () => visitas200),
    buscarPreco: vi.fn(async () => preco200),
    precoJaGravadoHoje: vi.fn(async () => new Set<string>()),
    gravarVisitas: vi.fn(async () => {}),
    gravarPreco: vi.fn(async () => {}),
    gravarStatusItens: vi.fn(async () => {}),
    continuar: vi.fn(async () => {}),
    concluir: vi.fn(async () => true),
    ...o,
  } as Fake;
}
const primeira = { org_id: ORG, primeira: true };
const pontos = (d: Fake): PontoVisitasGravar[] => d.gravarVisitas.mock.calls.flatMap((c) => c[1] as PontoVisitasGravar[]);
const idsVisitados = (d: Fake) => d.buscarVisitas.mock.calls.map((c) => c[0]);

describe('sincronizarTrafegoOrg', () => {
  it('primeira: reserva, varre o inventário ordenado, grava e avança por CAS, conclui com carga_concluida', async () => {
    const d = fake();
    expect(await sincronizarTrafegoOrg(d, primeira)).toEqual({ resultado: 'ok' });
    expect(idsVisitados(d).sort()).toEqual(['MLB1', 'MLB2', 'MLB3']);
    // janela móvel: 7 dias até hoje (último ok 25/09 está dentro dela)
    expect(d.buscarVisitas).toHaveBeenCalledWith('MLB1', { last: 6, ending: '2026-09-27' });
    expect(d.gravarVisitas.mock.calls[0][0]).toBe(RODADA);
    const p = pontos(d).filter((x) => x.ml_item_id === 'MLB1');
    expect(p).toHaveLength(7);
    expect(p.find((x) => x.dia === '2026-09-22')).toMatchObject({ visitas: 5, estado: 'ok' });
    expect(p.find((x) => x.dia === '2026-09-27')).toMatchObject({ estado: 'pendente' });
    expect(d.gravarPreco.mock.calls[0][0]).toContainEqual({
      ml_item_id: 'MLB1', dia: '2026-09-27', preco: 49.9, preco_regular: 59.9, moeda: 'BRL',
      observado_em: new Date(T0).toISOString(), origem: 'sale_price',
    });
    expect(d.avancarCursor).toHaveBeenCalledWith(RODADA, null, 'MLB3');
    // gravar antes de avançar o cursor
    expect(d.gravarVisitas.mock.invocationCallOrder[0]).toBeLessThan(d.avancarCursor.mock.invocationCallOrder[0]);
    expect(d.gravarPreco.mock.invocationCallOrder[0]).toBeLessThan(d.avancarCursor.mock.invocationCallOrder[0]);
    expect(d.concluir).toHaveBeenCalledWith(RODADA, 'ok', null, true);
  });

  it('primeira sem posse (outra cadeia viva) → obsoleta, sem ler nem gravar', async () => {
    const d = fake({ reservarPosse: vi.fn(async () => null) });
    expect(await sincronizarTrafegoOrg(d, primeira)).toEqual({ resultado: 'obsoleta' });
    expect(d.lerInventario).not.toHaveBeenCalled();
    expect(d.gravarVisitas).not.toHaveBeenCalled();
    expect(d.concluir).not.toHaveBeenCalled();
  });

  it('continuação de rodada antiga → obsoleta sem buscar nem gravar', async () => {
    const d = fake({ avancarCursor: vi.fn(async () => false) });
    const r = await sincronizarTrafegoOrg(d, { org_id: ORG, rodada: RODADA, cursor: 'MLB1', primeira: false });
    expect(r).toEqual({ resultado: 'obsoleta' });
    expect(d.avancarCursor).toHaveBeenCalledWith(RODADA, 'MLB1', 'MLB1');
    expect(d.reservarPosse).not.toHaveBeenCalled();
    expect(d.buscarVisitas).not.toHaveBeenCalled();
    expect(d.gravarVisitas).not.toHaveBeenCalled();
    expect(d.gravarPreco).not.toHaveBeenCalled();
    expect(d.concluir).not.toHaveBeenCalled();
  });

  it('CAS perdido depois do lote → obsoleta, sem continuar nem concluir', async () => {
    const d = fake({ avancarCursor: vi.fn(async () => false) });
    expect(await sincronizarTrafegoOrg(d, primeira, { limiteMs: 90_000, lote: 2, concorrencia: 6 })).toEqual({ resultado: 'obsoleta' });
    expect(d.avancarCursor).toHaveBeenCalledTimes(1);
    expect(d.continuar).not.toHaveBeenCalled();
    expect(d.concluir).not.toHaveBeenCalled();
  });

  it('orçamento estourado entre lotes → continua do último MLB gravado', async () => {
    const d = fake({}, ['MLB1', 'MLB2', 'MLB3', 'MLB4', 'MLB5']);
    d.buscarVisitas.mockImplementation(async () => { d.relogio.t += 50_000; return visitas200; });
    const r = await sincronizarTrafegoOrg(d, primeira, { limiteMs: 90_000, lote: 2, concorrencia: 6 });
    expect(r).toEqual({ resultado: 'continua' });
    expect(idsVisitados(d)).toEqual(['MLB1', 'MLB2']);
    expect(d.avancarCursor).toHaveBeenCalledWith(RODADA, null, 'MLB2');
    expect(d.continuar).toHaveBeenCalledWith({ org_id: ORG, rodada: RODADA, cursor: 'MLB2', primeira: false });
    expect(d.concluir).not.toHaveBeenCalled();
  });

  it('continuação parte depois do cursor e renova a posse antes de buscar', async () => {
    const d = fake({}, ['MLB1', 'MLB2', 'MLB3', 'MLB4']);
    const r = await sincronizarTrafegoOrg(d, { org_id: ORG, rodada: RODADA, cursor: 'MLB2', primeira: false });
    expect(r).toEqual({ resultado: 'ok' });
    expect(idsVisitados(d)).toEqual(['MLB3', 'MLB4']);
    expect(d.avancarCursor.mock.calls).toEqual([[RODADA, 'MLB2', 'MLB2'], [RODADA, 'MLB2', 'MLB4']]);
  });

  it('carga inicial interrompida: retoma do cursor reservado com a janela de 150 dias', async () => {
    const d = fake({
      reservarPosse: vi.fn(async () => ({ rodada: RODADA, cursor: 'MLB2' })),
      lerEstadoSync: vi.fn(async () => ({ cargaInicialConcluida: false, ultimoDiaOk: null })),
    });
    expect(await sincronizarTrafegoOrg(d, primeira)).toEqual({ resultado: 'ok' });
    expect(d.buscarVisitas.mock.calls).toEqual([['MLB3', { last: 149, ending: '2026-09-27' }]]);
    expect(d.avancarCursor).toHaveBeenCalledWith(RODADA, 'MLB2', 'MLB3');
    expect(d.concluir).toHaveBeenCalledWith(RODADA, 'ok', null, true);
  });

  it('429 com Retry-After que cabe no orçamento → espera e tenta de novo', async () => {
    const d = fake({}, ['MLB1']);
    d.buscarVisitas
      .mockResolvedValueOnce({ status: 429, retryAfterMs: 2_000, corpo: null })
      .mockResolvedValueOnce({ status: 503, retryAfterMs: null, corpo: null });
    expect(await sincronizarTrafegoOrg(d, primeira)).toEqual({ resultado: 'ok' });
    expect(d.esperar.mock.calls).toEqual([[2_000], [1_500]]); // 2ª sem Retry-After → 1,5 s
    expect(d.buscarVisitas).toHaveBeenCalledTimes(3);
    expect(pontos(d).every((x) => x.estado !== 'falha')).toBe(true);
  });

  it('429 cujo Retry-After não cabe → continua no mesmo cursor, sem gravar falha', async () => {
    const d = fake({}, ['MLB1', 'MLB2', 'MLB3']);
    d.buscarVisitas.mockImplementation(async (id: string) =>
      id === 'MLB3' ? { status: 429, retryAfterMs: 120_000, corpo: null } : visitas200);
    const r = await sincronizarTrafegoOrg(d, { org_id: ORG, rodada: RODADA, cursor: 'MLB1', primeira: false });
    expect(r).toEqual({ resultado: 'continua' });
    expect(d.esperar).not.toHaveBeenCalled();
    expect(d.continuar).toHaveBeenCalledWith({ org_id: ORG, rodada: RODADA, cursor: 'MLB1', primeira: false });
    expect(d.gravarVisitas).not.toHaveBeenCalled();
    expect(d.avancarCursor.mock.calls).toEqual([[RODADA, 'MLB1', 'MLB1']]);
    expect(d.concluir).not.toHaveBeenCalled();
  });

  it('5xx em todas as 3 tentativas → falha só daquele MLB (não trava a cadeia)', async () => {
    const d = fake({}, ['MLB1', 'MLB2']);
    d.buscarVisitas.mockImplementation(async (id: string) =>
      id === 'MLB2' ? { status: 500, retryAfterMs: 100, corpo: null } : visitas200);
    expect(await sincronizarTrafegoOrg(d, primeira)).toEqual({ resultado: 'ok' });
    expect(d.buscarVisitas.mock.calls.filter((c) => c[0] === 'MLB2')).toHaveLength(3);
    expect(pontos(d).filter((x) => x.ml_item_id === 'MLB2').every((x) => x.estado === 'falha')).toBe(true);
  });

  it('403 num MLB → falha dos dias pedidos só dele; a org segue', async () => {
    const d = fake({}, ['MLB1', 'MLB2']);
    d.buscarVisitas.mockImplementation(async (id: string) =>
      id === 'MLB2' ? { status: 403, retryAfterMs: null, corpo: null } : visitas200);
    expect(await sincronizarTrafegoOrg(d, primeira)).toEqual({ resultado: 'ok' });
    const p2 = pontos(d).filter((x) => x.ml_item_id === 'MLB2');
    expect(p2).toHaveLength(7);
    expect(p2.every((x) => x.estado === 'falha' && x.visitas === null)).toBe(true);
    expect(pontos(d).filter((x) => x.ml_item_id === 'MLB1').every((x) => x.estado !== 'falha')).toBe(true);
    expect(d.gravarStatusItens.mock.calls[0][0]).toContainEqual({ ml_item_id: 'MLB2', status: 'active', ultimo_ok_em: null });
  });

  it('corpo inválido → falha do MLB', async () => {
    const d = fake({ buscarVisitas: vi.fn(async () => ok({ nada: 1 })) }, ['MLB1']);
    expect(await sincronizarTrafegoOrg(d, primeira)).toEqual({ resultado: 'ok' });
    expect(pontos(d).every((x) => x.estado === 'falha')).toBe(true);
  });

  it('status dos itens vai sem duplicatas e só dos MLBs do lote', async () => {
    const d = fake({
      lerStatusItens: vi.fn(async () => [
        { ml_item_id: 'MLB1', status: 'active' }, { ml_item_id: 'MLB1', status: 'active' },
        { ml_item_id: 'MLB9', status: 'closed' }, { ml_item_id: 'MLB2', status: 'closed' },
      ]),
    }, ['MLB1', 'MLB2']);
    await sincronizarTrafegoOrg(d, primeira);
    const iso = new Date(T0).toISOString();
    expect(d.gravarStatusItens.mock.calls).toEqual([[[
      { ml_item_id: 'MLB1', status: 'active', ultimo_ok_em: iso },
      { ml_item_id: 'MLB2', status: 'closed', ultimo_ok_em: iso },
    ]]]);
  });

  it('preço já gravado hoje não é buscado de novo', async () => {
    const d = fake({ precoJaGravadoHoje: vi.fn(async () => new Set(['MLB1'])) }, ['MLB1', 'MLB2']);
    await sincronizarTrafegoOrg(d, primeira);
    expect(d.precoJaGravadoHoje).toHaveBeenCalledWith(['MLB1', 'MLB2'], '2026-09-27');
    expect(d.buscarPreco.mock.calls.map((c) => c[0])).toEqual(['MLB2']);
  });

  it('preço inválido ou com erro não grava nada daquele MLB', async () => {
    const d = fake({}, ['MLB1', 'MLB2']);
    d.buscarPreco.mockImplementation(async (id: string) =>
      id === 'MLB1' ? ok({ amount: 'x' }) : { status: 404, retryAfterMs: null, corpo: null });
    expect(await sincronizarTrafegoOrg(d, primeira)).toEqual({ resultado: 'ok' });
    expect(d.gravarPreco.mock.calls.flatMap((c) => c[0])).toEqual([]);
  });

  it('token inválido (401 ou SemAcessoTrafego) → sem_acesso', async () => {
    const d1 = fake({ buscarVisitas: vi.fn(async () => ({ status: 401, retryAfterMs: null, corpo: null })) });
    expect(await sincronizarTrafegoOrg(d1, primeira)).toEqual({ resultado: 'sem_acesso' });
    expect(d1.concluir).toHaveBeenCalledWith(RODADA, 'sem_acesso', expect.any(String), false);
    expect(d1.gravarVisitas).not.toHaveBeenCalled();

    const d2 = fake({ lerInventario: vi.fn(async () => { throw new SemAcessoTrafego('conexão ML inativa'); }) });
    expect(await sincronizarTrafegoOrg(d2, primeira)).toEqual({ resultado: 'sem_acesso' });
    expect(d2.concluir).toHaveBeenCalledWith(RODADA, 'sem_acesso', 'conexão ML inativa', false);
  });

  it('exceção → concluir erro com a mensagem; nunca lança, nem se o concluir falhar', async () => {
    const d = fake({ gravarVisitas: vi.fn(async () => { throw new Error('db fora'); }) });
    expect(await sincronizarTrafegoOrg(d, primeira)).toEqual({ resultado: 'erro' });
    expect(d.concluir).toHaveBeenCalledWith(RODADA, 'erro', 'db fora', false);
    expect(d.avancarCursor).not.toHaveBeenCalled();

    const d2 = fake({
      gravarVisitas: vi.fn(async () => { throw new Error('db fora'); }),
      concluir: vi.fn(async () => { throw new Error('db fora de novo'); }),
    });
    expect(await sincronizarTrafegoOrg(d2, primeira)).toEqual({ resultado: 'erro' });

    const d3 = fake({ reservarPosse: vi.fn(async () => { throw new Error('rpc'); }) });
    expect(await sincronizarTrafegoOrg(d3, primeira)).toEqual({ resultado: 'erro' });
  });

  it('inventário vazio → conclui ok', async () => {
    const d = fake({}, []);
    expect(await sincronizarTrafegoOrg(d, primeira)).toEqual({ resultado: 'ok' });
    expect(d.buscarVisitas).not.toHaveBeenCalled();
    expect(d.concluir).toHaveBeenCalledWith(RODADA, 'ok', null, true);
  });
});
