import { describe, expect, it, vi } from 'vitest';
import { MAX_MLBS, montarPreview, type AlvoExpandido, type DepsPreview, type PedidoPreview } from '../preview.ts';
import { resumir } from '../avaliacao.ts';
import { SemAcessoStatusML } from '../../ml-status.ts';
import type { CorAvaliada, EntradaRestauracao, EstadoVariacao, Semaforo, VivoItem } from '../tipos.ts';

const alvo = (ml: string, o: Partial<AlvoExpandido> = {}): AlvoExpandido => ({
  ml_item_id: ml, codigo_pai: `P-${ml}`, variacao_ids: [], variacoes_ml_esperadas: null, sku: `SKU-${ml}`, titulo: `T ${ml}`,
  ehKit: false, temAtacado: false, promocaoBanco: false, familiaPublicando: false, migracaoPxv: false, ...o,
});
const vivo = (o: Partial<VivoItem> = {}): VivoItem => ({
  preco: 100, variacoes: null, status: 'active', sub_status: [], catalog_listing: false, tem_relacoes: false, ...o,
});
const cor = (s: Semaforo): CorAvaliada => ({
  variation_id: null, sku: null, custo: 10, piso: 20, origem: 'nacional', aliquota_pct: 8, comissao_pct: 16, comissao_fixa: 0,
  frete: 10, liquido: 50, semaforo: s, motivo: null,
});
const est = (preco: number | null, editado: boolean): EstadoVariacao => ({ preco_publicacao: preco, preco_editado_pelo_operador: editado });

function deps(o: {
  alvos?: AlvoExpandido[]; vivos?: Record<string, VivoItem | Error>; promoML?: boolean | null; semaforo?: Semaforo[];
  estados?: Record<string, EstadoVariacao>; origem?: Awaited<ReturnType<DepsPreview['origem']>>;
} = {}): DepsPreview {
  return {
    expandir: vi.fn(async () => o.alvos ?? [alvo('MLB1')]),
    // plano: a variação única `V-<ml>`; Legacy: `V-<ml_variation_id>`
    variacoesDoMlb: vi.fn(async (_p: string, ml: string, ids: string[]) =>
      ids.length ? ids.map((id) => ({ ml_variation_id: id, variacao_id: id === 'sem' ? null : `V-${id}` })) : [{ ml_variation_id: '', variacao_id: `V-${ml}` }]),
    estadoVariacoes: vi.fn(async (ids: string[]) => new Map(ids.filter((id) => !o.estados || id in o.estados)
      .map((id) => [id, o.estados?.[id] ?? est(100, false)]))),
    ml: {
      lerVivo: vi.fn(async (ml: string) => {
        const v = o.vivos?.[ml] ?? vivo();
        if (v instanceof Error) throw v;
        return v;
      }),
      putPreco: vi.fn(),
      participaPromocaoML: vi.fn(async () => (o.promoML === undefined ? false : o.promoML)),
    },
    avaliar: vi.fn(async () => resumir((o.semaforo ?? ['verde']).map(cor))),
    origem: vi.fn(async () => (o.origem === undefined ? null : o.origem)),
  };
}
const pct = (valor: number, sentido: '+' | '-' = '+'): PedidoPreview => ({ familias: [], ml_item_ids: ['MLB1'], ajuste: { tipo: 'pct', sentido, valor } });

async function um(p: PedidoPreview, d: DepsPreview) {
  const r = await montarPreview(p, d);
  if (!r.ok) throw new Error(r.erro);
  return { ...r.itens[0], executaveis: r.executaveis };
}

describe('montarPreview — pedido', () => {
  it(`> ${MAX_MLBS} MLBs (após dedup) → recusa sem ler o ML`, async () => {
    const alvos = Array.from({ length: 501 }, (_, i) => alvo(`MLB${i}`));
    const d = deps({ alvos: [...alvos, alvo('MLB0')] });
    expect(await montarPreview(pct(10), d)).toEqual({ ok: false, erro: 'No máximo 500 anúncios por operação (a seleção expandiu para 501).' });
    expect(d.ml.lerVivo).not.toHaveBeenCalled();
  });

  it('dedup por MLB soma as flags de bloqueio (OU)', async () => {
    const r = await montarPreview(pct(10), deps({ alvos: [alvo('MLB1'), alvo('MLB1', { promocaoBanco: true })] }));
    expect(r.ok && r.itens).toMatchObject([{ situacao: 'fora', motivo: 'Participando de promoção' }]);
  });

  it('dedup por MLB', async () => {
    const r = await montarPreview(pct(10), deps({ alvos: [alvo('MLB1'), alvo('MLB1')] }));
    expect(r.ok && r.itens.length).toBe(1);
  });

  it('mais de 2 casas no ajuste ou em precos → recusa', async () => {
    const erro = { ok: false, erro: 'Use no máximo 2 casas decimais' };
    expect(await montarPreview(pct(1.005), deps())).toEqual(erro);
    expect(await montarPreview({ ...pct(10), precos: { MLB1: 10.001 } }, deps())).toEqual(erro);
  });
});

