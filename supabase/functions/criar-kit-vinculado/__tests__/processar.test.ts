// ADR-0151: cria kit(s) vinculado(s) a partir de uma família-base. Vitest (não Deno test) —
// é o runner que o CI e o vitest.config.ts realmente executam.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { criarKitsVinculados, type CriarKitDeps, type KitSolicitado } from '../processar.ts';
import { aplicarKitNosAtributos } from '../../_shared/categoria/atributos.ts';

// ATENÇÃO ao shape: `AtributoSchema` usa `valores: {id, nome}[]` (schema.ts:16), NÃO
// `values: {id, name}[]` — `parseAtributosSchema` já traduz o JSON da API do ML. Escrever
// o fixture com `values`/`name` faria o teste passar contra um código igualmente errado.
const SCHEMA_COM_KIT = [
  {
    id: 'SALE_FORMAT', nome: 'Formato de venda', valueType: 'list',
    valores: [{ id: 'V-UN', nome: 'Unidade' }, { id: 'V-KIT', nome: 'Kit' }],
  },
  { id: 'UNITS_PER_PACK', nome: 'Unidades por kit', valueType: 'number', valores: [] },
];
const SCHEMA_SEM_KIT = [{ id: 'BRAND', nome: 'Marca', valueType: 'string', valores: [] }];

describe('aplicarKitNosAtributos', () => {
  it('sobrescreve SALE_FORMAT e UNITS_PER_PACK pelo N', () => {
    const r = aplicarKitNosAtributos(
      SCHEMA_COM_KIT as never,
      [{ id: 'SALE_FORMAT', value_id: 'V-UN' }, { id: 'BRAND', value_name: 'ACME' }],
      3,
    );
    expect(r.find((a) => a.id === 'SALE_FORMAT')?.value_id).toEqual('V-KIT');
    expect(r.find((a) => a.id === 'UNITS_PER_PACK')?.value_name).toEqual('3');
    expect(r.find((a) => a.id === 'BRAND')?.value_name).toEqual('ACME');
  });

  it('falha LOUD quando a categoria não expõe SALE_FORMAT=Kit', () => {
    let status: number | undefined;
    try {
      aplicarKitNosAtributos([{ id: 'BRAND' }] as never, [], 3);
    } catch (e) {
      status = (e as Error & { status?: number }).status;
    }
    expect(status).toEqual(400);
  });
});

// ── Colunas reais de `familias`/`variacoes`, lidas do snapshot de schema versionado
// (`src/lib/database.types.ts`). Ler o schema em vez de escrever a lista à mão é o ponto do
// teste de paridade abaixo: uma lista fixa envelhece junto com o builder que ela deveria vigiar
// (ADR-0129, correção 2026-08-21).
function parseColunas(types: string, tabela: string): { nome: string; nullable: boolean }[] {
  const re = new RegExp(`\\n      ${tabela}: \\{\\n        Row: \\{\\n([\\s\\S]*?)\\n        \\}\\n`);
  const bloco = re.exec(types);
  if (!bloco) throw new Error(`bloco Row de \`${tabela}\` não encontrado em database.types.ts`);
  const linhas = bloco[1].split('\n');
  const colunas: { nome: string; nullable: boolean }[] = [];
  let i = 0;
  while (i < linhas.length) {
    const m = /^ {10}([a-z0-9_]+)\??: ?(.*)$/.exec(linhas[i]);
    if (!m) { i++; continue; }
    const [, nome, resto] = m;
    let tipoTexto = resto;
    let j = i + 1;
    // Tipo em união multi-linha (ex.: `estrategia_preco:\n  | Enum\n  | null`): a linha da
    // propriedade fica vazia e as linhas seguintes (12 espaços + "|") carregam o tipo.
    if (resto.trim() === '') {
      const partes: string[] = [];
      while (j < linhas.length && /^ {12}\|/.test(linhas[j])) { partes.push(linhas[j].trim()); j++; }
      tipoTexto = partes.join(' ');
    }
    colunas.push({ nome, nullable: /\bnull\b/.test(tipoTexto) });
    i = j;
  }
  // Guard anti-"tabela de diagnóstico com 0 linhas": se o gerador mudar de formatação, o parse
  // devolveria poucas colunas e o teste passaria vazio, sem vigiar nada.
  if (colunas.length < 5) throw new Error(`parse de database.types.ts devolveu só ${colunas.length} colunas para ${tabela}`);
  return colunas;
}
function todasColunas(types: string, tabela: string): string[] {
  return parseColunas(types, tabela).map((c) => c.nome);
}
function extrairColunasNotNull(types: string, tabela: string): string[] {
  return parseColunas(types, tabela).filter((c) => !c.nullable).map((c) => c.nome);
}

