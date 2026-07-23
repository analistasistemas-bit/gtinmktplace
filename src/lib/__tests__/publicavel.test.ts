import { describe, expect, test } from 'vitest';
import { familiaPrecosDivergentes, familiaPublicavel, criticasVariacao, variacoesEstoqueAlterado } from '../publicavel';
import type { Familia, Variacao } from '../tipos-dominio';

// Builders mínimos: familiaPublicavel/criticasVariacao só leem um subset de campos.
function mkVar(over: Partial<Variacao> = {}): Variacao {
  return {
    codigo: '001', cor: 'Azul', corHex: '#00f', corOrigem: null, corEditadaPeloOperador: false,
    preco: 40, precoPublicacao: 40, precoPublicadoMl: null, estoque: 5, gtin: null,
    fotoPath: 'foto/001.jpg', excluidaDaPublicacao: false, mlVariationId: null,
    estoqueAnterior: null, custo: null, pesoGramas: null, alturaCm: null, larguraCm: null,
    comprimentoCm: null, exibirComDesconto: null, descontoPct: null, atacado: null,
    ...over,
  } as Variacao;
}

function mkFam(over: Partial<Familia> = {}): Familia {
  return {
    id: 'f1', operacao: 'UPDATE', status: 'pronto', atributosFaltantes: null,
    mlItemId: 'MLB123', categoriaMlId: 'MLB419782', tipoAviamento: 'outro',
    variacoes: [], ...over,
  } as Familia;
}

type VariacaoParcial = { preco: number; precoPublicacao: number | null; excluidaDaPublicacao: boolean };
const fam = (vs: VariacaoParcial[]) => ({ variacoes: vs });

describe('familiaPrecosDivergentes', () => {
  test('preços iguais entre cores incluídas: false', () => {
    expect(
      familiaPrecosDivergentes(
        fam([
          { preco: 40.65, precoPublicacao: 40.65, excluidaDaPublicacao: false },
          { preco: 40.65, precoPublicacao: 40.65, excluidaDaPublicacao: false },
        ]),
      ),
    ).toBe(false);
  });

  test('preços diferentes entre cores incluídas: true', () => {
    expect(
      familiaPrecosDivergentes(
        fam([
          { preco: 40.65, precoPublicacao: 40.65, excluidaDaPublicacao: false },
          { preco: 134, precoPublicacao: 134, excluidaDaPublicacao: false },
        ]),
      ),
    ).toBe(true);
  });

  test('cor excluída da publicação não conta na comparação', () => {
    expect(
      familiaPrecosDivergentes(
        fam([
          { preco: 40.65, precoPublicacao: 40.65, excluidaDaPublicacao: false },
          { preco: 999, precoPublicacao: 999, excluidaDaPublicacao: true },
        ]),
      ),
    ).toBe(false);
  });

  test('família com 1 cor: nunca diverge', () => {
    expect(
      familiaPrecosDivergentes(fam([{ preco: 40.65, precoPublicacao: null, excluidaDaPublicacao: false }])),
    ).toBe(false);
  });

  test('família sem variações: false (não Infinity vs -Infinity)', () => {
    expect(familiaPrecosDivergentes(fam([]))).toBe(false);
  });

  test('usa precoPublicacao quando presente, cai para preco quando null', () => {
    expect(
      familiaPrecosDivergentes(
        fam([
          { preco: 10, precoPublicacao: 40.65, excluidaDaPublicacao: false },
          { preco: 10, precoPublicacao: null, excluidaDaPublicacao: false },
        ]),
      ),
    ).toBe(true); // 40.65 (publicação da 1ª) vs 10 (fallback pro preço da planilha na 2ª)
  });
});

