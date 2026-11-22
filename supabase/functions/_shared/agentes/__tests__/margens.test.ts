import { describe, expect, it, vi } from 'vitest';
import { margemDoAlvo, margensDoCatalogo, simularMargem, type DepsMargens } from '../margens.ts';
import type { Vinculo } from '../alvo.ts';
import { LimiteTarifa, type ItemAgora } from '../../ads/campanhas.ts';
import { montarCadastro, type LinhaVariacao } from '../../promocoes/cadastro.ts';
import type { ItemML, Tarifa } from '../../promocoes/tipos.ts';

const ORG = 'org-A';
const AGORA = new Date('2026-11-22T12:00:00Z');
const TARIFA: Tarifa = { comissao: { percentual: 12, fixa: 6 }, frete: 0 };

type Anuncio = { mlb: string; custo: number | null; preco: number | null; precoTabela?: number | null; familia?: string; sku?: string };

const linha = (a: Anuncio, n: number): LinhaVariacao => ({
  id: `v-${a.mlb}`, custo: a.custo, preco: 18, cor: 'Azul', codigo: null, gtin: null, ml_variation_id: String(n),
  peso_gramas: 200, altura_cm: 5, largura_cm: 10, comprimento_cm: 15, atualizado_em: '2026-09-01T00:00:00Z',
  familias: { ml_item_id: a.mlb, origem: 'nacional' },
});
const itemML = (a: Anuncio, n: number): ItemML => ({
  id: a.mlb, titulo: `Produto ${a.mlb}`, thumbnail: null, permalink: null, criado_em: null, listing_type_id: 'gold_special',
  categoria: 'MLB1234', sku: null, gtin: null, unidades: null, formato_kit: false, catalogo: false, relacionados: [],
  variacoes: [{ variation_id: n, cor: 'A', sku: a.sku ?? `SKU-${a.mlb}`, gtin: null }],
});

/** Deps falsas já "fechadas" na organização ORG. `semItem`/`semPreco` simulam MLB que o ML não devolveu. */
function deps(anuncios: Anuncio[], o: Partial<DepsMargens> & { semItem?: string[]; semPreco?: string[] } = {}) {
  const vinculos: Vinculo[] = anuncios.map((a) => ({
    mlb: a.mlb, mlbu: null, familia_ml: a.familia ?? null, sku: a.sku ?? `SKU-${a.mlb}`, codigo_pai: 'P1',
  }));
  const todos = anuncios.map((a) => a.mlb).sort();
  const d = {
    orgId: ORG,
    agora: AGORA,
    resolver: {
      vinculos: vi.fn(async (f: { mlb?: string; mlbu?: string; familia_ml?: string; sku?: string }) =>
        vinculos.filter((v) => (f.mlb ? v.mlb === f.mlb : f.familia_ml ? v.familia_ml === f.familia_ml : v.sku === f.sku))),
      buscarPorTitulo: vi.fn(async () => []),
    },
    carregarCadastro: vi.fn(async () => montarCadastro(anuncios.map((a, i) => linha(a, i + 1)), [])),
    lerAliquotas: vi.fn(async () => ({ nacional: 8, importado: 16 })),
    buscarItensML: vi.fn(async (ids: string[]) => new Map(anuncios
      .map((a, i) => [a.mlb, itemML(a, i + 1)] as const)
      .filter(([m]) => ids.includes(m) && !o.semItem?.includes(m)))),
    lerPrecos: vi.fn(async (ids: string[]) => new Map(anuncios
      .filter((a) => ids.includes(a.mlb) && !o.semPreco?.includes(a.mlb))
      .map((a): [string, ItemAgora] => [a.mlb,
        { status: 'active', subStatus: [], estoque: 1, preco: a.preco, precoTabela: a.precoTabela ?? null }]))),
    tarifaEm: vi.fn(async () => TARIFA),
    reservarTarifas: vi.fn(async () => 'ok' as const),
    listarMlbs: vi.fn(async (depois: string | null, limite: number) =>
      todos.filter((m) => depois == null || m > depois).slice(0, limite)),
    ...o,
  };
  return d;
}

