import { describe, it, expect } from 'vitest';
import { montarUserPrompt } from '../copywriter-prompt';

const base = {
  nome: 'PRODUTO X',
  descricao_detalhado: 'CONTÉM 1KG.',
  variacoes: [{ codigo: '1', cor: 'Azul', preco: 10 }],
};

describe('montarUserPrompt — rótulo de quantidade pela unidade', () => {
  it('inclui a unidade de venda no prompt', () => {
    const p = montarUserPrompt({ ...base, unidade: 'KG' });
    expect(p).toContain('Unidade de venda: KG');
  });

  it('sugere rótulo determinístico quando a unidade define a dimensão (KG → "Peso")', () => {
    const p = montarUserPrompt({ ...base, unidade: 'KG' });
    expect(p).toContain('Rótulo sugerido para a quantidade: "Peso"');
  });

  it('NÃO sugere rótulo para unidade de embalagem (PC) — IA decide pelo dado', () => {
    const p = montarUserPrompt({ ...base, unidade: 'PC' });
    expect(p).not.toContain('Rótulo sugerido para a quantidade');
  });

  it('sem unidade não quebra nem inventa rótulo', () => {
    const p = montarUserPrompt({ ...base });
    expect(p).not.toContain('Rótulo sugerido para a quantidade');
    expect(p).not.toContain('Unidade de venda');
  });
});
