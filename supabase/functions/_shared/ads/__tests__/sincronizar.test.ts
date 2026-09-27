import { describe, expect, it, vi } from 'vitest';
import { ParadaAds, sincronizarAdsOrg, type DepsAds, type GrupoGravar } from '../sincronizar.ts';
import type { RespostaML } from '../../trafego/sincronizar.ts';

const T0 = Date.parse('2026-09-27T15:00:00Z'); // 12:00 BRT → hoje = 2026-09-27
const RODADA = '2026-09-27T14:17:00.123Z';
const ORG = 'org-1';
const JANELA_DIARIA = { desde: '2026-09-12', ate: '2026-09-26' };
const JANELA_90 = { desde: '2026-06-29', ate: '2026-09-26' };
const ok = (corpo: unknown): RespostaML => ({ status: 200, retryAfterMs: null, corpo });
const http = (status: number, corpo: unknown = null, retryAfterMs: number | null = null): RespostaML => ({ status, retryAfterMs, corpo });
const grupo = (id: number, tipo: 'ITEM' | 'FAMILY' | 'CATALOG' = 'FAMILY', cost = 10, status = 'ACTIVE') => ({
  id, ad_group_type: tipo, ad_group_external_id: tipo === 'ITEM' ? `MLB${id}` : String(4000000 + id),
  campaign_id: 2000001, status, metrics: { cost },
});
const busca = (grupos: unknown[], total = grupos.length) => ok({ paging: { offset: 0, total, limit: 100 }, results: grupos, metrics_summary: { cost: 99 } });
/** Série densa: uma linha por dia da janela pedida (o parser recusa série furada). */
function diasDe(j: { desde: string; ate: string }): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${j.desde}T00:00:00Z`); t <= Date.parse(`${j.ate}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}
const serie = (j: { desde: string; ate: string }) => ok({ results: diasDe(j).map((date) => ({
  date, clicks: 2, prints: 100, cost: 1.25, cpc: 0.62, direct_amount: 10, indirect_amount: 0, total_amount: 10,
  direct_units_quantity: 1, units_quantity: 1, acos: 12.5, roas: 8,
})) });
const membros = (itens: string[], total = itens.length) =>
  ok({ paging: { total, offset: 0, limit: 100 }, results: itens.map((item_id) => ({ item_id })) });
const DIA = { cost: 1.25, clicks: 2, prints: 100, direct_amount: 10, indirect_amount: 0, total_amount: 10, direct_units: 1, units: 1 };

type Fake = DepsAds & Record<keyof DepsAds, ReturnType<typeof vi.fn>> & { relogio: { t: number } };
function fake(o: Partial<DepsAds> = {}): Fake {
  const relogio = { t: T0 };
  return {
    relogio,
    agora: vi.fn(() => relogio.t),
    esperar: vi.fn(async (ms: number) => { relogio.t += ms; }),
    reservarPosse: vi.fn(async () => ({ rodada: RODADA, cursor: null })),
    avancarCursor: vi.fn(async () => true),
    lerEstadoSync: vi.fn(async () => ({ cargaInicialOk: true, ultimoOkEm: '2026-09-26T14:20:00Z' })),
    lerGruposComGasto: vi.fn(async () => []),
    contarVinculos: vi.fn(async () => new Map<number, number>()),
    buscarAdvertiser: vi.fn(async () => ok({ advertisers: [{ advertiser_id: 1000001, site_id: 'MLB' }] })),
    buscarGrupos: vi.fn(async () => busca([grupo(11, 'ITEM'), grupo(12, 'FAMILY'), grupo(13, 'CATALOG', 0)])),
    buscarSerieGrupo: vi.fn(async (_id: number, j: { desde: string; ate: string }) => serie(j)),
    buscarMembros: vi.fn(async () => membros(['MLB21', 'MLB22'])),
    gravarLote: vi.fn(async () => true),
    continuar: vi.fn(async () => {}),
    concluir: vi.fn(async () => true),
    ...o,
  } as Fake;
}
const primeira = { org_id: ORG, primeira: true };
const gravados = (d: Fake): GrupoGravar[] => d.gravarLote.mock.calls.flatMap((c) => c[2] as GrupoGravar[]);
const lidos = (d: Fake) => d.buscarSerieGrupo.mock.calls.map((c) => c[0]);
const PARADA = { cargaConcluida: false, coberturaDesde: null, custoResumo: null, custoListado: null };

