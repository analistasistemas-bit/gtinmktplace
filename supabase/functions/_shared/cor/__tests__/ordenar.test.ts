import { describe, it, expect } from 'vitest';
import { ordenarCoresAlfabetica } from '../ordenar';

describe('ordenarCoresAlfabetica', () => {
  it('ordena alfabeticamente (pt-BR), sem alterar os nomes', () => {
    const entrada = ['Vermelho 209', 'Azul 215', 'Preto 219', 'Amarelo Ouro 038'];
    expect(ordenarCoresAlfabetica(entrada)).toEqual([
      'Amarelo Ouro 038', 'Azul 215', 'Preto 219', 'Vermelho 209',
    ]);
  });

  it('agrupa o mesmo prefixo e ordena o sufixo numérico naturalmente', () => {
    const entrada = ['Azul Royal 214', 'Azul 215', 'Azul Claro', 'Azul Bb 212'];
    expect(ordenarCoresAlfabetica(entrada)).toEqual([
      'Azul 215', 'Azul Bb 212', 'Azul Claro', 'Azul Royal 214',
    ]);
  });

  it('ignora acento na comparação mas preserva o acento no resultado', () => {
    const entrada = ['Salmão', 'Rosa Pétala 009', 'Lilás 245'];
    expect(ordenarCoresAlfabetica(entrada)).toEqual([
      'Lilás 245', 'Rosa Pétala 009', 'Salmão',
    ]);
  });

  it('é case-insensitive na ordenação', () => {
    expect(ordenarCoresAlfabetica(['branco', 'Azul', 'CHOCOLATE'])).toEqual([
      'Azul', 'branco', 'CHOCOLATE',
    ]);
  });

  it('não muta o array de entrada', () => {
    const entrada = ['B', 'A'];
    ordenarCoresAlfabetica(entrada);
    expect(entrada).toEqual(['B', 'A']);
  });
});
