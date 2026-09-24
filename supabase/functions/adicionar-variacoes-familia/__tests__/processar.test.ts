// ADR-0129. Padrão de teste igual a cadastrar-produto/__tests__/processar.test.ts: vitest
// (não Deno test) — é o runner que o CI (`test`/`frontend` do ci.yml) e o vitest.config.ts
// (`include: ['./supabase/functions/**/__tests__/**/*.test.ts']`) realmente executam.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  aplicarEstoqueInicial, carregarContextoGrade, clonarFamilia, clonarVariacao, decidirIncompleto, decidirRetry,
  detectarUP, familiaTemTamanho, montarVariacaoNova, normalizarCodigo8, normalizarIntencao,
  precoPublicacaoNova, resolverFotoHerdada, STRIP_FAMILIA, STRIP_VARIACAO, validarEntrada,
  validarGrade, type VariacaoNovaEntrada,
} from '../processar.ts';
import {
  classificarFamilia, numeracaoPublicavel, tamanhosDoTipo, tipoDaGrade,
} from '../../_shared/produto/tipos-produto-valores.ts';

/**
 * Colunas REAIS de `public.variacoes`, lidas do snapshot de schema versionado
 * (`src/lib/database.types.ts`, gerado pelo supabase gen types). Bloco `Row` — e não `Insert` —
 * porque só o `Row` lista TODA coluna incondicionalmente.
 *
 * Ler o schema em vez de escrever a lista à mão é o ponto do teste: uma lista fixa envelhece
 * junto com o builder que ela deveria vigiar, que é exatamente a recorrência que se quer barrar
 * (coluna nova no banco → clone pega via select('*') → montarVariacaoNova não → 500 em produção).
 */
