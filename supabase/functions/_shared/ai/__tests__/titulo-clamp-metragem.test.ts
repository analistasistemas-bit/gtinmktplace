import { describe, it, expect } from 'vitest';
import { extrairMetragem, garantirMetragemTitulo } from '../titulo';

describe('garantirMetragemTitulo — clampa mesmo quando a metragem já está no título', () => {
  it('título >60 com a metragem já presente é cortado para <=60 preservando a metragem (bug lote #27)', () => {
    const t = garantirMetragemTitulo(
      'FITA CETIM BUFALO N.1 10MT | 100% POLIÉSTER | BRILHO ACETINADO',
      'FITA CETIM BUFALO N.1 7MM CORES 10MT',
    );
    expect(t.length).toBeLessThanOrEqual(60);
    expect(t).toContain('10MT');
  });
});

describe('metragem decimal com vírgula (bug lote #65 — família 02851903, "T-007")', () => {
  it('extrairMetragem lê o número decimal inteiro, não só a cauda após a vírgula', () => {
    expect(extrairMetragem('BORDADO INGLES BUFALO T-007 13,71MT 5CM LARGURA')).toBe('13,71MT');
  });

  it('não injeta fragmento fabricado ("71MT") quando a IA arredondou a metragem decimal no título (bug real do lote #65)', () => {
    const t = garantirMetragemTitulo(
      'BORDADO INGLES BUFALO T-007 13,7MT | 5CM LARGURA',
      'BORDADO INGLES BUFALO T-007 13,71MT 5CM LARGURA',
    );
    // "71MT" isolado (não como cauda de "13,71MT") é o fragmento fabricado do bug.
    expect(t).not.toMatch(/(?:^|\s)71MT(?:\s|$)/);
    expect(t).toContain('13,71MT');
  });
});

// 3 variantes reais devolvidas pelo reprocessamento do lote #65 (2026-07-17), depois do 1º fix
// (que só evitava o "71MT" fabricado): a IA ainda duplicava a metragem de 3 formas diferentes —
// arredondada no mesmo segmento, arredondada com unidade errada, e duplicada em segmentos
// distintos (a certa já presente, sem acionar o guard antigo "já contém?"). Todas devem colapsar
// pra exatamente UMA menção de "13,71MT".
describe('metragem duplicada de 3 formas distintas — reprocessamento real do lote #65', () => {
  const nomePai = 'BORDADO EM PECA REF.CORES 5CM  C/13,71MT';

  it('arredondada no mesmo segmento (TC-002: "13,7MT 13,71MT")', () => {
    const t = garantirMetragemTitulo('BORDADO INGLES BUFALO TC-002 13,7MT 13,71MT BRANCO', nomePai);
    expect(t).toBe('BORDADO INGLES BUFALO TC-002 BRANCO 13,71MT');
  });

  it('arredondada com unidade errada (T-007: "13,7M 13,71MT")', () => {
    const t = garantirMetragemTitulo(
      'BORDADO INGLES BUFALO T-007 13,7M 13,71MT | 90% POLIESTER',
      nomePai,
    );
    expect(t).toBe('BORDADO INGLES BUFALO T-007 13,71MT | 90% POLIESTER');
  });

  it('duplicada entre segmentos, a certa já presente (T-035: "13,71MT ... | 13,7MT") — o guard antigo não pegava porque a metragem certa já estava lá', () => {
    const t = garantirMetragemTitulo(
      'BORDADO INGLES BUFALO 10CM 13,71MT BRANCO | 13,7MT',
      nomePai,
    );
    expect(t).toBe('BORDADO INGLES BUFALO 10CM BRANCO 13,71MT');
  });
});
