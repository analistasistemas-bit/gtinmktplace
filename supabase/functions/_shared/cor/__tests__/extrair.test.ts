import { describe, it, expect } from 'vitest';
import { extrairCorDoTexto } from '../extrair';

describe('extrairCorDoTexto', () => {
  it('retorna null quando nenhuma cor é encontrada', () => {
    expect(extrairCorDoTexto(['LINHA P/COST.XIK 120 2000J 455'])).toBeNull();
  });

  it('encontra cor case-insensitive', () => {
    expect(extrairCorDoTexto(['LINHA VERMELHA PARA COSTURA'])).toBe('Vermelho');
    expect(extrairCorDoTexto(['fita preta 5mm'])).toBe('Preto');
  });

  it('respeita word boundary (não casa azulejado com azul)', () => {
    expect(extrairCorDoTexto(['piso azulejado decorado'])).toBeNull();
  });

  it('prefere sinônimo mais longo (azul royal antes de azul)', () => {
    expect(extrairCorDoTexto(['Linha azul royal premium'])).toBe('Azul Royal');
  });

  it('busca em múltiplos textos do array', () => {
    expect(extrairCorDoTexto(['código opaco', 'descrição: fita pink neon'])).toBe('Rosa Neon');
  });

  it('retorna a forma canônica (não a forma do texto)', () => {
    expect(extrairCorDoTexto(['cor: PRETA 100% poliéster'])).toBe('Preto');
    expect(extrairCorDoTexto(['cru natural'])).toBe('Cru');
  });

  it('ignora arrays vazios ou strings vazias', () => {
    expect(extrairCorDoTexto([])).toBeNull();
    expect(extrairCorDoTexto(['', '', null as unknown as string])).toBeNull();
  });
});
