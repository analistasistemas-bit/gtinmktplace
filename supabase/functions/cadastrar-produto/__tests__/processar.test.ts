import { describe, expect, it } from 'vitest';
import { estoqueInicialDiverge, variacoesDivergem } from '../processar.ts';

const gravada = (over = {}) => ({ nome: 'Azul', gtin: '789', preco: 10.5, custo: 4.25, ...over });
const enviada = (over = {}) => ({ nome: 'Azul', gtin: '789', preco: 10.5, custo: 4.25, ...over });

describe('variacoesDivergem', () => {
  it('reenvio idêntico não diverge', () => {
    expect(variacoesDivergem([enviada()], [gravada()])).toBe(false);
  });

  it('normalização: espaços e string vazia equivalem ao que foi gravado', () => {
    expect(variacoesDivergem(
      [enviada({ nome: '  Azul  ', gtin: '' })],
      [gravada({ nome: 'Azul', gtin: null })],
    )).toBe(false);
  });

  it('nulos em ambos os lados não divergem', () => {
    expect(variacoesDivergem(
      [enviada({ nome: null, gtin: null, custo: null })],
      [gravada({ nome: null, gtin: null, custo: null })],
    )).toBe(false);
  });

  it('contagem diferente diverge', () => {
    expect(variacoesDivergem([enviada(), enviada()], [gravada()])).toBe(true);
  });

  it('reordenação diverge', () => {
    const a = enviada({ nome: 'Azul' });
    const b = enviada({ nome: 'Verde' });
    expect(variacoesDivergem([b, a], [gravada({ nome: 'Azul' }), gravada({ nome: 'Verde' })])).toBe(true);
  });

  it('preço alterado em um centavo diverge', () => {
    expect(variacoesDivergem([enviada({ preco: 10.51 })], [gravada({ preco: 10.5 })])).toBe(true);
  });

  it('custo alterado diverge — alimenta markup (ADR-0055)', () => {
    expect(variacoesDivergem([enviada({ custo: 4.26 })], [gravada({ custo: 4.25 })])).toBe(true);
  });

  it('custo que sai de ausente para preenchido diverge', () => {
    expect(variacoesDivergem([enviada({ custo: 4.25 })], [gravada({ custo: null })])).toBe(true);
  });

  // custo é `numeric` SEM escala fixa (arbitrária) — ao contrário de preco/dimensões
  // (numeric(_,2)), o Postgres não arredonda custo na escrita. Comparar em centavos, como preco,
  // esconderia justamente este caso (achado de revisão, Task 4b fix round 1).
  it('custo com diferença abaixo de um centavo diverge — custo não tem escala fixa, não pode truncar', () => {
    expect(variacoesDivergem([enviada({ custo: 4.251 })], [gravada({ custo: 4.252 })])).toBe(true);
  });

  it('custo número (payload) e string (PostgREST) do mesmo valor não divergem', () => {
    expect(variacoesDivergem([enviada({ custo: 4.25 })], [gravada({ custo: '4.25' })])).toBe(false);
  });

  it('nome ou gtin alterado diverge', () => {
    expect(variacoesDivergem([enviada({ nome: 'Verde' })], [gravada()])).toBe(true);
    expect(variacoesDivergem([enviada({ gtin: '111' })], [gravada()])).toBe(true);
  });

  it('preço vindo do PostgREST como string compara igual', () => {
    expect(variacoesDivergem([enviada({ preco: 10.5 })], [gravada({ preco: '10.50' })])).toBe(false);
  });

  it('peso e dimensões alterados divergem', () => {
    expect(variacoesDivergem(
      [enviada({ pesoGramas: 500 })],
      [gravada({ peso_gramas: 400 })],
    )).toBe(true);
    expect(variacoesDivergem(
      [enviada({ alturaCm: 10 })],
      [gravada({ altura_cm: 12 })],
    )).toBe(true);
  });

  // largura_cm/comprimento_cm não tinham teste próprio — sem isto, remover as duas colunas da
  // comparação não quebrava nenhum teste (achado de revisão, Task 4b fix round 1).
  it('largura e comprimento alterados divergem', () => {
    expect(variacoesDivergem(
      [enviada({ larguraCm: 20 })],
      [gravada({ largura_cm: 15 })],
    )).toBe(true);
    expect(variacoesDivergem(
      [enviada({ comprimentoCm: 30 })],
      [gravada({ comprimento_cm: 25 })],
    )).toBe(true);
  });

  // As 4 colunas de dimensão são numeric(10,2): `10` (payload, number) e `"10.00"` (PostgREST,
  // string) representam o MESMO valor. `!==` estrito trataria como diferentes e barraria todo
  // retry de um produto com dimensões preenchidas — é o caso que a suíte não cobria antes
  // (achado de revisão, Task 4b fix round 1): os testes acima só exercitam a DIVERGÊNCIA, que
  // passaria com `!==` estrito também.
  it('dimensões iguais com tipos diferentes (número vs string do PostgREST) não divergem', () => {
    expect(variacoesDivergem(
      [enviada({ pesoGramas: 500, alturaCm: 10, larguraCm: 20, comprimentoCm: 30 })],
      [gravada({ peso_gramas: '500.00', altura_cm: '10.00', largura_cm: '20.00', comprimento_cm: '30.00' })],
    )).toBe(false);
  });

  it('troca de posição entre linhas que só diferem no custo diverge', () => {
    // Sem comparar `custo`, estas duas seriam indistinguíveis e a troca passaria —
    // aplicando o estoque inicial de uma no SKU da outra.
    const a = enviada({ custo: 4.25 });
    const b = enviada({ custo: 9.9 });
    expect(variacoesDivergem([b, a], [gravada({ custo: 4.25 }), gravada({ custo: 9.9 })])).toBe(true);
  });

  it('preço com empate de arredondamento não é falso positivo', () => {
    // `1.005 * 100` em IEEE dá 100.49999…, que um `Math.round` ingênuo arredondaria para 1.00.
    // `numeric(12,2)` no Postgres guarda 1.01 (parseia o TEXTO decimal do JSON, não multiplica
    // float). Prova que `centavosExatos` concorda com o Postgres nesse empate sem depender de
    // arredondar na gravação — `montarLinhasProduto` grava `v.preco` cru, sem Math.round algum:
    // o texto decimal que o JSON manda ("1.005") é o mesmo texto que `centavosExatos` lê aqui.
    expect(variacoesDivergem([enviada({ preco: 1.005 })], [gravada({ preco: '1.01' })])).toBe(false);
  });
});

