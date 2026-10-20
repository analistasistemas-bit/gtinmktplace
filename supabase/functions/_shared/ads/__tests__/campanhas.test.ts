import { describe, expect, it, vi } from 'vitest';
import {
  equilibrioDoMlb, LIMITES_CAMPANHAS, LimiteTarifa, lerCampanhasAds, lerTodasPaginas, montarPublicados,
  parseAnunciosPatrocinados, parseCampanhas, parseItensBulk, type DepsCampanhas,
} from '../campanhas.ts';
import { montarCadastro, type LinhaVariacao } from '../../promocoes/cadastro.ts';
import type { ItemML, Tarifa } from '../../promocoes/tipos.ts';

// Recortes reais do spike 057 (Hairfly, 2026-10-20), sem campos de conta.
const CAMPANHA_HAIRFLY = {
  id: 7500229, name: 'Campanha Mercado Livre', status: 'active', strategy: 'PROFITABILITY', acos_target: 20.0,
  roas_target: 5.0, budget: 10.0, daily_budget: 10.0, channel: 'marketplace', advertiser_id: 3586381,
};
const anuncio = (o: Record<string, unknown> = {}) => ({
  item_id: 'MLB7736509406', campaign_id: 7500229, ad_group_id: 3002436452, status: 'active', status_raw: 'A',
  catalog_listing: true, title: 'Máscara Reconstrutora', thumbnail: 'http://x/t.jpg', permalink: 'https://ml/p', price: 28.5, ...o,
});

const v = (o: Partial<LinhaVariacao> & { id: string }): LinhaVariacao => ({
  custo: 10, preco: 18, cor: 'Azul', codigo: null, gtin: null, ml_variation_id: null,
  peso_gramas: 200, altura_cm: 5, largura_cm: 10, comprimento_cm: 15, atualizado_em: '2026-09-01T00:00:00Z',
  familias: { ml_item_id: 'MLB1', origem: 'nacional' }, ...o,
});
const itemML = (o: Partial<ItemML> = {}): ItemML => ({
  id: 'MLB1', titulo: null, thumbnail: null, permalink: null, listing_type_id: 'gold_special', categoria: 'MLB1234',
  sku: null, gtin: null, unidades: null, formato_kit: false, variacoes: [], catalogo: false, relacionados: [], ...o,
});
// 12 % de comissão, sem fixa, frete R$ 5.
const TARIFA: Tarifa = { comissao: { percentual: 12, fixa: 0 }, frete: 5 };
const ALIQ = { nacional: 8, importado: 16 };

describe('parseCampanhas', () => {
  it('lê nome, status, estratégia, ROAS/ACOS objetivo e orçamento diário', () => {
    expect(parseCampanhas({ paging: { total: 1 }, results: [CAMPANHA_HAIRFLY] })).toEqual({
      total: 1,
      campanhas: [{ id: 7500229, nome: 'Campanha Mercado Livre', status: 'active', estrategia: 'PROFITABILITY',
        roasObjetivo: 5, acosObjetivo: 20, orcamentoDiario: 10 }],
    });
  });
  it('campos opcionais ausentes viram null; status fora de active/paused é ignorado', () => {
    const r = parseCampanhas({ paging: { total: 2 }, results: [
      { id: 1, name: 'A', status: 'paused' }, { id: 2, name: 'B', status: 'deleted' }] });
    expect(r?.campanhas).toEqual([{ id: 1, nome: 'A', status: 'paused', estrategia: null, roasObjetivo: null,
      acosObjetivo: null, orcamentoDiario: null }]);
  });
  it('corpo fora do contrato → null', () => {
    expect(parseCampanhas({ results: [] })).toBeNull();
    expect(parseCampanhas({ paging: { total: 1 }, results: [{ name: 'sem id', status: 'active' }] })).toBeNull();
  });
});

