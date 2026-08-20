// ADR-0128. Padrão de teste igual a cadastrar-produto/__tests__/processar.test.ts: vitest
// (não Deno test) — é o runner que o CI (`test`/`frontend` do ci.yml) e o vitest.config.ts
// (`include: ['./supabase/functions/**/__tests__/**/*.test.ts']`) realmente executam.
import { describe, expect, it } from 'vitest';
import {
  clonarFamilia, clonarVariacao, montarVariacaoNova, normalizarCodigo8,
  precoPublicacaoNova, STRIP_FAMILIA, validarEntrada,
} from '../processar.ts';

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