// ADR-0088 Fase 2 — família User Products: cada cor é um item ML separado, logo o backend grava
// ml_variation_id=null em TODAS as variações. "Casada com o ML" vem de anuncios_externos_itens
// (sinal jaCasadaUP resolvido no fetch), NÃO de mlVariationId. Legacy continua por mlVariationId.
describe('familiaPublicavel — UPDATE User Products (jaCasadaUP)', () => {
  test('cor UP já casada (mlVariationId=null, jaCasadaUP=true) sem foto NÃO bloqueia', () => {
    const familia = mkFam({
      variacoes: [mkVar({ codigo: '001', mlVariationId: null, jaCasadaUP: true, fotoPath: undefined })],
    });
    expect(familiaPublicavel(familia).ok).toBe(true);
  });

  test('cor UP genuinamente nova (jaCasadaUP=false) sem foto AINDA bloqueia', () => {
    const familia = mkFam({
      variacoes: [mkVar({ codigo: '099', cor: 'Verde', mlVariationId: null, jaCasadaUP: false, fotoPath: undefined })],
    });
    const r = familiaPublicavel(familia);
    expect(r.ok).toBe(false);
    expect(r.motivos.some((m) => m.includes('sem foto'))).toBe(true);
  });

  test('família UP mista: 9 casadas sem foto + 1 nova sem foto → só a nova bloqueia', () => {
    const casadas = Array.from({ length: 9 }, (_, i) =>
      mkVar({ codigo: `00${i}`, mlVariationId: null, jaCasadaUP: true, fotoPath: undefined }));
    const nova = mkVar({ codigo: '099', cor: 'Roxo', mlVariationId: null, jaCasadaUP: false, fotoPath: undefined });
    const r = familiaPublicavel(mkFam({ variacoes: [...casadas, nova] }));
    expect(r.ok).toBe(false);
    expect(r.motivos).toHaveLength(1);
    expect(r.motivos[0]).toContain('Roxo');
  });
});

describe('familiaPublicavel — UPDATE Legacy (regressão: intocado, usa mlVariationId)', () => {
  test('cor Legacy casada (mlVariationId setado, jaCasadaUP undefined) sem foto NÃO bloqueia', () => {
    const familia = mkFam({
      variacoes: [mkVar({ codigo: '001', mlVariationId: 'MLV1', fotoPath: undefined })],
    });
    expect(familiaPublicavel(familia).ok).toBe(true);
  });

  test('cor Legacy nova (mlVariationId=null, jaCasadaUP undefined) sem foto bloqueia', () => {
    const familia = mkFam({
      variacoes: [mkVar({ codigo: '099', cor: 'Verde', mlVariationId: null, fotoPath: undefined })],
    });
    expect(familiaPublicavel(familia).ok).toBe(false);
  });
});

describe('criticasVariacao — casada não acusa (Legacy por mlVariationId, UP por jaCasadaUP)', () => {
  test('UP casada (mlVariationId=null, jaCasadaUP=true) sem foto → sem crítica', () => {
    expect(criticasVariacao(mkVar({ mlVariationId: null, jaCasadaUP: true, fotoPath: undefined }), 'UPDATE')).toEqual([]);
  });

  test('Legacy casada (mlVariationId setado) sem foto → sem crítica (intocado)', () => {
    expect(criticasVariacao(mkVar({ mlVariationId: 'MLV1', fotoPath: undefined }), 'UPDATE')).toEqual([]);
  });

  test('UP nova (jaCasadaUP=false) sem foto → acusa "sem foto"', () => {
    expect(criticasVariacao(mkVar({ mlVariationId: null, jaCasadaUP: false, fotoPath: undefined }), 'UPDATE')).toContain('sem foto');
  });
});

// ADR-0088: o diff de estoque enxerga cores UP casadas (mlVariationId=null) via jaCasadaUP; Legacy
// segue por mlVariationId (regressão). Depende de estoqueAnterior estar populado no reingest.
describe('variacoesEstoqueAlterado — casada UP entra no diff, Legacy intocado', () => {
  test('cor UP casada (jaCasadaUP=true, mlVariationId=null) com estoque mudado entra', () => {
    const v = mkVar({ codigo: '001', mlVariationId: null, jaCasadaUP: true, estoqueAnterior: 3, estoque: 7 });
    expect(variacoesEstoqueAlterado(mkFam({ variacoes: [v] }))).toHaveLength(1);
  });

  test('cor Legacy casada (mlVariationId setado) com estoque mudado entra (intocado)', () => {
    const v = mkVar({ codigo: '001', mlVariationId: 'MLV1', estoqueAnterior: 3, estoque: 7 });
    expect(variacoesEstoqueAlterado(mkFam({ variacoes: [v] }))).toHaveLength(1);
  });

  test('cor UP nova (jaCasadaUP=false, sem estoqueAnterior) fica fora do diff', () => {
    const v = mkVar({ codigo: '099', mlVariationId: null, jaCasadaUP: false, estoqueAnterior: null, estoque: 7 });
    expect(variacoesEstoqueAlterado(mkFam({ variacoes: [v] }))).toHaveLength(0);
  });
});