describe('parseAnunciosPatrocinados', () => {
  it('lê os anúncios da página', () => {
    expect(parseAnunciosPatrocinados({ paging: { total: 8 }, results: [anuncio({ status: 'hold', catalog_listing: false })] }))
      .toEqual({ total: 8, anuncios: [{ mlb: 'MLB7736509406', campanhaId: 7500229, grupoId: 3002436452, statusAds: 'hold',
        catalogo: false, titulo: 'Máscara Reconstrutora', thumbnail: 'http://x/t.jpg', permalink: 'https://ml/p' }] });
  });
  it('MLB inválido ou sem campanha → null (nunca lista parcial)', () => {
    expect(parseAnunciosPatrocinados({ paging: { total: 1 }, results: [anuncio({ item_id: 'XYZ' })] })).toBeNull();
    expect(parseAnunciosPatrocinados({ paging: { total: 1 }, results: [anuncio({ campaign_id: null })] })).toBeNull();
  });
});

describe('parseItensBulk', () => {
  it('200 vira status do item; 404, 500 e corpo inválido ficam de fora (desconhecido)', () => {
    const m = parseItensBulk([
      { status_code: 200, body: { id: 'MLB1', status: 'paused', sub_status: ['out_of_stock'], available_quantity: 0, price: 30 } },
      { status_code: 404 },
      { status_code: 500 },
      { status_code: 200, body: { id: 'MLB4' } },
    ], ['MLB1', 'MLB2', 'MLB3', 'MLB4']);
    expect([...m.entries()]).toEqual([['MLB1', { status: 'paused', subStatus: ['out_of_stock'], estoque: 0, preco: 30 }]]);
    expect(parseItensBulk({ erro: 1 }, ['MLB1']).size).toBe(0);
    expect(parseItensBulk([{ status_code: 200, body: { id: 'MLB1', status: '' } }], ['MLB1']).size).toBe(0);
  });
});