describe('sincronizarAdsOrg', () => {
  it('primeira: advertiser → search → série dos grupos com gasto → grava por grupo → CAS → conclui', async () => {
    const d = fake();
    expect(await sincronizarAdsOrg(d, primeira)).toEqual({ resultado: 'ok' });
    expect(d.buscarGrupos).toHaveBeenCalledWith(1000001, JANELA_DIARIA, 0);
    expect(lidos(d)).toEqual([11, 12]); // 13 sem gasto na janela: nem lido
    expect(d.buscarSerieGrupo).toHaveBeenCalledWith(11, JANELA_DIARIA);
    // Membros sempre na janela de 90 dias, mesmo na rodada diária.
    expect(d.buscarMembros).toHaveBeenCalledTimes(1);
    expect(d.buscarMembros).toHaveBeenCalledWith(12, JANELA_90, 0);
    expect(d.gravarLote.mock.calls[0].slice(0, 2)).toEqual([RODADA, new Date(T0).toISOString()]);
    const [g11, g12] = gravados(d);
    expect(g11).toMatchObject({ ad_group_id: 11, tipo: 'ITEM', external_id: 'MLB11', campaign_id: 2000001, status: 'ACTIVE', itens: ['MLB11'] });
    expect(g11.dias).toHaveLength(15);
    expect(g11.dias[0]).toEqual({ dia: '2026-09-12', ...DIA });
    expect(g11.dias[0]).not.toHaveProperty('roas');
    expect(g12).toMatchObject({ ad_group_id: 12, tipo: 'FAMILY', external_id: '4000012', itens: ['MLB21', 'MLB22'] });
    expect(d.gravarLote.mock.invocationCallOrder[0]).toBeLessThan(d.avancarCursor.mock.invocationCallOrder[0]);
    expect(d.avancarCursor).toHaveBeenCalledWith(RODADA, null, '12');
    expect(d.concluir).toHaveBeenCalledWith(RODADA, 'ok', null,
      { cargaConcluida: true, advertiserId: 1000001, coberturaDesde: '2026-09-12', custoResumo: 99, custoListado: 20 });
  });

  it('carga inicial: janela de 90 dias terminando ontem', async () => {
    const d = fake({ lerEstadoSync: vi.fn(async () => ({ cargaInicialOk: false, ultimoOkEm: null })) });
    await sincronizarAdsOrg(d, primeira);
    expect(d.buscarGrupos).toHaveBeenCalledWith(1000001, JANELA_90, 0);
    expect(gravados(d)[0].dias).toHaveLength(90);
    expect(d.concluir.mock.calls[0][3]).toMatchObject({ coberturaDesde: '2026-06-29' });
  });

  it('search paginado: segue o offset até o total', async () => {
    // Carga inicial: sem a busca extra de 90 dias do Ruling 2c-8 (o mock ignora a janela e duplicaria a
    // paginação); a mecânica testada aqui (seguir o offset) é a mesma nos dois modos.
    const d = fake({
      lerEstadoSync: vi.fn(async () => ({ cargaInicialOk: false, ultimoOkEm: null })),
      buscarGrupos: vi.fn(async (_a: number, _j: unknown, offset: number) =>
        (offset === 0 ? busca([grupo(11, 'ITEM'), grupo(12, 'ITEM')], 3) : busca([grupo(14, 'ITEM')], 3))),
    });
    await sincronizarAdsOrg(d, primeira);
    expect(d.buscarGrupos.mock.calls.map((c) => c[2])).toEqual([0, 2]);
    expect(lidos(d)).toEqual([11, 12, 14]);
  });

  it('status de grupo fora da lista conhecida no search: o grupo com gasto é lido e gravado com o status do ML', async () => {
    const d = fake({ buscarGrupos: vi.fn(async () => busca([grupo(15, 'ITEM', 5, 'ARCHIVED')])) });
    expect(await sincronizarAdsOrg(d, primeira)).toEqual({ resultado: 'ok' });
    expect(gravados(d)[0]).toMatchObject({ ad_group_id: 15, status: 'ARCHIVED' });
  });

  it('/ads paginado com total > 100: lê todas as páginas', async () => {
    const pag1 = Array.from({ length: 100 }, (_, k) => `MLB${3000 + k}`);
    const pag2 = Array.from({ length: 50 }, (_, k) => `MLB${4000 + k}`);
    const d = fake({
      buscarGrupos: vi.fn(async () => busca([grupo(12, 'FAMILY')])),
      buscarMembros: vi.fn(async (_id: number, _j: unknown, offset: number) => (offset === 0 ? membros(pag1, 150) : membros(pag2, 150))),
    });
    await sincronizarAdsOrg(d, primeira);
    expect(d.buscarMembros.mock.calls.map((c) => c[2])).toEqual([0, 100]);
    expect(gravados(d)[0].itens).toHaveLength(150);
  });

  it('releitura com menos membros que o vínculo gravado (ou lista vazia) mantém o vínculo: o grupo compartilhado não vira sku', async () => {
    const menor = fake({
      buscarGrupos: vi.fn(async () => busca([grupo(12, 'FAMILY')])),
      contarVinculos: vi.fn(async () => new Map([[12, 2]])),
      buscarMembros: vi.fn(async () => membros(['MLB21'])), // a cor irmã MLB22 sumiu da leitura
    });
    await sincronizarAdsOrg(menor, primeira);
    expect(menor.contarVinculos).toHaveBeenCalledWith([12]);
    expect(gravados(menor)[0].itens).toBeNull();
    const vazia = fake({ buscarGrupos: vi.fn(async () => busca([grupo(12, 'FAMILY')])), buscarMembros: vi.fn(async () => membros([])) });
    await sincronizarAdsOrg(vazia, primeira);
    expect(gravados(vazia)[0].itens).toBeNull();
    const maior = fake({
      buscarGrupos: vi.fn(async () => busca([grupo(12, 'FAMILY')])),
      contarVinculos: vi.fn(async () => new Map([[12, 2]])),
      buscarMembros: vi.fn(async () => membros(['MLB21', 'MLB22', 'MLB23'])),
    });
    await sincronizarAdsOrg(maior, primeira);
    expect(gravados(maior)[0].itens).toEqual(['MLB21', 'MLB22', 'MLB23']);
  });

  it('403 PolicyAgent no advertiser → sem_permissao, sem retry e sem tocar em grupos', async () => {
    const d = fake({ buscarAdvertiser: vi.fn(async () => http(403, { blocked_by: 'PolicyAgent', code: 'PA_UNAUTHORIZED_RESULT_FROM_POLICIES' })) });
    // Item 2 da correção final: o resultado da função é o estado preciso, não um "sem_acesso" genérico
    // (o worker/index é quem decide se colapsa pra sem_acesso, ver fiacao.ts).
    expect(await sincronizarAdsOrg(d, primeira)).toEqual({ resultado: 'sem_permissao' });
    expect(d.buscarAdvertiser).toHaveBeenCalledTimes(1);
    expect(d.esperar).not.toHaveBeenCalled();
    expect(d.buscarGrupos).not.toHaveBeenCalled();
    expect(d.concluir).toHaveBeenCalledWith(RODADA, 'sem_permissao',
      expect.stringContaining('sem permissão de Publicidade ou conexão recusada'), { ...PARADA, advertiserId: null });
  });

  it('401 (já depois da releitura do token nas deps) → sem_acesso; 404 no advertiser ou lista sem MLB → sem_advertiser', async () => {
    const a = fake({ buscarAdvertiser: vi.fn(async () => http(401, { error_code: 'unauthorized' })) });
    expect(await sincronizarAdsOrg(a, primeira)).toEqual({ resultado: 'sem_acesso' });
    expect(a.concluir.mock.calls[0][1]).toBe('sem_acesso');
    const b = fake({ buscarAdvertiser: vi.fn(async () => http(404, { message: 'No permissions found for user_id' })) });
    expect(await sincronizarAdsOrg(b, primeira)).toEqual({ resultado: 'sem_advertiser' });
    expect(b.concluir.mock.calls[0][1]).toBe('sem_advertiser');
    const c = fake({ buscarAdvertiser: vi.fn(async () => ok({ advertisers: [] })) });
    expect(await sincronizarAdsOrg(c, primeira)).toEqual({ resultado: 'sem_advertiser' });
    expect(c.concluir.mock.calls[0][1]).toBe('sem_advertiser');
  });

  it('org sem conexão (deps lança ParadaAds) → sem_acesso', async () => {
    const d = fake({ buscarAdvertiser: vi.fn(async () => { throw new ParadaAds('sem_acesso', 'Organização sem conexão com o Mercado Livre.'); }) });
    expect(await sincronizarAdsOrg(d, primeira)).toEqual({ resultado: 'sem_acesso' });
    expect(d.concluir.mock.calls[0][1]).toBe('sem_acesso');
  });

  it('404 de um grupo (apagado entre o search e a leitura) → pula o grupo, grava os outros', async () => {
    const d = fake({ buscarSerieGrupo: vi.fn(async (id: number, j: { desde: string; ate: string }) =>
      (id === 11 ? http(404, { error_code: 'ad_group_not_found_exception' }) : serie(j))) });
    expect(await sincronizarAdsOrg(d, primeira)).toEqual({ resultado: 'ok' });
    expect(gravados(d).map((g) => g.ad_group_id)).toEqual([12]);
  });

  it('404 de grupo listado com gasto: o custo de 90 dias dele sai do custoListado (dispara fora_dos_grupos, nunca despesa menor sem aviso)', async () => {
    const d = fake({
      buscarGrupos: vi.fn(async (_adv: number, j: { desde: string; ate: string }) =>
        (j.desde === JANELA_90.desde
          ? busca([grupo(11, 'ITEM', 20), grupo(12, 'FAMILY', 10), grupo(13, 'CATALOG', 0)])
          : busca([grupo(11, 'ITEM', 7.5), grupo(12, 'FAMILY', 10), grupo(13, 'CATALOG', 0)]))),
      buscarSerieGrupo: vi.fn(async (id: number, j: { desde: string; ate: string }) =>
        (id === 11 ? http(404, { error_code: 'ad_group_not_found_exception' }) : serie(j))),
    });
    await sincronizarAdsOrg(d, primeira);
    // 90 dias: 30 listados (20+10) − 20 do 11 (404) = 10; com o custo de 15 dias (7,5) daria 22,5.
    expect(d.concluir.mock.calls[0][3]).toMatchObject({ custoResumo: 99, custoListado: 10 });
  });

  it('CARGA INICIAL — 404 de grupo listado com gasto: o custo dele sai do custoListado', async () => {
    const d = fake({
      lerEstadoSync: vi.fn(async () => ({ cargaInicialOk: false, ultimoOkEm: null })),
      buscarSerieGrupo: vi.fn(async (id: number, j: { desde: string; ate: string }) =>
        (id === 11 ? http(404, { error_code: 'ad_group_not_found_exception' }) : serie(j))),
    });
    await sincronizarAdsOrg(d, primeira);
    expect(d.concluir.mock.calls[0][3]).toMatchObject({ custoResumo: 99, custoListado: 10 }); // 20 listados − 10 do 11
  });

  it('404 com gasto numa mensagem que continua: os ids descontados viajam na continuação, e o custo de 90 dias fecha na última', async () => {
    const d = fake({ buscarGrupos: vi.fn(async () => busca([grupo(11, 'ITEM', 7.5), grupo(12, 'ITEM'), grupo(14, 'ITEM')])) });
    d.buscarSerieGrupo.mockImplementation(async (id: number, j: { desde: string; ate: string }) => {
      d.relogio.t += 40_000; return id === 11 ? http(404, null) : serie(j);
    });
    expect(await sincronizarAdsOrg(d, primeira, { limiteMs: 60_000, lote: 1, concorrencia: 1 })).toEqual({ resultado: 'continua' });
    // Ruling 2c-9: a mensagem que só continua não sabe o custo de 90 dias do grupo (a busca extra só roda
    // na que conclui) — carrega o id, não o valor.
    expect(d.continuar).toHaveBeenCalledWith(
      { org_id: ORG, rodada: RODADA, cursor: '12', primeira: false, tentativa: 0, descontar: 7.5, descontados: [11] }, {});
    const e = fake({
      buscarGrupos: vi.fn(async (_adv: number, j: { desde: string; ate: string }) =>
        (j.desde === JANELA_90.desde
          ? busca([grupo(11, 'ITEM', 20), grupo(12, 'ITEM'), grupo(14, 'ITEM')])
          : busca([grupo(11, 'ITEM', 7.5), grupo(12, 'ITEM'), grupo(14, 'ITEM')]))),
    });
    await sincronizarAdsOrg(e, { org_id: ORG, rodada: RODADA, cursor: '12', primeira: false, descontar: 7.5, descontados: [11] });
    // 90 dias: 40 listados (20+10+10) − 20 do 11 (id herdado) = 20.
    expect(e.concluir.mock.calls[0][3]).toMatchObject({ custoListado: 20 });
  });

  it('CARGA INICIAL — 404 com gasto numa mensagem que continua: o desconto viaja na continuação e fecha na última', async () => {
    const inicial = { lerEstadoSync: vi.fn(async () => ({ cargaInicialOk: false, ultimoOkEm: null })) };
    const d = fake({ ...inicial, buscarGrupos: vi.fn(async () => busca([grupo(11, 'ITEM', 7.5), grupo(12, 'ITEM'), grupo(14, 'ITEM')])) });
    d.buscarSerieGrupo.mockImplementation(async (id: number, j: { desde: string; ate: string }) => {
      d.relogio.t += 40_000; return id === 11 ? http(404, null) : serie(j);
    });
    expect(await sincronizarAdsOrg(d, primeira, { limiteMs: 60_000, lote: 1, concorrencia: 1 })).toEqual({ resultado: 'continua' });
    expect(d.continuar).toHaveBeenCalledWith(
      { org_id: ORG, rodada: RODADA, cursor: '12', primeira: false, tentativa: 0, descontar: 7.5 }, {});
    const e = fake({ ...inicial, buscarGrupos: vi.fn(async () => busca([grupo(11, 'ITEM', 7.5), grupo(12, 'ITEM'), grupo(14, 'ITEM')])) });
    await sincronizarAdsOrg(e, { org_id: ORG, rodada: RODADA, cursor: '12', primeira: false, descontar: 7.5 });
    expect(e.concluir.mock.calls[0][3]).toMatchObject({ custoListado: 20 }); // 27,5 − 7,5
  });

  it('Ruling 2c-7 — FAMILY listado com gasto, /ads vazio e sem vínculo gravado: o custo de 90 dias sai do custoListado', async () => {
    const d = fake({
      buscarGrupos: vi.fn(async (_adv: number, j: { desde: string; ate: string }) =>
        (j.desde === JANELA_90.desde
          ? busca([grupo(11, 'ITEM'), grupo(12, 'FAMILY', 20)])
          : busca([grupo(11, 'ITEM'), grupo(12, 'FAMILY', 4)]))),
      buscarMembros: vi.fn(async () => membros([])),
    });
    expect(await sincronizarAdsOrg(d, primeira)).toEqual({ resultado: 'ok' });
    expect(gravados(d).find((g) => g.ad_group_id === 12)?.itens).toBeNull(); // os dias continuam gravados
    // 90 dias: 30 listados (10+20) − 20 do 12 (vazio sem vínculo) = 10; com o custo de 15 dias (4) daria 26.
    expect(d.concluir.mock.calls[0][3]).toMatchObject({ custoListado: 10 });
  });

  it('CARGA INICIAL — Ruling 2c-7: FAMILY listado com gasto, /ads vazio e sem vínculo gravado: o custo sai do custoListado', async () => {
    const d = fake({
      lerEstadoSync: vi.fn(async () => ({ cargaInicialOk: false, ultimoOkEm: null })),
      buscarGrupos: vi.fn(async () => busca([grupo(11, 'ITEM'), grupo(12, 'FAMILY', 4)])),
      buscarMembros: vi.fn(async () => membros([])),
    });
    expect(await sincronizarAdsOrg(d, primeira)).toEqual({ resultado: 'ok' });
    expect(gravados(d).find((g) => g.ad_group_id === 12)?.itens).toBeNull();
    expect(d.concluir.mock.calls[0][3]).toMatchObject({ custoListado: 10 }); // 14 listados − 4 do 12
  });

  it('Ruling 2c-7 — EMPTY com vínculo anterior preservado (itens null) NÃO é descontado', async () => {
    const d = fake({
      buscarGrupos: vi.fn(async (_adv: number, j: { desde: string; ate: string }) =>
        (j.desde === JANELA_90.desde
          ? busca([grupo(11, 'ITEM'), grupo(12, 'FAMILY', 20, 'EMPTY')])
          : busca([grupo(11, 'ITEM'), grupo(12, 'FAMILY', 4, 'EMPTY')]))),
      contarVinculos: vi.fn(async () => new Map([[12, 2]])),
      buscarMembros: vi.fn(async () => membros([])),
    });
    await sincronizarAdsOrg(d, primeira);
    expect(gravados(d).find((g) => g.ad_group_id === 12)?.itens).toBeNull();
    // 90 dias: 30 listados (10+20), sem desconto (vínculo preservado) = 30; com 15 dias (4) daria 14.
    expect(d.concluir.mock.calls[0][3]).toMatchObject({ custoListado: 30 });
  });

  it('desconto herdado maior que o listado (o grupo do 404 também sumiu do search): custoListado nunca negativo', async () => {
    const d = fake({ buscarGrupos: vi.fn(async () => busca([grupo(12, 'ITEM', 5)])) });
    await sincronizarAdsOrg(d, { org_id: ORG, rodada: RODADA, cursor: '11', primeira: false, descontar: 50, descontados: [12] });
    expect(d.concluir.mock.calls[0][3]).toMatchObject({ custoListado: 0 });
  });

  it('CARGA INICIAL — desconto herdado maior que o listado: custoListado nunca negativo', async () => {
    const d = fake({
      lerEstadoSync: vi.fn(async () => ({ cargaInicialOk: false, ultimoOkEm: null })),
      buscarGrupos: vi.fn(async () => busca([grupo(12, 'ITEM', 5)])),
    });
    await sincronizarAdsOrg(d, { org_id: ORG, rodada: RODADA, cursor: '11', primeira: false, descontar: 50 });
    expect(d.concluir.mock.calls[0][3]).toMatchObject({ custoListado: 0 });
  });

  it('lote adiado com 404 no meio não desconta duas vezes (o desconto só entra quando o lote é gravado)', async () => {
    const d = fake({ buscarGrupos: vi.fn(async () => busca([grupo(11, 'ITEM'), grupo(12, 'ITEM')])) });
    d.buscarSerieGrupo.mockImplementation(async (id: number, j: { desde: string; ate: string }) =>
      (id === 11 ? http(404, null) : http(429, null, 999_999)));
    expect(await sincronizarAdsOrg(d, primeira)).toEqual({ resultado: 'continua' });
    expect(d.continuar.mock.calls[0][0]).not.toHaveProperty('descontar');
  });

  it('grupo com gasto gravado na janela que saiu do search é relido por id e mantém o vínculo', async () => {
    const d = fake({
      buscarGrupos: vi.fn(async () => busca([grupo(12, 'FAMILY')])),
      lerGruposComGasto: vi.fn(async () => [{ ad_group_id: 9, tipo: 'FAMILY' as const, external_id: '4000009', campaign_id: 0, status: 'ACTIVE' }]),
    });
    await sincronizarAdsOrg(d, primeira);
    expect(d.lerGruposComGasto).toHaveBeenCalledWith('2026-09-12', '2026-09-26');
    expect(lidos(d)).toEqual([9, 12]);
    expect(d.buscarMembros.mock.calls.map((c) => c[0])).toEqual([12]);
    expect(gravados(d).find((g) => g.ad_group_id === 9)).toMatchObject({ itens: null, status: 'ACTIVE' });
  });

  it('429 que não cabe no orçamento → continuação no mesmo cursor, nada gravado', async () => {
    const d = fake({ buscarSerieGrupo: vi.fn(async () => http(429, null, 120_000)) });
    expect(await sincronizarAdsOrg(d, primeira)).toEqual({ resultado: 'continua' });
    expect(d.gravarLote).not.toHaveBeenCalled();
    expect(d.continuar).toHaveBeenCalledWith({ org_id: ORG, rodada: RODADA, cursor: null, primeira: false, tentativa: 1 }, { atrasoMs: 120_000 });
  });

  it('5º adiamento no mesmo cursor: os grupos não lidos viram falha, o cursor anda e a rodada fecha em erro (nunca ok)', async () => {
    const d = fake({ buscarSerieGrupo: vi.fn(async () => http(429, null, 120_000)) });
    expect(await sincronizarAdsOrg(d, { org_id: ORG, rodada: RODADA, cursor: null, primeira: false, tentativa: 5 })).toEqual({ resultado: 'erro' });
    expect(d.continuar).not.toHaveBeenCalled();
    expect(d.gravarLote).not.toHaveBeenCalled();
    expect(d.avancarCursor).toHaveBeenCalledWith(RODADA, null, '12');
    expect(d.concluir).toHaveBeenCalledWith(RODADA, 'erro', expect.stringContaining('2 grupos não lidos'), { ...PARADA, advertiserId: 1000001 });
    expect(d.concluir.mock.calls.some((c) => c[1] === 'ok')).toBe(false);
  });

  it('429 com Retry-After que cabe → espera e segue', async () => {
    let n = 0;
    const d = fake({ buscarSerieGrupo: vi.fn(async (_id: number, j: { desde: string; ate: string }) => (n++ === 0 ? http(429, null, 1_000) : serie(j))) });
    expect(await sincronizarAdsOrg(d, primeira)).toEqual({ resultado: 'ok' });
    expect(d.esperar).toHaveBeenCalledWith(1_000);
  });

  it('gravarLote false (não é mais a dona) → obsoleta, sem avançar cursor', async () => {
    const d = fake({ gravarLote: vi.fn(async () => false) });
    expect(await sincronizarAdsOrg(d, primeira)).toEqual({ resultado: 'obsoleta' });
    expect(d.avancarCursor).not.toHaveBeenCalled();
  });

  it('orçamento estourado entre lotes → continua do último grupo gravado', async () => {
    const d = fake({ buscarGrupos: vi.fn(async () => busca([grupo(11, 'ITEM'), grupo(12, 'ITEM'), grupo(14, 'ITEM')])) });
    d.buscarSerieGrupo.mockImplementation(async (_id: number, j: { desde: string; ate: string }) => { d.relogio.t += 40_000; return serie(j); });
    expect(await sincronizarAdsOrg(d, primeira, { limiteMs: 60_000, lote: 1, concorrencia: 1 })).toEqual({ resultado: 'continua' });
    expect(d.continuar).toHaveBeenCalledWith({ org_id: ORG, rodada: RODADA, cursor: '12', primeira: false, tentativa: 0 }, {});
  });

  it('continuação: confere a posse e só lê grupos depois do cursor', async () => {
    const d = fake();
    await sincronizarAdsOrg(d, { org_id: ORG, rodada: RODADA, cursor: '11', primeira: false });
    expect(d.avancarCursor).toHaveBeenNthCalledWith(1, RODADA, '11', '11');
    expect(lidos(d)).toEqual([12]);
  });

  it('série malformada ou furada → erro da rodada (500), nunca grava zero inventado', async () => {
    const malformada = fake({ buscarSerieGrupo: vi.fn(async () => ok({ results: [{ date: '2026-09-26', cost: 'x' }] })) });
    expect(await sincronizarAdsOrg(malformada, primeira)).toEqual({ resultado: 'erro' });
    expect(malformada.gravarLote).not.toHaveBeenCalled();
    expect(malformada.concluir).toHaveBeenCalledWith(RODADA, 'erro', expect.stringContaining('resposta inválida'), { ...PARADA, advertiserId: 1000001 });
    const furada = fake({ buscarSerieGrupo: vi.fn(async (_id: number, j: { desde: string; ate: string }) =>
      ok({ results: (serie(j).corpo as { results: unknown[] }).results.slice(1) })) });
    expect(await sincronizarAdsOrg(furada, primeira)).toEqual({ resultado: 'erro' });
    expect(furada.gravarLote).not.toHaveBeenCalled();
  });

  it('primeira sem posse → obsoleta sem ler nada', async () => {
    const d = fake({ reservarPosse: vi.fn(async () => null) });
    expect(await sincronizarAdsOrg(d, primeira)).toEqual({ resultado: 'obsoleta' });
    expect(d.buscarAdvertiser).not.toHaveBeenCalled();
  });

  // Ruling 2c-5 (fix round 1): a falha de um grupo não pode se perder entre mensagens da mesma rodada.
  it('CRÍTICO — lote preso, depois orçamento estourado entre lotes: a continuação carrega falhou, e a rodada nunca fecha em ok (cursor zera no fim)', async () => {
    const d = fake();
    d.buscarSerieGrupo.mockImplementation(async (id: number, j: { desde: string; ate: string }) => {
      d.relogio.t += 40_000;
      return id === 11 ? http(429, null, 120_000) : serie(j);
    });
    const r1 = await sincronizarAdsOrg(d, { org_id: ORG, rodada: RODADA, cursor: null, primeira: false, tentativa: 5 },
      { limiteMs: 30_000, lote: 1, concorrencia: 1 });
    expect(r1).toEqual({ resultado: 'continua' });
    expect(d.continuar).toHaveBeenCalledWith(
      { org_id: ORG, rodada: RODADA, cursor: '11', primeira: false, tentativa: 0, falhou: true }, {});
    expect(d.concluir.mock.calls.some((c) => c[1] === 'ok')).toBe(false);

    const r2 = await sincronizarAdsOrg(d, { org_id: ORG, rodada: RODADA, cursor: '11', primeira: false, tentativa: 0, falhou: true });
    expect(r2).toEqual({ resultado: 'erro' });
    expect(d.avancarCursor).toHaveBeenLastCalledWith(RODADA, '12', null); // zera: a próxima "primeira" recomeça do zero
    expect(d.concluir).toHaveBeenCalledTimes(1);
    expect(d.concluir).toHaveBeenCalledWith(RODADA, 'erro', expect.any(String),
      { cargaConcluida: false, advertiserId: 1000001, coberturaDesde: null, custoResumo: null, custoListado: null });
    expect(d.concluir.mock.calls.some((c) => c[1] === 'ok')).toBe(false);
  });

  // Ruling 2c-6 substitui o "avança pro fim do lote e zera depois" pelo zero imediato na carga inicial:
  // com o lote padrão (20) os dois grupos pendentes cabem no mesmo lote, e o cursor nunca sai de null.
  it('CRÍTICO — carga inicial com falha: cursor zera na hora, sem nunca ter avançado (recomeça do início)', async () => {
    const d = fake({
      lerEstadoSync: vi.fn(async () => ({ cargaInicialOk: false, ultimoOkEm: null })),
      buscarSerieGrupo: vi.fn(async () => http(429, null, 120_000)),
    });
    expect(await sincronizarAdsOrg(d, { org_id: ORG, rodada: RODADA, cursor: null, primeira: false, tentativa: 5 }))
      .toEqual({ resultado: 'erro' });
    expect(d.avancarCursor).not.toHaveBeenCalledWith(RODADA, null, '12');
    expect(d.avancarCursor).toHaveBeenLastCalledWith(RODADA, null, null);
    expect(d.concluir).toHaveBeenCalledWith(RODADA, 'erro', expect.stringContaining('2 grupos não lidos'),
      { cargaConcluida: false, advertiserId: 1000001, coberturaDesde: null, custoResumo: null, custoListado: null });
  });

  // IMPORTANTE: item que começaria depois do fim do orçamento não é lido (nunca abre uma requisição sem orçamento).
  it('item que começaria depois do fim do orçamento não é lido: adia com atrasoMs 0', async () => {
    const d = fake({ buscarGrupos: vi.fn(async () => busca([grupo(11, 'ITEM'), grupo(12, 'ITEM')])) });
    d.buscarSerieGrupo.mockImplementation(async (id: number, j: { desde: string; ate: string }) => {
      if (id === 11) d.relogio.t += 200_000;
      return serie(j);
    });
    expect(await sincronizarAdsOrg(d, primeira, { limiteMs: 90_000, lote: 2, concorrencia: 1 })).toEqual({ resultado: 'continua' });
    expect(d.buscarSerieGrupo).toHaveBeenCalledTimes(1); // o 2º item nem chega a pedir a série
    expect(d.continuar).toHaveBeenCalledWith(
      { org_id: ORG, rodada: RODADA, cursor: null, primeira: false, tentativa: 1 }, { atrasoMs: 0 });
  });

  // Menor 1: a paginação de /ads também confere o fim do orçamento antes de cada página.
  it('paginação de /ads confere o fim do orçamento antes de cada página', async () => {
    const pag1 = Array.from({ length: 100 }, (_, k) => `MLB${3000 + k}`);
    const d = fake({ buscarGrupos: vi.fn(async () => busca([grupo(12, 'FAMILY')])) });
    d.buscarMembros.mockImplementation(async (_id: number, _j: unknown, offset: number) => {
      if (offset === 0) d.relogio.t += 100_000;
      return membros(pag1, 150);
    });
    expect(await sincronizarAdsOrg(d, primeira)).toEqual({ resultado: 'continua' });
    expect(d.buscarMembros).toHaveBeenCalledTimes(1); // a 2ª página não é pedida fora do orçamento
    expect(d.continuar).toHaveBeenCalledWith(
      { org_id: ORG, rodada: RODADA, cursor: null, primeira: false, tentativa: 1 }, { atrasoMs: 0 });
  });

  // Menor 3: a margem de TIMEOUT_ML_MS em comRetry — cabe sem o timeout mas não com ele → adia sem esperar.
  it('margem do timeout no Retry-After: cabe sem reservar o timeout de uma requisição inteira, mas não com ele → adia sem esperar', async () => {
    const d = fake({ buscarAdvertiser: vi.fn(async () => http(429, null, 81_000)) });
    expect(await sincronizarAdsOrg(d, primeira)).toEqual({ resultado: 'continua' });
    expect(d.esperar).not.toHaveBeenCalled();
    expect(d.continuar).toHaveBeenCalledWith(
      { org_id: ORG, rodada: RODADA, cursor: null, primeira: false, tentativa: 1 }, { atrasoMs: 81_000 });
  });

  // Ruling 2c-6 (fix round 2): na carga inicial a regra não espera o fim da cadeia.
  it('CARGA INICIAL (Ruling 2c-6) — lote 1 preso: zera o cursor e fecha em erro na mesma mensagem, sem publicar continuação', async () => {
    const d = fake({
      lerEstadoSync: vi.fn(async () => ({ cargaInicialOk: false, ultimoOkEm: null })),
      buscarSerieGrupo: vi.fn(async () => http(429, null, 120_000)),
    });
    const r = await sincronizarAdsOrg(d, { org_id: ORG, rodada: RODADA, cursor: null, primeira: false, tentativa: 5 },
      { limiteMs: 30_000, lote: 1, concorrencia: 1 });
    expect(r).toEqual({ resultado: 'erro' });
    expect(d.continuar).not.toHaveBeenCalled();
    expect(d.buscarSerieGrupo).toHaveBeenCalledTimes(1); // nunca chega no 2º grupo (lote 2)
    expect(d.avancarCursor).not.toHaveBeenCalledWith(RODADA, null, '11'); // nunca avança para depois do não lido
    expect(d.avancarCursor).toHaveBeenLastCalledWith(RODADA, null, null); // zera na hora
    expect(d.concluir).toHaveBeenCalledWith(RODADA, 'erro', expect.stringContaining('1 grupo não lido'),
      { cargaConcluida: false, advertiserId: 1000001, coberturaDesde: null, custoResumo: null, custoListado: null });
  });

  it('CARGA INICIAL (Ruling 2c-6) — exceção no lote 2 depois de um lote ok: o cursor é zerado', async () => {
    const d = fake({
      lerEstadoSync: vi.fn(async () => ({ cargaInicialOk: false, ultimoOkEm: null })),
      buscarSerieGrupo: vi.fn(async (id: number, j: { desde: string; ate: string }) =>
        (id === 11 ? serie(j) : ok({ results: [{ date: '2026-09-26', cost: 'x' }] }))),
    });
    const r = await sincronizarAdsOrg(d, primeira, { limiteMs: 90_000, lote: 1, concorrencia: 1 });
    expect(r).toEqual({ resultado: 'erro' });
    expect(d.gravarLote).toHaveBeenCalledTimes(1); // o lote 1 (grupo 11) foi gravado antes da exceção
    expect(d.avancarCursor).toHaveBeenLastCalledWith(RODADA, '11', null); // zera depois do avanço do lote 1
    expect(d.concluir).toHaveBeenCalledWith(RODADA, 'erro', expect.stringContaining('resposta inválida'),
      { cargaConcluida: false, advertiserId: 1000001, coberturaDesde: null, custoResumo: null, custoListado: null });
  });

  it('DIÁRIA (Ruling 2c-6) — exceção com falhou herdado de mensagem anterior: zera o cursor mesmo fora da carga inicial', async () => {
    const d = fake({
      buscarSerieGrupo: vi.fn(async (id: number, j: { desde: string; ate: string }) =>
        (id === 11 ? serie(j) : ok({ results: [{ date: '2026-09-26', cost: 'x' }] }))),
    });
    const r = await sincronizarAdsOrg(d, { org_id: ORG, rodada: RODADA, cursor: null, primeira: false, tentativa: 0, falhou: true },
      { limiteMs: 90_000, lote: 1, concorrencia: 1 });
    expect(r).toEqual({ resultado: 'erro' });
    expect(d.avancarCursor).toHaveBeenLastCalledWith(RODADA, '11', null);
    expect(d.concluir).toHaveBeenCalledWith(RODADA, 'erro', expect.stringContaining('resposta inválida'),
      { cargaConcluida: false, advertiserId: 1000001, coberturaDesde: null, custoResumo: null, custoListado: null });
  });

  // Ruling 2c-8: custo_resumo/custo_listado da diária cobriam só a janela de 15 dias — um grupo excluído ou
  // vazio entre 16 e 90 dias atrás nunca entrava em `fora_dos_grupos`.
  it('Ruling 2c-8 (a) — diária: grupo excluído do resumo de 90 dias (ausente da listagem, sem gasto em 15 dias) entra em custoResumo − custoListado', async () => {
    const d = fake({
      buscarGrupos: vi.fn(async (_adv: number, j: { desde: string; ate: string }) =>
        (j.desde === JANELA_90.desde
          ? ok({ paging: { offset: 0, total: 0, limit: 100 }, results: [], metrics_summary: { cost: 15 } })
          : busca([]))),
    });
    expect(await sincronizarAdsOrg(d, primeira)).toEqual({ resultado: 'ok' });
    expect(d.buscarGrupos).toHaveBeenCalledWith(1000001, JANELA_90, 0);
    expect(d.concluir).toHaveBeenCalledWith(RODADA, 'ok', null,
      expect.objectContaining({ custoResumo: 15, custoListado: 0 }));
  });

  it('Ruling 2c-8 (b) — diária: sem nada fora dos grupos em 90 dias → diferença 0', async () => {
    const d = fake({
      buscarGrupos: vi.fn(async (_adv: number, j: { desde: string; ate: string }) =>
        (j.desde === JANELA_90.desde
          ? ok({ paging: { offset: 0, total: 0, limit: 100 }, results: [], metrics_summary: { cost: 0 } })
          : busca([]))),
    });
    expect(await sincronizarAdsOrg(d, primeira)).toEqual({ resultado: 'ok' });
    expect(d.concluir).toHaveBeenCalledWith(RODADA, 'ok', null,
      expect.objectContaining({ custoResumo: 0, custoListado: 0 }));
  });

  it('Ruling 2c-8 (c) — carga inicial não faz a busca extra de 90 dias (a busca principal já é de 90 dias)', async () => {
    const d = fake({ lerEstadoSync: vi.fn(async () => ({ cargaInicialOk: false, ultimoOkEm: null })) });
    expect(await sincronizarAdsOrg(d, primeira)).toEqual({ resultado: 'ok' });
    expect(d.buscarGrupos).toHaveBeenCalledTimes(1);
  });

  it('Ruling 2c-8 — grupo com gasto só entre 16 e 90 dias atrás (sem gasto em 15 dias, nunca relido), hoje vazio e sem vínculo gravado: sai do custo de 90 dias', async () => {
    const d = fake({
      buscarGrupos: vi.fn(async (_adv: number, j: { desde: string; ate: string }) =>
        (j.desde === JANELA_90.desde ? busca([grupo(12, 'FAMILY', 30)]) : busca([]))),
      contarVinculos: vi.fn(async (ids: number[]) => new Map(ids.map((id) => [id, 0]))),
    });
    expect(await sincronizarAdsOrg(d, primeira)).toEqual({ resultado: 'ok' });
    expect(d.contarVinculos).toHaveBeenCalledWith([12]);
    expect(d.buscarSerieGrupo).not.toHaveBeenCalled(); // não foi relido: sem gasto em 15 dias
    expect(d.concluir).toHaveBeenCalledWith(RODADA, 'ok', null,
      expect.objectContaining({ custoResumo: 99, custoListado: 0 }));
  });

  it('Ruling 2c-8 — grupo com gasto só entre 16 e 90 dias atrás, hoje vazio mas com vínculo gravado: NÃO é descontado', async () => {
    const d = fake({
      buscarGrupos: vi.fn(async (_adv: number, j: { desde: string; ate: string }) =>
        (j.desde === JANELA_90.desde ? busca([grupo(12, 'FAMILY', 30)]) : busca([]))),
      contarVinculos: vi.fn(async (ids: number[]) => new Map(ids.map((id) => [id, 2]))),
    });
    expect(await sincronizarAdsOrg(d, primeira)).toEqual({ resultado: 'ok' });
    expect(d.contarVinculos).toHaveBeenCalledWith([12]);
    expect(d.concluir).toHaveBeenCalledWith(RODADA, 'ok', null,
      expect.objectContaining({ custoResumo: 99, custoListado: 30 }));
  });

  // Item 5 da rodada de correção: os "extras" (grupo com gasto só em 90d, não relido) excluíam todo ITEM,
  // mas o Ruling 2c-7 desconta ITEM sem external_id (e sem vínculo) do mesmo jeito que FAMILY/CATALOG vazios.
  it('grupo ITEM sem external_id, com gasto só em 90 dias e sem vínculo: também é descontado (extras não excluem ITEM sem external_id)', async () => {
    const itemSemExternalId = { id: 20, ad_group_type: 'ITEM' as const, ad_group_external_id: null, campaign_id: 2000001, status: 'ACTIVE', metrics: { cost: 12 } };
    const d = fake({
      buscarGrupos: vi.fn(async (_adv: number, j: { desde: string; ate: string }) =>
        (j.desde === JANELA_90.desde ? busca([itemSemExternalId]) : busca([]))),
      contarVinculos: vi.fn(async (ids: number[]) => new Map(ids.map((id) => [id, 0]))),
    });
    expect(await sincronizarAdsOrg(d, primeira)).toEqual({ resultado: 'ok' });
    expect(d.contarVinculos).toHaveBeenCalledWith([20]);
    expect(d.concluir).toHaveBeenCalledWith(RODADA, 'ok', null,
      expect.objectContaining({ custoResumo: 99, custoListado: 0 }));
  });

  // Item 4 da rodada de correção: a busca extra de 90 dias tem o mesmo teto de adiamento das outras.
  // Item 1 da correção final (Grok 4.7 xhigh, ALTA): os dois primeiros GETs da cadeia (anunciante e
  // ad_groups/search de 15 dias) publicavam continuação sem olhar LIMITE_ADIAMENTOS — presos, a posse
  // renovava para sempre e o cursor nunca andava.
  it('429 constante no anunciante também tem teto de adiamento: presa, a rodada fecha em erro sem publicar continuação', async () => {
    const d = fake({ buscarAdvertiser: vi.fn(async () => http(429, null, 120_000)) });
    expect(await sincronizarAdsOrg(d, { org_id: ORG, rodada: RODADA, cursor: null, primeira: false, tentativa: 5 }))
      .toEqual({ resultado: 'erro' });
    expect(d.continuar).not.toHaveBeenCalled();
    expect(d.buscarGrupos).not.toHaveBeenCalled();
    expect(d.avancarCursor).toHaveBeenLastCalledWith(RODADA, null, null);
    expect(d.concluir).toHaveBeenCalledWith(RODADA, 'erro', expect.stringContaining('anunciante'),
      { cargaConcluida: false, advertiserId: null, coberturaDesde: null, custoResumo: null, custoListado: null });
    expect(d.concluir.mock.calls.some((c) => c[1] === 'ok')).toBe(false);
  });

  it('429 constante no ad_groups/search de 15 dias também tem teto de adiamento: presa, a rodada fecha em erro sem publicar continuação', async () => {
    const d = fake({ buscarGrupos: vi.fn(async () => http(429, null, 120_000)) });
    expect(await sincronizarAdsOrg(d, { org_id: ORG, rodada: RODADA, cursor: null, primeira: false, tentativa: 5 }))
      .toEqual({ resultado: 'erro' });
    expect(d.continuar).not.toHaveBeenCalled();
    expect(d.buscarSerieGrupo).not.toHaveBeenCalled();
    expect(d.avancarCursor).toHaveBeenLastCalledWith(RODADA, null, null);
    expect(d.concluir).toHaveBeenCalledWith(RODADA, 'erro', expect.stringContaining('ad_groups/search'),
      { cargaConcluida: false, advertiserId: 1000001, coberturaDesde: null, custoResumo: null, custoListado: null });
    expect(d.concluir.mock.calls.some((c) => c[1] === 'ok')).toBe(false);
  });

  it('Ruling 2c-9 — 429 constante na busca extra de 90 dias tem teto de adiamento: presa, a rodada fecha em erro (nunca ok sem o custo de 90 dias)', async () => {
    const d = fake({
      buscarGrupos: vi.fn(async (_adv: number, j: { desde: string; ate: string }) =>
        (j.desde === JANELA_90.desde ? http(429, null, 120_000) : busca([]))),
    });
    expect(await sincronizarAdsOrg(d, { org_id: ORG, rodada: RODADA, cursor: null, primeira: false, tentativa: 5 }))
      .toEqual({ resultado: 'erro' });
    expect(d.continuar).not.toHaveBeenCalled();
    expect(d.avancarCursor).toHaveBeenLastCalledWith(RODADA, null, null);
    expect(d.concluir).toHaveBeenCalledWith(RODADA, 'erro', expect.stringContaining('90 dias'),
      { cargaConcluida: false, advertiserId: 1000001, coberturaDesde: null, custoResumo: null, custoListado: null });
    expect(d.concluir.mock.calls.some((c) => c[1] === 'ok')).toBe(false);
  });

  // Item 6 da rodada de correção (Ruling 2c-9): a busca extra só roda na mensagem que fecha a rodada.
  it('Ruling 2c-9 — diária com 2 mensagens: a busca extra de 90 dias roda só na que conclui a rodada (a última)', async () => {
    const d = fake({
      buscarGrupos: vi.fn(async (_adv: number, j: { desde: string; ate: string }) =>
        (j.desde === JANELA_90.desde ? busca([]) : busca([grupo(11, 'ITEM'), grupo(12, 'ITEM'), grupo(14, 'ITEM')]))),
    });
    d.buscarSerieGrupo.mockImplementation(async (_id: number, j: { desde: string; ate: string }) => { d.relogio.t += 40_000; return serie(j); });
    const chamadas90d = () => d.buscarGrupos.mock.calls.filter((c) => (c[1] as { desde: string }).desde === JANELA_90.desde).length;
    expect(await sincronizarAdsOrg(d, primeira, { limiteMs: 60_000, lote: 1, concorrencia: 1 })).toEqual({ resultado: 'continua' });
    expect(chamadas90d()).toBe(0); // mensagem que só continua não busca o custo de 90 dias
    expect(await sincronizarAdsOrg(d, { org_id: ORG, rodada: RODADA, cursor: '12', primeira: false, tentativa: 0 }))
      .toEqual({ resultado: 'ok' });
    expect(chamadas90d()).toBe(1); // só a mensagem que conclui
  });

  // Correção da re-revisão, item 1: o estouro de orçamento na busca de 90 dias não tinha teto de
  // adiamento (só o 429 tinha) — sem isso a cadeia nunca fecharia se o orçamento estourasse sempre.
  it('Ruling 2c-9 — orçamento sempre estourado na busca de 90 dias também tem teto: a cadeia fecha em erro depois de 5 tentativas, nunca em ok', async () => {
    const d = fake();
    d.buscarGrupos.mockImplementation(async () => { d.relogio.t += 2_000; return busca([]); });
    let msg: { org_id: string; primeira: boolean; rodada?: string; cursor?: string | null; tentativa?: number } =
      { org_id: ORG, primeira: false, rodada: RODADA, cursor: null, tentativa: 0 };
    for (let i = 1; i <= 5; i++) {
      expect(await sincronizarAdsOrg(d, msg, { limiteMs: 1_000, lote: 20, concorrencia: 6 })).toEqual({ resultado: 'continua' });
      const ultima = d.continuar.mock.calls.at(-1)?.[0] as typeof msg;
      expect(ultima).toMatchObject({ cursor: null, tentativa: i, primeira: false });
      msg = ultima;
    }
    expect(await sincronizarAdsOrg(d, msg, { limiteMs: 1_000, lote: 20, concorrencia: 6 })).toEqual({ resultado: 'erro' });
    expect(d.avancarCursor).toHaveBeenLastCalledWith(RODADA, null, null);
    expect(d.concluir).toHaveBeenCalledWith(RODADA, 'erro', expect.stringContaining('90 dias'),
      { cargaConcluida: false, advertiserId: 1000001, coberturaDesde: null, custoResumo: null, custoListado: null });
    expect(d.concluir.mock.calls.some((c) => c[1] === 'ok')).toBe(false);
  });

  // Correção da re-revisão, item 2: um id já em `descontados` não pode ser reconferido pelos "extras"
  // (grupo com gasto só em 90 dias, não relido) — senão o mesmo grupo desconta duas vezes.
  it('Ruling 2c-9 — grupo em descontados não é descontado de novo pelos "extras" (desconto em dobro)', async () => {
    const d = fake({
      buscarGrupos: vi.fn(async (_adv: number, j: { desde: string; ate: string }) =>
        (j.desde === JANELA_90.desde ? busca([grupo(12, 'FAMILY', 30), grupo(99, 'FAMILY', 50)]) : busca([]))),
      contarVinculos: vi.fn(async (ids: number[]) => new Map(ids.map((id) => [id, id === 99 ? 2 : 0]))),
    });
    await sincronizarAdsOrg(d, { org_id: ORG, rodada: RODADA, cursor: null, primeira: false, tentativa: 0, descontados: [12] });
    expect(d.contarVinculos).toHaveBeenCalledWith([99]); // 12 já está em `descontados`; não é reconferido nos extras
    // Σ (30+50) − 30 (12, já contado em `descontados`) = 50. Sem o filtro, 12 desconta de novo: 80 − 60 = 20.
    expect(d.concluir).toHaveBeenCalledWith(RODADA, 'ok', null,
      expect.objectContaining({ custoResumo: 99, custoListado: 50 }));
  });

  // Correção da re-revisão, item 2 (piso 0): única entrada alcançável é a mesma página duplicada na busca
  // de 90 dias — daí `Σ` (soma bruta, sem dedup) e o mapa por id (que fica só com a última página) divergem.
  it('Ruling 2c-9 — página duplicada na busca de 90 dias (mesmo ad_group_id em duas páginas): custoListado nunca fica negativo (piso 0)', async () => {
    const d = fake({
      buscarGrupos: vi.fn(async (_adv: number, j: { desde: string; ate: string }, offset: number) => {
        if (j.desde !== JANELA_90.desde) return busca([]);
        return offset === 0 ? busca([grupo(12, 'FAMILY', 10)], 2) : busca([grupo(12, 'FAMILY', 40)], 2);
      }),
      contarVinculos: vi.fn(async (ids: number[]) => new Map(ids.map((id) => [id, 0]))),
    });
    expect(await sincronizarAdsOrg(d, primeira)).toEqual({ resultado: 'ok' });
    // Σ (10+40, sem dedup) − 80 (12 descontado 2×, uma por página) = −30 sem o piso; com o piso, 0.
    expect(d.concluir).toHaveBeenCalledWith(RODADA, 'ok', null,
      expect.objectContaining({ custoResumo: 99, custoListado: 0 }));
  });
});
