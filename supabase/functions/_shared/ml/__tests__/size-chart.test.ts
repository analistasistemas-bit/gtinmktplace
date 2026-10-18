import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  COMPRIMENTO_PE_CM, CONTORNO_PEITO_CM, DOMINIOS_SUPORTADOS, GENDER_VALUE, domainIdSemPrefixo,
  dominioAceitaGrade, garantirChart, mensagemForaDoSuperset, mensagemNumeracaoNaoSuportada,
  montarLinhasChart, montarLinhasChartCalcado, nomeChart, parseLinhasCalcado, parseLinhasResposta,
  tabelaComprimentoPe,
} from '../size-chart.ts';
import { tabelaQuadril } from '../medidas-valores.ts';
import { lerSchemaAtributos } from '../../categoria/schema.ts';

// Só o schema da categoria é fake (rede + Redis); `ehCategoriaMlValida` segue real.
vi.mock('../../categoria/schema.ts', async (orig) => ({
  ...(await orig<typeof import('../../categoria/schema.ts')>()),
  lerSchemaAtributos: vi.fn(),
}));

// Achado real (produção, 2026-09-19): a 1ª tentativa de publicação real ficou presa em retry
// porque POST /catalog/charts recusou o nome com `invalid_chart_name` — a mensagem cita "máximo
// 60 caracteres" mas o nome tinha 45; reproduzido isolado contra a API real, o `_` de
// "JACKETS_AND_COATS" (domain_id cru) é que invalida o nome, não o tamanho. Nome sem `_` (mesmo
// mais longo) passou. `nomeChart` nunca pode deixar `_` vazar pro campo `names`.
describe('nomeChart (ADR-0167 — achado real de produção)', () => {
  it('nunca contém underscore, mesmo com domain_id cru (JACKETS_AND_COATS)', () => {
    const nome = nomeChart('JACKETS_AND_COATS', 'masculino', ['P', 'M', 'G', 'GG']);
    expect(nome).not.toContain('_');
  });

  it('troca underscore por espaço, preservando legibilidade', () => {
    expect(nomeChart('JACKETS_AND_COATS', 'masculino', ['P', 'M'])).toBe('PubliAI Guia Jackets And Coats masculino P-M');
  });

  it('nunca passa de 60 caracteres (limite real confirmado)', () => {
    const nome = nomeChart('JACKETS_AND_COATS', 'masculino', ['P', 'M', 'G', 'GG']);
    expect(nome.length).toBeLessThanOrEqual(60);
  });
});

describe('domainIdSemPrefixo (ADR-0167)', () => {
  it('remove o prefixo MLB- do catalog_domain', () => {
    expect(domainIdSemPrefixo('MLB-JACKETS_AND_COATS')).toBe('JACKETS_AND_COATS');
  });

  it('mantém intacto quando já não tem prefixo', () => {
    expect(domainIdSemPrefixo('JACKETS_AND_COATS')).toBe('JACKETS_AND_COATS');
  });

  it('null/undefined vira null', () => {
    expect(domainIdSemPrefixo(null)).toBeNull();
    expect(domainIdSemPrefixo(undefined)).toBeNull();
  });
});

// Achado real (2026-09-19, pedido do Diego "acrescente o tamanho Único"): confirmado por 3
// chamadas reais (Spike 051 §12) que "Tamanho Único" não pode entrar no guia de tamanhos em
// JACKETS_AND_COATS/SPORT_T_SHIRTS — FILTRABLE_SIZE não tem essa opção no catálogo do ML, e o
// item exige SIZE_GRID_ID incondicionalmente (nenhuma isenção pra Único). A mensagem de erro
// precisa deixar claro que é limite do ML, não lacuna nossa — senão parece um bug a corrigir.
describe('mensagemForaDoSuperset (ADR-0167 / achado real "Tamanho Único")', () => {
  it('tamanho Único cita a causa real (FILTRABLE_SIZE sem essa opção no ML)', () => {
    const msg = mensagemForaDoSuperset(['Único']);
    expect(msg).toMatch(/FILTRABLE_SIZE/);
    expect(msg).toMatch(/Mercado Livre|ML/);
  });

  it('outros tamanhos fora do superset mantêm a mensagem genérica', () => {
    const msg = mensagemForaDoSuperset(['XG']);
    expect(msg).toMatch(/sem medida confirmada/);
    expect(msg).not.toMatch(/FILTRABLE_SIZE/);
  });

  it('mistura de Único com outro tamanho cita os dois casos', () => {
    const msg = mensagemForaDoSuperset(['XG', 'Único']);
    expect(msg).toMatch(/XG/);
    expect(msg).toMatch(/Único/);
    expect(msg).toMatch(/FILTRABLE_SIZE/);
  });
});