describe('equilibrioDoMlb', () => {
  it('ACOS de equilíbrio = (líquido − custo) ÷ preço no preço vivo', async () => {
    // 50 − 6 (comissão) − 5 (frete) − 4 (8 % imposto) = 35; (35 − 10) ÷ 50 = 50 %.
    const r = await equilibrioDoMlb(itemML(), 50, montarCadastro([v({ id: 'a' })], []), ALIQ, async () => TARIFA);
    expect(r).toEqual({ acosPct: 50, motivo: null });
  });
  it('sem arredondar: 19,996 % não vira 20 % (o alerta contra ACOS-alvo 20 % precisa disparar)', async () => {
    const c = montarCadastro([v({ id: 'a', custo: 55.01 })], []);
    const r = await equilibrioDoMlb(itemML(), 100.01, c, ALIQ, async () => TARIFA);
    expect(r.acosPct!).toBeLessThan(20);
    expect(r.acosPct!).toBeCloseTo(19.996, 3);
  });
  it('importado usa a alíquota de importado', async () => {
    const c = montarCadastro([v({ id: 'a', familias: { ml_item_id: 'MLB1', origem: 'importado' } })], []);
    // 50 − 6 − 5 − 8 = 31; (31 − 10) ÷ 50 = 42 %.
    expect((await equilibrioDoMlb(itemML(), 50, c, ALIQ, async () => TARIFA)).acosPct).toBeCloseTo(42);
  });
  it('sem piso cadastrado mas com custo: calcula (piso não entra no equilíbrio)', async () => {
    const r = await equilibrioDoMlb(itemML(), 50, montarCadastro([v({ id: 'a', preco: null })], []), ALIQ, async () => TARIFA);
    expect(r.acosPct).toBe(50);
  });
  it('motivos do cadastro, sem chamar tarifa', async () => {
    const tarifa = vi.fn(async () => TARIFA);
    const caso = async (linha: Partial<LinhaVariacao>) =>
      (await equilibrioDoMlb(itemML(), 50, montarCadastro([v({ id: 'a', ...linha })], []), ALIQ, tarifa)).motivo;
    expect(await caso({ custo: null })).toBe('sem_custo');
    expect(await caso({ custo: 0 })).toBe('sem_custo');
    expect(await caso({ familias: { ml_item_id: 'MLB1', origem: null } })).toBe('sem_origem');
    expect(await caso({ peso_gramas: null })).toBe('sem_dimensao');
    expect(await equilibrioDoMlb(itemML({ id: 'MLB9' }), 50, montarCadastro([v({ id: 'a' })], []), ALIQ, tarifa))
      .toEqual({ acosPct: null, motivo: 'sem_cadastro' });
    expect(tarifa).not.toHaveBeenCalled();
  });
  it('preço, categoria e tarifa', async () => {
    const c = montarCadastro([v({ id: 'a' })], []);
    expect((await equilibrioDoMlb(itemML(), null, c, ALIQ, async () => TARIFA)).motivo).toBe('sem_preco');
    expect((await equilibrioDoMlb(itemML({ categoria: null }), 50, c, ALIQ, async () => TARIFA)).motivo).toBe('sem_categoria');
    expect((await equilibrioDoMlb(itemML(), 50, c, ALIQ, async () => { throw new Error('estimada'); })).motivo).toBe('erro_tarifa');
    await expect(equilibrioDoMlb(itemML(), 50, c, ALIQ, async () => { throw new LimiteTarifa(); })).rejects.toBeInstanceOf(LimiteTarifa);
  });
  it('pior variação: mínimo entre as cores; uma cor sem referência deixa o MLB sem referência', async () => {
    const c = montarCadastro([
      v({ id: 'a', ml_variation_id: '1', custo: 10, familias: { ml_item_id: 'MLB1', origem: 'nacional' } }),
      v({ id: 'b', ml_variation_id: '2', custo: 20, familias: { ml_item_id: 'MLB1', origem: 'nacional' } }),
    ], []);
    const duas = itemML({ variacoes: [{ variation_id: 1, cor: 'A', sku: null, gtin: null }, { variation_id: 2, cor: 'B', sku: null, gtin: null }] });
    // (35 − 20) ÷ 50 = 30 % < 50 %.
    expect(await equilibrioDoMlb(duas, 50, c, ALIQ, async () => TARIFA)).toEqual({ acosPct: 30, motivo: null });
    const semCusto = montarCadastro([
      v({ id: 'a', ml_variation_id: '1' }), v({ id: 'b', ml_variation_id: '2', custo: null }),
    ], []);
    expect(await equilibrioDoMlb(duas, 50, semCusto, ALIQ, async () => TARIFA)).toEqual({ acosPct: null, motivo: 'sem_custo' });
  });

  describe('kit (ADR-0151), pelo resolverPack real', () => {
    const base = v({ id: 'base', codigo: '00000010', gtin: '7891010027858', custo: 29.9, preco: 39.99,
      peso_gramas: 800, altura_cm: 22, largura_cm: 10, comprimento_cm: 7, familias: { ml_item_id: 'MLBBASE', origem: 'nacional' } });
    const kit = v({ id: 'kit', codigo: '00000012', gtin: null, custo: 59.8, preco: 111.8,
      peso_gramas: 1600, altura_cm: 44, largura_cm: 10, comprimento_cm: 7,
      familias: { ml_item_id: 'MLBKIT', origem: 'nacional', kit_multiplicador: 2 } });
    // 100 − 12 − 5 − 8 = 75.
    it('kit próprio já nasce multiplicado: custo 59,80, nunca ×2 de novo', async () => {
      const r = await equilibrioDoMlb(itemML({ id: 'MLBKIT', unidades: 2 }), 100, montarCadastro([base, kit], []), ALIQ, async () => TARIFA);
      expect(r.acosPct).toBeCloseTo(15.2); // (75 − 59,8) ÷ 100
    });
    it('pack pelo GTIN da unidade com UNITS_PER_PACK=2: custo escalado a 59,80', async () => {
      const r = await equilibrioDoMlb(itemML({ id: 'MLBX', gtin: '7891010027858', unidades: 2 }), 100, montarCadastro([base], []), ALIQ, async () => TARIFA);
      expect(r.acosPct).toBeCloseTo(15.2);
    });
    it('motivo kit_* propaga', async () => {
      const r = await equilibrioDoMlb(itemML({ id: 'MLBKIT', unidades: 1 }), 100, montarCadastro([base, kit], []), ALIQ, async () => TARIFA);
      expect(r).toEqual({ acosPct: null, motivo: 'kit_divergente' });
    });
  });
});