const TYPES_RAW = readFileSync(resolve(process.cwd(), 'src/lib/database.types.ts'), 'utf8');
const COLS_FAMILIAS = todasColunas(TYPES_RAW, 'familias');
const COLS_VARIACOES = todasColunas(TYPES_RAW, 'variacoes');

/** Linha "cheia" com TODAS as colunas reais (como um `select('*')` real devolveria). */
function linhaFamiliaCheia(overrides: Record<string, unknown>): Record<string, unknown> {
  return { ...Object.fromEntries(COLS_FAMILIAS.map((c) => [c, `valor-${c}`])), ...overrides };
}
function linhaVariacaoCheia(overrides: Record<string, unknown>): Record<string, unknown> {
  return { ...Object.fromEntries(COLS_VARIACOES.map((c) => [c, `valor-${c}`])), ...overrides };
}

function kitPadrao(n: number): KitSolicitado {
  return {
    multiplicador: n,
    chaveCadastro: `uuid-k${n}`,
    titulo: `Kit com ${n} unidades`,
    descricao: 'Descrição do kit',
    preco: 99.9,
    gtin: null,
    imagemPath: 'user-1/kit.jpg',
    alturaCm: 10,
    larguraCm: 10,
    comprimentoCm: 10,
    atacado: null,
  };
}

const BASE_ID = 'f-base';

// ── Fake admin minimalista, feito para a sequência EXATA de queries de criarKitsVinculados
// (dispatch por tabela + shape dos filtros, não um query-builder genérico). ──────────────────
function chain(table: string, state: {
  baseFamilia: Record<string, unknown>;
  baseVariacoes: Record<string, unknown>[];
  existentesFamilias: Record<string, unknown>[];
  existentesVariacoes: Record<string, unknown>[];
  liveKits: { id: string; codigo_pai: string; kit_multiplicador: number }[];
  inserts: { familias: Record<string, unknown>[]; variacoes: Record<string, unknown>[] };
}) {
  type Filtro = { op: 'eq' | 'in' | 'not' | 'is'; val: unknown };
  const rec: { op?: string; filters: Record<string, Filtro>; payload?: unknown } = { filters: {} };
  const api: Record<string, unknown> = {
    select: () => { rec.op = rec.op ?? 'select'; return api; },
    eq: (col: string, val: unknown) => { rec.filters[col] = { op: 'eq', val }; return api; },
    in: (col: string, vals: unknown[]) => { rec.filters[col] = { op: 'in', val: vals }; return api; },
    not: (col: string) => { rec.filters[col] = { op: 'not', val: null }; return api; },
    order: () => api,
    limit: () => api,
    insert: (payload: unknown) => { rec.op = 'insert'; rec.payload = payload; return api; },
    update: (payload: unknown) => { rec.op = 'update'; rec.payload = payload; return api; },
    delete: () => { rec.op = 'delete'; return api; },
    single: async () => resolve(),
    maybeSingle: async () => resolve(),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(resolve()).then(res, rej),
  };
  function resolve(): { data: unknown; error: null } {
    const f = rec.filters;
    if (table === 'familias') {
      if (rec.op === 'insert') {
        const id = `fam-new-${state.inserts.familias.length + 1}`;
        state.inserts.familias.push(rec.payload as Record<string, unknown>);
        return { data: { id }, error: null };
      }
      if (rec.op === 'update' || rec.op === 'delete') return { data: null, error: null };
      if ('chave_cadastro' in f) {
        const chaves = f.chave_cadastro.val as string[];
        return { data: state.existentesFamilias.filter((x) => chaves.includes(x.chave_cadastro as string)), error: null };
      }
      if ('id' in f) {
        return { data: f.id.val === state.baseFamilia.id ? state.baseFamilia : null, error: null };
      }
      if ('kit_base_codigo_pai' in f) {
        return { data: state.liveKits, error: null };
      }
      if ('codigo_pai' in f) return { data: [], error: null }; // codigosJaUsados
      return { data: null, error: null };
    }
    if (table === 'variacoes') {
      if (rec.op === 'insert') {
        state.inserts.variacoes.push(rec.payload as Record<string, unknown>);
        return { data: null, error: null };
      }
      if (rec.op === 'delete') return { data: null, error: null };
      if ('familia_id' in f && f.familia_id.op === 'in') {
        const ids = f.familia_id.val as string[];
        return { data: state.existentesVariacoes.filter((v) => ids.includes(v.familia_id as string)), error: null };
      }
      if ('familia_id' in f && f.familia_id.op === 'eq') {
        return { data: f.familia_id.val === state.baseFamilia.id ? state.baseVariacoes : [], error: null };
      }
      if ('codigo' in f) return { data: [], error: null }; // codigosJaUsados
      return { data: [], error: null };
    }
    if (table === 'lotes') {
      if (rec.op === 'insert') return { data: { id: 'lote-1' }, error: null };
      return { data: null, error: null };
    }
    return { data: null, error: null };
  }
  return api;
}