describe('montarLinhasChart (ADR-0167 / Spike 051 §3)', () => {
  const sizeValores = [{ id: '17552780', nome: 'P' }, { id: '2282666', nome: 'M' }];
  // Achado real do spike: FILTRABLE_SIZE tem value_id PRÓPRIO, diferente de SIZE, para o mesmo tamanho.
  const filtravelValores = [{ id: '13853813', nome: 'P' }, { id: '12917795', nome: 'M' }];

  it('monta SIZE + FILTRABLE_SIZE + CHEST_CIRCUMFERENCE_FROM por linha, com ids corretos de cada namespace', () => {
    const linhas = montarLinhasChart(['P', 'M'], sizeValores, filtravelValores);
    expect(linhas).toEqual([
      { attributes: [
        { id: 'SIZE', values: [{ id: '17552780', name: 'P' }] },
        { id: 'FILTRABLE_SIZE', values: [{ id: '13853813', name: 'P' }] },
        { id: 'CHEST_CIRCUMFERENCE_FROM', values: [{ name: '88 cm' }] },
      ] },
      { attributes: [
        { id: 'SIZE', values: [{ id: '2282666', name: 'M' }] },
        { id: 'FILTRABLE_SIZE', values: [{ id: '12917795', name: 'M' }] },
        { id: 'CHEST_CIRCUMFERENCE_FROM', values: [{ name: '96 cm' }] },
      ] },
    ]);
  });

  it('tamanho sem medida confirmada (ex.: Tamanho Único) falha alto em vez de inventar', () => {
    expect(() => montarLinhasChart(['Único'], sizeValores, filtravelValores))
      .toThrow(/sem valor\/medida confirmado/);
  });

  it('tamanho sem value_id em SIZE ou FILTRABLE_SIZE falha alto', () => {
    expect(() => montarLinhasChart(['G'], sizeValores, filtravelValores)).toThrow();
  });

  it('CONTORNO_PEITO_CM só cobre P/M/G/GG — trava contra regressão silenciosa', () => {
    expect(Object.keys(CONTORNO_PEITO_CM).sort()).toEqual(['G', 'GG', 'M', 'P']);
  });
});

describe('parseLinhasResposta (ADR-0167 / Spike 051 §3)', () => {
  it('extrai tamanho -> {rowId, sizeLabel} da resposta real do ML', () => {
    const rows = [
      { id: '8522331:1', attributes: [{ id: 'SIZE', values: [{ name: 'P' }] }, { id: 'FILTRABLE_SIZE', values: [{ name: 'P' }] }] },
      { id: '8522331:2', attributes: [{ id: 'SIZE', values: [{ name: 'M' }] }] },
    ];
    const mapa = parseLinhasResposta(rows);
    expect(mapa.get('P')).toEqual({ rowId: '8522331:1', sizeLabel: 'P' });
    expect(mapa.get('M')).toEqual({ rowId: '8522331:2', sizeLabel: 'M' });
    expect(mapa.size).toBe(2);
  });

  it('linha sem atributo SIZE não entra no mapa', () => {
    const rows = [{ id: '8522331:9', attributes: [{ id: 'FILTRABLE_SIZE', values: [{ name: 'P' }] }] }];
    expect(parseLinhasResposta(rows).size).toBe(0);
  });
});

