import { describe, it, expect } from 'vitest';
import {
  contemMetragem,
  extrairContagem,
  extrairLargura,
  extrairMetragem,
  removerCaudaConectiva,
} from '../titulo';

describe('removerCaudaConectiva', () => {
  it('remove conectivo solto no fim ("VERSÁTIL E" → "VERSÁTIL")', () => {
    expect(removerCaudaConectiva('FITA CETIM N.1 100MT | 100% POLIÉSTER | VERSÁTIL E'))
      .toBe('FITA CETIM N.1 100MT | 100% POLIÉSTER | VERSÁTIL');
  });

  it('remove segmento que sobrou só com conectivo ("... | E" → "...")', () => {
    expect(removerCaudaConectiva('FITA N.1 100MT | 100% POLIÉSTER | E'))
      .toBe('FITA N.1 100MT | 100% POLIÉSTER');
  });

  it('remove vários conectivos encadeados e o pipe vazio', () => {
    expect(removerCaudaConectiva('FITA N.1 100MT | 100% POLIÉSTER | RESISTENTE E DE'))
      .toBe('FITA N.1 100MT | 100% POLIÉSTER | RESISTENTE');
  });

  it('não altera título já completo', () => {
    const ok = 'FITA CETIM N.1 100MT | 100% POLIÉSTER | RESISTENTE';
    expect(removerCaudaConectiva(ok)).toBe(ok);
  });

  it('limpa pipe pendurado no fim', () => {
    expect(removerCaudaConectiva('FITA N.1 100MT | 100% POLIÉSTER |'))
      .toBe('FITA N.1 100MT | 100% POLIÉSTER');
  });
});

describe('extrairMetragem', () => {
  it('extrai metragem em MT convertendo para a unidade canônica "m"', () => {
    expect(extrairMetragem('FITA CETIM PROGRESSO N.1 CORES 100MT')).toBe('100m');
    expect(extrairMetragem('FITA CETIM PROGRESSO N.1 CORES 10MT (P)')).toBe('10m');
  });

  it('normaliza "metros" e espaços para "m"', () => {
    expect(extrairMetragem('FITA 50 METROS')).toBe('50m');
    expect(extrairMetragem('FITA 30 M')).toBe('30m');
  });

  it('retorna null quando não há metragem (jardas não conta)', () => {
    expect(extrairMetragem('LINHA P/COST.XIK 120 2000J 455')).toBeNull();
    expect(extrairMetragem('BOTAO MADREPEROLA N.24')).toBeNull();
  });

  it('não casa o "1" de N.1 nem códigos sem unidade de metro', () => {
    expect(extrairMetragem('FITA CETIM PROGRESSO N.1 209 VERMELHO')).toBeNull();
  });
});

// Portado de titulo-largura.test.ts (deletado na Task 11): extrairLargura/contemMetragem
// sobrevivem à remoção dos guards de string — consumidos por titulo-guards.ts (ADR-0099) e por
// copywriter-prompt.ts (lado da descrição).
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

describe('unidade canônica (ADR-0099)', () => {
  it('metragem sai em "m" minúsculo, nunca "MT"', () => {
    expect(extrairMetragem('FITA CETIM N.3 100MT')).toBe('100m');
    expect(extrairMetragem('LANTEJOULAS CORES C/50MTS')).toBe('50m');
    expect(extrairMetragem('TECIDO HELANCA 10 METROS')).toBe('10m');
  });

  it('preserva decimal em formato BR', () => {
    expect(extrairMetragem('BORDADO EM PECA C/13,71MT')).toBe('13,71m');
  });

  it('contagem sai em "un", nunca "UNIDADES" nem "UND"', () => {
    expect(extrairContagem('SACO DE ORGANZA C/10UND')).toBe('10un');
    expect(extrairContagem('POMPOM C/100UND')).toBe('100un');
    expect(extrairContagem('KIT COM 12 PEÇAS')).toBe('12pc');
  });

  it('sem metragem no texto devolve null', () => {
    expect(extrairMetragem('COLCHETE C/GANCHO TAM')).toBeNull();
  });
});
