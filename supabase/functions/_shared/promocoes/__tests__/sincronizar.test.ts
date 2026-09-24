import { describe, expect, it, vi } from 'vitest';
import {
  MSG_ALIQUOTA, mesmaRodada, projetarItem, sincronizarLista, sincronizarPromocao,
  type DepsLeitura, type DepsLista, type MsgLeitura,
} from '../sincronizar.ts';
import { montarCadastro, type LinhaVariacao } from '../cadastro.ts';
import { SemAcessoPromocoes } from '../ml.ts';
import type { ItemML, ItemPromocaoML, PromocaoML, Tarifa } from '../tipos.ts';

const tarifa10: Tarifa = { comissao: { percentual: 10, fixa: 0 }, frete: 0 };
const aliq = { nacional: 8, importado: 16 };
const linhaVar = (o: Partial<LinhaVariacao> & { id: string }): LinhaVariacao => ({
  custo: 20, preco: 30, cor: null, codigo: null, gtin: null, ml_variation_id: null, peso_gramas: 200,
  altura_cm: 5, largura_cm: 10, comprimento_cm: 15, atualizado_em: '2026-09-01T00:00:00Z',
  familias: { ml_item_id: 'MLB1', origem: 'nacional' }, ...o,
});
const item = (o: Partial<ItemPromocaoML> = {}): ItemPromocaoML => ({
  ml_item_id: 'MLB1', status: 'candidate', preco_original: 60, preco_promo: 50, preco_min: null, preco_max: null,
  preco_sugerido: null, ml_pct: null, vendedor_pct: null, estoque_min: null, estoque_max: null, ...o,
});
const itemMl = (o: Partial<ItemML> = {}): ItemML => ({
  id: 'MLB1', titulo: 'Toalha', thumbnail: null, permalink: 'https://p', listing_type_id: 'gold_special',
  categoria: 'MLB123', sku: null, gtin: null, variacoes: [], ...o,
});

describe('projetarItem', () => {
  it('Legacy 3 cores: líquido por cor, pior semáforo entre as que têm líquido', async () => {
    const cad = montarCadastro([
      linhaVar({ id: 'a', ml_variation_id: '1', custo: 20, preco: 30 }),  // 50 − 5 − 4 = 41 ≥ 30 → verde
      linhaVar({ id: 'b', ml_variation_id: '2', custo: 45, preco: 50 }),  // 41 < 45 → vermelho
    ], []);
    const ml = itemMl({ variacoes: [
      { variation_id: 1, cor: 'Azul', sku: null, gtin: null },
      { variation_id: 2, cor: 'Rosa', sku: null, gtin: null },
      { variation_id: 3, cor: 'Verde', sku: null, gtin: null },           // sem cadastro
    ] });
    const l = await projetarItem(item(), ml, cad, aliq, async () => tarifa10);
    expect(l.projecao.map((p) => [p.cor, p.semaforo, p.motivo])).toEqual([
      ['Azul', 'verde', null], ['Rosa', 'vermelho', null], ['Verde', 'indisponivel', 'sem_cadastro'],
    ]);
    expect(l.projecao[0].liquido).toBeCloseTo(41, 10);
    expect(l.pior_semaforo).toBe('vermelho');
    expect(l.preco_avaliado).toBe(50);
  });

  it('importado usa a alíquota de importado', async () => {
    const cad = montarCadastro([linhaVar({ id: 'a', familias: { ml_item_id: 'MLB1', origem: 'importado' } })], []);
    const l = await projetarItem(item(), itemMl(), cad, aliq, async () => tarifa10);
    expect(l.projecao[0].aliquota_pct).toBe(16);
    expect(l.projecao[0].liquido).toBeCloseTo(50 - 5 - 8, 10);
  });

  it('convidado com faixa: avalia no sugerido e calcula até quanto descer', async () => {
    const cad = montarCadastro([linhaVar({ id: 'a', preco: 30 })], []);
    const l = await projetarItem(item({ preco_min: 20, preco_max: 60, preco_sugerido: 45 }), itemMl(), cad, aliq, async () => tarifa10);
    expect(l.preco_avaliado).toBe(45);
    expect(l.projecao[0].ate_quanto).toBeCloseTo(36.6, 2);
  });

  it('participando com faixa: avalia no preço que está no ar, não no sugerido', async () => {
    const cad = montarCadastro([linhaVar({ id: 'a' })], []);
    const l = await projetarItem(item({ status: 'started', preco_promo: 42, preco_sugerido: 45, preco_min: 20, preco_max: 60 }), itemMl(), cad, aliq, async () => tarifa10);
    expect(l.preco_avaliado).toBe(42);
  });

  it('falha no "até quanto" não apaga o líquido já calculado no preço avaliado', async () => {
    const cad = montarCadastro([linhaVar({ id: 'a', preco: 30 })], []);
    const tarifa = async (q: { preco: number }) => { if (q.preco !== 45) throw new Error('estimada'); return tarifa10; };
    const l = await projetarItem(item({ preco_min: 20, preco_max: 60, preco_sugerido: 45 }), itemMl(), cad, aliq, tarifa);
    expect(l.projecao[0]).toMatchObject({ motivo: null, ate_quanto: null, semaforo: 'verde' });
    expect(l.projecao[0].liquido).toBeCloseTo(45 * 0.82, 10);
  });

  it('falha ou tarifa estimada derruba só a cor (erro_tarifa)', async () => {
    const cad = montarCadastro([linhaVar({ id: 'a' })], []);
    const l = await projetarItem(item(), itemMl(), cad, aliq, async () => { throw new Error('estimada'); });
    expect(l.projecao[0]).toMatchObject({ motivo: 'erro_tarifa', liquido: null, semaforo: 'indisponivel' });
  });

  it('falha de tarifa deixa rastro no log (console.warn), sem mudar o resultado', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cad = montarCadastro([linhaVar({ id: 'a' })], []);
    const l = await projetarItem(item(), itemMl(), cad, aliq, async () => { throw new Error('estimada'); });
    expect(l.projecao[0].motivo).toBe('erro_tarifa');
    expect(warn).toHaveBeenCalledWith('[promocoes] tarifa indisponível', expect.objectContaining({ ml_item_id: item().ml_item_id, erro: 'estimada' }));
    warn.mockRestore();
  });

  it('item fora do multiget: sem categoria, sem líquido', async () => {
    const cad = montarCadastro([linhaVar({ id: 'a' })], []);
    const l = await projetarItem(item(), null, cad, aliq, async () => tarifa10);
    expect(l.projecao[0].motivo).toBe('sem_categoria');
  });
});