const cursorDe = (o: string, ultimo: string) => Buffer.from(JSON.stringify({ o, d: ultimo })).toString('base64url');
const duasCasas = (x: number) => Math.abs(x * 100 - Math.round(x * 100)) < 1e-9;

describe('margemDoAlvo', () => {
  it('margem 40 → roas_minimo 2,5; detalhe da pior cor; promoção pelo preço de tabela', async () => {
    const d = deps([{ mlb: 'MLB1', custo: 14, preco: 50, precoTabela: 60 }]);
    const r = await margemDoAlvo('MLB1', d);
    expect(r).toEqual({
      estado: 'ok', lido_em: AGORA.toISOString(), tarifa_idade_max_horas: 8,
      anuncios: [{
        mlb: 'MLB1', titulo: 'Produto MLB1', sku: 'SKU-MLB1', preco_brl: 50, preco_tabela_brl: 60, em_promocao: true,
        custo_brl: 14, comissao_brl: 12, frete_brl: 0, imposto_brl: 4, liquido_brl: 34, margem_pct: 40, roas_minimo: 2.5,
        motivo: null,
      }],
      referencia: { margem_pct: 40, roas_minimo: 2.5, mlb: 'MLB1', motivo: null },
    });
    expect(d.reservarTarifas).toHaveBeenCalledWith(2);
    expect(d.carregarCadastro).toHaveBeenCalledTimes(1);
  });

  it('margem −5 → roas_minimo null, motivo sem_espaco_para_ads, margem_pct −5', async () => {
    const r = await margemDoAlvo('MLB1', deps([{ mlb: 'MLB1', custo: 79, preco: 100 }]));
    if (r.estado !== 'ok') throw new Error(r.estado);
    expect(r.anuncios[0]).toMatchObject({ margem_pct: -5, roas_minimo: null, motivo: 'sem_espaco_para_ads', em_promocao: false });
    expect(r.referencia).toEqual({ margem_pct: -5, roas_minimo: null, mlb: 'MLB1', motivo: 'sem_espaco_para_ads' });
  });

  it('_brl com 2 casas e a soma fechando no preço', async () => {
    const r = await margemDoAlvo('MLB1', deps([{ mlb: 'MLB1', custo: 10, preco: 49.9 }]));
    if (r.estado !== 'ok') throw new Error(r.estado);
    const a = r.anuncios[0];
    for (const k of ['preco_brl', 'custo_brl', 'comissao_brl', 'frete_brl', 'imposto_brl', 'liquido_brl'] as const) {
      expect(duasCasas(a[k]!), k).toBe(true);
    }
    expect(a.comissao_brl).toBe(11.99);
    expect(a.imposto_brl).toBe(3.99);
    expect(Math.abs(a.comissao_brl! + a.frete_brl! + a.imposto_brl! + a.liquido_brl! - a.preco_brl!)).toBeLessThanOrEqual(0.01 + 1e-9);
    // margem_pct sem arredondar
    expect(duasCasas(a.margem_pct!)).toBe(false);
  });

  it('sem alíquota → sem_aliquota, sem reservar nem consultar tarifa', async () => {
    const d = deps([{ mlb: 'MLB1', custo: 14, preco: 50 }], { lerAliquotas: vi.fn(async () => null) });
    expect(await margemDoAlvo('MLB1', d)).toEqual({ estado: 'sem_aliquota' });
    expect(d.tarifaEm).not.toHaveBeenCalled();
    expect(d.reservarTarifas).not.toHaveBeenCalled();
    expect(d.buscarItensML).not.toHaveBeenCalled();
  });

  it('Review Focus 3: família com um anúncio sem custo → cada um com seu número ou motivo; referência null', async () => {
    const F = '8632963637759506';
    const r = await margemDoAlvo(`#${F}`, deps([
      { mlb: 'MLB1', custo: 14, preco: 50, familia: F },
      { mlb: 'MLB2', custo: null, preco: 55, precoTabela: 70, familia: F },
    ]));
    if (r.estado !== 'ok') throw new Error(r.estado);
    expect(r.anuncios[0]).toMatchObject({ mlb: 'MLB1', margem_pct: 40, roas_minimo: 2.5, motivo: null });
    expect(r.anuncios[1]).toEqual({
      mlb: 'MLB2', titulo: 'Produto MLB2', sku: null, preco_brl: 55, preco_tabela_brl: 70, em_promocao: true,
      custo_brl: null, comissao_brl: null, frete_brl: null, imposto_brl: null, liquido_brl: null, margem_pct: null,
      roas_minimo: null, motivo: 'sem_custo',
    });
    expect(r.referencia).toEqual({ margem_pct: null, roas_minimo: null, mlb: null, motivo: 'anuncio_sem_numero' });
  });

  it('referência = menor margem quando todos têm número', async () => {
    const r = await margemDoAlvo('SKU-X', deps([
      { mlb: 'MLB1', custo: 14, preco: 50, sku: 'SKU-X' },
      { mlb: 'MLB2', custo: 79, preco: 100, sku: 'SKU-X' },
    ]));
    if (r.estado !== 'ok') throw new Error(r.estado);
    expect(r.referencia).toEqual({ margem_pct: -5, roas_minimo: null, mlb: 'MLB2', motivo: 'sem_espaco_para_ads' });
  });

  it("reservarTarifas 'limite' → limite_tarifas; 'falha' → indisponivel; tarifa nunca consultada", async () => {
    for (const [res, estado] of [['limite', 'limite_tarifas'], ['falha', 'indisponivel']] as const) {
      const d = deps([{ mlb: 'MLB1', custo: 14, preco: 50 }], { reservarTarifas: vi.fn(async () => res) });
      expect(await margemDoAlvo('MLB1', d)).toEqual({ estado });
      expect(d.tarifaEm).not.toHaveBeenCalled();
      expect(d.carregarCadastro).not.toHaveBeenCalled();
    }
  });

  it('tarifaEm lança LimiteTarifa → limite_tarifas', async () => {
    const d = deps([{ mlb: 'MLB1', custo: 14, preco: 50 }], { tarifaEm: vi.fn(async () => { throw new LimiteTarifa(); }) });
    expect(await margemDoAlvo('MLB1', d)).toEqual({ estado: 'limite_tarifas' });
  });

  it('MLB que o ML não devolve → anuncio_indisponivel, sem número', async () => {
    const r = await margemDoAlvo('SKU-X', deps([
      { mlb: 'MLB1', custo: 14, preco: 50, sku: 'SKU-X' },
      { mlb: 'MLB2', custo: 14, preco: 50, sku: 'SKU-X' },
      { mlb: 'MLB3', custo: 14, preco: 50, sku: 'SKU-X' },
    ], { semItem: ['MLB2'], semPreco: ['MLB3'] }));
    if (r.estado !== 'ok') throw new Error(r.estado);
    expect(r.anuncios.map((a) => a.motivo)).toEqual([null, 'anuncio_indisponivel', 'anuncio_indisponivel']);
    expect(r.anuncios[1]).toMatchObject({ margem_pct: null, custo_brl: null, preco_brl: 50 });
    expect(r.anuncios[2]).toMatchObject({ margem_pct: null, preco_brl: null, em_promocao: null });
    expect(r.referencia.motivo).toBe('anuncio_sem_numero');
  });

  it('família com mais de 60 MLBs → alvo_grande, sem calcular', async () => {
    const F = '8632963637759506';
    const muitos = Array.from({ length: 61 }, (_, i) => ({ mlb: `MLB${1000 + i}`, custo: 14, preco: 50, familia: F }));
    const d = deps(muitos);
    expect(await margemDoAlvo(F, d)).toEqual({ estado: 'alvo_grande' });
    expect(d.lerAliquotas).not.toHaveBeenCalled();
  });

  it('candidatos e nao_encontrado passam direto, sem ler alíquota', async () => {
    const cand = [{ codigo_pai: 'P1', titulo: 'Camiseta', mlbs: ['MLB1'] }];
    const d = deps([]);
    d.resolver.buscarPorTitulo = vi.fn(async () => cand);
    expect(await margemDoAlvo('camiseta', d)).toEqual({ estado: 'candidatos', candidatos: cand });
    expect(await margemDoAlvo('MLB999', d)).toEqual({ estado: 'nao_encontrado' });
    expect(d.lerAliquotas).not.toHaveBeenCalled();
  });
});

