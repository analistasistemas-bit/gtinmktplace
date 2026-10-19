// ADR-0129. Padrão de teste igual a cadastrar-produto/__tests__/processar.test.ts: vitest
// (não Deno test) — é o runner que o CI (`test`/`frontend` do ci.yml) e o vitest.config.ts
// (`include: ['./supabase/functions/**/__tests__/**/*.test.ts']`) realmente executam.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  aplicarEstoqueInicial, checarNcmDaFamilia, carregarContextoGrade, clonarFamilia, clonarVariacao, decidirAposEstoque, decidirErroPendente, decidirIncompleto,
  decidirRetry, desfazerCriacao, ehNotaJaImportada, MSG_NOTA_JA_IMPORTADA, detectarUP, haAtualizacaoComErro, haFamiliaEmVoo, limparFamiliaOrfa, montarVariacaoNova, normalizarCodigo8, normalizarIntencao,
  notaJaImportada,
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

  it('sem foto no fluxo SEM tamanho: mensagem de sempre (INV-1)', () => {
    const { imagemPath: _i, ...semFoto } = variacaoValida();
    const erros = validarEntrada({ ...bodyValido(), variacoes: [semFoto] }, userId);
    expect(erros).toEqual([{ campo: 'variacoes[0].imagemPath', mensagem: 'Foto é obrigatória.' }]);
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

  // ADR-0182 D2 / Review Focus 2: nova versão sem grade_tamanho deixaria a calça ambígua.
  it('preserva grade_tamanho e genero', () => {
    const fam = clonarFamilia({ id: 'a', grade_tamanho: 'calca', genero: 'feminino' }, { loteId: 'l1', userId: 'u1', chave: 'k1' });
    expect(fam.grade_tamanho).toBe('calca');
    expect(fam.genero).toBe('feminino');
  });

  // A1 (auditoria fiscal 19/10): prontidão fiscal é da família que foi ao ML.
  it('clone nasce sem as colunas de prontidão fiscal', () => {
    const fam = clonarFamilia({
      id: 'a', can_invoice: true, can_invoice_causa: 'x', can_invoice_em: 't', fiscal_sincronizado_em: 't', nome_pai: 'P',
    }, { loteId: 'l1', userId: 'u1', chave: 'k1' });
    for (const k of ['can_invoice', 'can_invoice_causa', 'can_invoice_em', 'fiscal_sincronizado_em']) {
      expect(fam).not.toHaveProperty(k);
    }
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

  it('clone não carrega GTIN inválido legado; válido fica', () => {
    const ctx = { familiaId: 'f', userId: 'u', estoqueCanonico: undefined };
    expect(clonarVariacao({ codigo: '00000001', estoque: 1, gtin: '2' }, ctx).gtin).toBeNull();
    expect(clonarVariacao({ codigo: '00000001', estoque: 1, gtin: '7891234567895' }, ctx).gtin).toBe('7891234567895');
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

describe('GTIN inválido grava vazio', () => {
  it('montarVariacaoNova e normalizarIntencao descartam "1" e mantêm EAN válido', () => {
    const base = {
      codigo: '00000009', nome: 'Verde', gtin: '1', preco: 15, custo: 6,
      estoqueInicial: 5, pesoGramas: null, alturaCm: null, larguraCm: null,
      comprimentoCm: null, imagemPath: null,
    };
    const ctx = { familiaId: 'f', userId: 'u', orgId: 'o', precoPublicacao: 25 };
    expect(montarVariacaoNova(base, ctx).gtin).toBeNull();
    expect(normalizarIntencao(base).gtin).toBeNull();
    expect(montarVariacaoNova({ ...base, gtin: '7891234567895' }, ctx).gtin).toBe('7891234567895');
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
        is: (k: string, v: unknown) => { filtros[`is:${k}`] = v; return q; },
        order: (k: string, o: unknown) => { filtros[`order:${k}`] = o; return q; },
        limit: (n: number) => { filtros.limit = n; return q; },
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
    expect(validarEntrada({ ...base, variacoes: [{ ...v }] }, 'u1')).toEqual([
      { campo: 'variacoes[0].imagemPath', mensagem: 'Envie a foto ou herde a de um SKU da mesma cor.' },
    ]);
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
  const ctx = { vivas, tiposHabilitados: ['roupa'], genero: 'masculino', ehUP: true, gradeTamanho: null as string | null };
  const nova = (cor: string, tamanho?: string, extra: object = {}) => ({ nome: cor, tamanho, gtin: null, preco: 10, custo: null, estoqueInicial: 1,
    pesoGramas: null, alturaCm: null, larguraCm: null, comprimentoCm: null, imagemPath: 'u/x', ...extra }) as VariacaoNovaEntrada;
  // ADR-0182 D2 / Review Focus 1: calça 34–46 nunca é inferida como calçado quando a grade está gravada.
  describe('grade gravada (ADR-0182)', () => {
    const vivasCalca = [
      { codigo: '00000001', cor: 'Preto', tamanho: '34', excluida_da_publicacao: false },
      { codigo: '00000002', cor: 'Preto', tamanho: '36', excluida_da_publicacao: false },
    ];
    const cCalca = { ...ctx, vivas: vivasCalca, tiposHabilitados: ['roupa', 'calcado'], gradeTamanho: 'calca' };
    it('calça gravada em org roupa+calçado: aceita 38, recusa 39', () => {
      expect(validarGrade([nova('Preto', '38')], cCalca)).toEqual([]);
      expect(validarGrade([nova('Preto', '39')], cCalca)[0]!.mensagem).toMatch(/Tamanho "39" não é válido/);
    });
    it('calça não passa pela checagem de numeração de calçado (46 feminino aceito)', () => {
      expect(validarGrade([nova('Preto', '46')], { ...cCalca, genero: 'feminino' })).toEqual([]);
    });
    it('calça gravada com Roupa desligada na org → mensagem de tipo desativado', () => {
      expect(validarGrade([nova('Preto', '38')], { ...cCalca, tiposHabilitados: ['calcado'] })[0]!.mensagem)
        .toMatch(/Roupa está desativado/);
    });
    it('infantil gravada aceita 8 e recusa P', () => {
      const c = { ...ctx, vivas: [{ codigo: '00000001', cor: 'Azul', tamanho: '4', excluida_da_publicacao: false }], genero: 'meninos', gradeTamanho: 'infantil' };
      expect(validarGrade([nova('Azul', '8')], c)).toEqual([]);
      expect(validarGrade([nova('Azul', 'P')], c)).toHaveLength(1);
    });
    it('grade null com vivas P,M segue a inferência legada (Letras)', () => {
      expect(validarGrade([nova('Verde', 'G')], { ...ctx, gradeTamanho: null })).toEqual([]);
      expect(validarGrade([nova('Verde', '38')], { ...ctx, gradeTamanho: null, tiposHabilitados: ['roupa', 'calcado'] })).toHaveLength(1);
    });
  });
  it('aceita cor nova e tamanho novo', () => {
    expect(validarGrade([nova('Verde', 'P'), nova('Preto', 'G')], ctx)).toEqual([]);
  });
  it('recusa par que já existe e par repetido na submissão, com mensagens distintas', () => {
    expect(validarGrade([nova('Preto', 'M')], ctx)).toEqual([
      { campo: 'variacoes[0].tamanho', mensagem: 'Preto · M já existe neste produto.' },
    ]);
    expect(validarGrade([nova('Verde', 'P'), nova('Verde', 'P')], ctx)).toEqual([
      { campo: 'variacoes[1].tamanho', mensagem: 'Verde · P está repetido nesta submissão.' },
    ]);
  });
  it('par com a cor na grafia do ML ("Azul-marinho" × "Azul Marinho") é o MESMO par', () => {
    const c = { ...ctx, vivas: [...vivas, { codigo: '00000003', cor: 'Azul Marinho', tamanho: 'P', excluida_da_publicacao: false }] };
    expect(validarGrade([nova('Azul-marinho', 'P')], c)[0]!.mensagem).toMatch(/já existe/);
    expect(validarGrade([nova('preto', 'G'), nova('Preto', 'G')], ctx)[0]!.mensagem).toMatch(/repetido nesta submissão/);
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
    expect(validarGrade([nova('PRETO', 'G', { imagemPath: undefined, fotoDeCodigo: '00000001' })], ctx)).toEqual([]);
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
    expect(tamanhosDoTipo('roupa')).toEqual(['P', 'M', 'G', 'GG', 'GGG']);
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
  it('mesma cor em outra grafia ("Azul-marinho" × "Azul Marinho") herda', () => {
    expect(resolverFotoHerdada('1', 'Azul-marinho', [{ codigo: '00000001', cor: 'Azul Marinho', imagem_path: 'o/a.jpg', ml_picture_id: null }]))
      .toEqual({ imagemPath: 'o/a.jpg', mlPictureId: null });
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

describe('decidirErroPendente (achado E2E 1: adição anterior terminou em erro)', () => {
  const publicada = { criado_em: '2026-09-20T10:00:00Z' };
  it('família em erro mais nova que a publicada → bloqueia', () => {
    expect(decidirErroPendente(publicada, { status: 'erro', criado_em: '2026-09-21T10:00:00Z' })).toBe(true);
  });
  it('família em erro mais antiga que a publicada → segue', () => {
    expect(decidirErroPendente(publicada, { status: 'erro', criado_em: '2026-09-19T10:00:00Z' })).toBe(false);
  });
  it('a publicada é a mais recente (ou não há outra) → segue', () => {
    expect(decidirErroPendente(publicada, { status: 'publicado', criado_em: publicada.criado_em })).toBe(false);
    expect(decidirErroPendente(publicada, null)).toBe(false);
  });
});

describe('haAtualizacaoComErro', () => {
  const publicadaEm = '2026-09-20T10:00:00Z';
  it('família simples → nunca consulta nem bloqueia (INV-1)', async () => {
    const { admin, chamadas } = fakeAdmin({});
    expect(await haAtualizacaoComErro(admin, 'org', '00000100', 'simples', publicadaEm)).toBe(false);
    expect(chamadas).toEqual([]);
  });
  it('grade: mais recente do codigo_pai (sem kit, criado_em desc) em erro e mais nova → bloqueia', async () => {
    let filtros: Record<string, unknown> = {};
    const { admin } = fakeAdmin({ familias: (f) => { filtros = f; return { data: { status: 'erro', criado_em: '2026-09-21T10:00:00Z' } }; } });
    expect(await haAtualizacaoComErro(admin, 'org', '00000100', 'grade', publicadaEm)).toBe(true);
    expect(filtros).toMatchObject({
      org_id: 'org', codigo_pai: '00000100', 'is:kit_multiplicador': null,
      'order:criado_em': { ascending: false }, limit: 1,
    });
  });
  it('grade: mais recente é a publicada → segue', async () => {
    const { admin } = fakeAdmin({ familias: () => ({ data: { status: 'publicado', criado_em: publicadaEm } }) });
    expect(await haAtualizacaoComErro(admin, 'org', '00000100', 'grade', publicadaEm)).toBe(false);
  });
  it('grade: erro na consulta → lança (falha fechada)', async () => {
    const { admin } = fakeAdmin({ familias: () => ({ data: null, error: { message: 'boom' } }) });
    await expect(haAtualizacaoComErro(admin, 'org', '00000100', 'grade', publicadaEm)).rejects.toThrow(/boom/);
  });
});

describe('aplicarEstoqueInicial', () => {
  it('devolve a falha por código e reusa o mesmo p_ref entre chamadas', async () => {
    const { admin, rpcArgs } = fakeAdmin({}, (_n, a) => (a.p_codigo === '00000002' ? { error: { message: 'kit' } } : {}));
    const entrada = { orgId: 'org', familiaId: 'fam', userId: 'u', itens: [
      { codigo: '00000001', qtd: 3, custo: null }, { codigo: '00000002', qtd: 1, custo: 5 },
    ] };
    expect(await aplicarEstoqueInicial(admin, entrada)).toEqual({ falhas: ['00000002: kit'], notaFechada: false });
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

/** Banco em memória mínimo para a limpeza de órfãs: select/eq/not-in/limit, count head e delete.
 *  `falhar` = tabela cuja LEITURA devolve erro (delete nunca falha aqui). */
function bancoFake(estado: Record<string, Array<Record<string, unknown>>>, falhar: string[] = []) {
  const apagados: string[] = [];
  const admin = {
    from(t: string) {
      const filtros: Array<(r: Record<string, unknown>) => boolean> = [];
      let op: 'select' | 'delete' = 'select';
      let head = false;
      const responder = () => {
        const linhas = (estado[t] ?? []).filter((r) => filtros.every((f) => f(r)));
        if (op === 'delete') {
          estado[t] = (estado[t] ?? []).filter((r) => !linhas.includes(r));
          linhas.forEach((r) => apagados.push(`${t}:${r.id}`));
          return Promise.resolve({ error: null });
        }
        if (falhar.includes(t)) return Promise.resolve({ data: null, count: null, error: { message: 'falha' } });
        return Promise.resolve(head ? { count: linhas.length, error: null } : { data: linhas, error: null });
      };
      const q = {
        select: (_c: string, o?: { head?: boolean }) => { head = !!o?.head; return q; },
        delete: () => { op = 'delete'; return q; },
        eq: (k: string, v: unknown) => { filtros.push((r) => r[k] === v); return q; },
        not: (k: string, _op: string, _v: string) => { filtros.push((r) => !['publicado', 'erro'].includes(r[k] as string)); return q; },
        limit: () => q,
        then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) => responder().then(res, rej),
      };
      return q;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { admin, apagados, estado };
}

describe('haFamiliaEmVoo — órfã deste fluxo (rodada 2)', () => {
  const agora = new Date('2026-09-24T12:10:00Z');
  const fam = (extra: Record<string, unknown> = {}) => ({
    id: 'fo', lote_id: 'lo', org_id: 'org', codigo_pai: '00000100', status: 'pronto', operacao: 'UPDATE',
    criado_em: '2026-09-24T12:00:00Z', mudanca_estrutural: { novas: ['00000103'], removidas: [], intencao: [{}] },
    ...extra,
  });
  const cenario = (f: Record<string, unknown>, variacoes: Array<Record<string, unknown>> = [], falhar: string[] = []) =>
    bancoFake({ familias: [f], variacoes, lotes: [{ id: 'lo' }] }, falhar);

  it('órfã antiga deste fluxo → limpa família e lote e a submissão segue', async () => {
    const b = cenario(fam());
    expect(await haFamiliaEmVoo(b.admin, 'org', '00000100', agora)).toBe(false);
    expect(b.apagados).toEqual(['familias:fo', 'lotes:lo']);
  });
  it('lote com outra família sobrevive', async () => {
    const b = bancoFake({ familias: [fam(), { id: 'outra', lote_id: 'lo', org_id: 'org', codigo_pai: '00000999', status: 'publicado' }], variacoes: [], lotes: [{ id: 'lo' }] });
    expect(await haFamiliaEmVoo(b.admin, 'org', '00000100', agora)).toBe(false);
    expect(b.apagados).toEqual(['familias:fo']);
  });
  it('órfã recente → nada apagado, 409 emVoo', async () => {
    const b = cenario(fam({ criado_em: '2026-09-24T12:09:00Z' }));
    expect(await haFamiliaEmVoo(b.admin, 'org', '00000100', agora)).toBe(true);
    expect(b.apagados).toEqual([]);
  });
  it.each([
    ['com variações', fam(), [{ id: 'v1', familia_id: 'fo' }]],
    ['sem intencao', fam({ mudanca_estrutural: { novas: [], removidas: [] } }), []],
    ["status 'publicando'", fam({ status: 'publicando' }), []],
    ['operação CREATE', fam({ operacao: 'CREATE' }), []],
  ])('família em voo real (%s) → nunca apagada', async (_n, f, vars) => {
    const b = cenario(f as Record<string, unknown>, vars as Array<Record<string, unknown>>);
    expect(await haFamiliaEmVoo(b.admin, 'org', '00000100', agora)).toBe(true);
    expect(b.apagados).toEqual([]);
  });
  it('erro na contagem de variações → nada apagado, 409 emVoo', async () => {
    const b = cenario(fam(), [], ['variacoes']);
    expect(await haFamiliaEmVoo(b.admin, 'org', '00000100', agora)).toBe(true);
    expect(b.apagados).toEqual([]);
  });
  it('erro na consulta de famílias em voo → lança (fail-closed), nada apagado', async () => {
    const b = cenario(fam(), [], ['familias']);
    await expect(haFamiliaEmVoo(b.admin, 'org', '00000100', agora)).rejects.toThrow(/atualização em andamento/);
    expect(b.apagados).toEqual([]);
  });
  it('sem família em voo → uma consulta só, nada apagado', async () => {
    const b = cenario(fam({ status: 'publicado' }));
    expect(await haFamiliaEmVoo(b.admin, 'org', '00000100', agora)).toBe(false);
    expect(b.apagados).toEqual([]);
  });
});

describe('limparFamiliaOrfa', () => {
  it('erro no count de famílias restantes → lote fica', async () => {
    const b = bancoFake({ familias: [{ id: 'fo', lote_id: 'lo' }], lotes: [{ id: 'lo' }] }, ['familias']);
    await limparFamiliaOrfa(b.admin, { id: 'fo', lote_id: 'lo' });
    expect(b.apagados).toEqual(['familias:fo']);
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
  it('intenção gravada antes do fix com gtin cru "2" + reenvio idêntico → reaplicar (não 409)', () => {
    const antiga = [{ codigo: '00000103', ...normalizarIntencao(corpo()), gtin: '2' }];
    expect(decidirRetry(antiga, [{ ...corpo(), gtin: '2' }], ['00000103']).tipo).toBe('reaplicar');
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

// ─── ADR-0181 D-8: variação faltante pela nota (refNota) ─────────────────────────────────────
const CHAVE44 = '26261011222333000181550010000010511000030324';
const REF = `nfe:${CHAVE44}:1`;

describe('validarEntrada — refNota (ADR-0181 D-8)', () => {
  const v = () => ({
    codigo: '9', nome: 'Verde', gtin: null, preco: 10, custo: null, estoqueInicial: 5,
    pesoGramas: null, alturaCm: null, larguraCm: null, comprimentoCm: null, imagemPath: 'user-1/c/x.jpg',
  });
  const body = (extra: Record<string, unknown>) => ({ familia_id: 'f', chave: '11111111-1111-1111-1111-111111111111', variacoes: [v()], ...extra });
  it('refNota válida com 1 variação passa', () => {
    expect(validarEntrada(body({ refNota: REF }), 'user-1')).toEqual([]);
  });
  it.each(['nfe:123:1', 'addvar:x', `nfe:${CHAVE44}:1234`, `nfe:${CHAVE44}:1:00000001`, 42])('refNota malformada (%s) → erro no campo refNota', (ref) => {
    expect(validarEntrada(body({ refNota: ref }), 'user-1').map((e) => e.campo)).toContain('refNota');
  });
  it('refNota com 2 variações → uma por vez', () => {
    const erros = validarEntrada(body({ refNota: REF, variacoes: [v(), { ...v(), codigo: '8' }] }), 'user-1');
    expect(erros).toContainEqual({ campo: 'variacoes', mensagem: 'Na importação por nota, adicione um tamanho/cor por vez.' });
  });
});

describe('aplicarEstoqueInicial — refNota', () => {
  it('com refNota chama registrar_entrada_nota_pendente com p_chave e ref da nota', async () => {
    const { admin, chamadas, rpcArgs } = fakeAdmin({});
    await aplicarEstoqueInicial(admin, {
      orgId: 'org', familiaId: 'fam', userId: 'u', refNota: REF, itens: [{ codigo: '00000107', qtd: 5, custo: 10 }],
    });
    expect(chamadas).toEqual(['rpc:registrar_entrada_nota_pendente']);
    expect(rpcArgs[0]).toEqual({
      p_org: 'org', p_chave: CHAVE44, p_codigo: '00000107', p_qtd: 5, p_custo: 10,
      p_doc: 'NF-e (variação nova)', p_user: 'u', p_ref: `${REF}:00000107`,
    });
  });
  it('sem refNota continua registrar_entrada com addvar', async () => {
    const { admin, chamadas, rpcArgs } = fakeAdmin({});
    await aplicarEstoqueInicial(admin, { orgId: 'org', familiaId: 'fam', userId: 'u', itens: [{ codigo: '00000107', qtd: 5, custo: null }] });
    expect(chamadas).toEqual(['rpc:registrar_entrada']);
    expect(rpcArgs[0].p_ref).toBe('addvar:fam:00000107');
  });
  it('falha da RPC vira falhasEstoque (não aborta)', async () => {
    const { admin } = fakeAdmin({}, () => ({ error: { message: 'timeout' } }));
    expect(await aplicarEstoqueInicial(admin, {
      orgId: 'org', familiaId: 'fam', userId: 'u', refNota: REF, itens: [{ codigo: '00000107', qtd: 5, custo: null }],
    })).toEqual({ falhas: ['00000107: timeout'], notaFechada: false });
  });
});

describe('notaJaImportada', () => {
  it('consulta notas_compra pela org e pelos 44 dígitos da ref', async () => {
    let filtros: Record<string, unknown> = {};
    const { admin } = fakeAdmin({ notas_compra: (f) => { filtros = f; return { data: { id: 'n1' } }; } });
    expect(await notaJaImportada(admin, 'org', REF)).toBe(true);
    expect(filtros).toEqual({ org_id: 'org', chave: CHAVE44 });
  });
  it('sem nota → false', async () => {
    const { admin } = fakeAdmin({ notas_compra: () => ({ data: null }) });
    expect(await notaJaImportada(admin, 'org', REF)).toBe(false);
  });
  it('erro na consulta → lança (fail-closed)', async () => {
    const { admin } = fakeAdmin({ notas_compra: () => ({ data: null, error: { message: 'boom' } }) });
    await expect(notaJaImportada(admin, 'org', REF)).rejects.toThrow(/boom/);
  });
});

// Resposta real da RPC quando a outra aba confirma a nota entre a checagem cedo e o lançamento.
const ERRO_NOTA_FECHADA = {
  code: '23514',
  message: `registrar_entrada_nota_pendente: a nota ${CHAVE44} já foi importada; adicione o tamanho/cor sem a nota`,
};

describe('ehNotaJaImportada', () => {
  it('exige código E texto (23514 também sai dos guards de kit)', () => {
    expect(ehNotaJaImportada(ERRO_NOTA_FECHADA)).toBe(true);
    expect(ehNotaJaImportada({ code: '23514', message: 'Produto tem kit vinculado ativo' })).toBe(false);
    expect(ehNotaJaImportada({ code: 'P0001', message: 'já foi importada' })).toBe(false);
    expect(ehNotaJaImportada(null)).toBe(false);
  });
});

describe('nota importada durante a criação (D-8, revisão pré-merge)', () => {
  const entrada = { orgId: 'org', familiaId: 'fam', userId: 'u', refNota: REF, itens: [{ codigo: '00000107', qtd: 5, custo: null }] };
  it('RPC recusa por nota fechada → recusar, e o desfazer apaga o lote (cascata leva família e variações)', async () => {
    const { admin } = fakeAdmin({}, () => ({ error: ERRO_NOTA_FECHADA }));
    const estoque = await aplicarEstoqueInicial(admin, entrada);
    expect(estoque.notaFechada).toBe(true);
    expect(decidirAposEstoque(REF, estoque)).toBe('recusar_nota_importada');

    const b = bancoFake({ lotes: [{ id: 'lo' }], familias: [{ id: 'fam', lote_id: 'lo' }] });
    expect(await desfazerCriacao(b.admin, { loteId: 'lo', familiaId: 'fam', motivo: MSG_NOTA_JA_IMPORTADA })).toBe(true);
    expect(b.apagados).toEqual(['lotes:lo']);
  });
  it('falha transitória com nota → publica (caminho atual: trava a linha, a confirmação aplica)', async () => {
    const { admin } = fakeAdmin({}, () => ({ error: { code: '57014', message: 'timeout' } }));
    expect(decidirAposEstoque(REF, await aplicarEstoqueInicial(admin, entrada))).toBe('publicar');
  });
  it('sem nota nunca recusa', () => {
    expect(decidirAposEstoque(undefined, { notaFechada: true })).toBe('publicar');
  });
  it('DELETE falhou → família vira erro e lote vai para revisao (nenhum retry a encontra em pronto)', async () => {
    const ops: Array<[string, string, unknown]> = [];
    const q = (t: string) => ({
      delete: () => ({ eq: async () => { ops.push([t, 'delete', null]); return { error: { message: 'boom' } }; } }),
      update: (v: unknown) => ({ eq: async () => { ops.push([t, 'update', v]); return { error: null }; } }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = { from: q } as any;
    expect(await desfazerCriacao(admin, { loteId: 'lo', familiaId: 'fam', motivo: MSG_NOTA_JA_IMPORTADA })).toBe(false);
    expect(ops).toEqual([
      ['lotes', 'delete', null],
      ['familias', 'update', { status: 'erro', erro_mensagem: MSG_NOTA_JA_IMPORTADA }],
      ['lotes', 'update', { status: 'revisao' }],
    ]);
  });
});

describe('index.ts — ordem do modo nota (leitura do código)', () => {
  const src = readFileSync(resolve(process.cwd(), 'supabase/functions/adicionar-variacoes-familia/index.ts'), 'utf8');
  it('confere a nota antes de reservar código e de qualquer insert', () => {
    const i = src.indexOf('notaJaImportada(admin');
    expect(i).toBeGreaterThan(0);
    // Os alvos existem (senão indexOf = -1 e o toBeLessThan passaria vazio).
    const alvos = [src.indexOf("rpc('proximo_codigo_produto'"), src.indexOf(".from('lotes')\n    .insert"),
      src.lastIndexOf('encadearPublicacao(req')];
    for (const a of alvos) { expect(a).toBeGreaterThan(0); expect(i).toBeLessThan(a); }
  });
  it('nota fechada na criação: desfaz e responde 409 ANTES de encadear a publicação', () => {
    const decisao = src.lastIndexOf("decidirAposEstoque(refNota, estoque) === 'recusar_nota_importada'");
    const desfaz = src.indexOf('desfazerCriacao(admin', decisao);
    const resp409 = src.indexOf('return json({ error: MSG_NOTA_JA_IMPORTADA }, 409);', desfaz);
    const publica = src.lastIndexOf('encadearPublicacao(req');
    for (const a of [decisao, desfaz, resp409]) expect(a).toBeGreaterThan(0);
    expect(decisao).toBeLessThan(desfaz);
    expect(desfaz).toBeLessThan(resp409);
    expect(resp409).toBeLessThan(publica);
  });
  it('retry ainda pronto com nota fechada: 409 antes de re-encadear', () => {
    const guard = src.indexOf("decidirAposEstoque(mudanca?.refNota, { notaFechada }) === 'recusar_nota_importada'");
    const reencadeia = src.indexOf("publicacaoOk = await encadearPublicacao(req");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(reencadeia);
    // 2º clique (mesma chave) acha a família em 'erro' deixada pelo 1º: também 409, não 200 que trava a linha.
    expect(src.slice(guard - 90, guard)).toContain("(jaExistente.status === 'pronto' || jaExistente.status === 'erro') &&");
  });
});

describe('decidirRetry — refNota', () => {
  const corpo = (): VariacaoNovaEntrada => ({
    nome: 'Verde', tamanho: 'P', gtin: null, preco: 10, custo: null, estoqueInicial: 2,
    pesoGramas: null, alturaCm: null, larguraCm: null, comprimentoCm: null, imagemPath: 'u1/x.jpg',
  });
  const intencao = () => [{ codigo: '00000103', ...normalizarIntencao(corpo()) }];
  const reaplicar = { tipo: 'reaplicar', itens: [{ codigo: '00000103', qtd: 2, custo: null }] };
  it('mesma refNota → reaplicar', () => {
    expect(decidirRetry(intencao(), [corpo()], ['00000103'], { gravada: REF, corpo: REF })).toEqual(reaplicar);
  });
  it('refNota diferente → divergente', () => {
    expect(decidirRetry(intencao(), [corpo()], ['00000103'], { gravada: REF, corpo: `nfe:${CHAVE44}:2` })).toEqual({ tipo: 'divergente' });
  });
  it('refNota removida no retry → divergente', () => {
    expect(decidirRetry(intencao(), [corpo()], ['00000103'], { gravada: REF, corpo: undefined })).toEqual({ tipo: 'divergente' });
  });
  it('refNota acrescentada no retry → divergente', () => {
    expect(decidirRetry(intencao(), [corpo()], ['00000103'], { gravada: undefined, corpo: REF })).toEqual({ tipo: 'divergente' });
  });
  it('sem refNota dos dois lados (intenção antiga) → reaplicar como sempre', () => {
    expect(decidirRetry(intencao(), [corpo()], ['00000103'])).toEqual(reaplicar);
    expect(decidirRetry(intencao(), [corpo()], ['00000103'], { gravada: undefined, corpo: undefined })).toEqual(reaplicar);
  });
});

// ADR-0187 — fronteira real: o fake admin só aceita o rpc; qualquer `from` (insert em lotes/familias,
// update, delete) estoura — provando que a checagem não escreve nada.
describe('checarNcmDaFamilia (ADR-0187)', () => {
  const fake = (rpc: () => unknown) => {
    const chamadas: string[] = [];
    const admin = {
      rpc: async (fn: string) => { chamadas.push(fn); return rpc(); },
      from: () => { throw new Error('não deve tocar tabela'); },
    } as never;
    return { admin, chamadas };
  };
  it('NCM inexistente → 400 com a copy + orientação, sem tocar tabela', async () => {
    const { admin, chamadas } = fake(() => ({ data: [], error: null }));
    expect(await checarNcmDaFamilia(admin, '75937727')).toEqual({
      status: 400, error: 'NCM 75937727 não existe na tabela oficial — corrija no botão Fiscal antes.',
    });
    expect(chamadas).toEqual(['ncm_consultar']);
  });
  it('NCM vencido → 400 "não está mais vigente"', async () => {
    const { admin } = fake(() => ({ data: [{ codigo: '75937727', vigente: false }], error: null }));
    const r = await checarNcmDaFamilia(admin, '75937727');
    expect(r?.status).toBe(400);
    expect(r?.error).toContain('não está mais vigente');
  });
  it('NCM vigente → null (segue)', async () => {
    const { admin } = fake(() => ({ data: [{ codigo: '62034900', vigente: true }], error: null }));
    expect(await checarNcmDaFamilia(admin, '62034900')).toBeNull();
  });
  it('família sem NCM (null) → null, sem rpc', async () => {
    const { admin, chamadas } = fake(() => ({ data: [], error: null }));
    expect(await checarNcmDaFamilia(admin, null)).toBeNull();
    expect(chamadas).toEqual([]);
  });
  it('erro de leitura → 500 (fail-closed)', async () => {
    const { admin } = fake(() => ({ data: null, error: { message: 'fora do ar' } }));
    const r = await checarNcmDaFamilia(admin, '62034900');
    expect(r?.status).toBe(500);
  });
});
