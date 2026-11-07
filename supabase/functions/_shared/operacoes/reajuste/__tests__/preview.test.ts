import { describe, expect, it, vi } from 'vitest';
import type { ConfigMlb } from '../faixas.ts';
import { oferta } from '../ofertas.ts';
import { planejarPassos } from '../passos.ts';
import { MAX_MLBS, montarPreview, type AlvoExpandido, type DepsPreview, type PedidoPreview } from '../preview.ts';
import { resumir } from '../avaliacao.ts';
import { SemAcessoStatusML } from '../../ml-status.ts';
import type { CorAvaliada, EntradaRestauracao, EstadoVariacao, FaixaPreco, OfertaVigente, Passo, Semaforo, VivoItem } from '../tipos.ts';

vi.mock('../passos.ts', async (original) => {
  const m = await original<typeof import('../passos.ts')>();
  return { ...m, planejarPassos: vi.fn(m.planejarPassos) };
});

const alvo = (ml: string, o: Partial<AlvoExpandido> = {}): AlvoExpandido => ({
  ml_item_id: ml, codigo_pai: `P-${ml}`, variacao_ids: [], variacoes_ml_esperadas: null, sku: `SKU-${ml}`, titulo: `T ${ml}`,
  ehKit: false, familiaPublicando: false, migracaoPxv: false, ...o,
});
const vivo = (o: Partial<VivoItem> = {}): VivoItem => ({
  preco: 100, variacoes: null, status: 'active', sub_status: [], catalog_listing: false, tem_relacoes: false, ...o,
});
const cor = (s: Semaforo): CorAvaliada => ({
  variation_id: null, sku: null, custo: 10, piso: 20, origem: 'nacional', aliquota_pct: 8, comissao_pct: 16, comissao_fixa: 0,
  frete: 10, liquido: 50, semaforo: s, motivo: null,
});
const of = (id: string, preco: number | null, o: Partial<OfertaVigente> = {}) =>
  ({ ...oferta({ promocao_id: id, tipo: 'DEAL', status: 'started', preco, offer_id: null, inicio: null, fim: null }), ...o });
const est = (preco: number | null, editado: boolean): EstadoVariacao => ({ preco_publicacao: preco, preco_editado_pelo_operador: editado });