describe('montarPreview — item', () => {
  it('elegível: alvo, restaurar das variações (ordem fixa), incluído, codigo_pai', async () => {
    const d = deps({ vivos: { MLB1: vivo({ preco: 100, variacoes: [{ id: '22', preco: 100 }, { id: '11', preco: 100 }] }) } });
    const it0 = await um(pct(10), d);
    expect(it0).toMatchObject({
      ml_item_id: 'MLB1', codigo_pai: 'P-MLB1', titulo: 'T MLB1', sku: 'SKU-MLB1', preco_anterior: 100, preco: 110,
      situacao: 'elegivel', motivo: null, incluido: true, aviso: null, variacoes_ml: ['22', '11'],
      variacao_ids: ['V-11', 'V-22'], executaveis: 1,
    });
    expect(it0.restaurar).toEqual([
      { variacao_id: 'V-11', esperado: est(100, false), novo: est(110, true) },
      { variacao_id: 'V-22', esperado: est(100, false), novo: est(110, true) },
    ]);
    expect(d.variacoesDoMlb).toHaveBeenCalledWith('P-MLB1', 'MLB1', ['22', '11']);
    expect(d.avaliar).toHaveBeenCalledWith('MLB1', 110);
  });

  it('plano/UP: variacoes_ml null, variação única do RPC', async () => {
    const it0 = await um(pct(10), deps());
    expect(it0).toMatchObject({ variacoes_ml: null, variacao_ids: ['V-MLB1'], situacao: 'elegivel' });
  });

  it('partição > 0: só as variações do próprio MLB', async () => {
    const d = deps({ vivos: { MLB1: vivo({ variacoes: [{ id: '33', preco: 100 }] }) } });
    const it0 = await um(pct(10), d);
    expect(d.variacoesDoMlb).toHaveBeenCalledWith('P-MLB1', 'MLB1', ['33']);
    expect(it0.variacao_ids).toEqual(['V-33']);
    expect(d.estadoVariacoes).toHaveBeenCalledWith(['V-33']);
  });

  const fora: [string, Parameters<typeof deps>[0], string][] = [
    ['inativo', { vivos: { MLB1: vivo({ status: 'closed' }) } }, 'Anúncio moderado, encerrado ou inativo'],
    ['kit', { alvos: [alvo('MLB1', { ehKit: true })] }, 'Kit Virtual não entra no reajuste'],
    ['catálogo', { vivos: { MLB1: vivo({ catalog_listing: true }) } }, 'Anúncio de catálogo (ou com par de catálogo) fica fora do reajuste'],
    ['atacado', { alvos: [alvo('MLB1', { temAtacado: true })] }, 'Anúncio com preço de atacado fica fora do reajuste'],
    ['promoção no banco, ML false', { alvos: [alvo('MLB1', { promocaoBanco: true })], promoML: false }, 'Participando de promoção'],
    ['promoção no ML', { promoML: true }, 'Participando de promoção'],
    ['promoção inconclusiva', { promoML: null }, 'Não foi possível conferir promoções — tente de novo'],
    ['família publicando', { alvos: [alvo('MLB1', { familiaPublicando: true })] }, 'Família em publicação/atualização'],
    ['migração PxV', { alvos: [alvo('MLB1', { migracaoPxv: true })] }, 'Migração para preço por variação em curso'],
    ['Legacy divergente', { vivos: { MLB1: vivo({ variacoes: [{ id: '1', preco: 100 }, { id: '2', preco: 90 }] }) } }, 'Variações com preços diferentes no ML'],
    ['variação sem casamento', { vivos: { MLB1: vivo({ variacoes: [{ id: '1', preco: 100 }, { id: 'sem', preco: 100 }] }) } }, 'Não foi possível casar todas as variações do anúncio com o cadastro'],
    ['variação sem estado no banco', { estados: {} }, 'Não foi possível casar todas as variações do anúncio com o cadastro'],
    ['leitura do ML falhou', { vivos: { MLB1: new Error('ML 500') } }, 'Não foi possível ler o anúncio — tente de novo'],
  ];
  it.each(fora)('fora: %s', async (_n, o, motivo) => {
    const d = deps(o);
    const it0 = await um(pct(10), d);
    expect(it0).toMatchObject({ situacao: 'fora', motivo, incluido: false, avaliacao: null, restaurar: null, codigo_pai: 'P-MLB1', executaveis: 0 });
    expect(d.avaliar).not.toHaveBeenCalled();
  });

  it('fora: preço resultante ≤ 0', async () => {
    expect(await um(pct(100, '-'), deps())).toMatchObject({ situacao: 'fora', motivo: 'Preço resultante inválido', preco_anterior: 100 });
  });

  it('fora: sem ajuste e sem preço editado', async () => {
    expect(await um({ familias: [], ml_item_ids: ['MLB1'], ajuste: null }, deps())).toMatchObject({ situacao: 'fora', motivo: 'Preço resultante inválido' });
  });

  it('401/403 do ML propaga (reconectar), não vira fora', async () => {
    await expect(montarPreview(pct(10), deps({ vivos: { MLB1: new SemAcessoStatusML('ML 401') } }))).rejects.toBeInstanceOf(SemAcessoStatusML);
  });

  it('sem alteração: lista à parte, sem avaliação', async () => {
    const d = deps();
    expect(await um(pct(0), d)).toMatchObject({ situacao: 'sem_alteracao', preco: 100, incluido: false, restaurar: null, executaveis: 0 });
    expect(d.avaliar).not.toHaveBeenCalled();
  });

  it('preço editado sobrescreve o ajuste', async () => {
    const d = deps();
    expect(await um({ ...pct(10), precos: { MLB1: 123.4 } }, d)).toMatchObject({ preco: 123.4, situacao: 'elegivel' });
    expect(d.avaliar).toHaveBeenCalledWith('MLB1', 123.4);
  });

  it.each([['vermelho'], ['indisponivel']] as [Semaforo][])('%s → elegível desmarcado', async (s) => {
    expect(await um(pct(10), deps({ semaforo: ['verde', s] }))).toMatchObject({ situacao: 'elegivel', incluido: false, executaveis: 1 });
  });

  it('amarelo → incluído com aviso 🟡', async () => {
    const it0 = await um(pct(10), deps({ semaforo: ['amarelo'] }));
    expect(it0.incluido).toBe(true);
    expect(it0.aviso).toContain('🟡');
  });
});

