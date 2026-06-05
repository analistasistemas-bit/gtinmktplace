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

import { extrairCorECodigo } from '../extrair';

describe('extrairCorECodigo', () => {
  it('código + cor literal (perde nada): VERMELHO TOMATE', () => {
    expect(extrairCorECodigo('FITA CETIM PROGRESSO N.1 1354 VERMELHO TOMATE 10MT'))
      .toEqual({ cor: 'Vermelho Tomate', codigo: '1354' });
  });
  it('expande abreviações: AZ TIFFANY → Azul Tiffany', () => {
    expect(extrairCorECodigo('FITA CETIM PROGRESSO N.07 247 AZ TIFFANY 10MT'))
      .toEqual({ cor: 'Azul Tiffany', codigo: '247' });
  });
  it('expande VD LIMA → Verde Lima', () => {
    expect(extrairCorECodigo('FITA CETIM PROGRESSO N.07 2036 VD LIMA 10MT'))
      .toEqual({ cor: 'Verde Lima', codigo: '2036' });
  });
  it('expande AMA CL → Amarelo Claro', () => {
    expect(extrairCorECodigo('FITA CETIM PROGRESSO N.07 2052 AMA CL 10MT'))
      .toEqual({ cor: 'Amarelo Claro', codigo: '2052' });
  });
  it('preserva zero à esquerda no código: 009', () => {
    expect(extrairCorECodigo('FITA CETIM PROGRESSO N.07 009 ROSA PETALA 10MT'))
      .toEqual({ cor: 'Rosa Petala', codigo: '009' });
  });
  it('vários dígitos: usa o último seguido de letras (10 BCA → Branco 10)', () => {
    expect(extrairCorECodigo('LINHA P/COST.XIK 120 2000J 10 BCA'))
      .toEqual({ cor: 'Branco', codigo: '10' });
  });
  it('sem dígito antes da cor → null (cai no dicionário)', () => {
    expect(extrairCorECodigo('FITA CETIM PROGRESSO N.3 PRETO 10MT')).toBeNull();
  });
  it('ignora o tamanho (10MT) e tokens mistos', () => {
    expect(extrairCorECodigo('FITA CETIM PROGRESSO N.1 1355 MARSALA 10MT'))
      .toEqual({ cor: 'Marsala', codigo: '1355' });
  });
});