function deps(o: {
  alvos?: AlvoExpandido[]; vivos?: Record<string, VivoItem | Error>; ofertasML?: OfertaVigente[] | null; banco?: OfertaVigente[]; semBanco?: boolean; semaforo?: Semaforo[];
  estados?: Record<string, EstadoVariacao>; origem?: Awaited<ReturnType<DepsPreview['origem']>>;
  faixas?: FaixaPreco[] | null | Error; config?: ConfigMlb;
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
      lerOfertas: vi.fn(async () => (o.ofertasML === undefined ? [] : o.ofertasML)),
      lerFaixas: vi.fn(async () => {
        if (o.faixas instanceof Error) throw o.faixas;
        return o.faixas === undefined ? [] : o.faixas;
      }),
      gravarFaixas: vi.fn(),
    },
    configAtacado: vi.fn(async () => o.config ?? { faixas: null, divergente: false }),
    ofertasBanco: vi.fn(async (ids: string[]) => new Map(o.semBanco ? [] : ids.map((id): [string, OfertaVigente[]] => [id, o.banco ?? []]))),
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
    const r = await montarPreview(pct(10), deps({ alvos: [alvo('MLB1'), alvo('MLB1', { migracaoPxv: true })] }));
    expect(r.ok && r.itens).toMatchObject([{ situacao: 'fora', motivo: 'Migração para preço por variação em curso' }]);
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
    ['promoção inconclusiva', { ofertasML: null }, 'Não foi possível conferir promoções — tente de novo'],
    ['banco sem o MLB pedido', { semBanco: true }, 'Não foi possível conferir promoções — tente de novo'],
    ['oferta sem preço comprovado', { banco: [of('P', null)] }, 'Não foi possível conferir promoções — tente de novo'],
    ['Relâmpago em andamento', { ofertasML: [of('L', 50, { tipo: 'LIGHTNING' })] }, 'Relâmpago em andamento fica fora do reajuste'],
    ['alvo abaixo da oferta do ML', { ofertasML: [of('P', 120)] }, 'Preço igual ou abaixo da oferta de R$ 120,00 — ajuste a oferta antes'],
    ['alvo igual à oferta só do banco', { banco: [of('P', 110)] }, 'Preço igual ou abaixo da oferta de R$ 110,00 — ajuste a oferta antes'],
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

describe('montarPreview — ofertas', () => {
  it('oferta abaixo do alvo: elegível, com as ofertas e o passo do base', async () => {
    const it0 = await um(pct(10), deps({ ofertasML: [of('P', 80)] }));
    expect(it0).toMatchObject({ situacao: 'elegivel', motivo: null, ofertas: [{ promocao_id: 'P', preco: 80 }] });
    expect(it0.passos).toEqual([{ tipo: 'base', anterior: 100, alvo: 110, estado: 'pendente' }]);
  });

  it('sem oferta: passo do base, ofertas vazias', async () => {
    expect(await um(pct(10, '-'), deps())).toMatchObject({ situacao: 'elegivel', ofertas: [], passos: [{ tipo: 'base', anterior: 100, alvo: 90 }] });
  });

  it('une as fontes e consulta o banco uma vez só', async () => {
    const d = deps({ alvos: [alvo('MLB1'), alvo('MLB2')], ofertasML: [of('P', 80)], banco: [of('Q', 90)] });
    const r = await montarPreview({ ...pct(10), ml_item_ids: ['MLB1', 'MLB2'] }, d);
    expect(r.ok && r.itens.map((i) => i.ofertas?.map((o) => o.promocao_id))).toEqual([['P', 'Q'], ['P', 'Q']]);
    expect(d.ofertasBanco).toHaveBeenCalledTimes(1);
    expect(d.ofertasBanco).toHaveBeenCalledWith(['MLB1', 'MLB2']);
  });

  it.each([
    ['LIGHTNING', 'ML pending, banco started', 'pending', 'started'],
    ['LIGHTNING', 'ML started, banco pending', 'started', 'pending'],
    ['SMART_LIGHTNING', 'ML pending, banco started', 'pending', 'started'],
    ['SMART_LIGHTNING', 'ML started, banco pending', 'started', 'pending'],
  ] as const)('%s com a mesma chave, %s → fora', async (tipo, _n, doML, doBanco) => {
    const r = (status: OfertaVigente['status']) => of('L', 39.9, { tipo, status, chave: 'OFFER-1', offer_id: 'OFFER-1' });
    const d = deps({ ofertasML: [r(doML)], banco: [r(doBanco)] });
    expect(await um(pct(10), d)).toMatchObject({ situacao: 'fora', motivo: 'Relâmpago em andamento fica fora do reajuste', passos: null });
  });

  it('sem alteração não trava nem planeja', async () => {
    expect(await um(pct(0), deps({ ofertasML: [of('P', 120)] }))).toMatchObject({ situacao: 'sem_alteracao', passos: null });
  });

  it('trava devolve fora com passos nulos', async () => {
    expect(await um(pct(10), deps({ ofertasML: [of('P', 120)] }))).toMatchObject({ situacao: 'fora', passos: null, restaurar: null, incluido: false });
  });

  it('planejarPassos lança → fora com a mensagem, sem derrubar o preview', async () => {
    vi.mocked(planejarPassos).mockImplementationOnce(() => { throw new Error('base 110 igual ou abaixo da oferta'); });
    const d = deps();
    expect(await um(pct(10), d)).toMatchObject({ situacao: 'fora', motivo: 'base 110 igual ou abaixo da oferta', passos: null, executaveis: 0 });
    expect(d.avaliar).not.toHaveBeenCalled();
  });
});

describe('montarPreview — Reverter', () => {
  // origem: 100 → 110; banco antes {100, false}, gravado {110, true}
  const restOrigem: EntradaRestauracao[] = [{ variacao_id: 'V-1', esperado: est(100, false), novo: est(110, true) }];
  const origem = new Map([['MLB1', { codigo_pai: 'P-MLB1', preco_anterior: 100, preco: 110, restaurar: restOrigem, passos: [] }]]);
  const v110 = (ids = ['1'], preco = 110) => vivo({ preco, variacoes: ids.map((id) => ({ id, preco })) });
  const rev: PedidoPreview = { familias: [], ml_item_ids: [], ajuste: { tipo: 'pct', sentido: '+', valor: 50 }, precos: { MLB1: 1.001 }, origem_id: 'op-1' };

  it('aplicado: alvo = preco_anterior, restaurar invertido, aviso D10; ignora ajuste/precos', async () => {
    const d = deps({ vivos: { MLB1: v110() }, estados: { 'V-1': est(110, true) }, origem });
    const it0 = await um(rev, d);
    expect(it0).toMatchObject({ situacao: 'elegivel', preco_anterior: 110, preco: 100, variacao_ids: ['V-1'], codigo_pai: 'P-MLB1', executaveis: 1 });
    expect(it0.restaurar).toEqual([{ variacao_id: 'V-1', esperado: est(110, true), novo: est(100, false) }]);
    expect(it0.aviso).toContain('re-ingest');
    expect(it0.passos).toEqual([{ tipo: 'base', anterior: 110, alvo: 100, estado: 'pendente' }]);
    expect(d.expandir).toHaveBeenCalledWith([], ['MLB1']);
    expect(d.variacoesDoMlb).toHaveBeenCalledWith('P-MLB1', 'MLB1', ['1']);
  });

  it('ML mudou depois → não revertível', async () => {
    const d = deps({ vivos: { MLB1: v110(['1'], 115) }, estados: { 'V-1': est(110, true) }, origem });
    expect(await um(rev, d)).toMatchObject({ situacao: 'fora', motivo: 'Não revertível: o preço mudou depois do reajuste' });
  });

  it('alvo igual ou abaixo de uma oferta → fora', async () => {
    const d = deps({ vivos: { MLB1: v110() }, estados: { 'V-1': est(110, true) }, origem, ofertasML: [of('P', 100)] });
    expect(await um(rev, d)).toMatchObject({ situacao: 'fora', motivo: 'Preço igual ou abaixo da oferta de R$ 100,00 — ajuste a oferta antes', passos: null });
  });

  it('banco editado depois → não revertível', async () => {
    const d = deps({ vivos: { MLB1: v110() }, estados: { 'V-1': est(112, true) }, origem });
    expect(await um(rev, d)).toMatchObject({ situacao: 'fora', motivo: 'Não revertível: o preço foi editado depois do reajuste' });
  });

  it('item da origem fora do cadastro → fora, não some', async () => {
    const r = await montarPreview(rev, deps({ alvos: [], origem }));
    expect(r.ok && r.itens).toMatchObject([{ ml_item_id: 'MLB1', codigo_pai: 'P-MLB1', situacao: 'fora', motivo: 'Anúncio não encontrado no cadastro', ofertas: null, passos: null }]);
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

describe('montarPreview — atacado (ADR-0196)', () => {
  const CINCO = [{ min_unidades: 2, desconto_pct: 5 }];
  const viva = (preco: number): FaixaPreco[] => [{ min_unidades: 2, preco }];
  const tipos = (i: { passos: { tipo: string }[] | null }) => i.passos?.map((p) => p.tipo);

  it('anúncio com atacado deixa de ficar fora; descendo, grava as faixas antes do base', async () => {
    const d = deps({ faixas: viva(95), config: { faixas: CINCO, divergente: false } });
    const i = await um(pct(10, '-'), d);
    expect(i).toMatchObject({
      situacao: 'elegivel', preco: 90, faixas_anteriores: viva(95), faixas_alvo: [{ min_unidades: 2, preco: 85.5 }],
    });
    expect(tipos(i)).toEqual(['faixas', 'base']);
    expect(d.configAtacado).toHaveBeenCalledWith(['V-MLB1']);
  });

  it('subindo, grava as faixas depois do base', async () => {
    const i = await um(pct(10), deps({ faixas: viva(95), config: { faixas: CINCO, divergente: false } }));
    expect(i.faixas_alvo).toEqual([{ min_unidades: 2, preco: 104.5 }]);
    expect(tipos(i)).toEqual(['base', 'faixas']);
  });

  it('sem configuração e abaixo do alvo: mantém as faixas, sem passo', async () => {
    const i = await um(pct(10), deps({ faixas: viva(95) }));
    expect(i).toMatchObject({ situacao: 'elegivel', faixas_anteriores: viva(95), faixas_alvo: null });
    expect(tipos(i)).toEqual(['base']);
  });

  it('configuração sem faixa viva: não cria faixas', async () => {
    const i = await um(pct(10, '-'), deps({ config: { faixas: CINCO, divergente: false } }));
    expect(i).toMatchObject({ situacao: 'elegivel', faixas_anteriores: [], faixas_alvo: null });
    expect(tipos(i)).toEqual(['base']);
  });

  it('[] com faixa viva: não apaga as faixas', async () => {
    const i = await um(pct(10), deps({ faixas: viva(95), config: { faixas: [], divergente: false } }));
    expect(i).toMatchObject({ situacao: 'elegivel', faixas_anteriores: viva(95), faixas_alvo: null });
    expect(tipos(i)).toEqual(['base']);
  });

  it('sem atacado: faixas vazias, sem passo', async () => {
    expect(await um(pct(10), deps())).toMatchObject({ situacao: 'elegivel', faixas_anteriores: [], faixas_alvo: null });
  });

  it.each<[string, Parameters<typeof deps>[0], string]>([
    ['leitura inconclusiva', { faixas: null }, 'Não foi possível ler o atacado — tente de novo'],
    ['faixa viva cruzando, sem configuração', { faixas: viva(95) }, 'Faixa de atacado ficaria acima do preço base'],
    ['configuração divergente', { config: { faixas: null, divergente: true } }, 'Atacado diferente entre cores — ajuste na Revisão'],
  ])('%s → fora', async (_n, o, motivo) => {
    expect(await um(pct(10, '-'), deps(o))).toMatchObject({ situacao: 'fora', motivo, passos: null, faixas_alvo: null, executaveis: 0 });
  });

  it('configuração com valor ilegível → fora, sem derrubar o lote', async () => {
    const config = { faixas: [{ min_unidades: 2, desconto_pct: NaN }], divergente: false };
    expect(await um(pct(10), deps({ config, faixas: viva(95) }))).toMatchObject({ situacao: 'fora', passos: null });
  });

  it('conta sem acesso ao ler o atacado sobe, não vira 500 linhas fora', async () => {
    await expect(montarPreview(pct(10), deps({ faixas: new SemAcessoStatusML('ML 403') }))).rejects.toBeInstanceOf(SemAcessoStatusML);
  });

  it('sem alteração não lê o atacado', async () => {
    const d = deps({ faixas: null });
    expect(await um(pct(0), d)).toMatchObject({ situacao: 'sem_alteracao' });
    expect(d.ml.lerFaixas).not.toHaveBeenCalled();
  });

  describe('trava financeira de cada preço', () => {
    // Avaliador por preço: a faixa de 85,50 dá `s`, os demais dão verde.
    const comFaixa = (s: Semaforo) => {
      const d = deps({ faixas: viva(95), config: { faixas: CINCO, divergente: false } });
      d.avaliar = vi.fn(async (_ml: string, preco: number) => resumir([cor(preco === 85.5 ? s : 'verde')]));
      return d;
    };

    it('base verde com faixa em prejuízo: item desmarcado, exige confirmação, aviso por unidade', async () => {
      const d = comFaixa('vermelho');
      const i = await um(pct(10, '-'), d);
      expect(i).toMatchObject({ situacao: 'elegivel', incluido: false, avaliacao: { pior: 'vermelho', tem_vermelho: true, tem_sem_dado: false } });
      expect(i.aviso).toContain('lucro por unidade');
      expect(i.precos_avaliados?.map((p) => [p.tipo, p.chave, p.preco, p.avaliacao.pior])).toEqual([
        ['faixa', '2', 85.5, 'vermelho'], ['base', 'base', 90, 'verde'],
      ]);
      expect(d.avaliar).toHaveBeenCalledWith('MLB1', 85.5);
      expect(d.avaliar).toHaveBeenCalledWith('MLB1', 90);
    });

    it('faixa sem dado (origem ausente): desmarcado, exige a confirmação ⚪', async () => {
      expect(await um(pct(10, '-'), comFaixa('indisponivel'))).toMatchObject({ incluido: false, avaliacao: { tem_vermelho: false, tem_sem_dado: true } });
    });

    it('faixa abaixo do piso: agregado amarelo, segue incluído com o aviso', async () => {
      const i = await um(pct(10, '-'), comFaixa('amarelo'));
      expect(i).toMatchObject({ incluido: true, avaliacao: { pior: 'amarelo' } });
      expect(i.aviso).toContain('🟡');
      expect(i.aviso).toContain('lucro por unidade');
    });

    it('todos verdes: incluído, sem aviso', async () => {
      expect(await um(pct(10, '-'), comFaixa('verde'))).toMatchObject({ incluido: true, aviso: null, avaliacao: { pior: 'verde' } });
    });

    it('faixa que não muda não é avaliada: nada é escrito nela', async () => {
      const d = deps({ faixas: viva(95) });
      const i = await um(pct(10), d);
      expect(i.precos_avaliados?.map((p) => p.tipo)).toEqual(['base']);
      expect(d.avaliar).toHaveBeenCalledTimes(1);
    });

    it('só faixas em prejuízo: exige confirmação sem avaliar o base', async () => {
      const faixas: Passo = { tipo: 'faixas', anterior: viva(95), alvo: [{ min_unidades: 2, preco: 85.5 }], estado: 'pendente' };
      vi.mocked(planejarPassos).mockReturnValueOnce([faixas]);
      const d = comFaixa('vermelho');
      const i = await um(pct(10, '-'), d);
      expect(i).toMatchObject({ incluido: false, avaliacao: { tem_vermelho: true } });
      expect(d.avaliar).toHaveBeenCalledTimes(1);
      expect(d.avaliar).toHaveBeenCalledWith('MLB1', 85.5);
    });

    it('item fora ou sem alteração não tem preços avaliados', async () => {
      expect(await um(pct(0), deps())).toMatchObject({ situacao: 'sem_alteracao', precos_avaliados: null });
      expect(await um(pct(10, '-'), deps({ faixas: null }))).toMatchObject({ situacao: 'fora', precos_avaliados: null });
    });
  });

  describe('Reverter', () => {
    const restaurar: EntradaRestauracao[] = [{ variacao_id: 'V-MLB1', esperado: est(100, false), novo: est(110, true) }];
    const origem = new Map([['MLB1', { codigo_pai: 'P-MLB1', preco_anterior: 100, preco: 110, restaurar, passos: [] }]]);
    const voltar: PedidoPreview = { familias: [], ml_item_ids: [], ajuste: null, origem_id: 'o' };
    const base = { origem, vivos: { MLB1: vivo({ preco: 110 }) }, estados: { 'V-MLB1': est(110, true) } };

    it('nunca gera passo de faixas, mesmo com configuração', async () => {
      const d = deps({ ...base, faixas: viva(95), config: { faixas: CINCO, divergente: false } });
      const i = await um(voltar, d);
      expect(i).toMatchObject({ situacao: 'elegivel', preco: 100, faixas_alvo: null });
      expect(tipos(i)).toEqual(['base']);
      expect(d.configAtacado).not.toHaveBeenCalled();
    });

    it('avalia o base restaurado e desmarca se der prejuízo', async () => {
      const d = deps({ ...base, faixas: viva(95), semaforo: ['vermelho'] });
      const i = await um(voltar, d);
      expect(i).toMatchObject({ incluido: false, avaliacao: { tem_vermelho: true } });
      expect(i.precos_avaliados?.map((p) => [p.tipo, p.preco])).toEqual([['base', 100]]);
      expect(d.avaliar).toHaveBeenCalledTimes(1);
    });

    it('faixa viva que ficaria acima do base restaurado → fora', async () => {
      expect(await um(voltar, deps({ ...base, faixas: viva(105) })))
        .toMatchObject({ situacao: 'fora', motivo: 'Faixa de atacado ficaria acima do preço base' });
    });

    it('oferta nova acima do alvo antigo → fora', async () => {
      expect(await um(voltar, deps({ ...base, faixas: viva(95), ofertasML: [of('P', 100)] })))
        .toMatchObject({ situacao: 'fora', motivo: expect.stringContaining('Preço igual ou abaixo da oferta') });
    });

    describe('com faixas na origem', () => {
      const passoFaixas = (estado: Passo['estado']): Passo => ({ tipo: 'faixas', anterior: viva(90), alvo: viva(99), estado });
      const baseOrigem: Passo = { tipo: 'base', anterior: 100, alvo: 110, estado: 'confirmado' };
      const comPassos = (passos: Passo[], o: { restaurar?: EntradaRestauracao[]; preco?: number } = {}) => new Map([['MLB1', {
        codigo_pai: 'P-MLB1', preco_anterior: 100, preco: o.preco ?? 110, restaurar: o.restaurar ?? restaurar, passos,
      }]]);

      it('restaura as faixas que a origem deixou, com passos na ordem da descida', async () => {
        const d = deps({ ...base, origem: comPassos([baseOrigem, passoFaixas('confirmado')]), faixas: viva(99) });
        const i = await um(voltar, d);
        expect(i).toMatchObject({ situacao: 'elegivel', preco: 100, faixas_anteriores: viva(99), faixas_alvo: viva(90) });
        expect(tipos(i)).toEqual(['faixas', 'base']);
        expect(i.passos?.[0]).toMatchObject({ anterior: viva(99), alvo: viva(90), estado: 'pendente' });
        expect(d.configAtacado).not.toHaveBeenCalled();
      });

      it('faixas editadas depois da origem → fora', async () => {
        expect(await um(voltar, deps({ ...base, origem: comPassos([baseOrigem, passoFaixas('confirmado')]), faixas: viva(98) })))
          .toMatchObject({ situacao: 'fora', motivo: 'Não revertível: o atacado mudou depois da alteração' });
      });

      it('faixas apagadas depois da origem → fora', async () => {
        expect(await um(voltar, deps({ ...base, origem: comPassos([baseOrigem, passoFaixas('confirmado')]), faixas: [] })))
          .toMatchObject({ situacao: 'fora', motivo: 'Não revertível: o atacado mudou depois da alteração' });
      });

      it('faixas que a origem não conseguiu gravar: reverte só o base', async () => {
        const i = await um(voltar, deps({ ...base, origem: comPassos([baseOrigem, passoFaixas('pendente')]), faixas: viva(90) }));
        expect(i).toMatchObject({ situacao: 'elegivel', faixas_alvo: null });
        expect(tipos(i)).toEqual(['base']);
      });

      it('só faixas: não compara restaurar, não mexe em preço nem marca', async () => {
        const d = deps({
          origem: comPassos([passoFaixas('confirmado')], { restaurar: [], preco: 100 }), vivos: { MLB1: vivo({ preco: 100 }) },
          estados: { 'V-MLB1': est(123, true) }, faixas: viva(99),
        });
        const i = await um(voltar, d);
        expect(i).toMatchObject({ situacao: 'elegivel', preco: 100, preco_anterior: 100, restaurar: [], aviso: null });
        expect(tipos(i)).toEqual(['faixas']);
      });

      it('só faixas com faixas editadas → fora', async () => {
        const d = deps({ origem: comPassos([passoFaixas('confirmado')], { restaurar: [], preco: 100 }), vivos: { MLB1: vivo({ preco: 100 }) }, faixas: viva(98) });
        expect(await um(voltar, d)).toMatchObject({ situacao: 'fora', motivo: 'Não revertível: o atacado mudou depois da alteração' });
      });

      it('só faixas com o preço mudado depois → fora', async () => {
        const d = deps({ origem: comPassos([passoFaixas('confirmado')], { restaurar: [], preco: 100 }), vivos: { MLB1: vivo({ preco: 105 }) }, faixas: viva(99) });
        expect(await um(voltar, d)).toMatchObject({ situacao: 'fora', motivo: 'Não revertível: o preço mudou depois do reajuste' });
      });
    });
  });
});