const promo = (id: string, tipo = 'DEAL', status = 'pending') =>
  ({ id, tipo, status, nome: id, inicio: null, fim: null, prazo_adesao: null, beneficios: null, bruto: {} }) as PromocaoML;

type FakeLista = DepsLista & Record<keyof DepsLista, ReturnType<typeof vi.fn>>;
const depsLista = (o: Partial<DepsLista> = {}): FakeLista => ({
  lerAliquotas: vi.fn(async () => aliq),
  listarPromocoes: vi.fn(async (): Promise<PromocaoML[]> => []),
  gravarPromocoes: vi.fn(async () => {}),
  encerrarAusentes: vi.fn(async () => {}),
  reservarLeitura: vi.fn(async () => true),
  enfileirar: vi.fn(async () => {}),
  avisar: vi.fn(async () => 0),
  gravarEstado: vi.fn(async () => {}),
  ...o,
}) as unknown as FakeLista;
const ctx = { orgId: 'org', rodada: '2026-10-06T12:00:00.000Z' };

describe('sincronizarLista', () => {
  it('alíquotas não confirmadas: falha LOUD sem chamar o ML', async () => {
    const d = depsLista({ lerAliquotas: vi.fn(async () => null) });
    expect((await sincronizarLista(d, ctx)).estado).toBe('erro');
    expect(d.gravarEstado).toHaveBeenCalledWith({ estado: 'erro', erro: MSG_ALIQUOTA });
    expect(d.listarPromocoes).not.toHaveBeenCalled();
  });

  it('403 → sem_acesso; lista vazia → sem_promocoes e encerra as antigas', async () => {
    const d1 = depsLista({ listarPromocoes: vi.fn(async () => { throw new SemAcessoPromocoes('ML 403'); }) });
    expect((await sincronizarLista(d1, ctx)).estado).toBe('sem_acesso');
    expect(d1.gravarEstado).toHaveBeenCalledWith({ estado: 'sem_acesso', erro: 'ML 403' });
    const d2 = depsLista();
    expect((await sincronizarLista(d2, ctx)).estado).toBe('sem_promocoes');
    expect(d2.encerrarAusentes).toHaveBeenCalledWith([]);
  });

  it('grava, encerra ausentes, avisa e enfileira só pending/started não-cupom que reservou', async () => {
    const d = depsLista({
      listarPromocoes: vi.fn(async () => [
        promo('C', 'SELLER_COUPON_CAMPAIGN', 'started'), promo('F', 'DEAL', 'finished'), promo('P'), promo('S', 'SMART', 'started'),
      ]),
      reservarLeitura: vi.fn(async (id: string) => id !== 'S'),
    });
    const r = await sincronizarLista(d, ctx);
    expect(d.encerrarAusentes).toHaveBeenCalledWith(['C', 'F', 'P', 'S']);
    expect(d.avisar).toHaveBeenCalledTimes(1);
    expect(r.enfileiradas).toEqual(['P']);
    expect(d.enfileirar).toHaveBeenCalledWith({ etapa: 'promocao', org_id: 'org', promocao_id: 'P', tipo: 'DEAL', rodada: ctx.rodada, cursor: null });
    expect(d.gravarEstado).toHaveBeenLastCalledWith({ estado: 'ok' });
  });

  it('falha inesperada grava estado erro e relança (nada fica em "sincronizando")', async () => {
    const d = depsLista({ listarPromocoes: vi.fn(async () => [promo('P')]), gravarPromocoes: vi.fn(async () => { throw new Error('db fora'); }) });
    await expect(sincronizarLista(d, ctx)).rejects.toThrow('db fora');
    expect(d.gravarEstado).toHaveBeenCalledWith({ estado: 'erro', erro: 'db fora' });
  });

  it('falha nos alertas não derruba o sync', async () => {
    const d = depsLista({ listarPromocoes: vi.fn(async () => [promo('P')]), avisar: vi.fn(async () => { throw new Error('telegram'); }) });
    expect((await sincronizarLista(d, ctx)).estado).toBe('ok');
  });
});