function depsFake(opts: {
  custo?: number | null;
  peso_gramas?: number | null;
  mlItemId?: string | null;
  qtdVariacoes?: number;
  chavesJaUsadas?: string[];
  categoriaSemKit?: boolean;
} = {}) {
  const {
    custo = 10, peso_gramas: pesoGramas = 100, mlItemId = null,
    qtdVariacoes = 1, chavesJaUsadas = [], categoriaSemKit = false,
  } = opts;

  const baseFamilia = linhaFamiliaCheia({
    id: BASE_ID, org_id: 'org-1', user_id: 'user-1', codigo_pai: '00000010',
    categoria_ml_id: 'MLB123', atributos_ml: [{ id: 'SALE_FORMAT', value_id: 'V-UN' }],
    kit_base_codigo_pai: null, kit_multiplicador: null, ml_item_id: mlItemId,
  });
  const baseVariacoes = Array.from({ length: qtdVariacoes }, (_, i) => linhaVariacaoCheia({
    id: `bv${i}`, familia_id: BASE_ID, org_id: 'org-1', user_id: 'user-1',
    codigo: `0000000${i + 1}`, custo, peso_gramas: pesoGramas,
  }));
  const existentesFamilias = chavesJaUsadas.map((chave) => {
    const n = Number(chave.replace('uuid-k', ''));
    return { id: `fam-exist-${n}`, codigo_pai: `9000000${n}`, kit_multiplicador: n, chave_cadastro: chave };
  });
  const existentesVariacoes = existentesFamilias.map((f) => ({
    familia_id: f.id, codigo: `8000000${f.kit_multiplicador}`,
  }));

  const inserts = { familias: [] as Record<string, unknown>[], variacoes: [] as Record<string, unknown>[] };
  const enfileirados = { processFamilia: 0, publicarFamilias: 0 };
  const state = {
    baseFamilia, baseVariacoes, existentesFamilias, existentesVariacoes,
    liveKits: [] as { id: string; codigo_pai: string; kit_multiplicador: number }[],
    inserts,
  };
  let proximoCodigo = 20;

  const admin = {
    from: (table: string) => chain(table, state),
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'proximo_codigo_produto') {
        const qtd = args.p_qtd as number;
        const ultimo = proximoCodigo;
        proximoCodigo += qtd;
        return { data: ultimo, error: null };
      }
      if (name === 'proximo_numero_lote') return { data: 1, error: null };
      return { data: null, error: null };
    }),
  };

  const deps: CriarKitDeps = {
    admin: admin as never,
    orgId: 'org-1',
    userId: 'user-1',
    resolverToken: async () => 'fake-token',
    lerSchema: async () => (categoriaSemKit ? SCHEMA_SEM_KIT : SCHEMA_COM_KIT) as never,
    encadearPublicacao: async () => { enfileirados.publicarFamilias++; return true; },
  };

  return { deps, inserts, enfileirados };
}