function colunasDeVariacoes(): string[] {
  // resolve a partir do root do vitest (raiz do repo) — `import.meta.url` sob o transform do
  // vite nem sempre é `file:`, e readFileSync recusa outros schemes.
  const arquivo = readFileSync(resolve(process.cwd(), 'src/lib/database.types.ts'), 'utf8');
  const bloco = /\n      variacoes: \{\n        Row: \{\n([\s\S]*?)\n        \}\n/.exec(arquivo);
  if (!bloco) throw new Error('bloco Row de `variacoes` não encontrado em database.types.ts');
  const colunas = bloco[1]
    .split('\n')
    .map((l) => /^\s{10}([a-z0-9_]+)\??:/.exec(l)?.[1])
    .filter((c): c is string => !!c);
  // Guard anti-"tabela de diagnóstico com 0 linhas": se o gerador mudar de formatação, o parse
  // devolveria poucas colunas e o teste passaria vazio, sem vigiar nada. 30 é folgado (o schema
  // tem 35 colunas em 2026-08-21) e só quebra se o parse realmente desandar.
  if (colunas.length < 30) throw new Error(`parse de database.types.ts devolveu só ${colunas.length} colunas`);
  return colunas;
}

describe('normalizarCodigo8', () => {
  it('preenche 1-8 dígitos com zero à esquerda', () => {
    expect(normalizarCodigo8('123')).toBe('00000123');
    expect(normalizarCodigo8('12345678')).toBe('12345678');
  });
  it('rejeita 9+ dígitos, não-dígitos e vazio', () => {
    expect(normalizarCodigo8('123456789')).toBeNull();
    expect(normalizarCodigo8('12a')).toBeNull();
    expect(normalizarCodigo8('')).toBeNull();
  });
});

describe('validarEntrada', () => {
  const userId = 'user-1';
  const variacaoValida = () => ({
    codigo: '9', nome: 'Verde', gtin: null, preco: 10, custo: null,
    estoqueInicial: 5, pesoGramas: null, alturaCm: null, larguraCm: null,
    comprimentoCm: null, imagemPath: 'user-1/chave/00000009-foto.jpg',
  });
  const bodyValido = () => ({
    familia_id: 'fam-1', chave: '11111111-1111-1111-1111-111111111111',
    variacoes: [variacaoValida()],
  });

  it('payload válido não gera erro', () => {
    expect(validarEntrada(bodyValido(), userId)).toEqual([]);
  });

  it('variacoes vazio gera erro', () => {
    const erros = validarEntrada({ ...bodyValido(), variacoes: [] }, userId);
    expect(erros.some((e) => e.campo === 'variacoes')).toBe(true);
  });

  it('nome vazio gera erro', () => {
    const erros = validarEntrada(
      { ...bodyValido(), variacoes: [{ ...variacaoValida(), nome: '  ' }] }, userId,
    );
    expect(erros.some((e) => e.campo === 'variacoes[0].nome')).toBe(true);
  });

  it('preco 0 gera erro', () => {
    const erros = validarEntrada(
      { ...bodyValido(), variacoes: [{ ...variacaoValida(), preco: 0 }] }, userId,
    );
    expect(erros.some((e) => e.campo === 'variacoes[0].preco')).toBe(true);
  });

  it('estoqueInicial 0 gera erro (D-desvio 5: cor nova exige estoque > 0)', () => {
    const erros = validarEntrada(
      { ...bodyValido(), variacoes: [{ ...variacaoValida(), estoqueInicial: 0 }] }, userId,
    );
    expect(erros.some((e) => e.campo === 'variacoes[0].estoqueInicial')).toBe(true);
  });

  it('estoqueInicial fracionário gera erro', () => {
    const erros = validarEntrada(
      { ...bodyValido(), variacoes: [{ ...variacaoValida(), estoqueInicial: 1.5 }] }, userId,
    );
    expect(erros.some((e) => e.campo === 'variacoes[0].estoqueInicial')).toBe(true);
  });

  it('imagemPath de outro usuário gera erro (policy do bucket exige 1º segmento = auth.uid())', () => {
    const erros = validarEntrada(
      { ...bodyValido(), variacoes: [{ ...variacaoValida(), imagemPath: 'outro-user/x.jpg' }] }, userId,
    );
    expect(erros.some((e) => e.campo === 'variacoes[0].imagemPath')).toBe(true);
  });

  it('imagemPath com travessia de diretório gera erro', () => {
    const erros = validarEntrada(
      { ...bodyValido(), variacoes: [{ ...variacaoValida(), imagemPath: 'user-1/../x.jpg' }] }, userId,
    );
    expect(erros.some((e) => e.campo === 'variacoes[0].imagemPath')).toBe(true);
  });

  it('codigo repetido entre linhas gera erro', () => {
    const erros = validarEntrada(
      { ...bodyValido(), variacoes: [variacaoValida(), { ...variacaoValida(), nome: 'Azul' }] }, userId,
    );
    expect(erros.some((e) => e.campo.startsWith('variacoes') && e.mensagem.includes('duplicado'))).toBe(true);
  });

  it('chave fora do formato uuid gera erro', () => {
    const erros = validarEntrada({ ...bodyValido(), chave: 'not-a-uuid' }, userId);
    expect(erros.some((e) => e.campo === 'chave')).toBe(true);
  });
});

describe('precoPublicacaoNova', () => {
  it('menor preco_publicacao entre as irmãs incluídas', () => {
    expect(precoPublicacaoNova([
      { preco_publicacao: 30, excluida_da_publicacao: false },
      { preco_publicacao: 25, excluida_da_publicacao: false },
    ], 99)).toBe(25);
  });
  it('irmã excluída não conta — cai no fallback', () => {
    expect(precoPublicacaoNova([{ preco_publicacao: 10, excluida_da_publicacao: true }], 99)).toBe(99);
  });
  it('preco_publicacao nulo não conta — cai no fallback', () => {
    expect(precoPublicacaoNova([{ preco_publicacao: null, excluida_da_publicacao: false }], 99)).toBe(99);
  });
});

describe('familiaTemTamanho (ADR-0166 / R4)', () => {
  it('familia sem tamanho nenhum libera o fluxo', () => {
    expect(familiaTemTamanho([{ tamanho: null }, { tamanho: '  ' }])).toBe(false);
  });

  it('UMA variacao com tamanho ja bloqueia — familia mista nao pode nascer', () => {
    expect(familiaTemTamanho([{ tamanho: null }, { tamanho: 'P' }])).toBe(true);
  });

  it('lista vazia nao bloqueia', () => {
    expect(familiaTemTamanho([])).toBe(false);
  });
});

describe('clonarFamilia', () => {
  it('remove STRIP_FAMILIA e aplica overrides de UPDATE', () => {
    const fam = clonarFamilia({
      id: 'a', criado_em: 'x', lote_id: 'l0', status: 'publicado',
      chave_cadastro: 'k0', qstash_message_id: 'q', erro_mensagem: 'e',
      nome_pai: 'P', ml_item_id: 'MLB1', operacao: 'CREATE', user_id: 'antigo', org_id: 'org',
    }, { loteId: 'l1', userId: 'u1', chave: 'k1' });
    expect(fam.id).toBeUndefined();
    expect(fam.lote_id).toBe('l1');
    expect(fam.status).toBe('pronto');
    expect(fam.operacao).toBe('UPDATE');
    expect(fam.chave_cadastro).toBe('k1');
    expect(fam.user_id).toBe('u1');
    expect(fam.ml_item_id).toBe('MLB1');
    expect(fam.nome_pai).toBe('P');
  });

  it('STRIP_FAMILIA cobre timestamps de processamento e diagnóstico do title pipeline', () => {
    expect(STRIP_FAMILIA).toEqual(expect.arrayContaining([
      'id', 'criado_em', 'atualizado_em', 'lote_id', 'status', 'chave_cadastro',
      'qstash_message_id', 'erro_mensagem', 'editado_em', 'publicado_em',
      'titulo_descartes', 'mudanca_estrutural',
    ]));
  });
});

describe('clonarVariacao', () => {
  it('estoque canônico vence o estoque clonado; identidade ML preservada', () => {
    const v = clonarVariacao({
      id: 'v1', criado_em: 'x', familia_id: 'fam-antiga', codigo: '00000001',
      estoque: 3, ml_variation_id: 'MLBV1', ml_picture_id: 'pic1', cor: 'Azul',
      preco_publicacao: 20, excluida_da_publicacao: false,
    }, { familiaId: 'fam-nova', userId: 'u1', estoqueCanonico: 10 });
    expect(v.id).toBeUndefined();
    expect(v.familia_id).toBe('fam-nova');
    expect(v.user_id).toBe('u1');
    expect(v.estoque).toBe(10);
    expect(v.estoque_anterior).toBe(10);
    expect(v.ml_variation_id).toBe('MLBV1');
    expect(v.ml_picture_id).toBe('pic1');
    expect(v.cor).toBe('Azul');
    expect(v.preco_publicacao).toBe(20);
    expect(v.excluida_da_publicacao).toBe(false);
  });

  it('sem estoque canônico, usa o estoque clonado', () => {
    const v = clonarVariacao(
      { id: 'v1', criado_em: 'x', familia_id: 'fam-antiga', codigo: '00000001', estoque: 7 },
      { familiaId: 'fam-nova', userId: 'u1', estoqueCanonico: undefined },
    );
    expect(v.estoque).toBe(7);
    expect(v.estoque_anterior).toBe(7);
  });
});

describe('montarVariacaoNova', () => {
  it('nasce incluída, cor = nome, sem identidade ML, com o preço de publicação do contexto', () => {
    const v = montarVariacaoNova({
      codigo: '00000009', nome: '  Verde  ', gtin: null, preco: 15, custo: 6,
      estoqueInicial: 5, pesoGramas: null, alturaCm: null, larguraCm: null,
      comprimentoCm: null, imagemPath: 'user-1/chave/00000009.jpg',
    }, { familiaId: 'fam-nova', userId: 'u1', orgId: 'org-1', precoPublicacao: 25 });
    expect(v.familia_id).toBe('fam-nova');
    expect(v.org_id).toBe('org-1');
    expect(v.codigo).toBe('00000009');
    expect(v.cor).toBe('Verde');
    expect(v.cor_origem).toBe('manual');
    expect(v.estoque).toBe(0);
    expect(v.excluida_da_publicacao).toBe(false);
    expect(v.ml_variation_id).toBeNull();
    expect(v.ml_picture_id).toBeNull();
    expect(v.estoque_anterior).toBeNull();
    expect(v.preco_publicacao).toBe(25);
  });
});

/**
 * Regressão do 500 de 2026-08-21 ("null value in column preco_editado_pelo_operador of relation
 * variacoes violates not-null constraint"), que quebrava 100% dos salvamentos de Adicionar
 * Variação. `index.ts` insere clones e novas no MESMO array; o PostgREST monta um único insert
 * multi-row com a UNIÃO das chaves e preenche com NULL as ausentes de cada linha
 * (`Prefer: missing=null`) — NULL explícito ignora o DEFAULT da coluna. Como o clone vem de
 * `select('*')`, toda coluna que só ele tinha virava NULL na linha nova; nas NOT NULL, 500.
 *
 * Os testes por função (acima) não pegam isso: o bug só existe na INTERAÇÃO dos dois builders.
 * Comparar os conjuntos de chaves é mais barato e mais durável que subir um Postgres no CI.
 */
describe('paridade de chaves entre clonarVariacao e montarVariacaoNova', () => {
  const colunas = colunasDeVariacoes();
  // Linha "cheia": o clone real vem de select('*'), então todo teste com um mock magro
  // (como os de clonarVariacao acima) é cego para este bug por construção.
  const linhaCheia = Object.fromEntries(colunas.map((c) => [c, `valor-${c}`]));

  const chavesClone = () => Object.keys(clonarVariacao(
    linhaCheia, { familiaId: 'fam-nova', userId: 'u1', estoqueCanonico: 1 },
  )).sort();
  const chavesNova = () => Object.keys(montarVariacaoNova({
    codigo: '00000009', nome: 'Verde', gtin: null, preco: 15, custo: 6,
    estoqueInicial: 5, pesoGramas: null, alturaCm: null, larguraCm: null,
    comprimentoCm: null, imagemPath: 'user-1/chave/00000009.jpg',
  }, { familiaId: 'fam-nova', userId: 'u1', orgId: 'org-1', precoPublicacao: 25 })).sort();

  it('os dois builders produzem exatamente o mesmo conjunto de chaves', () => {
    expect(chavesNova()).toEqual(chavesClone());
  });

  it('o conjunto cobre o schema real menos STRIP_VARIACAO (nenhuma coluna fica de fora)', () => {
    const esperado = colunas
      .filter((c) => !(STRIP_VARIACAO as readonly string[]).includes(c) || c === 'familia_id')
      .sort();
    expect(chavesClone()).toEqual(esperado);
  });

  it('STRIP_VARIACAO remove atualizado_em (trigger moddatetime só roda em UPDATE)', () => {
    expect(STRIP_VARIACAO).toEqual(expect.arrayContaining(['id', 'criado_em', 'atualizado_em', 'familia_id']));
    expect(chavesClone()).not.toContain('atualizado_em');
  });

  it('toda coluna NOT NULL com DEFAULT sai com valor explícito na linha nova (não undefined)', () => {
    const nova = montarVariacaoNova({
      codigo: '00000009', nome: 'Verde', gtin: null, preco: 15, custo: 6,
      estoqueInicial: 5, pesoGramas: null, alturaCm: null, larguraCm: null,
      comprimentoCm: null, imagemPath: 'user-1/chave/00000009.jpg',
    }, { familiaId: 'fam-nova', userId: 'u1', orgId: 'org-1', precoPublicacao: 25 });
    // NOT NULL DEFAULT em public.variacoes (verificado contra o banco em 2026-08-21).
    expect(nova.preco_editado_pelo_operador).toBe(false);
    expect(nova.cor_editada_pelo_operador).toBe(false);
    expect(nova.excluida_da_publicacao).toBe(false);
    expect(nova.catalog_status).toBe('pendente');
    expect(nova.estoque).toBe(0);
  });
});

// ─── ADR-0166 2026-09-24c: SKUs novos de grade (cor × tamanho) em família UP publicada ────────

/**
 * Stub encadeável do supabase-js: registra cada `from(tabela)`/`rpc(nome)` e responde pela
 * função da tabela com os filtros `eq`/`in` acumulados. Serve `maybeSingle()` e `await` direto
 * (o `select(..., { head: true })` do count é aguardado sem terminal).
 */
type Resposta = { data?: unknown; error?: { message: string } | null; count?: number | null };
function fakeAdmin(
  tabelas: Record<string, (filtros: Record<string, unknown>) => Resposta>,
  rpc: (nome: string, args: Record<string, unknown>) => Resposta = () => ({ data: null, error: null }),
) {
  const chamadas: string[] = [];
  const rpcArgs: Array<Record<string, unknown>> = [];
  const admin = {
    from(tabela: string) {
      chamadas.push(tabela);
      const filtros: Record<string, unknown> = {};
      const responder = () => {
        const fn = tabelas[tabela];
        if (!fn) throw new Error(`tabela inesperada: ${tabela}`);
        return Promise.resolve({ error: null, ...fn(filtros) });
      };
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => { filtros[k] = v; return q; },
        in: (k: string, v: unknown) => { filtros[k] = v; return q; },
        maybeSingle: responder,
        then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) => responder().then(res, rej),
      };
      return q;
    },
    rpc(nome: string, args: Record<string, unknown>) {
      chamadas.push(`rpc:${nome}`);
      rpcArgs.push(args);
      return Promise.resolve({ error: null, ...rpc(nome, args) });
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { admin, chamadas, rpcArgs };
}

describe('validarEntrada — grade', () => {
  const base = { familia_id: 'f', chave: '00000000-0000-4000-8000-000000000000' };
  const v = { nome: 'Verde', tamanho: 'P', gtin: null, preco: 10, custo: null, estoqueInicial: 1,
    pesoGramas: null, alturaCm: null, larguraCm: null, comprimentoCm: null };
  it('aceita variação sem código quando traz tamanho', () => {
    expect(validarEntrada({ ...base, variacoes: [{ ...v, imagemPath: 'u1/x.jpg' }] }, 'u1')).toEqual([]);
  });
  it('aceita fotoDeCodigo no lugar de imagemPath', () => {
    expect(validarEntrada({ ...base, variacoes: [{ ...v, fotoDeCodigo: '00000001' }] }, 'u1')).toEqual([]);
  });
  it('recusa sem foto nenhuma e com as duas', () => {
    expect(validarEntrada({ ...base, variacoes: [{ ...v }] }, 'u1').map((e) => e.campo)).toContain('variacoes[0].imagemPath');
    expect(validarEntrada({ ...base, variacoes: [{ ...v, imagemPath: 'u1/x', fotoDeCodigo: '1' }] }, 'u1').map((e) => e.campo)).toContain('variacoes[0].imagemPath');
  });
  it('sem tamanho continua exigindo código (fluxo antigo intacto)', () => {
    const { tamanho: _t, ...semTam } = v;
    expect(validarEntrada({ ...base, variacoes: [{ ...semTam, imagemPath: 'u1/x' }] }, 'u1').map((e) => e.campo)).toContain('variacoes[0].codigo');
  });
  it('fotoDeCodigo fora de 1–8 dígitos e tamanho vazio são recusados', () => {
    expect(validarEntrada({ ...base, variacoes: [{ ...v, fotoDeCodigo: 'abc' }] }, 'u1').map((e) => e.campo)).toContain('variacoes[0].fotoDeCodigo');
    expect(validarEntrada({ ...base, variacoes: [{ ...v, tamanho: '  ', imagemPath: 'u1/x', codigo: '9' }] }, 'u1').map((e) => e.campo)).toContain('variacoes[0].tamanho');
  });
  it('código informado junto com tamanho ainda é validado no formato', () => {
    expect(validarEntrada({ ...base, variacoes: [{ ...v, codigo: 'x1', imagemPath: 'u1/x' }] }, 'u1').map((e) => e.campo)).toContain('variacoes[0].codigo');
  });
});

describe('validarGrade', () => {
  const vivas = [
    { codigo: '00000001', cor: 'Preto', tamanho: 'P', excluida_da_publicacao: false },
    { codigo: '00000002', cor: 'Preto', tamanho: 'M', excluida_da_publicacao: false },
  ];
  const ctx = { vivas, tiposHabilitados: ['roupa'], genero: 'masculino', ehUP: true };
  const nova = (cor: string, tamanho?: string, extra: object = {}) => ({ nome: cor, tamanho, gtin: null, preco: 10, custo: null, estoqueInicial: 1,
    pesoGramas: null, alturaCm: null, larguraCm: null, comprimentoCm: null, imagemPath: 'u/x', ...extra }) as VariacaoNovaEntrada;
  it('aceita cor nova e tamanho novo', () => {
    expect(validarGrade([nova('Verde', 'P'), nova('Preto', 'G')], ctx)).toEqual([]);
  });
  it('recusa par que já existe e par repetido na submissão', () => {
    expect(validarGrade([nova('Preto', 'M')], ctx)).toHaveLength(1);
    expect(validarGrade([nova('Verde', 'P'), nova('Verde', 'P')], ctx)).toHaveLength(1);
  });
  it('recusa tamanho fora da whitelist, sem tamanho e com código', () => {
    expect(validarGrade([nova('Verde', 'XGG')], ctx)[0]!.mensagem).toMatch(/tamanho/i);
    expect(validarGrade([nova('Verde')], ctx)[0]!.mensagem).toMatch(/tamanho/i);
    expect(validarGrade([nova('Verde', 'P', { codigo: '123' })], ctx)[0]!.mensagem).toMatch(/código/i);
  });
  it('recusa família sem gênero e família não-UP', () => {
    expect(validarGrade([nova('Verde', 'P')], { ...ctx, genero: null })[0]!.mensagem).toMatch(/gênero/i);
    expect(validarGrade([nova('Verde', 'P')], { ...ctx, ehUP: false })[0]!.mensagem).toMatch(/não é suportado/i);
  });
  it('família SEM tamanho: recusa variação com tamanho', () => {
    expect(validarGrade([nova('Verde', 'P', { codigo: '9' })], { ...ctx, vivas: [{ codigo: '00000001', cor: 'Preto', tamanho: null, excluida_da_publicacao: false }] })).toHaveLength(1);
  });
  it('família SEM tamanho: ignora ehUP/tipos/gênero e aceita o payload de hoje (INV-1)', () => {
    const simples = { vivas: [{ codigo: '00000001', cor: 'Preto', tamanho: null, excluida_da_publicacao: false }], tiposHabilitados: [], genero: null, ehUP: false };
    expect(validarGrade([nova('Verde', undefined, { codigo: '9' })], simples)).toEqual([]);
    expect(validarGrade([nova('Verde', undefined, { codigo: '9', imagemPath: undefined, fotoDeCodigo: '00000001' })], simples)).toHaveLength(1);
  });
  it('fotoDeCodigo tem que apontar para SKU vivo da MESMA cor', () => {
    expect(validarGrade([nova('Preto', 'G', { imagemPath: undefined, fotoDeCodigo: '00000001' })], ctx)).toEqual([]);
    expect(validarGrade([nova('Verde', 'G', { imagemPath: undefined, fotoDeCodigo: '00000001' })], ctx)).toHaveLength(1);
  });
  it('org com roupa E calçado: jaqueta publicada não aceita numeração (Codex r2 #1)', () => {
    const c = { ...ctx, tiposHabilitados: ['roupa', 'calcado'] };
    expect(validarGrade([nova('Preto', '42')], c)[0]!.mensagem).toMatch(/tamanho/i);
    expect(validarGrade([nova('Preto', 'G')], c)).toEqual([]);
  });
  it('tipo da grade desligado na org depois de publicar → recusa com motivo claro', () => {
    expect(validarGrade([nova('Preto', 'G')], { ...ctx, tiposHabilitados: [] })[0]!.mensagem).toMatch(/desativad/i);
  });
  it('numeração sem guia de tamanhos para o gênero é recusada na edge (Codex r2 #4)', () => {
    const vivasCalc = [{ codigo: '00000001', cor: 'Preto', tamanho: '38', excluida_da_publicacao: false }];
    const c = { ...ctx, vivas: vivasCalc, tiposHabilitados: ['calcado'], genero: 'feminino' };
    expect(validarGrade([nova('Preto', '45')], c)[0]!.mensagem).toMatch(/Mercado Livre/i);
    expect(validarGrade([nova('Preto', '39')], c)).toEqual([]);
  });
  it('grade publicada com tamanhos mistos/desconhecidos → recusa (não adivinha o tipo)', () => {
    const c = { ...ctx, vivas: [{ codigo: '00000001', cor: 'Preto', tamanho: 'P', excluida_da_publicacao: false }, { codigo: '00000002', cor: 'Preto', tamanho: '38', excluida_da_publicacao: false }], tiposHabilitados: ['roupa', 'calcado'] };
    expect(validarGrade([nova('Azul', 'P')], c)).toHaveLength(1);
  });
  it('incluídas com e sem tamanho → recusa antes de escrever (Codex r3 #1)', () => {
    const c = { ...ctx, vivas: [{ codigo: '00000001', cor: 'Preto', tamanho: 'P', excluida_da_publicacao: false }, { codigo: '00000002', cor: 'Azul', tamanho: null, excluida_da_publicacao: false }] };
    expect(validarGrade([nova('Verde', 'P')], c)[0]!.mensagem).toMatch(/com e sem tamanho/);
  });
  it('excluída não decide o tipo, mas bloqueia par duplicado', () => {
    const c = { ...ctx, vivas: [
      { codigo: '00000001', cor: 'Preto', tamanho: 'P', excluida_da_publicacao: false },
      { codigo: '00000002', cor: 'Preto', tamanho: 'M', excluida_da_publicacao: true },
      { codigo: '00000003', cor: 'Azul', tamanho: null, excluida_da_publicacao: true },
    ] };
    expect(validarGrade([nova('Preto', 'G')], c)).toEqual([]);
    expect(validarGrade([nova('Preto', 'M')], c)[0]!.mensagem).toMatch(/já existe/);
  });
});

describe('classificarFamilia', () => {
  it('só as incluídas contam', () => {
    expect(classificarFamilia([])).toBe('simples');
    expect(classificarFamilia([{ tamanho: null, excluida_da_publicacao: false }, { tamanho: ' ', excluida_da_publicacao: false }])).toBe('simples');
    expect(classificarFamilia([{ tamanho: 'P', excluida_da_publicacao: false }, { tamanho: null, excluida_da_publicacao: true }])).toBe('grade');
    expect(classificarFamilia([{ tamanho: null, excluida_da_publicacao: false }, { tamanho: 'P', excluida_da_publicacao: true }])).toBe('simples');
    expect(classificarFamilia([{ tamanho: 'P', excluida_da_publicacao: false }, { tamanho: null, excluida_da_publicacao: false }])).toBe('mista');
  });
});

describe('tipoDaGrade / numeracaoPublicavel', () => {
  it('infere o tipo pelos tamanhos', () => {
    expect(tipoDaGrade(['P', 'GG'])).toBe('roupa');
    expect(tipoDaGrade(['38', '41/42'])).toBe('calcado');
    expect(tipoDaGrade(['P', '38'])).toBeNull();
    expect(tipoDaGrade([])).toBeNull();
    expect(tipoDaGrade(['XGG'])).toBeNull();
  });
  it('tamanhosDoTipo devolve a lista canônica do tipo', () => {
    expect(tamanhosDoTipo('roupa')).toEqual(['P', 'M', 'G', 'GG']);
    expect(tamanhosDoTipo('calcado')).toContain('41/42');
  });
  it('mesma regra que o front usava (conferir 45/46 feminino e pares contra COMPRIMENTO_PE_CM)', () => {
    expect(numeracaoPublicavel('45', 'feminino')).toBe(false);
    expect(numeracaoPublicavel('33/34', 'masculino')).toBe(false);
    expect(numeracaoPublicavel('40', 'masculino')).toBe(true);
  });
});

describe('resolverFotoHerdada', () => {
  // Códigos vivos sempre com 8 dígitos (é o que o banco grava); `fotoDeCodigo` pode vir curto e é
  // normalizado por `normalizarCodigo8` antes de comparar (Codex r2 #8).
  it('copia imagem_path e ml_picture_id do irmão da mesma cor', () => {
    expect(resolverFotoHerdada('1', 'Preto', [{ codigo: '00000001', cor: 'Preto', imagem_path: 'o/a.jpg', ml_picture_id: 'PIC' }]))
      .toEqual({ imagemPath: 'o/a.jpg', mlPictureId: 'PIC' });
  });
  it('irmão só com ml_picture_id ainda serve', () => {
    expect(resolverFotoHerdada('00000001', 'Preto', [{ codigo: '00000001', cor: 'Preto', imagem_path: null, ml_picture_id: 'PIC' }]))
      .toEqual({ imagemPath: null, mlPictureId: 'PIC' });
  });
  it('cor diferente ou irmão sem foto nenhuma → null', () => {
    expect(resolverFotoHerdada('00000001', 'Verde', [{ codigo: '00000001', cor: 'Preto', imagem_path: 'x', ml_picture_id: null }])).toBeNull();
    expect(resolverFotoHerdada('00000001', 'Preto', [{ codigo: '00000001', cor: 'Preto', imagem_path: null, ml_picture_id: null }])).toBeNull();
  });
});

describe('montarVariacaoNova — grade', () => {
  it('grava tamanho e a foto resolvida; mantém a paridade de chaves com clonarVariacao', () => {
    const linha = montarVariacaoNova(
      { codigo: '00000009', nome: 'Verde', tamanho: 'P', gtin: null, preco: 10, custo: null, estoqueInicial: 1,
        pesoGramas: null, alturaCm: null, larguraCm: null, comprimentoCm: null, imagemPath: 'o/a.jpg', mlPictureId: 'PIC' },
      { familiaId: 'f', userId: 'u', orgId: 'o', precoPublicacao: 10 },
    );
    expect(linha.tamanho).toBe('P');
    expect(linha.imagem_path).toBe('o/a.jpg');
    expect(linha.ml_picture_id).toBe('PIC');
  });
  it('sem tamanho grava null (INV-1)', () => {
    const linha = montarVariacaoNova(
      { codigo: '00000009', nome: 'Verde', gtin: null, preco: 10, custo: null, estoqueInicial: 1,
        pesoGramas: null, alturaCm: null, larguraCm: null, comprimentoCm: null, imagemPath: 'o/a.jpg', mlPictureId: null },
      { familiaId: 'f', userId: 'u', orgId: 'o', precoPublicacao: 10 },
    );
    expect(linha.tamanho).toBeNull();
    expect(linha.ml_picture_id).toBeNull();
  });
});

describe('detectarUP (mesma detecção do worker update-familia-ml)', () => {
  const raiz = (r: Resposta) => () => r;
  it('raiz ausente → false', async () => {
    const { admin, chamadas } = fakeAdmin({ anuncios_externos: raiz({ data: null }) });
    expect(await detectarUP(admin, 'org', '00000100')).toBe(false);
    expect(chamadas).toEqual(['anuncios_externos']);
  });
  it('raiz com 0 itens → false; com itens → true', async () => {
    const semItens = fakeAdmin({ anuncios_externos: raiz({ data: { id: 'r1' } }), anuncios_externos_itens: () => ({ count: 0 }) });
    expect(await detectarUP(semItens.admin, 'org', '00000100')).toBe(false);
    const comItens = fakeAdmin({ anuncios_externos: raiz({ data: { id: 'r1' } }), anuncios_externos_itens: () => ({ count: 3 }) });
    expect(await detectarUP(comItens.admin, 'org', '00000100')).toBe(true);
  });
  it('filtra a raiz por org, codigo_pai, canal e partição 0', async () => {
    let filtrosRaiz: Record<string, unknown> = {};
    const { admin } = fakeAdmin({ anuncios_externos: (f) => { filtrosRaiz = f; return { data: null }; } });
    await detectarUP(admin, 'org', '00000100');
    expect(filtrosRaiz).toEqual({ org_id: 'org', codigo_pai: '00000100', canal: 'mercado_livre', particao: 0 });
  });
  it('SKU igual em OUTRA raiz não conta (a consulta é por anuncio_externo_id)', async () => {
    const { admin } = fakeAdmin({
      anuncios_externos: raiz({ data: { id: 'r1' } }),
      anuncios_externos_itens: (f) => ({ count: f.anuncio_externo_id === 'r2' ? 5 : 0 }),
    });
    expect(await detectarUP(admin, 'org', '00000100')).toBe(false);
  });
  it('erro em qualquer consulta → lança (fail-closed)', async () => {
    const e1 = fakeAdmin({ anuncios_externos: raiz({ data: null, error: { message: 'boom' } }) });
    await expect(detectarUP(e1.admin, 'org', '1')).rejects.toThrow(/boom/);
    const e2 = fakeAdmin({ anuncios_externos: raiz({ data: { id: 'r1' } }), anuncios_externos_itens: () => ({ count: null, error: { message: 'bang' } }) });
    await expect(detectarUP(e2.admin, 'org', '1')).rejects.toThrow(/bang/);
  });
});

describe('carregarContextoGrade (Codex r4 #2)', () => {
  it('família simples → NENHUMA consulta nova (INV-1)', async () => {
    const { admin, chamadas } = fakeAdmin({});
    const r = await carregarContextoGrade(admin, 'org', '00000100', [
      { tamanho: null, excluida_da_publicacao: false }, { tamanho: 'P', excluida_da_publicacao: true },
    ]);
    expect(r).toEqual({ classe: 'simples', ehUP: false, tiposHabilitados: [] });
    expect(chamadas).toEqual([]);
  });
  it('família de grade → detecta UP e lê os tipos da org', async () => {
    const { admin, chamadas } = fakeAdmin({
      anuncios_externos: () => ({ data: { id: 'r1' } }),
      anuncios_externos_itens: () => ({ count: 2 }),
      organizations: () => ({ data: { tipos_produto_habilitados: ['roupa'] } }),
    });
    const r = await carregarContextoGrade(admin, 'org', '00000100', [{ tamanho: 'P', excluida_da_publicacao: false }]);
    expect(r).toEqual({ classe: 'grade', ehUP: true, tiposHabilitados: ['roupa'] });
    expect(chamadas.sort()).toEqual(['anuncios_externos', 'anuncios_externos_itens', 'organizations']);
  });
});

describe('aplicarEstoqueInicial', () => {
  it('devolve a falha por código e reusa o mesmo p_ref entre chamadas', async () => {
    const { admin, rpcArgs } = fakeAdmin({}, (_n, a) => (a.p_codigo === '00000002' ? { error: { message: 'kit' } } : {}));
    const entrada = { orgId: 'org', familiaId: 'fam', userId: 'u', itens: [
      { codigo: '00000001', qtd: 3, custo: null }, { codigo: '00000002', qtd: 1, custo: 5 },
    ] };
    expect(await aplicarEstoqueInicial(admin, entrada)).toEqual(['00000002: kit']);
    await aplicarEstoqueInicial(admin, entrada);
    expect(rpcArgs.map((a) => a.p_ref)).toEqual([
      'addvar:fam:00000001', 'addvar:fam:00000002', 'addvar:fam:00000001', 'addvar:fam:00000002',
    ]);
    expect(rpcArgs[1]).toEqual({
      p_org: 'org', p_codigo: '00000002', p_qtd: 1, p_custo: 5, p_doc: 'Variação adicionada',
      p_obs: null, p_criado_por: 'u', p_ref: 'addvar:fam:00000002',
    });
  });
});

describe('decidirIncompleto (órfã não pode travar o produto via emVoo)', () => {
  const agora = new Date('2026-09-24T12:10:00Z');
  it('órfã com mais de 2 min → limpar', () => {
    expect(decidirIncompleto('2026-09-24T12:07:59Z', agora)).toBe('limpar');
  });
  it('órfã recente (até 2 min) → aguardar', () => {
    expect(decidirIncompleto('2026-09-24T12:09:00Z', agora)).toBe('aguardar');
    expect(decidirIncompleto('2026-09-24T12:08:00Z', agora)).toBe('aguardar');
  });
});

describe('decidirRetry (Codex #3, r2 #2, r3 #2)', () => {
  const corpo = (): VariacaoNovaEntrada => ({
    nome: 'Verde', tamanho: 'P', gtin: null, preco: 10, custo: null, estoqueInicial: 2,
    pesoGramas: null, alturaCm: null, larguraCm: null, comprimentoCm: null, imagemPath: 'u1/x.jpg',
  });
  const intencao = () => [{ codigo: '00000103', ...normalizarIntencao(corpo()) }];

  it('sem intenção gravada → legado', () => {
    expect(decidirRetry(undefined, [corpo()], [])).toEqual({ tipo: 'legado' });
    expect(decidirRetry(null, [corpo()], [])).toEqual({ tipo: 'legado' });
  });
  it('variações persistidas a menos → incompleto', () => {
    expect(decidirRetry(intencao(), [corpo()], [])).toEqual({ tipo: 'incompleto' });
  });
  it('comprimento diferente → divergente', () => {
    expect(decidirRetry(intencao(), [corpo(), corpo()], ['00000103'])).toEqual({ tipo: 'divergente' });
  });
  it('body idêntico (com espaços extras no nome) → reaplicar com a quantidade DA INTENÇÃO', () => {
    expect(decidirRetry(intencao(), [{ ...corpo(), nome: '  Verde ' }], ['00000103'])).toEqual({
      tipo: 'reaplicar', itens: [{ codigo: '00000103', qtd: 2, custo: null }],
    });
  });
  const alteracoes: Record<string, Partial<VariacaoNovaEntrada>> = {
    nome: { nome: 'Azul' }, tamanho: { tamanho: 'G' }, gtin: { gtin: '7891234567895' },
    preco: { preco: 11 }, custo: { custo: 4 }, estoqueInicial: { estoqueInicial: 3 },
    pesoGramas: { pesoGramas: 100 }, alturaCm: { alturaCm: 1 }, larguraCm: { larguraCm: 1 },
    comprimentoCm: { comprimentoCm: 1 }, imagemPath: { imagemPath: 'u1/y.jpg' },
    fotoDeCodigo: { fotoDeCodigo: '1' }, codigoDigitado: { codigo: '9' },
  };
  it('a tabela de alterações cobre TODO campo de normalizarIntencao', () => {
    expect(Object.keys(alteracoes).sort()).toEqual(Object.keys(normalizarIntencao(corpo())).sort());
  });
  it.each(Object.keys(alteracoes))('campo %s alterado isoladamente → divergente', (campo) => {
    expect(decidirRetry(intencao(), [{ ...corpo(), ...alteracoes[campo] }], ['00000103'])).toEqual({ tipo: 'divergente' });
  });
});