type FakeLeitura = DepsLeitura & Record<keyof DepsLeitura, ReturnType<typeof vi.fn>> & { avancar: (ms: number) => void };
function depsLeitura(o: Partial<DepsLeitura> = {}): FakeLeitura {
  let relogio = 0;
  return {
    avancar: (ms: number) => { relogio += ms; },
    agora: vi.fn(() => relogio),
    // O PostgREST serializa timestamptz como `+00:00`; a mensagem leva `Z` (toISOString).
    rodadaEmCurso: vi.fn(async (): Promise<string | null> => '2026-10-06T12:00:00+00:00'),
    lerAliquotas: vi.fn(async () => aliq),
    listarItens: vi.fn(async () => [item({ ml_item_id: 'MLB3' }), item({ ml_item_id: 'MLB1' }), item({ ml_item_id: 'MLB2' })]),
    buscarItensML: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, itemMl({ id })]))),
    carregarCadastro: vi.fn(async () => montarCadastro([linhaVar({ id: 'a' })], [])),
    tarifaEm: vi.fn(async () => tarifa10),
    gravarLote: vi.fn(async () => {}),
    continuar: vi.fn(async () => {}),
    concluir: vi.fn(async () => true),
    falhar: vi.fn(async () => {}),
    ...o,
  } as unknown as FakeLeitura;
}
const msg: MsgLeitura = { etapa: 'promocao', org_id: 'org', promocao_id: 'P', tipo: 'DEAL', rodada: ctx.rodada, cursor: null };
const opts = { limiteMs: 90_000, lote: 2, concorrencia: 4 };

describe('mesmaRodada', () => {
  it('compara instantes, não texto', () => {
    expect(mesmaRodada('2026-10-06T12:00:00+00:00', '2026-10-06T12:00:00.000Z')).toBe(true);
    expect(mesmaRodada('2026-10-06T12:00:01+00:00', '2026-10-06T12:00:00.000Z')).toBe(false);
    expect(mesmaRodada(null, '2026-10-06T12:00:00.000Z')).toBe(false);
  });
});

