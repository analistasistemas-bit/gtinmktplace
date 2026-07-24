import { describe, expect, test } from 'vitest';
import { familiasElegiveisEstoqueRapido, calcularZerados, deveExibirGateEstoqueRapido } from '../estoque-rapido';
import type { Familia, Variacao } from '../tipos-dominio';

function mkVar(over: Partial<Variacao> = {}): Variacao {
  return {
    codigo: '001', cor: 'Azul', corHex: '#00f', corOrigem: null, corEditadaPeloOperador: false,
    preco: 40, precoPublicacao: 40, precoPublicadoMl: null, estoque: 5, gtin: null,
    fotoPath: 'foto/001.jpg', excluidaDaPublicacao: false, mlVariationId: 'V1',
    estoqueAnterior: null, custo: null, pesoGramas: null, alturaCm: null, larguraCm: null,
    comprimentoCm: null, exibirComDesconto: null, descontoPct: null, atacado: null,
    ...over,
  } as Variacao;
}

function mkFam(over: Partial<Familia> = {}): Familia {
  return {
    id: 'f1', codigoPai: '00000100', titulo: 'FITA EXEMPLO', operacao: 'UPDATE',
    status: 'pronto', atributosFaltantes: null, mlItemId: 'MLB123',
    categoriaMlId: 'MLB419782', tipoAviamento: 'outro',
    variacoes: [mkVar()],
    ...over,
  } as Familia;
}

describe('familiasElegiveisEstoqueRapido', () => {
  test('UPDATE publicável (cor casada, sem pendência): elegível', () => {
    const f = mkFam({ variacoes: [mkVar({ mlVariationId: 'V1', fotoPath: 'a.jpg' })] });
    expect(familiasElegiveisEstoqueRapido([f])).toEqual([f]);
  });

  test('CREATE, mesmo tecnicamente pronto, nunca é elegível', () => {
    const f = mkFam({
      operacao: 'CREATE', mlItemId: null, categoriaMlId: 'MLB419782',
      variacoes: [mkVar({ mlVariationId: null, fotoPath: 'a.jpg', excluidaDaPublicacao: false })],
    });
    expect(familiasElegiveisEstoqueRapido([f])).toEqual([]);
  });

  test('UPDATE com cor nova (estoque > 0, sem foto): não elegível — cai no fluxo manual', () => {
    const f = mkFam({
      variacoes: [
        mkVar({ mlVariationId: 'V1', fotoPath: 'a.jpg' }), // casada, ok
        mkVar({ codigo: '002', mlVariationId: null, fotoPath: undefined, estoque: 3 }), // cor nova sem foto
      ],
    });
    expect(familiasElegiveisEstoqueRapido([f])).toEqual([]);
  });

  // B1 (achado da revisão): familiaPublicavel só reprova cor nova INCOMPLETA. Uma cor
  // nova COMPLETA (foto + preço + estoque > 0) passa em familiaPublicavel().ok, mas
  // ainda não está casada no ML — publicá-la criaria uma variação nova de verdade, o
  // que a ADR-0089 proíbe. A elegibilidade tem que barrar isso mesmo com tudo completo.
  test('UPDATE com cor nova COMPLETA (foto+preço+estoque, mas ainda não casada no ML): não elegível', () => {
    const f = mkFam({
      variacoes: [
        mkVar({ mlVariationId: 'V1', fotoPath: 'a.jpg' }), // casada, ok
        mkVar({
          codigo: '002', mlVariationId: null, jaCasadaUP: false, fotoPath: 'nova.jpg',
          precoPublicacao: 40, estoque: 3, excluidaDaPublicacao: false,
        }), // cor nova 100% completa, mas NUNCA foi ao ML — não pode entrar no 1-clique
      ],
    });
    expect(familiasElegiveisEstoqueRapido([f])).toEqual([]);
  });

  test('UPDATE com cor nova SEM estoque (dorme, excluída): continua elegível', () => {
    const f = mkFam({
      variacoes: [
        mkVar({ mlVariationId: 'V1', fotoPath: 'a.jpg' }),
        mkVar({ codigo: '002', mlVariationId: null, fotoPath: undefined, estoque: 0, excluidaDaPublicacao: true }),
      ],
    });
    expect(familiasElegiveisEstoqueRapido([f])).toEqual([f]);
  });

  test('família ainda processando (status != pronto/erro): não elegível', () => {
    const f = mkFam({ status: 'processando' });
    expect(familiasElegiveisEstoqueRapido([f])).toEqual([]);
  });

  test('UPDATE com atributo obrigatório faltando (ADR-0052): não elegível', () => {
    const f = mkFam({ atributosFaltantes: ['Material'] });
    expect(familiasElegiveisEstoqueRapido([f])).toEqual([]);
  });

  test('UPDATE sem ml_item_id (nunca foi publicada): não elegível', () => {
    const f = mkFam({ mlItemId: null });
    expect(familiasElegiveisEstoqueRapido([f])).toEqual([]);
  });

  test('família com status erro: reprovável (retry pendente), não elegível pro atalho', () => {
    // familiaPublicavel trata 'erro' como republicável, mas a cor pode não estar
    // resolvida (é justamente o caso genérico "sem cor selecionada" abaixo); o teste
    // cobre o caminho onde não há nenhuma cor casada nem nova — sempre reprova.
    const f = mkFam({ status: 'erro', variacoes: [] });
    expect(familiasElegiveisEstoqueRapido([f])).toEqual([]);
  });

  test('mistura: só as elegíveis voltam, na ordem original', () => {
    const elegivel = mkFam({ id: 'f1' });
    const createPronto = mkFam({
      id: 'f2', operacao: 'CREATE', mlItemId: null,
      variacoes: [mkVar({ mlVariationId: null, fotoPath: 'a.jpg' })],
    });
    expect(familiasElegiveisEstoqueRapido([elegivel, createPronto])).toEqual([elegivel]);
  });
});

