import { describe, expect, it } from 'vitest';
import { escolherLogo, ehSimbolo, iniciais, validarArquivoLogo } from '../org-logo';

describe('escolherLogo', () => {
  it('usa a versão do tema ativo', () => {
    expect(escolherLogo('dark', 'c', 'e')).toBe('e');
    expect(escolherLogo('light', 'c', 'e')).toBe('c');
  });
  it('só uma versão cadastrada: usa ela nos dois temas', () => {
    expect(escolherLogo('dark', 'c', null)).toBe('c');
    expect(escolherLogo('light', null, 'e')).toBe('e');
  });
  it('nenhuma: null', () => {
    expect(escolherLogo('light', null, null)).toBeNull();
  });
});

describe('iniciais', () => {
  it('até 2 letras maiúsculas', () => {
    expect(iniciais('Avil Moda')).toBe('AM');
    expect(iniciais('avil moda praia')).toBe('AM');
    expect(iniciais('Avil')).toBe('A');
  });
  it('vazio ou ausente: ?', () => {
    expect(iniciais('')).toBe('?');
    expect(iniciais('   ')).toBe('?');
    expect(iniciais(null)).toBe('?');
  });
});

describe('ehSimbolo', () => {
  it('quase quadrada é símbolo; larga é wordmark', () => {
    expect(ehSimbolo(100, 100)).toBe(true);
    expect(ehSimbolo(149, 100)).toBe(true);
    expect(ehSimbolo(150, 100)).toBe(false);
    expect(ehSimbolo(300, 80)).toBe(false);
  });
});

describe('validarArquivoLogo', () => {
  const arq = (tipo: string, bytes: number) => new File([new Uint8Array(bytes)], 'logo', { type: tipo });
  it('aceita png/jpeg/webp até 512 KB', () => {
    expect(validarArquivoLogo(arq('image/png', 100 * 1024))).toBeNull();
    expect(validarArquivoLogo(arq('image/jpeg', 512 * 1024))).toBeNull();
    expect(validarArquivoLogo(arq('image/webp', 10))).toBeNull();
  });
  it('recusa SVG e outros tipos', () => {
    expect(validarArquivoLogo(arq('image/svg+xml', 10))).toMatch(/PNG, JPG ou WEBP/);
  });
  it('recusa acima de 512 KB', () => {
    expect(validarArquivoLogo(arq('image/png', 600 * 1024))).toMatch(/512 KB/);
  });
});