describe('sincronizarPromocao', () => {
  it('lê em lotes na ordem de ml_item_id e conclui', async () => {
    const d = depsLeitura();
    const r = await sincronizarPromocao(d, msg, opts);
    expect(r).toEqual({ resultado: 'concluida', processados: 3 });
    expect(d.gravarLote.mock.calls.map((c) => c[0].map((l: { ml_item_id: string }) => l.ml_item_id))).toEqual([['MLB1', 'MLB2'], ['MLB3']]);
    expect(d.concluir).toHaveBeenCalledTimes(1);
  });

  it('orçamento esgotado: grava o que fez e continua do cursor', async () => {
    const d = depsLeitura();
    d.gravarLote.mockImplementation(async () => { d.avancar(100_000); });
    const r = await sincronizarPromocao(d, msg, opts);
    expect(r).toEqual({ resultado: 'continua', processados: 2 });
    expect(d.continuar).toHaveBeenCalledWith('MLB2');
    expect(d.concluir).not.toHaveBeenCalled();
  });

  it('retoma depois do último id processado', async () => {
    const d = depsLeitura();
    await sincronizarPromocao(d, { ...msg, cursor: 'MLB2' }, opts);
    expect(d.gravarLote.mock.calls.map((c) => c[0].map((l: { ml_item_id: string }) => l.ml_item_id))).toEqual([['MLB3']]);
  });

  it('item novo antes do cursor não desloca a retomada', async () => {
    const d = depsLeitura({ listarItens: vi.fn(async () => ['MLB0', 'MLB1', 'MLB2', 'MLB3'].map((id) => item({ ml_item_id: id }))) });
    await sincronizarPromocao(d, { ...msg, cursor: 'MLB2' }, opts);
    expect(d.gravarLote.mock.calls.map((c) => c[0].map((l: { ml_item_id: string }) => l.ml_item_id))).toEqual([['MLB3']]);
  });

  it('mensagem de rodada velha não faz nada', async () => {
    const d = depsLeitura({ rodadaEmCurso: vi.fn(async () => '2026-10-06T18:00:00+00:00') });
    expect((await sincronizarPromocao(d, msg, opts)).resultado).toBe('obsoleta');
    expect(d.listarItens).not.toHaveBeenCalled();
  });

  it('posse perdida no meio: para sem gravar, sem continuar e sem concluir', async () => {
    const d = depsLeitura();
    d.rodadaEmCurso
      .mockResolvedValueOnce('2026-10-06T12:00:00+00:00')   // entrada
      .mockResolvedValueOnce('2026-10-06T12:00:00+00:00')   // antes do 1º lote
      .mockResolvedValueOnce('2026-10-06T12:00:00+00:00')   // antes de gravar o 1º lote
      .mockResolvedValue('2026-10-06T12:40:00+00:00');      // rodada nova reservou
    const r = await sincronizarPromocao(d, msg, opts);
    expect(r).toEqual({ resultado: 'obsoleta', processados: 2 });
    expect(d.gravarLote).toHaveBeenCalledTimes(1);
    expect(d.continuar).not.toHaveBeenCalled();
    expect(d.concluir).not.toHaveBeenCalled();
  });

  it('posse perdida durante a projeção: não grava o lote', async () => {
    const d = depsLeitura();
    d.rodadaEmCurso
      .mockResolvedValueOnce('2026-10-06T12:00:00+00:00')   // entrada
      .mockResolvedValueOnce('2026-10-06T12:00:00+00:00')   // antes do 1º lote
      .mockResolvedValue('2026-10-06T12:40:00+00:00');      // perdeu enquanto projetava
    expect(await sincronizarPromocao(d, msg, opts)).toEqual({ resultado: 'obsoleta', processados: 0 });
    expect(d.gravarLote).not.toHaveBeenCalled();
  });

  it('conclusão sem posse vira obsoleta', async () => {
    const d = depsLeitura({ concluir: vi.fn(async () => false) });
    expect((await sincronizarPromocao(d, msg, opts)).resultado).toBe('obsoleta');
  });

  it('erro marca a promoção e libera a reserva', async () => {
    const d = depsLeitura({ listarItens: vi.fn(async () => { throw new Error('ML 500 em /x'); }) });
    expect((await sincronizarPromocao(d, msg, opts)).resultado).toBe('erro');
    expect(d.falhar).toHaveBeenCalledWith('ML 500 em /x');
  });

  it('alíquota desconfirmada no meio: falha LOUD', async () => {
    const d = depsLeitura({ lerAliquotas: vi.fn(async () => null) });
    expect((await sincronizarPromocao(d, msg, opts)).resultado).toBe('erro');
    expect(d.falhar).toHaveBeenCalledWith(MSG_ALIQUOTA);
  });
});
