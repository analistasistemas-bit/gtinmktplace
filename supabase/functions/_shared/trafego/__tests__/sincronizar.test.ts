import { describe, expect, it, vi } from 'vitest';
import {
  SemAcessoTrafego, sincronizarTrafegoOrg,
  type DepsTrafego, type PontoVisitasGravar, type RespostaML,
} from '../sincronizar.ts';
import type { FontesInventario } from '../inventario.ts';
import { TIMEOUT_ML_MS } from '../fiacao.ts';

const T0 = Date.parse('2026-09-27T12:00:00Z'); // 09:00 BRT → hoje = 2026-09-27
const RODADA = '2026-09-27T09:17:00.123Z';
const ORG = 'org-1';
const vazio: FontesInventario = {
  familias: [], anunciosExternos: [], itensUp: [], kitsVirtuais: [], catalogoVariacoes: [],
  catalogoItensUp: [], pxvAnteriores: [], vendidos: [],
};
const ok = (corpo: unknown): RespostaML => ({ status: 200, retryAfterMs: null, corpo });
// janela móvel padrão do fake() (last:6, ending:'2026-09-27'): date_from/date_to precisam
// confirmar exatamente essa janela, senão parseVisitas devolve null (vendas-sku-design, Fatia 2b).
const visitas200 = ok({
  date_from: '2026-09-21T00:00:00Z', date_to: '2026-09-27T00:00:00Z',
  results: [{ date: '2026-09-22T00:00:00Z', total: 5 }],
});
const preco200 = ok({ amount: 49.9, regular_amount: 59.9, currency_id: 'BRL' });