describe('simularMargem', () => {
  it('Review Focus 5: preço inválido → preco_invalido sem chamar nenhuma dep', async () => {
    for (const p of [0, -1, 'abc', '50', 1000001, NaN, Infinity, null, undefined, 0.004]) {
      const d = deps([{ mlb: 'MLB1', custo: 14, preco: 50 }]);
      expect(await simularMargem('MLB1', p, d), String(p)).toEqual({ estado: 'preco_invalido' });
      expect(d.tarifaEm).not.toHaveBeenCalled();
      expect(d.reservarTarifas).not.toHaveBeenCalled();
      expect(d.resolver.vinculos).not.toHaveBeenCalled();
    }
  });

  it('preço com 3 casas é arredondado a 2 antes de calcular (49,999 → 50)', async () => {
    const d = deps([{ mlb: 'MLB1', custo: 14, preco: 80 }]);
    const r = await simularMargem('MLB1', 49.999, d);
    if (r.estado !== 'ok') throw new Error(r.estado);
    expect(r.anuncios[0]).toMatchObject({ preco_brl: 50, margem_pct: 40 });
    expect(d.tarifaEm.mock.calls.every(([q]) => (q as { preco: number }).preco === 50)).toBe(true);
  });

  it('preço informado vale para todos os anúncios do alvo; preço atual vem junto', async () => {
    const d = deps([
      { mlb: 'MLB1', custo: 14, preco: 50, sku: 'SKU-X' },
      { mlb: 'MLB2', custo: 14, preco: 45, sku: 'SKU-X' },
    ]);
    const r = await simularMargem('SKU-X', 1000000, d);
    if (r.estado !== 'ok') throw new Error(r.estado);
    expect(r.anuncios.map((a) => [a.preco_brl, a.preco_atual_brl])).toEqual([[1000000, 50], [1000000, 45]]);
    expect(d.tarifaEm.mock.calls.every(([q]) => (q as { preco: number }).preco === 1000000)).toBe(true);
    const r2 = await simularMargem('MLB1', 50, deps([{ mlb: 'MLB1', custo: 14, preco: 80 }]));
    if (r2.estado !== 'ok') throw new Error(r2.estado);
    expect(r2.anuncios[0]).toMatchObject({ preco_brl: 50, preco_atual_brl: 80, margem_pct: 40, roas_minimo: 2.5 });
  });
});