describe('montarPublicados / lerTodasPaginas', () => {
  it('pai + filhos UP por codigo_pai, sem duplicar e sem filho pendente', () => {
    expect(montarPublicados(
      [{ id: 'p1', codigo_pai: '100', item_externo_id: 'MLB1' }, { id: 'p2', codigo_pai: '200', item_externo_id: 'MLB5' }],
      [{ anuncio_externo_id: 'p1', item_externo_id: 'MLB2' }, { anuncio_externo_id: 'p1', item_externo_id: 'MLB1' },
        { anuncio_externo_id: 'p1', item_externo_id: null }, { anuncio_externo_id: 'pX', item_externo_id: 'MLB9' }],
    )).toEqual({ '100': ['MLB1', 'MLB2'], '200': ['MLB5'] });
  });
  it('pagina de 1000 em 1000 até a página incompleta', async () => {
    const todas = Array.from({ length: 2345 }, (_, i) => i);
    const pagina = vi.fn(async (de: number, ate: number) => todas.slice(de, ate + 1));
    expect(await lerTodasPaginas(pagina)).toHaveLength(2345);
    expect(pagina.mock.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
});

describe('lerCampanhasAds', () => {
  type Rota = (path: string) => { status: number; corpo: unknown } | undefined;
  const ADV = { status: 200, corpo: { advertisers: [{ advertiser_id: 77, site_id: 'MLB' }] } };
  const pagina = (results: unknown[], total = results.length) => ({ status: 200, corpo: { paging: { total }, results } });
  const bulk = (path: string) => {
    const ids = decodeURIComponent(path.split('ids=')[1].split('&')[0]).split(',');
    return { status: 200, corpo: ids.map((id) => ({ status_code: 200, body: { id, status: 'active', sub_status: [], available_quantity: 3, price: 50 } })) };
  };
  const deps = (rota: Rota, o: Partial<DepsCampanhas> = {}): DepsCampanhas & { get: ReturnType<typeof vi.fn> } => ({
    hoje: '2026-10-20',
    get: vi.fn(async (path: string) => rota(path) ?? (path.startsWith('/items/bulk') ? bulk(path) : { status: 500, corpo: null })),
    contarCadastro: async () => 10,
    carregarCadastro: async () => montarCadastro([v({ id: 'a', familias: { ml_item_id: 'MLB1', origem: 'nacional' } })], []),
    lerAliquotas: async () => ALIQ,
    buscarItensML: async (ids) => new Map(ids.map((id) => [id, itemML({ id })])),
    tarifaEm: async () => TARIFA,
    lerPublicados: async () => ({ '100': ['MLB1'] }),
    ...o,
  }) as never;
  const comAnuncios = (porCampanha: Record<number, unknown[]>, campanhas = [CAMPANHA_HAIRFLY]): Rota => (path) => {
    if (path.startsWith('/advertising/advertisers')) return ADV;
    if (path.includes('/campaigns/search')) return pagina(campanhas);
    const m = path.match(/filters\[campaign_id\]=(\d+)/);
    if (m) return pagina(porCampanha[Number(m[1])] ?? []);
    return undefined;
  };

  it('sem anunciante, 401 e 403 viram estados', async () => {
    const sem = deps((p) => (p.startsWith('/advertising') ? { status: 200, corpo: { advertisers: [] } } : undefined));
    expect(await lerCampanhasAds(sem, 'T')).toEqual({ ok: true, estado: 'sem_advertiser' });
    expect(await lerCampanhasAds(deps(() => ({ status: 401, corpo: null })), 'T')).toEqual({ ok: true, estado: 'sem_acesso' });
    expect(await lerCampanhasAds(deps(() => ({ status: 403, corpo: null })), 'T')).toEqual({ ok: true, estado: 'sem_permissao' });
  });

  it('caminho feliz: campanha, anúncio com item e equilíbrio; janela de 7 dias BRT', async () => {
    const d = deps(comAnuncios({ 7500229: [anuncio({ item_id: 'MLB1' })] }));
    const r = await lerCampanhasAds(d, '2026-10-20T15:00:00Z');
    expect(r).toMatchObject({
      ok: true, estado: 'ok', lidoEm: '2026-10-20T15:00:00Z', aliquotasConfirmadas: true, projecaoLimitada: false,
      publicadosPorFamilia: { '100': ['MLB1'] },
      campanhas: [{ id: 7500229, roasObjetivo: 5 }],
      anuncios: [{ mlb: 'MLB1', campanhaId: 7500229, item: { status: 'active', estoque: 3, preco: 50 }, equilibrio: { acosPct: 50, motivo: null } }],
    });
    const camp = d.get.mock.calls.map((c) => c[0] as string).find((p) => p.includes('/campaigns/search'))!;
    expect(camp).toContain('date_from=2026-10-13&date_to=2026-10-20');
    expect(camp).toContain('filters[status]=active,paused');
  });

  it('pagina campanhas e anúncios', async () => {
    const muitos = Array.from({ length: 60 }, (_, i) => anuncio({ item_id: `MLB${1000 + i}` }));
    const d = deps((path) => {
      if (path.startsWith('/advertising/advertisers')) return ADV;
      if (path.includes('/campaigns/search')) return pagina([CAMPANHA_HAIRFLY]);
      if (path.includes('filters[campaign_id]')) {
        const off = Number(path.match(/offset=(\d+)/)![1]);
        return pagina(muitos.slice(off, off + 50), 60);
      }
      return undefined;
    });
    const r = await lerCampanhasAds(d, 'T');
    expect(r.estado === 'ok' && r.anuncios).toHaveLength(60);
  });

  it('teto de páginas estourado → erro explícito, nunca lista truncada', async () => {
    const d = deps((path) => {
      if (path.startsWith('/advertising/advertisers')) return ADV;
      if (path.includes('/campaigns/search')) return pagina([CAMPANHA_HAIRFLY]);
      if (path.includes('filters[campaign_id]')) return pagina([anuncio()], 50 * (LIMITES_CAMPANHAS.paginas + 5));
      return undefined;
    });
    await expect(lerCampanhasAds(d, 'T')).rejects.toThrow(/teto/);
  });

  it('campanha pausada não é projetada; bulk com 500 deixa o item desconhecido', async () => {
    const pausada = { ...CAMPANHA_HAIRFLY, id: 9, status: 'paused' };
    const buscar = vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, itemML({ id })])));
    const d = deps((path) => {
      if (path.startsWith('/items/bulk')) return { status: 500, corpo: null };
      return comAnuncios({ 9: [anuncio({ item_id: 'MLB1', campaign_id: 9 })] }, [pausada])(path);
    }, { buscarItensML: buscar });
    const r = await lerCampanhasAds(d, 'T');
    expect(r.estado === 'ok' && r.anuncios[0]).toMatchObject({ item: null, equilibrio: { acosPct: null, motivo: 'fora_da_projecao' } });
    expect(r.estado === 'ok' && r.projecaoLimitada).toBe(false);
    expect(buscar).not.toHaveBeenCalled();
  });

  it('sem alíquota confirmada: sem_aliquota, sem carregar cadastro', async () => {
    const carregar = vi.fn();
    const d = deps(comAnuncios({ 7500229: [anuncio({ item_id: 'MLB1' })] }), { lerAliquotas: async () => null, carregarCadastro: carregar });
    const r = await lerCampanhasAds(d, 'T');
    expect(r).toMatchObject({ aliquotasConfirmadas: false, anuncios: [{ equilibrio: { acosPct: null, motivo: 'sem_aliquota' } }] });
    expect(carregar).not.toHaveBeenCalled();
  });

  it('cadastro acima do teto: nenhuma projeção, projeção limitada', async () => {
    const carregar = vi.fn();
    const d = deps(comAnuncios({ 7500229: [anuncio({ item_id: 'MLB1' })] }),
      { contarCadastro: async () => LIMITES_CAMPANHAS.cadastro + 1, carregarCadastro: carregar });
    const r = await lerCampanhasAds(d, 'T');
    expect(r).toMatchObject({ projecaoLimitada: true, anuncios: [{ equilibrio: { motivo: 'fora_da_projecao' } }] });
    expect(carregar).not.toHaveBeenCalled();
  });

  it('orçamento de cores: o MLB que não cabe inteiro fica de fora, e os seguintes também', async () => {
    const n = LIMITES_CAMPANHAS.cores;
    const cores = (k: number) => Array.from({ length: k }, (_, i) => ({ variation_id: i + 1, cor: `C${i}`, sku: null, gtin: null }));
    const d = deps(comAnuncios({ 7500229: [anuncio({ item_id: 'MLB1' }), anuncio({ item_id: 'MLB2' }), anuncio({ item_id: 'MLB3' })] }), {
      // MLB1 usa n − 1 cores; MLB2 tem 2 (não cabe); MLB3 tem 1 (caberia, mas vem depois do corte).
      buscarItensML: async (ids) => new Map(ids.map((id) => [id, itemML({ id, variacoes: cores(id === 'MLB1' ? n - 1 : id === 'MLB2' ? 2 : 1) })])),
    });
    const r = await lerCampanhasAds(d, 'T');
    if (r.estado !== 'ok') throw new Error('estado');
    expect(r.anuncios.map((a) => a.equilibrio.motivo)).toEqual([expect.not.stringMatching(/fora_da_projecao/), 'fora_da_projecao', 'fora_da_projecao']);
    expect(r.projecaoLimitada).toBe(true);
  });

  it('teto de MLBs: além do limite não busca o item nem projeta', async () => {
    const ads = Array.from({ length: LIMITES_CAMPANHAS.mlbs + 1 }, (_, i) => anuncio({ item_id: `MLB${5000 + i}` }));
    const buscar = vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, itemML({ id })])));
    const d = deps((path) => {
      if (path.includes('filters[campaign_id]')) {
        const off = Number(path.match(/offset=(\d+)/)![1]);
        return pagina(ads.slice(off, off + 50), ads.length);
      }
      return comAnuncios({})(path);
    }, { buscarItensML: buscar });
    const r = await lerCampanhasAds(d, 'T');
    if (r.estado !== 'ok') throw new Error('estado');
    expect(buscar.mock.calls[0][0]).toHaveLength(LIMITES_CAMPANHAS.mlbs);
    expect(r.anuncios.at(-1)!.equilibrio.motivo).toBe('fora_da_projecao');
    expect(r.projecaoLimitada).toBe(true);
  });

  it('teto de consultas de tarifa: o MLB que estoura fica fora da projeção', async () => {
    let chamadas = 0;
    const ads = [anuncio({ item_id: 'MLB1' }), anuncio({ item_id: 'MLB2' })];
    const d = deps(comAnuncios({ 7500229: ads }), {
      carregarCadastro: async () => montarCadastro([v({ id: 'a' }), v({ id: 'b', familias: { ml_item_id: 'MLB2', origem: 'nacional' } })], []),
      tarifaEm: async () => { chamadas++; return TARIFA; },
    });
    const orig = LIMITES_CAMPANHAS.tarifas;
    (LIMITES_CAMPANHAS as { tarifas: number }).tarifas = 1;
    try {
      const r = await lerCampanhasAds(d, 'T');
      if (r.estado !== 'ok') throw new Error('estado');
      expect(r.anuncios.filter((a) => a.equilibrio.motivo === 'fora_da_projecao')).toHaveLength(1);
      expect(r.projecaoLimitada).toBe(true);
      expect(chamadas).toBe(1);
    } finally {
      (LIMITES_CAMPANHAS as { tarifas: number }).tarifas = orig;
    }
  });

  it('anúncio de outra campanha na busca filtrada é descartado (filtro do ML não confiável, spike 057)', async () => {
    const d = deps(comAnuncios({ 7500229: [anuncio({ item_id: 'MLB1' }), anuncio({ item_id: 'MLB2', campaign_id: 357912053, status: 'idle' })] }));
    const r = await lerCampanhasAds(d, 'T');
    expect(r.estado === 'ok' && r.anuncios.map((a) => a.mlb)).toEqual(['MLB1']);
  });

  it('página vazia antes do total → erro, nunca lista incompleta como sucesso', async () => {
    const d = deps((path) => {
      if (path.includes('filters[campaign_id]')) {
        const off = Number(path.match(/offset=(\d+)/)![1]);
        return pagina(off === 0 ? Array.from({ length: 50 }, (_, i) => anuncio({ item_id: `MLB${100 + i}` })) : [], 100);
      }
      return comAnuncios({})(path);
    });
    await expect(lerCampanhasAds(d, 'T')).rejects.toThrow(/página vazia/);
  });

  it('as páginas de campanhas não comem o teto dos anúncios', async () => {
    const n = LIMITES_CAMPANHAS.paginas * 50;
    const ads = Array.from({ length: n }, (_, i) => anuncio({ item_id: `MLB${10_000 + i}` }));
    const d = deps((path) => {
      if (path.includes('filters[campaign_id]')) {
        const off = Number(path.match(/offset=(\d+)/)![1]);
        return pagina(ads.slice(off, off + 50), n);
      }
      return comAnuncios({})(path);
    });
    const r = await lerCampanhasAds(d, 'T');
    expect(r.estado === 'ok' && r.anuncios).toHaveLength(n);
  });

  it('falha de rede num bloco do bulk: itens desconhecidos, leitura segue', async () => {
    const d = deps((path) => {
      if (path.startsWith('/items/bulk')) throw new Error('fetch failed');
      return comAnuncios({ 7500229: [anuncio({ item_id: 'MLB1' })] })(path);
    });
    const r = await lerCampanhasAds(d, 'T');
    expect(r).toMatchObject({ estado: 'ok', anuncios: [{ item: null }] });
  });

  it('depois do corte de cores, MLB sem metadados também fica fora da projeção (não erro_item)', async () => {
    const n = LIMITES_CAMPANHAS.cores;
    const cores = (k: number) => Array.from({ length: k }, (_, i) => ({ variation_id: i + 1, cor: `C${i}`, sku: null, gtin: null }));
    const d = deps(comAnuncios({ 7500229: [anuncio({ item_id: 'MLB1' }), anuncio({ item_id: 'MLB2' })] }), {
      buscarItensML: async () => new Map([['MLB1', itemML({ id: 'MLB1', variacoes: cores(n + 1) })]]),
    });
    const r = await lerCampanhasAds(d, 'T');
    if (r.estado !== 'ok') throw new Error('estado');
    expect(r.anuncios.map((a) => a.equilibrio.motivo)).toEqual(['fora_da_projecao', 'fora_da_projecao']);
  });

  it('erro ao ler publicados → null (o front não alerta parcial)', async () => {
    const d = deps(comAnuncios({ 7500229: [anuncio({ item_id: 'MLB1' })] }), { lerPublicados: async () => { throw new Error('db'); } });
    expect(await lerCampanhasAds(d, 'T')).toMatchObject({ publicadosPorFamilia: null });
  });
});