describe('calcularZerados', () => {
  test('variação que zerou nesta rodada (estoqueAnterior > 0, estoque 0): entra na lista', () => {
    const f = mkFam({ variacoes: [mkVar({ codigo: '001', cor: 'Azul', estoqueAnterior: 10, estoque: 0 })] });
    expect(calcularZerados([f]).variacoes).toEqual([
      { familiaId: 'f1', codigoPai: '00000100', titulo: 'FITA EXEMPLO', codigo: '001', cor: 'Azul' },
    ]);
  });

  test('variação já zerada antes (estoqueAnterior 0, estoque 0): não é transição, não entra', () => {
    const f = mkFam({ variacoes: [mkVar({ estoqueAnterior: 0, estoque: 0 })] });
    expect(calcularZerados([f]).variacoes).toEqual([]);
  });

  test('cor nova (estoqueAnterior null) com estoque 0: não conta como transição', () => {
    const f = mkFam({ variacoes: [mkVar({ estoqueAnterior: null, estoque: 0 })] });
    expect(calcularZerados([f]).variacoes).toEqual([]);
  });

  test('variação excluída da publicação: nunca entra, mesmo zerando', () => {
    const f = mkFam({ variacoes: [mkVar({ estoqueAnterior: 10, estoque: 0, excluidaDaPublicacao: true })] });
    expect(calcularZerados([f]).variacoes).toEqual([]);
  });

  test('família com todas as variações incluídas zeradas: entra em `familias`', () => {
    const f = mkFam({
      variacoes: [
        mkVar({ codigo: '001', estoqueAnterior: 10, estoque: 0 }),
        mkVar({ codigo: '002', estoqueAnterior: 5, estoque: 0 }),
      ],
    });
    expect(calcularZerados([f]).familias).toEqual([
      { familiaId: 'f1', codigoPai: '00000100', titulo: 'FITA EXEMPLO' },
    ]);
  });

  test('família com pelo menos 1 cor ainda com estoque: não entra em `familias`', () => {
    const f = mkFam({
      variacoes: [
        mkVar({ codigo: '001', estoqueAnterior: 10, estoque: 0 }),
        mkVar({ codigo: '002', estoque: 5 }),
      ],
    });
    expect(calcularZerados([f]).familias).toEqual([]);
  });

  test('família sem nenhuma variação incluída: não entra em `familias`', () => {
    const f = mkFam({ variacoes: [mkVar({ excluidaDaPublicacao: true, estoque: 0 })] });
    expect(calcularZerados([f]).familias).toEqual([]);
  });

  // N3 (achado da revisão): o relatório é sobre reposição de estoque (conceito de
  // UPDATE); uma família CREATE zerada não é "estoque que zerou numa reposição" e
  // seria semanticamente estranha na seção "Estoque zerado nesta atualização".
  test('família CREATE, mesmo com tudo zerado, não entra no relatório', () => {
    const f = mkFam({
      operacao: 'CREATE', mlItemId: null,
      variacoes: [mkVar({ estoqueAnterior: 10, estoque: 0 })],
    });
    expect(calcularZerados([f])).toEqual({ variacoes: [], familias: [] });
  });

  test('sem nenhuma variação/família zerada: listas vazias', () => {
    const f = mkFam({ variacoes: [mkVar({ estoqueAnterior: 5, estoque: 5 })] });
    expect(calcularZerados([f])).toEqual({ variacoes: [], familias: [] });
  });
});

// M2 (achado da revisão code-review-fable5 v1): esta condição já causou 1 bug real
// (exigir 100% das famílias 'pronto' escondia o gate sempre que qualquer família do
// lote falhava, mesmo com dezenas de UPDATE já elegíveis) — extraída como função pura
// pra nunca mais regredir silenciosamente.
describe('deveExibirGateEstoqueRapido', () => {
  const elegivel = [mkFam()];

  test('true quando não há família pendente/processando e há elegíveis', () => {
    expect(
      deveExibirGateEstoqueRapido({
        loteStatus: 'revisao',
        familias: [{ status: 'pronto' }, { status: 'pronto' }],
        elegiveis: elegivel,
      }),
    ).toBe(true);
  });

  test('false quando há família ainda pendente ou processando, mesmo com elegíveis', () => {
    expect(
      deveExibirGateEstoqueRapido({
        loteStatus: 'processando',
        familias: [{ status: 'pronto' }, { status: 'processando' }],
        elegiveis: elegivel,
      }),
    ).toBe(false);
  });

  // Regressão a evitar: o bug real que motivou este teste.
  test('true mesmo com 1 família em erro, desde que haja elegíveis', () => {
    expect(
      deveExibirGateEstoqueRapido({
        loteStatus: 'revisao',
        familias: [{ status: 'pronto' }, { status: 'erro' }],
        elegiveis: elegivel,
      }),
    ).toBe(true);
  });

  test('false quando não há nenhuma família elegível', () => {
    expect(
      deveExibirGateEstoqueRapido({
        loteStatus: 'revisao',
        familias: [{ status: 'pronto' }],
        elegiveis: [],
      }),
    ).toBe(false);
  });

  test('false quando lote.status não é revisao nem processando', () => {
    expect(
      deveExibirGateEstoqueRapido({
        loteStatus: 'concluido',
        familias: [{ status: 'pronto' }],
        elegiveis: elegivel,
      }),
    ).toBe(false);
  });
});