describe('montarPreview — Reverter', () => {
  // origem: 100 → 110; banco antes {100, false}, gravado {110, true}
  const restOrigem: EntradaRestauracao[] = [{ variacao_id: 'V-1', esperado: est(100, false), novo: est(110, true) }];
  const origem = new Map([['MLB1', { codigo_pai: 'P-MLB1', preco_anterior: 100, preco: 110, restaurar: restOrigem }]]);
  const v110 = (ids = ['1'], preco = 110) => vivo({ preco, variacoes: ids.map((id) => ({ id, preco })) });
  const rev: PedidoPreview = { familias: [], ml_item_ids: [], ajuste: { tipo: 'pct', sentido: '+', valor: 50 }, precos: { MLB1: 1.001 }, origem_id: 'op-1' };

  it('aplicado: alvo = preco_anterior, restaurar invertido, aviso D10; ignora ajuste/precos', async () => {
    const d = deps({ vivos: { MLB1: v110() }, estados: { 'V-1': est(110, true) }, origem });
    const it0 = await um(rev, d);
    expect(it0).toMatchObject({ situacao: 'elegivel', preco_anterior: 110, preco: 100, variacao_ids: ['V-1'], codigo_pai: 'P-MLB1', executaveis: 1 });
    expect(it0.restaurar).toEqual([{ variacao_id: 'V-1', esperado: est(110, true), novo: est(100, false) }]);
    expect(it0.aviso).toContain('re-ingest');
    expect(d.expandir).toHaveBeenCalledWith([], ['MLB1']);
    expect(d.variacoesDoMlb).toHaveBeenCalledWith('P-MLB1', 'MLB1', ['1']);
  });

  it('ML mudou depois → não revertível', async () => {
    const d = deps({ vivos: { MLB1: v110(['1'], 115) }, estados: { 'V-1': est(110, true) }, origem });
    expect(await um(rev, d)).toMatchObject({ situacao: 'fora', motivo: 'Não revertível: o preço mudou depois do reajuste' });
  });

  it('banco editado depois → não revertível', async () => {
    const d = deps({ vivos: { MLB1: v110() }, estados: { 'V-1': est(112, true) }, origem });
    expect(await um(rev, d)).toMatchObject({ situacao: 'fora', motivo: 'Não revertível: o preço foi editado depois do reajuste' });
  });

  it('item da origem fora do cadastro → fora, não some', async () => {
    const r = await montarPreview(rev, deps({ alvos: [], origem }));
    expect(r.ok && r.itens).toMatchObject([{ ml_item_id: 'MLB1', codigo_pai: 'P-MLB1', situacao: 'fora', motivo: 'Anúncio não encontrado no cadastro' }]);
  });

  it.each([
    ['C entrou no ML com o mesmo preço', v110(['1', '2'])],
    ['cor da origem saiu do ML', v110(['2'])],
    ['cor sem casamento', v110(['1', 'sem'])],
  ])('variações mudaram: %s → não revertível', async (_n, v) => {
    const d = deps({ vivos: { MLB1: v }, estados: { 'V-1': est(110, true), 'V-2': est(110, true) }, origem });
    expect(await um(rev, d)).toMatchObject({ situacao: 'fora', motivo: 'Não revertível: as variações do anúncio mudaram depois do reajuste', restaurar: null });
  });

  it('origem inexistente → recusa', async () => {
    expect(await montarPreview(rev, deps())).toEqual({ ok: false, erro: 'Operação de origem não encontrada' });
  });
});
