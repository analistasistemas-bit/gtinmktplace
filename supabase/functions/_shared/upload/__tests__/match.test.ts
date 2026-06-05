import { describe, it, expect } from 'vitest';
import { classificarArquivo } from '../match';

describe('classificarArquivo', () => {
  it('reconhece CAPA_ com 8 dígitos', () => {
    expect(classificarArquivo('CAPA_00012345.jpeg')).toEqual({
      tipo: 'capa',
      codigo: '00012345',
    });
  });

  it('reconhece foto de variação com 8 dígitos', () => {
    expect(classificarArquivo('00012345.jpeg')).toEqual({
      tipo: 'variacao',
      codigo: '00012345',
    });
  });

  it('aceita .jpg, .jpeg, .png em qualquer caixa', () => {
    expect(classificarArquivo('CAPA_00012345.JPG').tipo).toBe('capa');
    expect(classificarArquivo('CAPA_00012345.PNG').tipo).toBe('capa');
    expect(classificarArquivo('00012345.png').tipo).toBe('variacao');
  });

  it('rejeita arquivos sem 8 dígitos exatos', () => {
    expect(classificarArquivo('CAPA_123.jpeg')).toEqual({ tipo: 'invalido' });
    expect(classificarArquivo('123.jpeg')).toEqual({ tipo: 'invalido' });
    expect(classificarArquivo('CAPA_000123456.jpeg')).toEqual({ tipo: 'invalido' });
  });

  it('rejeita extensões não suportadas', () => {
    expect(classificarArquivo('CAPA_00012345.gif')).toEqual({ tipo: 'invalido' });
    expect(classificarArquivo('00012345.webp')).toEqual({ tipo: 'invalido' });
  });

  it('é case-sensitive para o prefixo (CAPA maiúsculo)', () => {
    expect(classificarArquivo('capa_00012345.jpeg')).toEqual({ tipo: 'invalido' });
    expect(classificarArquivo('Capa_00012345.jpeg')).toEqual({ tipo: 'invalido' });
  });

  it('reconhece CAPA2_ com 8 dígitos', () => {
    expect(classificarArquivo('CAPA2_00012345.jpeg')).toEqual({ tipo: 'capa2', codigo: '00012345' });
  });
  it('CAPA2_ não é confundido com CAPA_ nem variação', () => {
    expect(classificarArquivo('CAPA_00012345.jpeg').tipo).toBe('capa');
    expect(classificarArquivo('00012345.jpeg').tipo).toBe('variacao');
  });
});
