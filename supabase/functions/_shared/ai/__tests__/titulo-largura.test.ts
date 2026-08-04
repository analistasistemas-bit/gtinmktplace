import { describe, it, expect } from 'vitest';
import { extrairLargura, contemMetragem, garantirLarguraTitulo, garantirMetragemTitulo, garantirCorTitulo } from '../titulo';

describe('extrairLargura', () => {
  it('captura "6MM DE LARGURA"', () => {
    expect(extrairLargura('A LANTEJOULA DE 6MM DE LARGURA É IDEAL')).toBe('6mm');
  });

  it('captura ordem invertida "LARGURA DE 6MM"', () => {
    expect(extrairLargura('FITA COM LARGURA DE 10MM')).toBe('10mm');
  });

  it('captura "LARGURA: 6MM" (rótulo com dois-pontos)', () => {
    expect(extrairLargura('LARGURA: 6MM')).toBe('6mm');
  });

  it('aceita decimal com vírgula (formato BR)', () => {
    expect(extrairLargura('FITA DE 2,5MM DE LARGURA')).toBe('2,5mm');
  });

  it('não confunde metragem em metros ("M"/"MT"/"METROS") com largura em mm/cm', () => {
    expect(extrairLargura('ROLO CONTENDO 50 METROS')).toBeNull();
    expect(extrairLargura('FITA 10MT BRANCA')).toBeNull();
  });

  it('sem menção a largura em mm/cm → null', () => {
    expect(extrairLargura('BARBANTE DE ALGODÃO 4/6 FIOS')).toBeNull();
  });

  it('captura largura em CM (bug real: franjas com nome_pai em MM mas descrição em CM)', () => {
    expect(extrairLargura('A FRANJA DA BÚFALO, COM 5 CM DE LARGURA, É CONFECCIONADA...')).toBe('5cm');
  });

  it('captura CM na ordem invertida e com dois-pontos', () => {
    expect(extrairLargura('FRANJA COM LARGURA DE 10CM')).toBe('10cm');
    expect(extrairLargura('LARGURA: 8CM')).toBe('8cm');
  });

  it('não confunde CM com MM: cada um só bate com sua própria unidade', () => {
    expect(extrairLargura('5 CM DE LARGURA')).toBe('5cm');
    expect(extrairLargura('5 MM DE LARGURA')).toBe('5mm');
  });
});

describe('contemMetragem', () => {
  it('aceita token exato ("50MT")', () => {
    expect(contemMetragem('FITA 50MT BRANCA')).toBe(true);
  });

  it('aceita por extenso ("50 metros")', () => {
    expect(contemMetragem('O produto vem em um rolo contendo 50 metros.')).toBe(true);
  });

  it('sem menção a metragem → false', () => {
    expect(contemMetragem('Produzida em PVC de alta qualidade.')).toBe(false);
  });
});

describe('garantirLarguraTitulo', () => {
  it('crava a largura no 1º segmento quando grounded e ausente do título', () => {
    const out = garantirLarguraTitulo('LANTEJOULA TRANÇADA BÚFALO 50MT | PVC ALTA QUALIDADE', '6mm');
    expect(out).toBe('LANTEJOULA TRANÇADA BÚFALO 50MT 6MM | PVC ALTA QUALIDADE');
    expect(out.length).toBeLessThanOrEqual(60);
  });

  it('é idempotente quando a largura já está no título (case-insensitive)', () => {
    const titulo = 'LANTEJOULA TRANÇADA BÚFALO 50MT 6MM | PVC ALTA QUALIDADE';
    expect(garantirLarguraTitulo(titulo, '6mm')).toBe(titulo);
  });

  it('não toca no título quando não há largura grounded (null)', () => {
    const titulo = 'BARBANTE EUROROMA 600G | 100% ALGODÃO';
    expect(garantirLarguraTitulo(titulo, null)).toBe(titulo);
  });

  it('funciona igual pra largura em cm (bug real: franjas)', () => {
    const out = garantirLarguraTitulo('FRANJA BÚFALO OURO 5MT | 100% POLIÉSTER', '5cm');
    expect(out).toBe('FRANJA BÚFALO OURO 5MT 5CM | 100% POLIÉSTER');
  });

  it('derruba o diferencial para caber em 60 chars', () => {
    const out = garantirLarguraTitulo(
      'LANTEJOULA TRANÇADA LISA BÚFALO 50MT | PVC ALTA QUALIDADE | BRILHANTE',
      '6mm',
    );
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out).toContain('6MM');
  });

  it('encadeia com garantirMetragemTitulo e garantirCorTitulo (ordem real do pipeline)', () => {
    const out = garantirCorTitulo(
      garantirLarguraTitulo(
        garantirMetragemTitulo('LANTEJOULA TRANÇADA BÚFALO | PVC ALTA QUALIDADE', 'LANTEJOULAS TAM 6 CORES C/50MTS'),
        '6mm',
      ),
      'Dourado',
      1,
    );
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out).toContain('50MT');
    expect(out).toContain('6MM');
  });
});