describe('criarKitsVinculados', () => {
  it('kit deriva custo e peso multiplicados por N', async () => {
    const { deps, inserts } = depsFake({ custo: 12.5, peso_gramas: 200 });
    const r = await criarKitsVinculados(deps, {
      familiaBaseId: 'f-base',
      kits: [kitPadrao(3)],
    });
    expect(r.ok).toEqual(true);
    const variacao = inserts.variacoes[0];
    expect(variacao.custo).toEqual(37.5);
    expect(variacao.peso_gramas).toEqual(600);
    expect(variacao.estoque).toEqual(0);
    expect(variacao.gtin).toEqual(null);
  });

  it('kit nasce vinculado à base e pronto, sem passar por process-familia', async () => {
    const { deps, inserts, enfileirados } = depsFake({ custo: 10, peso_gramas: 100 });
    await criarKitsVinculados(deps, {
      familiaBaseId: 'f-base', kits: [kitPadrao(2)],
    });
    const familia = inserts.familias[0];
    expect(familia.kit_base_codigo_pai).toEqual('00000010');
    expect(familia.kit_multiplicador).toEqual(2);
    expect(familia.status).toEqual('pronto');
    expect(familia.operacao).toEqual('CREATE');
    expect(familia.chave_cadastro).toEqual('uuid-k2');
    // Decisão 3: nada de process-familia.
    expect(enfileirados.processFamilia).toEqual(0);
  });

  it('base já publicada encadeia publicar-familias na hora', async () => {
    const { deps, enfileirados } = depsFake({ custo: 10, peso_gramas: 100, mlItemId: 'MLB1' });
    await criarKitsVinculados(deps, {
      familiaBaseId: 'f-base', kits: [kitPadrao(2)],
    });
    expect(enfileirados.publicarFamilias).toEqual(1);
  });

  it('base ainda não publicada NÃO encadeia — quem publica é o worker do CREATE da base', async () => {
    const { deps, enfileirados } = depsFake({ custo: 10, peso_gramas: 100, mlItemId: null });
    await criarKitsVinculados(deps, {
      familiaBaseId: 'f-base', kits: [kitPadrao(2)],
    });
    expect(enfileirados.publicarFamilias).toEqual(0);
  });

  it('base com mais de uma variação é recusada (escopo v1)', async () => {
    const { deps } = depsFake({ custo: 10, peso_gramas: 100, qtdVariacoes: 2 });
    const r = await criarKitsVinculados(deps, {
      familiaBaseId: 'f-base', kits: [kitPadrao(2)],
    });
    expect(r.ok).toEqual(false);
    expect(r.motivo).toEqual('base_multivariacao');
  });

  it('base sem custo é recusada LOUD (custo alimenta markup, ADR-0055)', async () => {
    const { deps } = depsFake({ custo: null, peso_gramas: 100 });
    const r = await criarKitsVinculados(deps, {
      familiaBaseId: 'f-base', kits: [kitPadrao(2)],
    });
    expect(r.ok).toEqual(false);
    expect(r.motivo).toEqual('base_sem_custo');
  });

  it('base sem peso é recusada LOUD (peso alimenta frete, ADR-0018)', async () => {
    const { deps } = depsFake({ custo: 10, peso_gramas: null });
    const r = await criarKitsVinculados(deps, {
      familiaBaseId: 'f-base', kits: [kitPadrao(2)],
    });
    expect(r.ok).toEqual(false);
    expect(r.motivo).toEqual('base_sem_peso');
  });

  it('categoria sem suporte a Kit falha LOUD', async () => {
    const { deps } = depsFake({ custo: 10, peso_gramas: 100, categoriaSemKit: true });
    const r = await criarKitsVinculados(deps, {
      familiaBaseId: 'f-base', kits: [kitPadrao(2)],
    });
    expect(r.ok).toEqual(false);
    expect(r.motivo).toEqual('categoria_sem_kit');
    expect(r.mensagem).toMatch(/Kit/);
  });

  it('DOIS tamanhos num clique criam duas famílias com chaves distintas', async () => {
    // Com uma `chave_cadastro` só para a submissão, o 2º insert colidiria no unique parcial
    // (23505) e o rollback cancelaria tudo — só kit único funcionaria.
    const { deps, inserts } = depsFake({ custo: 10, peso_gramas: 100 });
    const r = await criarKitsVinculados(deps, {
      familiaBaseId: 'f-base', kits: [kitPadrao(2), kitPadrao(3)],
    });
    expect(r.ok).toEqual(true);
    expect(inserts.familias.length).toEqual(2);
    const chaves = inserts.familias.map((f) => f.chave_cadastro);
    expect(new Set(chaves).size).toEqual(2);
    expect(inserts.familias.map((f) => f.kit_multiplicador).sort()).toEqual([2, 3]);
  });

  it('reenvio das mesmas chaves devolve os kits originais sem criar outros', async () => {
    const { deps, inserts } = depsFake({
      custo: 10, peso_gramas: 100, chavesJaUsadas: ['uuid-k2', 'uuid-k3'],
    });
    const r = await criarKitsVinculados(deps, {
      familiaBaseId: 'f-base', kits: [kitPadrao(2), kitPadrao(3)],
    });
    expect(r.ok).toEqual(true);
    expect(inserts.familias.length).toEqual(0);
    expect(r.kits?.length).toEqual(2);
  });

  it('reenvio PARCIAL (1 das 2 chaves já usada) não duplica a que já existe', async () => {
    const { deps, inserts } = depsFake({ custo: 10, peso_gramas: 100, chavesJaUsadas: ['uuid-k2'] });
    const r = await criarKitsVinculados(deps, {
      familiaBaseId: 'f-base', kits: [kitPadrao(2), kitPadrao(3)],
    });
    expect(r.ok).toEqual(true);
    expect(inserts.familias.length).toEqual(1);
    expect(inserts.familias[0].kit_multiplicador).toEqual(3);
  });

  it('multiplicador fora de 2..6 é recusado', async () => {
    const { deps } = depsFake({ custo: 10, peso_gramas: 100 });
    for (const n of [1, 7, 0, -2]) {
      const r = await criarKitsVinculados(deps, {
        familiaBaseId: 'f-base', kits: [kitPadrao(n)],
      });
      expect(r.ok).toEqual(false);
      expect(r.motivo).toEqual('multiplicador_invalido');
    }
  });

  it('título acima de 60 caracteres é recusado', async () => {
    const { deps } = depsFake({ custo: 10, peso_gramas: 100 });
    const r = await criarKitsVinculados(deps, {
      familiaBaseId: 'f-base',
      kits: [{ ...kitPadrao(2), titulo: 'x'.repeat(61) }],
    });
    expect(r.ok).toEqual(false);
    expect(r.motivo).toEqual('titulo_longo');
  });

  it('multiplicador repetido na mesma submissão é recusado', async () => {
    const { deps } = depsFake({ custo: 10, peso_gramas: 100 });
    const r = await criarKitsVinculados(deps, {
      familiaBaseId: 'f-base', kits: [kitPadrao(2), { ...kitPadrao(2), chaveCadastro: 'uuid-outra' }],
    });
    expect(r.ok).toEqual(false);
    expect(r.motivo).toEqual('kit_duplicado');
  });

  /**
   * ADR-0129 (correção 2026-08-21): o PostgREST une as chaves das linhas de um insert
   * multi-linha e grava NULL EXPLÍCITO nas que faltam, atropelando o DEFAULT da coluna.
   * A lista de colunas vem do snapshot de schema versionado, nunca escrita à mão — lista
   * fixa envelheceria junto com o builder que deveria vigiar.
   *
   * Aqui o insert é sempre uma linha por chamada (nunca um array misto), então o bug de
   * UNIÃO de chaves não se aplica — mas a garantia equivalente continua valendo: nenhuma
   * coluna NOT NULL pode ficar de fora do objeto montado (clone da base + overrides).
   */
  it('builders cobrem toda coluna NOT NULL sem default de familias e variacoes', async () => {
    // `id`/`criado_em`/`atualizado_em` são as únicas NOT NULL que este insert deixa de fora
    // DE PROPÓSITO — nascem do DEFAULT da coluna (gen_random_uuid()/now()), mesmo padrão de
    // cadastrar-produto e adicionar-variacoes-familia. Presentes = NULL explícito atropelando
    // o DEFAULT (o bug do ADR-0129); ausentes = DEFAULT intacto. É por isso que o insert é
    // sempre uma linha por chamada — omitir a chave inteira só é seguro fora de um union.
    const SEM_DEFAULT_NA_LINHA = new Set(['id', 'criado_em', 'atualizado_em']);
    const colunasNotNull = (tabela: string) =>
      extrairColunasNotNull(TYPES_RAW, tabela).filter((c) => !SEM_DEFAULT_NA_LINHA.has(c));
    const { deps, inserts } = depsFake({ custo: 10, peso_gramas: 100 });
    await criarKitsVinculados(deps, {
      familiaBaseId: 'f-base', kits: [kitPadrao(2)],
    });
    for (const col of colunasNotNull('familias')) {
      expect(col in inserts.familias[0]).toEqual(true);
    }
    for (const col of colunasNotNull('variacoes')) {
      expect(col in inserts.variacoes[0]).toEqual(true);
    }
    // Os três ficam mesmo de fora — confirma que a exclusão acima é intencional, não um
    // esquecimento do builder.
    for (const col of SEM_DEFAULT_NA_LINHA) {
      expect(col in inserts.familias[0]).toEqual(false);
      expect(col in inserts.variacoes[0]).toEqual(false);
    }
  });
});
