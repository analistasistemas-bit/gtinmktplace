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

  it('produto sem cor real ("Outra" do Vision) — omite a seção de cores, não lista placeholder (lote #31)', () => {
    const p = montarUserPrompt({ ...base, variacoes: [{ codigo: '1', cor: 'Outra', preco: 10 }] });
    expect(p).not.toMatch(/-\s*Outra\b/);
    expect(p).not.toContain('(sem cor identificada)');
    expect(p).not.toContain('Cores disponíveis');
    expect(p).toContain('NÃO tem variação de cor');
  });

  it('variação sem cor (null) também omite a seção de cores', () => {
    const p = montarUserPrompt({ ...base, variacoes: [{ codigo: '1', cor: null, preco: 10 }] });
    expect(p).not.toContain('Cores disponíveis');
    expect(p).toContain('NÃO tem variação de cor');
  });

  it('lista cores reais normalmente', () => {
    const p = montarUserPrompt({ ...base, variacoes: [
      { codigo: '1', cor: 'Azul', preco: 10 }, { codigo: '2', cor: 'Vermelho', preco: 10 },
    ] });
    expect(p).toContain('Cores disponíveis:');
    expect(p).toContain('- Azul');
    expect(p).toContain('- Vermelho');
  });

  it('mistura cor real + "Outra" — lista só a cor real', () => {
    const p = montarUserPrompt({ ...base, variacoes: [
      { codigo: '1', cor: 'Azul', preco: 10 }, { codigo: '2', cor: 'Outra', preco: 10 },
    ] });
    expect(p).toContain('- Azul');
    expect(p).not.toMatch(/-\s*Outra\b/);
  });
});