const NOVOS_A = { titulo: 'Fita A', permalink: 'https://p/a', variacao: 'Verde' };
const NOVOS_B = { titulo: 'Fita B', permalink: 'https://p/b', variacao: null };
const SEM_NOVOS = { titulo: null, permalink: null, variacao: null };
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
    lerInventario: vi.fn(async () => ({ fontes: { ...vazio, familias: mlbs }, encerradosHaMaisDe30d: new Set<string>(), comColetaOk: new Set(mlbs) })),
    lerStatusItens: vi.fn(async (ids: string[]) => ids.map((id) => ({ ml_item_id: id, status: 'active', titulo: `T ${id}`, permalink: `https://p/${id}`, variacao: 'Azul · G' }))),
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
    expect(d.continuar).toHaveBeenCalledWith({ org_id: ORG, rodada: RODADA, cursor: 'MLB2', primeira: false, tentativa: 0 }, {});
    expect(d.concluir).not.toHaveBeenCalled();
  });

  // ADR-0173 §4: o Supabase derruba por CPU (2 s), não por relógio — teto por contagem por mensagem.
  it('teto por contagem: para em maxItens e continua do último MLB com o relógio parado', async () => {
    const d = fake({}, ['MLB1', 'MLB2', 'MLB3', 'MLB4']);
    const r = await sincronizarTrafegoOrg(d, primeira, { limiteMs: 90_000, lote: 2, concorrencia: 6, maxItens: 2 });
    expect(r).toEqual({ resultado: 'continua' });
    expect(idsVisitados(d)).toEqual(['MLB1', 'MLB2']);
    expect(d.continuar).toHaveBeenCalledWith({ org_id: ORG, rodada: RODADA, cursor: 'MLB2', primeira: false, tentativa: 0 }, {});
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

  it('429 cujo Retry-After não cabe → continua no mesmo cursor (tentativa+1, atraso do Retry-After), sem falha', async () => {
    const d = fake({}, ['MLB1', 'MLB2', 'MLB3']);
    d.buscarVisitas.mockImplementation(async (id: string) =>
      id === 'MLB3' ? { status: 429, retryAfterMs: 120_000, corpo: null } : visitas200);
    const r = await sincronizarTrafegoOrg(d, { org_id: ORG, rodada: RODADA, cursor: 'MLB1', primeira: false, tentativa: 2 });
    expect(r).toEqual({ resultado: 'continua' });
    expect(d.esperar).not.toHaveBeenCalled();
    expect(d.continuar).toHaveBeenCalledWith(
      { org_id: ORG, rodada: RODADA, cursor: 'MLB1', primeira: false, tentativa: 3 }, { atrasoMs: 120_000 });
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
    expect(d.gravarStatusItens.mock.calls[0][0]).toContainEqual({
      ml_item_id: 'MLB2', status: 'active', ultimo_ok_em: null, titulo: 'T MLB2', permalink: 'https://p/MLB2', variacao: 'Azul · G',
    });
  });

  it('corpo inválido → falha do MLB', async () => {
    const d = fake({ buscarVisitas: vi.fn(async () => ok({ nada: 1 })) }, ['MLB1']);
    expect(await sincronizarTrafegoOrg(d, primeira)).toEqual({ resultado: 'ok' });
    expect(pontos(d).every((x) => x.estado === 'falha')).toBe(true);
  });

  it('status dos itens vai sem duplicatas e só dos MLBs do lote', async () => {
    const d = fake({
      lerStatusItens: vi.fn(async () => [
        { ml_item_id: 'MLB1', status: 'active', ...NOVOS_A }, { ml_item_id: 'MLB1', status: 'active', ...NOVOS_B },
        { ml_item_id: 'MLB9', status: 'closed', ...NOVOS_A }, { ml_item_id: 'MLB2', status: 'closed', ...NOVOS_A },
      ]),
    }, ['MLB1', 'MLB2']);
    await sincronizarTrafegoOrg(d, primeira);
    const iso = new Date(T0).toISOString();
    expect(d.gravarStatusItens.mock.calls).toEqual([[[
      { ml_item_id: 'MLB1', status: 'active', ultimo_ok_em: iso, ...NOVOS_A },
      { ml_item_id: 'MLB2', status: 'closed', ultimo_ok_em: iso, ...NOVOS_A },
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

  it('adiar num lote posterior → continua do cursor já avançado, tentativa zerada', async () => {
    const d = fake({}, ['MLB1', 'MLB2', 'MLB3', 'MLB4']);
    d.buscarVisitas.mockImplementation(async (id: string) =>
      id === 'MLB3' ? { status: 429, retryAfterMs: 120_000, corpo: null } : visitas200);
    const r = await sincronizarTrafegoOrg(d, { org_id: ORG, rodada: RODADA, cursor: null, primeira: false, tentativa: 4 },
      { limiteMs: 90_000, lote: 2, concorrencia: 6 });
    expect(r).toEqual({ resultado: 'continua' });
    expect(d.continuar).toHaveBeenCalledWith(
      { org_id: ORG, rodada: RODADA, cursor: 'MLB2', primeira: false, tentativa: 0 }, { atrasoMs: 120_000 });
  });

  it('limite de adiamentos no mesmo cursor → falha só dos MLBs não coletados e o cursor anda', async () => {
    const d = fake({}, ['MLB1', 'MLB2', 'MLB3', 'MLB4']);
    d.buscarVisitas.mockImplementation(async (id: string) =>
      id === 'MLB3' ? { status: 429, retryAfterMs: 120_000, corpo: null } : visitas200);
    const r = await sincronizarTrafegoOrg(d, { org_id: ORG, rodada: RODADA, cursor: 'MLB1', primeira: false, tentativa: 5 },
      { limiteMs: 90_000, lote: 20, concorrencia: 1 });
    expect(r).toEqual({ resultado: 'ok' });
    expect(d.continuar).not.toHaveBeenCalled();
    expect(idsVisitados(d)).toEqual(['MLB2', 'MLB3']); // MLB4 nem é buscado depois do adiamento
    const estados = (id: string) => new Set(pontos(d).filter((x) => x.ml_item_id === id).map((x) => x.estado));
    expect(estados('MLB2').has('falha')).toBe(false);
    expect(estados('MLB3')).toEqual(new Set(['falha']));
    expect(estados('MLB4')).toEqual(new Set(['falha']));
    expect(d.buscarPreco.mock.calls.map((c) => c[0])).toEqual(['MLB2']); // sem preço depois de marcar adiamento
    expect(d.avancarCursor).toHaveBeenLastCalledWith(RODADA, 'MLB1', 'MLB4');
  });

  it('erro no multiget de status não derruba a org: grava ultimo_ok_em com status desconhecido e segue', async () => {
    const d = fake({ lerStatusItens: vi.fn(async () => { throw new Error('ML 429'); }) }, ['MLB1', 'MLB2']);
    d.buscarVisitas.mockImplementation(async (id: string) =>
      id === 'MLB2' ? { status: 404, retryAfterMs: null, corpo: null } : visitas200);
    expect(await sincronizarTrafegoOrg(d, primeira)).toEqual({ resultado: 'ok' });
    // MLB2 sem visitas ok e sem status: nada a gravar dele
    expect(d.gravarStatusItens.mock.calls).toEqual([[[
      { ml_item_id: 'MLB1', status: 'desconhecido', ultimo_ok_em: new Date(T0).toISOString(), ...SEM_NOVOS },
    ]]]);
    expect(d.avancarCursor).toHaveBeenCalledWith(RODADA, null, 'MLB2');
  });

  it('MLB com visitas ok que o multiget não trouxe → ultimo_ok_em gravado com status desconhecido', async () => {
    const d = fake({ lerStatusItens: vi.fn(async () => [{ ml_item_id: 'MLB1', status: 'active', ...NOVOS_A }]) }, ['MLB1', 'MLB2']);
    await sincronizarTrafegoOrg(d, primeira);
    const iso = new Date(T0).toISOString();
    expect(d.gravarStatusItens.mock.calls).toEqual([[[
      { ml_item_id: 'MLB1', status: 'active', ultimo_ok_em: iso, ...NOVOS_A },
      { ml_item_id: 'MLB2', status: 'desconhecido', ultimo_ok_em: iso, ...SEM_NOVOS },
    ]]]);
  });

  it('MLB sem coleta ok anterior ganha a janela de 150 dias mesmo com a carga da org concluída', async () => {
    const d = fake({}, ['MLB1', 'MLB2']);
    d.lerInventario.mockResolvedValue({
      fontes: { ...vazio, familias: ['MLB1', 'MLB2'] }, encerradosHaMaisDe30d: new Set<string>(), comColetaOk: new Set(['MLB1']),
    });
    await sincronizarTrafegoOrg(d, primeira);
    expect(d.buscarVisitas).toHaveBeenCalledWith('MLB1', { last: 6, ending: '2026-09-27' });
    expect(d.buscarVisitas).toHaveBeenCalledWith('MLB2', { last: 149, ending: '2026-09-27' });
  });

  it('429 no preço que não cabe → adia o lote (mesmo cursor, atraso do Retry-After), sem falha', async () => {
    const d = fake({ buscarPreco: vi.fn(async () => ({ status: 429, retryAfterMs: 120_000, corpo: null })) }, ['MLB1']);
    expect(await sincronizarTrafegoOrg(d, primeira)).toEqual({ resultado: 'continua' });
    expect(d.continuar).toHaveBeenCalledWith(
      { org_id: ORG, rodada: RODADA, cursor: null, primeira: false, tentativa: 1 }, { atrasoMs: 120_000 });
    expect(d.gravarVisitas).not.toHaveBeenCalled();
    expect(d.gravarPreco).not.toHaveBeenCalled();
  });

  it('preço que trava não passa do orçamento: não tenta de novo se a espera + timeout não cabem', async () => {
    const d = fake({}, ['MLB1']);
    d.buscarVisitas.mockImplementation(async () => { d.relogio.t += 75_000; return visitas200; });
    d.buscarPreco.mockImplementation(async () => { d.relogio.t += TIMEOUT_ML_MS; return { status: 503, retryAfterMs: null, corpo: null }; });
    expect(await sincronizarTrafegoOrg(d, primeira)).toEqual({ resultado: 'continua' });
    expect(d.buscarPreco).toHaveBeenCalledTimes(1);
    expect(d.relogio.t - T0).toBeLessThanOrEqual(90_000 + TIMEOUT_ML_MS);
    expect(d.continuar).toHaveBeenCalledWith(expect.objectContaining({ cursor: null, tentativa: 1 }), { atrasoMs: 1_500 });
    expect(d.gravarVisitas).not.toHaveBeenCalled();
  });

  it('item que começaria depois do fim do orçamento não é buscado; o lote adia sem falha', async () => {
    const d = fake({}, ['MLB1', 'MLB2']);
    d.buscarVisitas.mockImplementation(async () => { d.relogio.t += 95_000; return visitas200; });
    const r = await sincronizarTrafegoOrg(d, primeira, { limiteMs: 90_000, lote: 20, concorrencia: 1 });
    expect(r).toEqual({ resultado: 'continua' });
    expect(idsVisitados(d)).toEqual(['MLB1']);
    expect(d.continuar).toHaveBeenCalledWith(expect.objectContaining({ cursor: null, tentativa: 1 }), { atrasoMs: 0 });
    expect(d.gravarVisitas).not.toHaveBeenCalled();
  });

  it('preço observado depois da meia-noite BRT não é gravado no dia anterior', async () => {
    const d = fake({}, ['MLB1']);
    d.relogio.t = Date.parse('2026-09-28T02:59:59Z'); // 23:59:59 BRT de 27/09
    d.buscarPreco.mockImplementation(async () => { d.relogio.t += 2_000; return preco200; });
    expect(await sincronizarTrafegoOrg(d, primeira)).toEqual({ resultado: 'ok' });
    expect(d.precoJaGravadoHoje).toHaveBeenCalledWith(['MLB1'], '2026-09-27');
    expect(d.gravarPreco).not.toHaveBeenCalled();
  });

  it('concluir devolvendo false → obsoleta', async () => {
    const d = fake({ concluir: vi.fn(async () => false) });
    expect(await sincronizarTrafegoOrg(d, primeira)).toEqual({ resultado: 'obsoleta' });
  });

  it('concluir(ok) que lança → erro, sem chamar concluir(erro) por cima', async () => {
    const d = fake({ concluir: vi.fn(async () => { throw new Error('rede'); }) });
    expect(await sincronizarTrafegoOrg(d, primeira)).toEqual({ resultado: 'erro' });
    expect(d.concluir).toHaveBeenCalledTimes(1);
  });

  it('inventário vazio → conclui ok', async () => {
    const d = fake({}, []);
    expect(await sincronizarTrafegoOrg(d, primeira)).toEqual({ resultado: 'ok' });
    expect(d.buscarVisitas).not.toHaveBeenCalled();
    expect(d.concluir).toHaveBeenCalledWith(RODADA, 'ok', null, true);
  });
});