describe('estoqueInicialDiverge', () => {
  const codigos = ['00000002', '00000003'];

  it('sem movimento para o código não diverge — a primeira tentativa morreu antes do laço', () => {
    // CASO PRIMÁRIO da feature: comparar contra `variacoes.estoque` (que é 0 aqui) daria 409
    // falso e barraria o retry legítimo. Se este teste quebrar, a feature quebrou.
    expect(estoqueInicialDiverge([{ estoqueInicial: 10 }], ['00000002'], [])).toBe(false);
  });

  it('movimento com a mesma quantidade não diverge — no-op normal do retry', () => {
    expect(estoqueInicialDiverge(
      [{ estoqueInicial: 10 }],
      ['00000002'],
      [{ codigo: '00000002', quantidade: 10 }],
    )).toBe(false);
  });

  it('movimento com quantidade diferente diverge — 10 gravado, 50 reenviado', () => {
    // O defeito: sem esta checagem `registrar_entrada` era no-op silencioso (unique_violation →
    // return null), `falhasEstoque` ficava vazio e a tela mostrava sucesso com 50.
    expect(estoqueInicialDiverge(
      [{ estoqueInicial: 50 }],
      ['00000002'],
      [{ codigo: '00000002', quantidade: 10 }],
    )).toBe(true);
  });

  it('variação sem estoqueInicial e sem movimento não diverge', () => {
    expect(estoqueInicialDiverge([{ estoqueInicial: null }], ['00000002'], [])).toBe(false);
    expect(estoqueInicialDiverge([{ estoqueInicial: 0 }], ['00000002'], [])).toBe(false);
    expect(estoqueInicialDiverge([{}], ['00000002'], [])).toBe(false);
  });

  it('movimento existente e estoque zerado/limpo no reenvio DIVERGE', () => {
    // Espelho do defeito: ledger 10, tela 0, resposta 200. A decisão é por PRESENÇA do
    // movimento — não trocar por early-out em `estoqueInicial` falsy.
    expect(estoqueInicialDiverge(
      [{ estoqueInicial: null }],
      ['00000002'],
      [{ codigo: '00000002', quantidade: 10 }],
    )).toBe(true);
    expect(estoqueInicialDiverge(
      [{ estoqueInicial: 0 }],
      ['00000002'],
      [{ codigo: '00000002', quantidade: 10 }],
    )).toBe(true);
  });

  it('quantidade vinda como string do PostgREST compara igual', () => {
    expect(estoqueInicialDiverge(
      [{ estoqueInicial: 10 }],
      ['00000002'],
      [{ codigo: '00000002', quantidade: '10' }],
    )).toBe(false);
  });

  it('casa por código, não por posição da lista de movimentos', () => {
    expect(estoqueInicialDiverge(
      [{ estoqueInicial: 10 }, { estoqueInicial: 5 }],
      codigos,
      [{ codigo: '00000003', quantidade: 5 }, { codigo: '00000002', quantidade: 10 }],
    )).toBe(false);
    expect(estoqueInicialDiverge(
      [{ estoqueInicial: 10 }, { estoqueInicial: 5 }],
      codigos,
      [{ codigo: '00000003', quantidade: 7 }],
    )).toBe(true);
  });
});
