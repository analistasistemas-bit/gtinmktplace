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
  categoria: 'MLB123', sku: null, gtin: null, unidades: null, formato_kit: false, variacoes: [],
  catalogo: false, relacionados: [], ...o,
});

describe('projetarItem', () => {
  describe('kit (incidente MLB7665740658)', () => {
    const cad = montarCadastro([
      linhaVar({ id: 'base', codigo: '00000010', gtin: '7891010027858', custo: 29.9, preco: 39.99, peso_gramas: 800,
        altura_cm: 22, largura_cm: 10, comprimento_cm: 7, familias: { ml_item_id: 'MLBBASE', origem: 'nacional' } }),
      linhaVar({ id: 'kit', codigo: '00000012', custo: 59.8, preco: 111.8, peso_gramas: 1600,
        altura_cm: 44, largura_cm: 10, comprimento_cm: 7, familias: { ml_item_id: 'MLBKIT', origem: 'nacional', kit_multiplicador: 2 } }),
    ], []);
    const it_ = item({ ml_item_id: 'MLB7665740658', preco_sugerido: 106.21, preco_min: 22.36, preco_max: 106.21 });
    const ml = (unidades: number | null) => itemMl({ id: 'MLB7665740658', sku: '00000012', gtin: '7891010027858', unidades });

    it('custo e medidas do pacote; nunca verde; não sugere descer abaixo do piso do kit', async () => {
      const dims: unknown[] = [];
      const l = await projetarItem(it_, ml(2), cad, aliq, async (q) => { dims.push(q.dim); return tarifa10; });
      expect(l.projecao[0]).toMatchObject({ custo: 59.8, piso: 111.8, semaforo: 'amarelo', ate_quanto: null, ate_quanto_motivo: 'nenhum' });
      expect(dims.every((d) => JSON.stringify(d) === JSON.stringify({ altura_cm: 44, largura_cm: 10, comprimento_cm: 7, peso_gramas: 1600 }))).toBe(true);
    });

    it('ML diz 3 unidades, cadastro diz kit de 2 → ⚪ sem líquido nem sugestão', async () => {
      const tarifa = vi.fn(async () => tarifa10);
      const l = await projetarItem(it_, ml(3), cad, aliq, tarifa);
      expect(l.projecao[0]).toMatchObject({ semaforo: 'indisponivel', motivo: 'kit_divergente', liquido: null, ate_quanto: null });
      expect(l.pior_semaforo).toBe('indisponivel');
      expect(tarifa).not.toHaveBeenCalled();
    });

    it('uma cor de kit ⚪ trava o anúncio em ⚪ mesmo com outra cor verde', async () => {
      const cad2 = montarCadastro([linhaVar({ id: 'a', ml_variation_id: '1', custo: 10, preco: 20 }),
        linhaVar({ id: 'k', ml_variation_id: '2', custo: 20, preco: 40, familias: { ml_item_id: 'MLB1', origem: 'nacional', kit_multiplicador: 2 } })], []);
      const l = await projetarItem(item(), itemMl({ variacoes: [
        { variation_id: 1, cor: 'Azul', sku: null, gtin: null },
        { variation_id: 2, cor: 'Rosa', sku: null, gtin: null, unidades: 3 },
      ] }), cad2, aliq, async () => tarifa10);
      expect(l.projecao.map((p) => p.semaforo)).toEqual(['verde', 'indisponivel']);
      expect(l.pior_semaforo).toBe('indisponivel');
    });
  });

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
    removerItens: vi.fn(async () => {}),
    continuar: vi.fn(async () => {}),
    concluir: vi.fn(async () => true),
    falhar: vi.fn(async () => {}),
    ...o,
  } as unknown as FakeLeitura;
}
const msg: MsgLeitura = { etapa: 'promocao', org_id: 'org', promocao_id: 'P', tipo: 'DEAL', rodada: ctx.rodada, cursor: null };
const opts = { limiteMs: 90_000, lote: 2, concorrencia: 4, maxItens: 1000 };

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

  // LGH-MLB1000 (Avil, 04/10/2026): o ML lista o anúncio 2× (oferta genérica com stock + oferta por horário);
  // o upsert por (org, promoção, item) recusava o lote inteiro ("cannot affect row a second time").
  it('anúncio repetido (Relâmpago): grava uma linha, a de menor preço, herdando o estoque', async () => {
    const d = depsLeitura({
      listarItens: vi.fn(async () => [
        item({ ml_item_id: 'MLB7', preco_promo: 27.54, estoque_min: 5, estoque_max: 84 }),
        item({ ml_item_id: 'MLB7', preco_promo: 24.64 }),
      ]),
    });
    expect(await sincronizarPromocao(d, msg, opts)).toEqual({ resultado: 'concluida', processados: 1 });
    const [linha] = d.gravarLote.mock.calls[0][0];
    expect(d.gravarLote.mock.calls[0][0]).toHaveLength(1);
    expect(linha).toMatchObject({ ml_item_id: 'MLB7', preco_promo: 24.64, estoque_min: 5, estoque_max: 84 });
  });

  it('anúncio repetido: a oferta em que já participa ganha da candidata mais barata', async () => {
    const d = depsLeitura({
      listarItens: vi.fn(async () => [
        item({ ml_item_id: 'MLB7', status: 'candidate', preco_promo: 20 }),
        item({ ml_item_id: 'MLB7', status: 'started', preco_promo: 25 }),
      ]),
    });
    await sincronizarPromocao(d, msg, opts);
    expect(d.gravarLote.mock.calls[0][0]).toEqual([expect.objectContaining({ status: 'started', preco_promo: 25 })]);
  });

  // ADR-0174, emenda 2026-10-05 — Hairfly: normal MLB5322348511 ↔ catálogo MLB7736509406 (mesmo User Product).
  describe('par normal/catálogo', () => {
    const N = 'MLB5', C = 'MLB7';
    const mlPar = (o: Record<string, Partial<ItemML>> = {}) => new Map<string, ItemML>([
      [N, itemMl({ id: N, titulo: 'Nutritiva Tanox', thumbnail: 'https://n.jpg', permalink: 'https://n', relacionados: [C], ...o[N] })],
      [C, itemMl({ id: C, titulo: 'Reconstrutora Hair Fly', thumbnail: 'https://c.jpg', permalink: 'https://c', catalogo: true, relacionados: [N], ...o[C] })],
    ]);
    const buscar = (m: Map<string, ItemML>) => vi.fn(async (ids: string[]) => new Map(ids.filter((id) => m.has(id)).map((id) => [id, m.get(id)!])));
    const gravados = (d: FakeLeitura) => d.gravarLote.mock.calls.flatMap((c) => c[0]);

    it('grava só a linha do catálogo, com a cara do normal, mesmo com o par em lotes diferentes', async () => {
      const ids = [N, 'MLB6', C];
      const d = depsLeitura({ listarItens: vi.fn(async () => ids.map((id) => item({ ml_item_id: id }))), buscarItensML: buscar(new Map([...mlPar(), ['MLB6', itemMl({ id: 'MLB6' })]])) });
      expect(await sincronizarPromocao(d, msg, opts)).toEqual({ resultado: 'concluida', processados: 3 });
      expect(gravados(d).map((l) => l.ml_item_id)).toEqual(['MLB6', C]);
      expect(gravados(d).find((l) => l.ml_item_id === C)).toMatchObject({
        anuncio_normal_id: N, titulo: 'Nutritiva Tanox', thumbnail: 'https://n.jpg', permalink: 'https://n',
      });
      expect(gravados(d).find((l) => l.ml_item_id === 'MLB6')).toMatchObject({ anuncio_normal_id: null });
    });

    it('retomada depois do cursor: o normal já processado ainda conta para o par', async () => {
      const d = depsLeitura({ listarItens: vi.fn(async () => [item({ ml_item_id: N }), item({ ml_item_id: C })]), buscarItensML: buscar(mlPar()) });
      await sincronizarPromocao(d, { ...msg, cursor: N }, opts);
      expect(gravados(d)).toEqual([expect.objectContaining({ ml_item_id: C, anuncio_normal_id: N })]);
    });

    it('normal já participando: as duas linhas ficam, cada uma com a própria cara', async () => {
      const d = depsLeitura({ listarItens: vi.fn(async () => [item({ ml_item_id: N, status: 'started' }), item({ ml_item_id: C })]), buscarItensML: buscar(mlPar()) });
      await sincronizarPromocao(d, msg, opts);
      expect(gravados(d).map((l) => [l.ml_item_id, l.anuncio_normal_id, l.titulo])).toEqual([[N, null, 'Nutritiva Tanox'], [C, null, 'Reconstrutora Hair Fly']]);
    });

    it('sem par 1↔1 (relacionado fora da campanha, ausente do multiget ou relação múltipla): nada muda', async () => {
      const fora = depsLeitura({ listarItens: vi.fn(async () => [item({ ml_item_id: C })]), buscarItensML: buscar(mlPar()) });
      await sincronizarPromocao(fora, msg, opts);
      expect(gravados(fora)).toEqual([expect.objectContaining({ ml_item_id: C, anuncio_normal_id: null, titulo: 'Reconstrutora Hair Fly' })]);

      const semN = new Map([[C, mlPar().get(C)!]]);
      const ausente = depsLeitura({ listarItens: vi.fn(async () => [item({ ml_item_id: N }), item({ ml_item_id: C })]), buscarItensML: buscar(semN) });
      await sincronizarPromocao(ausente, msg, opts);
      expect(gravados(ausente).map((l) => [l.ml_item_id, l.anuncio_normal_id])).toEqual([[N, null], [C, null]]);

      const multipla = depsLeitura({ listarItens: vi.fn(async () => [item({ ml_item_id: N }), item({ ml_item_id: C })]), buscarItensML: buscar(mlPar({ [C]: { relacionados: [N, 'MLB9'] } })) });
      await sincronizarPromocao(multipla, msg, opts);
      expect(gravados(multipla).map((l) => [l.ml_item_id, l.anuncio_normal_id])).toEqual([[N, null], [C, null]]);

      // Codex #1: relação de um lado só não esconde o normal nem dá a cara dele ao catálogo.
      const unilateral = depsLeitura({ listarItens: vi.fn(async () => [item({ ml_item_id: N }), item({ ml_item_id: C })]), buscarItensML: buscar(mlPar({ [C]: { relacionados: [] } })) });
      await sincronizarPromocao(unilateral, msg, opts);
      expect(gravados(unilateral).map((l) => [l.ml_item_id, l.anuncio_normal_id])).toEqual([[N, null], [C, null]]);
    });

    // Codex #2: tentativa anterior da mesma rodada gravou o normal (sincronizado_em = rodada, o concluir não apaga).
    it('normal escondido é removido explicitamente da Central', async () => {
      const d = depsLeitura({ listarItens: vi.fn(async () => [item({ ml_item_id: N }), item({ ml_item_id: C })]), buscarItensML: buscar(mlPar()) });
      await sincronizarPromocao(d, msg, opts);
      expect(d.removerItens).toHaveBeenCalledWith([N]);
    });

    // Grok #1: no lote do normal o ML não devolveu o catálogo (code ≠ 200) → o normal foi gravado solto;
    // quando o par fecha no lote do catálogo, o normal (já atrás do cursor) também sai da Central.
    it('par fechado só no lote do catálogo: apaga o normal gravado antes', async () => {
      const m = mlPar();
      let chamadas = 0;
      const buscarItensML = vi.fn(async (ids: string[]) => {
        chamadas++;
        return new Map(ids.filter((id) => m.has(id) && !(chamadas <= 2 && id === C)).map((id) => [id, m.get(id)!]));
      });
      const d = depsLeitura({ listarItens: vi.fn(async () => [N, 'MLB6', C].map((id) => item({ ml_item_id: id }))), buscarItensML });
      await sincronizarPromocao(d, msg, opts);
      expect(gravados(d).find((l) => l.ml_item_id === C)).toMatchObject({ anuncio_normal_id: N });
      expect(d.removerItens).toHaveBeenCalledWith([N]);
    });
  });

  it('orçamento esgotado: grava o que fez e continua do cursor', async () => {
    const d = depsLeitura();
    d.gravarLote.mockImplementation(async () => { d.avancar(100_000); });
    const r = await sincronizarPromocao(d, msg, opts);
    expect(r).toEqual({ resultado: 'continua', processados: 2 });
    expect(d.continuar).toHaveBeenCalledWith('MLB2');
    expect(d.concluir).not.toHaveBeenCalled();
  });

  // 11.11 da Black (Avil, 04/10/2026): 220 anúncios em ~89 s de relógio estouraram os 2 s de CPU (546).
  // O relógio não protege a CPU (ADR-0173 §4): o teto por mensagem é por contagem.
  it('teto por contagem: para em maxItens e continua do cursor mesmo com o relógio parado', async () => {
    const d = depsLeitura();
    const r = await sincronizarPromocao(d, msg, { ...opts, maxItens: 2 });
    expect(r).toEqual({ resultado: 'continua', processados: 2 });
    expect(d.continuar).toHaveBeenCalledWith('MLB2');
    expect(d.concluir).not.toHaveBeenCalled();
  });

  it('teto que não é múltiplo do lote corta o lote no teto', async () => {
    const d = depsLeitura();
    const r = await sincronizarPromocao(d, msg, { ...opts, maxItens: 1 });
    expect(r).toEqual({ resultado: 'continua', processados: 1 });
    expect(d.continuar).toHaveBeenCalledWith('MLB1');
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
