import { describe, it, expect } from 'vitest';
import { agregarEstado, type FilhoAgg } from '../publicar-grupo';

// Ordem de precedência exata da ADR-0088 (seção "Regra de agregação de estado").
// A = filhos não-retirados; E = skus_esperados. Função TOTAL: todo combo tem resultado.

const f = (sku: string, status: FilhoAgg['status'], retirado = false): FilhoAgg => ({ sku, status, retirado });

describe('agregarEstado (redução N filhos → estado da partição)', () => {
  // caso 0 — gate de mudança de composição tem precedência sobre TUDO
  it('caso 0: mudando_composicao=true → publicando (mascara erro que sairia sem o gate)', () => {
    // um filho em erro que, sem o gate, viraria erro (caso 2)
    expect(agregarEstado([f('A', 'erro')], ['A'], true)).toBe('publicando');
  });
  it('caso 0: mudando_composicao=true → publicando (mascara ativo que sairia sem o gate)', () => {
    // conjunto == E e todos ativos: sem o gate seria 'ativo' (caso 8)
    expect(agregarEstado([f('A', 'ativo'), f('B', 'ativo')], ['A', 'B'], true)).toBe('publicando');
  });

  // caso 1 — A vazio nunca é ativo por vacuidade
  it('caso 1: A vazio com E não-vazio → publicando (nunca ativo por vacuidade)', () => {
    expect(agregarEstado([], ['A', 'B'], false)).toBe('publicando');
  });
  it('caso 1 (guard): A vazio e E vazio → publicando (footgun ∅==∅ fechado)', () => {
    expect(agregarEstado([], [], false)).toBe('publicando');
  });
  it('caso 1: filhos só retirados (A vazio) com E não-vazio → publicando', () => {
    expect(agregarEstado([f('A', 'pausado', true)], ['B'], false)).toBe('publicando');
  });

  // caso 2 — erro tem precedência sobre conjunto incompleto
  it('caso 2: algum filho de A em erro → erro', () => {
    expect(agregarEstado([f('A', 'ativo'), f('B', 'erro')], ['A', 'B'], false)).toBe('erro');
  });
  it('caso 2: erro precede reserva incompleta (não vira publicando)', () => {
    // só 1 de 2 reservado, mas está em erro → erro, não publicando
    expect(agregarEstado([f('A', 'erro')], ['A', 'B'], false)).toBe('erro');
  });

  // caso 3 — compensacao_pendente
  it('caso 3: algum filho em compensacao_pendente (sem erro) → compensacao_pendente', () => {
    expect(agregarEstado([f('A', 'ativo'), f('B', 'compensacao_pendente')], ['A', 'B'], false))
      .toBe('compensacao_pendente');
  });
  it('caso 3: erro precede compensacao_pendente', () => {
    expect(agregarEstado([f('A', 'erro'), f('B', 'compensacao_pendente')], ['A', 'B'], false)).toBe('erro');
  });

  // caso 4 — não-terminais em transição
  it.each(['pendente', 'criado', 'criacao_incerta', 'remocao_pendente'] as const)(
    'caso 4: filho em %s (não-terminal) → publicando',
    (st) => {
      expect(agregarEstado([f('A', 'ativo'), f('B', st)], ['A', 'B'], false)).toBe('publicando');
    },
  );
  it('caso 4: criacao_incerta nunca conta como ativo (não libera publicado)', () => {
    expect(agregarEstado([f('A', 'criacao_incerta')], ['A'], false)).toBe('publicando');
  });

  // caso 5 — excesso não explicado por retirada
  it('caso 5: filho não-retirado com SKU ∉ E (excesso) → erro', () => {
    expect(agregarEstado([f('A', 'ativo'), f('X', 'ativo')], ['A'], false)).toBe('erro');
  });
  it('caso 5: filho retirado com SKU ∉ E NÃO é excesso (histórico, ignorado) → ativo', () => {
    expect(agregarEstado([f('A', 'ativo'), f('X', 'pausado', true)], ['A'], false)).toBe('ativo');
  });

  // caso 6 — subconjunto próprio (faltam SKUs)
  it('caso 6: conjunto de A ⊊ E (7 de 9 por crash) → publicando', () => {
    const filhos = ['1', '2', '3', '4', '5', '6', '7'].map((s) => f(s, 'ativo'));
    const E = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
    expect(agregarEstado(filhos, E, false)).toBe('publicando');
  });

  // caso 7 — mistura ativo+pausado (conjunto == E)
  it('caso 7: conjunto == E, mistura ativo+pausado → parcial', () => {
    expect(agregarEstado([f('A', 'ativo'), f('B', 'pausado')], ['A', 'B'], false)).toBe('parcial');
  });

  // caso 8 — todos ativo E conjunto == E
  it('caso 8: todos ativo e conjunto == E → ativo (único que libera publicado)', () => {
    expect(agregarEstado([f('A', 'ativo'), f('B', 'ativo')], ['A', 'B'], false)).toBe('ativo');
  });

  // caso 9 — todos pausado
  it('caso 9: todos pausado (conjunto == E) → pausado', () => {
    expect(agregarEstado([f('A', 'pausado'), f('B', 'pausado')], ['A', 'B'], false)).toBe('pausado');
  });

  // prova da correção-chave: retirar 1 cor de família de N nunca fica presa em parcial
  it('retirar 1 cor: N-1 não-retirados ativos + 1 retirado pausado → ativo (não parcial)', () => {
    const filhos = [f('A', 'ativo'), f('B', 'ativo'), f('C', 'pausado', true)];
    expect(agregarEstado(filhos, ['A', 'B'], false)).toBe('ativo');
  });
});