// ADR-0167 / achado real 2026-09-19 (pedido do Diego: "veja agora a de sapato/sandalias"):
// FOOTWEAR não usa SIZE+FILTRABLE_SIZE+CHEST_CIRCUMFERENCE_FROM como vestuário — usa
// BR_SIZE+FOOT_LENGTH (confirmado via POST /catalog/charts real contra SANDALS_AND_CLOGS,
// Spike 051 §13). COMPRIMENTO_PE_CM vem do chart STANDARD oficial do próprio ML (masculino
// id 210058, feminino id 210059) — não é tabela inventada, é dado publicado pelo ML.
describe('COMPRIMENTO_PE_CM (ADR-0167 / Spike 051 §13 — dado real do chart STANDARD do ML)', () => {
  it('masculino cobre 33 a 48 (chart STANDARD real 210058)', () => {
    expect(COMPRIMENTO_PE_CM.masculino['33']).toBe(22.5);
    expect(COMPRIMENTO_PE_CM.masculino['40']).toBe(26.5);
    expect(COMPRIMENTO_PE_CM.masculino['48']).toBe(33);
  });

  it('feminino cobre 33 a 44 (chart STANDARD real 210059)', () => {
    expect(COMPRIMENTO_PE_CM.feminino['33']).toBe(22);
    expect(COMPRIMENTO_PE_CM.feminino['37']).toBe(24.7);
    expect(COMPRIMENTO_PE_CM.feminino['44']).toBe(29.3);
  });
});

describe('tabelaComprimentoPe (ADR-0167)', () => {
  it('feminino usa a própria tabela', () => {
    expect(tabelaComprimentoPe('feminino')).toBe(COMPRIMENTO_PE_CM.feminino);
  });

  it('masculino usa a própria tabela', () => {
    expect(tabelaComprimentoPe('masculino')).toBe(COMPRIMENTO_PE_CM.masculino);
  });

  // Decisão explícita: o ML não publica chart STANDARD "Sem gênero" (testado, resposta vazia,
  // Spike 051 §13) — unissex reaproveita a tabela masculino (cobre 33-48 por completo, igual à
  // faixa de NUMERACOES_CALCADO; a feminino para em 44). Assunção sinalizada ao Diego.
  it('unissex reaproveita a tabela masculino (sem chart STANDARD "Sem gênero" no ML)', () => {
    expect(tabelaComprimentoPe('unissex')).toBe(COMPRIMENTO_PE_CM.masculino);
  });
});

describe('montarLinhasChartCalcado (ADR-0167 / Spike 051 §13)', () => {
  it('monta BR_SIZE + FOOT_LENGTH com struct numérico (formato real confirmado)', () => {
    const linhas = montarLinhasChartCalcado(['37', '40'], COMPRIMENTO_PE_CM.feminino);
    expect(linhas).toEqual([
      { attributes: [
        { id: 'BR_SIZE', values: [{ name: '37 BR', struct: { number: 37, unit: 'BR' } }] },
        { id: 'FOOT_LENGTH', values: [{ name: '24.7 cm', struct: { number: 24.7, unit: 'cm' } }] },
      ] },
      { attributes: [
        { id: 'BR_SIZE', values: [{ name: '40 BR', struct: { number: 40, unit: 'BR' } }] },
        { id: 'FOOT_LENGTH', values: [{ name: '26.7 cm', struct: { number: 26.7, unit: 'cm' } }] },
      ] },
    ]);
  });

  it('numeração fora da tabela (ex.: par "33/34") falha alto em vez de inventar', () => {
    expect(() => montarLinhasChartCalcado(['33/34'], COMPRIMENTO_PE_CM.masculino)).toThrow();
  });
});