describe('margensDoCatalogo', () => {
  const cento20 = Array.from({ length: 120 }, (_, i) => ({ mlb: `MLB${1001 + i}`, custo: 14, preco: 50 }));

  it('120 MLBs: página 1 com 50 e cursor; página 3 com 20 e sem cursor', async () => {
    const d = deps(cento20);
    const p1 = await margensDoCatalogo(null, d);
    if (p1.estado !== 'ok') throw new Error(p1.estado);
    expect(p1.anuncios).toHaveLength(50);
    expect(p1.anuncios[0].mlb).toBe('MLB1001');
    expect(p1.proximo_cursor).toBe(cursorDe(ORG, 'MLB1050'));
    expect(p1.parcial).toBe(false);
    expect(p1.tarifa_idade_max_horas).toBe(8);
    expect(d.reservarTarifas).toHaveBeenCalledWith(100);
    const p2 = await margensDoCatalogo(p1.proximo_cursor, d);
    if (p2.estado !== 'ok') throw new Error(p2.estado);
    expect(p2.anuncios.map((a) => a.mlb)[0]).toBe('MLB1051');
    const p3 = await margensDoCatalogo(p2.proximo_cursor, d);
    if (p3.estado !== 'ok') throw new Error(p3.estado);
    expect(p3.anuncios).toHaveLength(20);
    expect(p3.anuncios[19].mlb).toBe('MLB1120');
    expect(p3.proximo_cursor).toBeNull();
    expect(d.listarMlbs).toHaveBeenCalledWith(null, 51);
  });

  it('Review Focus 2: cursor de outra organização → cursor_invalido, sem ler nada', async () => {
    const d = deps(cento20);
    expect(await margensDoCatalogo(cursorDe('org-B', 'MLB1050'), d)).toEqual({ estado: 'cursor_invalido' });
    expect(d.listarMlbs).not.toHaveBeenCalled();
  });

  it('cursor lixo → cursor_invalido', async () => {
    const d = deps(cento20);
    const b64 = (s: string) => Buffer.from(s).toString('base64url');
    for (const c of ['', 'xxx', '!!!', b64('nao json'), b64('null'), b64('[1]'), b64(JSON.stringify({ o: ORG })),
      b64(JSON.stringify({ o: ORG, d: 'abc' })), b64(JSON.stringify({ o: ORG, d: 5 }))]) {
      expect(await margensDoCatalogo(c, d), c).toEqual({ estado: 'cursor_invalido' });
    }
    expect(d.listarMlbs).not.toHaveBeenCalled();
  });

  it('parcial quando algum anúncio vem sem número por erro_tarifa ou anuncio_indisponivel', async () => {
    const r = await margensDoCatalogo(null, deps(cento20.slice(0, 3), { semPreco: ['MLB1002'] }));
    if (r.estado !== 'ok') throw new Error(r.estado);
    expect(r.parcial).toBe(true);
    let n = 0;
    const r2 = await margensDoCatalogo(null, deps(cento20.slice(0, 3), {
      tarifaEm: vi.fn(async () => { if (++n === 2) throw new Error('ML 500'); return TARIFA; }),
    }));
    if (r2.estado !== 'ok') throw new Error(r2.estado);
    expect(r2.anuncios.some((a) => a.motivo === 'erro_tarifa')).toBe(true);
    expect(r2.parcial).toBe(true);
    // sem_custo é dado da loja, não falha de leitura
    const r3 = await margensDoCatalogo(null, deps([{ mlb: 'MLB1', custo: null, preco: 50 }]));
    if (r3.estado !== 'ok') throw new Error(r3.estado);
    expect(r3.parcial).toBe(false);
  });

  it('catálogo vazio → ok sem anúncios e sem reservar tarifa', async () => {
    const d = deps([]);
    expect(await margensDoCatalogo(null, d)).toMatchObject({ estado: 'ok', anuncios: [], proximo_cursor: null, parcial: false });
    expect(d.reservarTarifas).not.toHaveBeenCalled();
  });
});

describe('saída sem dado sensível', () => {
  it('nenhuma chave custo_centavos, token, fornecedor, comprador', async () => {
    const proibidas = ['custo_centavos', 'token', 'fornecedor', 'comprador'];
    const chaves = (x: unknown, out: string[] = []): string[] => {
      if (Array.isArray(x)) x.forEach((y) => chaves(y, out));
      else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) { out.push(k); chaves(v, out); }
      return out;
    };
    const d = deps([{ mlb: 'MLB1', custo: 14, preco: 50 }, { mlb: 'MLB2', custo: null, preco: 50 }]);
    const saidas = [await margemDoAlvo('MLB1', d), await margensDoCatalogo(null, d), await simularMargem('MLB2', 70, d)];
    for (const s of saidas) {
      expect(s.estado).toBe('ok');
      for (const k of chaves(s)) expect(proibidas.some((p) => k.toLowerCase().includes(p)), k).toBe(false);
    }
  });
});