// Achado real (2026-09-19, sandália): /items/validate recusou o item com SIZE="37"
// (invalid.fashion_grid.size.values) e só aceitou com SIZE="37 BR" — o rótulo da linha do chart,
// não o valor cru da categoria. `sizeLabel` existe pra carregar esse rótulo até o payload do item.
describe('parseLinhasCalcado (ADR-0167 / Spike 051 §13 — sizeLabel é o achado real de produção)', () => {
  it('extrai numeração -> {rowId, sizeLabel} de um chart STANDARD real (atributo SIZE com struct.number)', () => {
    const rows = [
      { id: '210058:8', attributes: [{ id: 'SIZE', values: [{ name: '40 BR', struct: { number: 40 } }] }] },
    ];
    expect(parseLinhasCalcado(rows).get('40')).toEqual({ rowId: '210058:8', sizeLabel: '40 BR' });
  });

  it('extrai numeração -> {rowId, sizeLabel} de um chart SPECIFIC nosso (atributo BR_SIZE com struct.number)', () => {
    const rows = [
      { id: '8077736:1', attributes: [{ id: 'BR_SIZE', values: [{ name: '37 BR', struct: { number: 37 } }] }] },
    ];
    expect(parseLinhasCalcado(rows).get('37')).toEqual({ rowId: '8077736:1', sizeLabel: '37 BR' });
  });

  it('linha sem SIZE nem BR_SIZE não entra no mapa', () => {
    const rows = [{ id: 'x:1', attributes: [{ id: 'FOOT_LENGTH', values: [{ name: '24 cm' }] }] }];
    expect(parseLinhasCalcado(rows).size).toBe(0);
  });
});

describe('mensagemNumeracaoNaoSuportada (ADR-0167)', () => {
  it('cita o(s) valor(es) e explica que não é lacuna de mapeamento', () => {
    const msg = mensagemNumeracaoNaoSuportada(['33/34', '45/46']);
    expect(msg).toMatch(/33\/34/);
    expect(msg).toMatch(/45\/46/);
    expect(msg).toMatch(/comprimento de p[ée]/i);
  });
});

// Achado real (revisão Fable, 2026-09-19): charts criados antes de 0cec85cb gravaram `linhas`
// como `{tamanho: "rowId:versao"}` (string) — a migration 20260919154953 documenta esse formato.
// O código novo espera `{tamanho: {rowId, sizeLabel}}`. Sem normalizar na leitura, uma linha
// antiga vira a própria string em `linha?.rowId` (undefined) e a publicação quebra por
// sizeGridRowId ausente. Este teste cobre exatamente o ramo do cache em `garantirChart` que o
// CI anterior não pegava (só havia mock de `garantirChartFn`, nunca a função real).
describe('garantirChart — cache em formato antigo (ADR-0167, achado real Fable)', () => {
  function adminStub(linhas: unknown): SupabaseClient {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: { chart_id: '8522331', linhas } }),
                }),
              }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;
  }

  it('normaliza linha antiga (string "rowId:versao") para {rowId, sizeLabel: tamanho}', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ settings: { catalog_domain: 'MLB-JACKETS_AND_COATS' } }),
    })) as unknown as typeof fetch);

    const resolvido = await garantirChart(
      adminStub({ P: '8522331:1', M: '8522331:2' }),
      'token', 'conexao-1', 'MLB123', 'masculino', ['P', 'M'], 'letras',
    );

    expect(resolvido!.linhaPorTamanho.get('P')).toEqual({ rowId: '8522331:1', sizeLabel: 'P' });
    expect(resolvido!.linhaPorTamanho.get('M')).toEqual({ rowId: '8522331:2', sizeLabel: 'M' });

    vi.unstubAllGlobals();
  });

  it('mantém linha já no formato novo ({rowId, sizeLabel}) sem alterar', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ settings: { catalog_domain: 'MLB-SANDALS_AND_CLOGS' } }),
    })) as unknown as typeof fetch);

    const resolvido = await garantirChart(
      adminStub({ 37: { rowId: '8078230:5', sizeLabel: '37 BR' } }),
      'token', 'conexao-1', 'MLB123', 'unissex', ['37'], 'calcado',
    );

    expect(resolvido!.linhaPorTamanho.get('37')).toEqual({ rowId: '8078230:5', sizeLabel: '37 BR' });

    vi.unstubAllGlobals();
  });
});

// ADR-0182 / Spike 056: quadril (SHORTS/PANTS), CLOTHING_LOTS sem guia, grade × domínio.
// "Sem chamar o ML" = nenhuma URL de /catalog/charts: o GET /categories (domínio) é inevitável.
describe('ADR-0182 — guia de quadril e domínio sem guia', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.mocked(lerSchemaAtributos).mockReset(); });

  /** Admin fake que registra toda chamada a `from` (cache `ml_size_charts`). O cache é indexado
   *  pela chave completa `conexão|domínio|gênero|grade` (ADR-0182 D6): só devolve a linha se os
   *  4 filtros `eq` baterem — prova que a busca usa a chave inteira. */
  function adminFake(cache: Record<string, unknown> = {}) {
    const inserts: Array<Record<string, unknown>> = [];
    const from = vi.fn(() => ({
      select: () => {
        const filtros: Record<string, unknown> = {};
        const q = {
          eq: (col: string, v: unknown) => { filtros[col] = v; return q; },
          maybeSingle: () => Promise.resolve({ data: cache[
            [filtros.connection_id, filtros.domain_id, filtros.genero, filtros.grade_tamanho].join('|')
          ] ?? null }),
        };
        return q;
      },
      insert: (row: Record<string, unknown>) => { inserts.push(row); return Promise.resolve({ error: null }); },
    }));
    return { admin: { from } as unknown as SupabaseClient, from, inserts };
  }

  type Row = { attributes: Array<{ id: string; values: Array<{ name: string }> }> };
  /** fetch fake: GET /categories devolve o domínio; POST /catalog/charts ecoa as linhas com id. */
  function fetchFake(dominio: string) {
    const posts: Array<{ url: string; body: { rows: Row[]; names: unknown; attributes: unknown } }> = [];
    const fn = vi.fn(async (url: string, init?: { body?: string }) => {
      if (url.includes('/categories/')) {
        return { ok: true, json: async () => ({ settings: { catalog_domain: `MLB-${dominio}` } }) };
      }
      const body = JSON.parse(init?.body ?? '{}');
      posts.push({ url, body });
      return {
        ok: true, status: 201,
        json: async () => ({ id: 999, rows: body.rows.map((r: Row, i: number) => ({ id: `999:${i + 1}`, ...r })) }),
      };
    });
    vi.stubGlobal('fetch', fn as unknown as typeof fetch);
    return { posts, urls: () => fn.mock.calls.map((c) => String(c[0])) };
  }

  it('GENDER_VALUE tem os 6 gêneros com os ids do Spike 056 / ADR-0182 D3', () => {
    expect(GENDER_VALUE.sem_genero_infantil).toEqual({ id: '19159491', nome: 'Sem gênero infantil' });
    expect(GENDER_VALUE.meninos).toEqual({ id: '339667', nome: 'Meninos' });
    expect(GENDER_VALUE.meninas).toEqual({ id: '339668', nome: 'Meninas' });
    expect(GENDER_VALUE.masculino.id).toBe('339666');
    expect(GENDER_VALUE.feminino.id).toBe('339665');
    expect(GENDER_VALUE.unissex.id).toBe('110461');
  });

  it('SHORTS, PANTS, CLOTHING_LOTS e SWIMWEAR entram em DOMINIOS_SUPORTADOS', () => {
    for (const d of ['SHORTS', 'PANTS', 'CLOTHING_LOTS', 'SWIMWEAR', 'JACKETS_AND_COATS', 'SPORT_T_SHIRTS', 'SNEAKERS', 'SANDALS_AND_CLOGS']) {
      expect(DOMINIOS_SUPORTADOS.has(d)).toBe(true);
    }
  });

  it('montarLinhasChart de quadril infantil: FILTRABLE_SIZE "4 anos" e HIP_CIRCUMFERENCE_FROM "62 cm"', () => {
    const size = [{ id: '4119847', nome: '4' }];
    const filt = [{ id: '99', nome: '4' }, { id: '12189465', nome: '4 anos' }];
    const linhas = montarLinhasChart(['4'], size, filt, tabelaQuadril('meninos'), 'HIP_CIRCUMFERENCE_FROM', (t) => `${t} anos`);
    expect(linhas).toEqual([{ attributes: [
      { id: 'SIZE', values: [{ id: '4119847', name: '4' }] },
      { id: 'FILTRABLE_SIZE', values: [{ id: '12189465', name: '4 anos' }] },
      { id: 'HIP_CIRCUMFERENCE_FROM', values: [{ name: '62 cm' }] },
    ] }]);
  });

  it('dominioAceitaGrade: calçado só em domínio de calçado; infantil/calça só em quadril/sem guia', () => {
    expect(dominioAceitaGrade('SNEAKERS', 'calcado')).toBe(true);
    expect(dominioAceitaGrade('SANDALS_AND_CLOGS', 'calcado')).toBe(true);
    expect(dominioAceitaGrade('PANTS', 'calcado')).toBe(false);
    expect(dominioAceitaGrade('CLOTHING_LOTS', 'calcado')).toBe(false);
    expect(dominioAceitaGrade('JACKETS_AND_COATS', 'letras')).toBe(true);
    expect(dominioAceitaGrade('SHORTS', 'letras')).toBe(true);
    expect(dominioAceitaGrade('CLOTHING_LOTS', 'letras')).toBe(true);
    expect(dominioAceitaGrade('SNEAKERS', 'letras')).toBe(false);
    expect(dominioAceitaGrade('PANTS', 'calca')).toBe(true);
    expect(dominioAceitaGrade('CLOTHING_LOTS', 'infantil')).toBe(true);
    expect(dominioAceitaGrade('SNEAKERS', 'calca')).toBe(false);
    expect(dominioAceitaGrade('JACKETS_AND_COATS', 'infantil')).toBe(false);
    expect(dominioAceitaGrade('SWIMWEAR', 'infantil')).toBe(true);
    expect(dominioAceitaGrade('SWIMWEAR', 'calcado')).toBe(false);
  });

  it.each([['CLOTHING_LOTS', 'CLOTHING_LOT_SIZE'], ['SWIMWEAR', 'SIZE']] as const)(
    '%s → sem guia (tamanho em %s), sem tocar o cache nem chamar /catalog/charts', async (dominio, atributo) => {
      const { admin, from } = adminFake();
      const f = fetchFake(dominio);
      const r = await garantirChart(admin, 'token', 'conexao-1', 'MLB1', 'meninas', ['4', '6'], 'infantil');
      expect(r).toEqual({ semGuia: atributo });
      expect(from).not.toHaveBeenCalled();
      expect(f.urls().every((u) => u.includes('/categories/'))).toBe(true);
    },
  );

  it.each([['SNEAKERS', 'calca'], ['PANTS', 'calcado']] as const)(
    'grade %s/%s incompatível lança antes de cache/chart', async (dominio, grade) => {
      const { admin, from } = adminFake();
      const f = fetchFake(dominio);
      await expect(garantirChart(admin, 'token', 'conexao-1', 'MLB1', 'masculino', ['40'], grade))
        .rejects.toThrow(`Guia de tamanhos: grade ${grade} incompatível com o domínio ${dominio} — confira a categoria do produto.`);
      expect(from).not.toHaveBeenCalled();
      expect(f.urls().every((u) => u.includes('/categories/'))).toBe(true);
    },
  );

  it('gênero fora de GENDER_VALUE lança antes do cache (nunca cai na tabela masculina em silêncio)', async () => {
    const { admin, from } = adminFake();
    fetchFake('PANTS');
    await expect(garantirChart(admin, 'token', 'c', 'MLB1', 'bebes' as never, ['40'], 'calca')).rejects.toThrow(/gênero/);
    expect(from).not.toHaveBeenCalled();
  });

  it('gênero incoerente com a grade (Calça + meninos) lança antes do cache', async () => {
    const { admin, from } = adminFake();
    fetchFake('PANTS');
    await expect(garantirChart(admin, 'token', 'c', 'MLB1', 'meninos', ['40'], 'calca')).rejects.toThrow(/gênero/);
    expect(from).not.toHaveBeenCalled();
  });

  it('PANTS feminino calça sem cache → POST só com as 8 linhas da Calça (Letras fora: ML recusa FILTRABLE_SIZE misto), 40 → 102 cm', async () => {
    const tamanhosCategoria = ['P', 'M', 'G', 'GG', '34', '36', '38', '40', '42', '44', '46', '48', '2', '4'];
    vi.mocked(lerSchemaAtributos).mockResolvedValue([
      { id: 'SIZE', valores: tamanhosCategoria.map((t, i) => ({ id: `s${i}`, nome: t })) },
      { id: 'FILTRABLE_SIZE', valores: [...tamanhosCategoria.slice(0, 12), '2 anos', '4 anos'].map((t, i) => ({ id: `f${i}`, nome: t })) },
    ] as never);
    const { admin, inserts } = adminFake();
    const f = fetchFake('PANTS');

    const r = await garantirChart(admin, 'token', 'conexao-1', 'MLB188065', 'feminino', ['40'], 'calca');

    expect(f.posts).toHaveLength(1);
    const rows = f.posts[0].body.rows;
    expect(rows).toHaveLength(8);
    const nomesSize = rows.map((row) => row.attributes.find((a) => a.id === 'SIZE')!.values[0].name);
    expect(new Set(nomesSize)).toEqual(new Set(['34', '36', '38', '40', '42', '44', '46', '48']));
    for (const row of rows) {
      expect(row.attributes.map((a) => a.id)).toEqual(['SIZE', 'FILTRABLE_SIZE', 'HIP_CIRCUMFERENCE_FROM']);
    }
    const linha40 = rows.find((row) => row.attributes[0].values[0].name === '40')!;
    expect(linha40.attributes[1].values[0].name).toBe('40');
    expect(linha40.attributes[2].values[0].name).toBe('102 cm');
    expect(f.posts[0].body.attributes).toEqual([{ id: 'GENDER', values: [{ id: '339665', name: 'Feminino' }] }]);
    expect(r!.linhaPorTamanho.get('40')?.sizeLabel).toBe('40');
    expect(inserts).toHaveLength(1);
  });

  // ADR-0182 D6 (ensaio real 2026-10-16): o ML recusou o chart adulto misto Letras + Calça com
  // `value_is_not_the_same_type` — cache e superset passam a ser por grade.
  function schemaAdulto() {
    const tamanhos = ['P', 'M', 'G', 'GG', '34', '36', '38', '40', '42', '44', '46', '48', '2', '4'];
    vi.mocked(lerSchemaAtributos).mockResolvedValue([
      { id: 'SIZE', valores: tamanhos.map((t, i) => ({ id: `s${i}`, nome: t })) },
      { id: 'FILTRABLE_SIZE', valores: tamanhos.map((t, i) => ({ id: `f${i}`, nome: t })) },
    ] as never);
  }
  const nomes = (rows: Row[]) => rows.map((row) => row.attributes[0].values[0].name);

  it('PANTS masculino calça → POST com exatamente 34..48 e cache gravado com grade_tamanho calca', async () => {
    schemaAdulto();
    const { admin, inserts } = adminFake();
    const f = fetchFake('PANTS');
    await garantirChart(admin, 'token', 'conexao-1', 'MLB1', 'masculino', ['40'], 'calca');
    expect(f.posts).toHaveLength(1);
    expect(nomes(f.posts[0].body.rows)).toEqual(['34', '36', '38', '40', '42', '44', '46', '48']);
    expect(f.posts[0].body.rows[3].attributes[2]).toEqual({ id: 'HIP_CIRCUMFERENCE_FROM', values: [{ name: '100 cm' }] });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      connection_id: 'conexao-1', domain_id: 'PANTS', genero: 'masculino', grade_tamanho: 'calca', chart_id: '999',
    });
  });

  it('SHORTS masculino letras → POST com 4 linhas (P, M, G, GG)', async () => {
    schemaAdulto();
    const { admin, inserts } = adminFake();
    const f = fetchFake('SHORTS');
    await garantirChart(admin, 'token', 'conexao-1', 'MLB1', 'masculino', ['M'], 'letras');
    expect(nomes(f.posts[0].body.rows)).toEqual(['P', 'M', 'G', 'GG']);
    expect(inserts[0]).toMatchObject({ grade_tamanho: 'letras' });
  });

  it('cache de (conexão, SHORTS, masculino, letras) não serve um pedido de calça → chart novo', async () => {
    schemaAdulto();
    const { admin, inserts } = adminFake({
      'conexao-1|SHORTS|masculino|letras': { chart_id: '111', linhas: { P: { rowId: '111:1', sizeLabel: 'P' } } },
    });
    const f = fetchFake('SHORTS');
    const r = await garantirChart(admin, 'token', 'conexao-1', 'MLB1', 'masculino', ['40'], 'calca');
    expect(f.posts).toHaveLength(1);
    expect(nomes(f.posts[0].body.rows)).toEqual(['34', '36', '38', '40', '42', '44', '46', '48']);
    expect(r!.chartId).toBe('999');
    expect(inserts[0]).toMatchObject({ domain_id: 'SHORTS', grade_tamanho: 'calca' });
  });

  it('SHORTS meninos sem cache → 8 linhas infantis com FILTRABLE_SIZE "<n> anos"', async () => {
    const infantil = ['2', '4', '6', '8', '10', '12', '14', '16'];
    vi.mocked(lerSchemaAtributos).mockResolvedValue([
      { id: 'SIZE', valores: [...infantil, 'P'].map((t, i) => ({ id: `s${i}`, nome: t })) },
      { id: 'FILTRABLE_SIZE', valores: infantil.map((t, i) => ({ id: `f${i}`, nome: `${t} anos` })) },
    ] as never);
    const { admin } = adminFake();
    const f = fetchFake('SHORTS');
    await garantirChart(admin, 'token', 'conexao-1', 'MLB188064', 'meninos', ['4'], 'infantil');
    const rows = f.posts[0].body.rows;
    expect(rows).toHaveLength(8);
    const linha4 = rows.find((row) => row.attributes[0].values[0].name === '4')!;
    expect(linha4.attributes[1].values[0].name).toBe('4 anos');
    expect(linha4.attributes[2]).toEqual({ id: 'HIP_CIRCUMFERENCE_FROM', values: [{ name: '62 cm' }] });
    expect((f.posts[0].body.names as { MLB: string }).MLB).not.toContain('_');
  });

  it('JACKETS_AND_COATS com cache existente devolve o cache, sem POST (regressão, Review Focus 4)', async () => {
    const { admin, inserts } = adminFake({
      'conexao-1|JACKETS_AND_COATS|masculino|letras': { chart_id: '8522331', linhas: { P: { rowId: '8522331:1', sizeLabel: 'P' } } },
    });
    const f = fetchFake('JACKETS_AND_COATS');
    const r = await garantirChart(admin, 'token', 'conexao-1', 'MLB1', 'masculino', ['P'], 'letras');
    expect(r).toEqual({ chartId: '8522331', linhaPorTamanho: new Map([['P', { rowId: '8522331:1', sizeLabel: 'P' }]]) });
    expect(f.posts).toHaveLength(0);
    expect(inserts).toHaveLength(0);
    expect(lerSchemaAtributos).not.toHaveBeenCalled();
  });

  it('JACKETS_AND_COATS sem cache segue no peito (CHEST_CIRCUMFERENCE_FROM, regressão)', async () => {
    vi.mocked(lerSchemaAtributos).mockResolvedValue([
      { id: 'SIZE', valores: ['P', 'M', 'G', 'GG'].map((t, i) => ({ id: `s${i}`, nome: t })) },
      { id: 'FILTRABLE_SIZE', valores: ['P', 'M', 'G', 'GG'].map((t, i) => ({ id: `f${i}`, nome: t })) },
    ] as never);
    const { admin } = adminFake();
    const f = fetchFake('JACKETS_AND_COATS');
    await garantirChart(admin, 'token', 'conexao-1', 'MLB1', 'masculino', ['P'], 'letras');
    const rows = f.posts[0].body.rows;
    expect(rows.map((row) => row.attributes[0].values[0].name)).toEqual(['P', 'M', 'G', 'GG']);
    expect(rows.every((row) => row.attributes[2].id === 'CHEST_CIRCUMFERENCE_FROM')).toBe(true);
    expect(rows[0].attributes[2].values[0].name).toBe('88 cm');
    expect(f.posts[0].body.names).toEqual({ MLB: 'PubliAI Guia Jackets And Coats masculino P-M-G-GG' });
  });

  it('nomeChart normaliza o gênero infantil e mantém os nomes adultos', () => {
    expect(nomeChart('SHORTS', 'sem_genero_infantil', ['2', '4'])).not.toContain('_');
    expect(nomeChart('JACKETS_AND_COATS', 'masculino', ['P'])).toBe('PubliAI Guia Jackets And Coats masculino P');
  });
});
