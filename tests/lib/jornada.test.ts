import { describe, it, expect } from 'vitest';
import { jornadaDoLote, destinoDoLote, ETAPAS_JORNADA } from '@/lib/jornada';

describe('jornadaDoLote', () => {
  it('mapeia cada status para o índice de etapa correto', () => {
    expect(jornadaDoLote('importando').indiceAtual).toBe(0);
    expect(jornadaDoLote('processando').indiceAtual).toBe(1);
    expect(jornadaDoLote('revisao').indiceAtual).toBe(2);
    expect(jornadaDoLote('publicando').indiceAtual).toBe(3);
    expect(jornadaDoLote('concluido').indiceAtual).toBe(ETAPAS_JORNADA.length); // 4 = tudo concluído
  });

  it('sem erro nos status normais', () => {
    for (const s of ['importando', 'processando', 'revisao', 'publicando', 'concluido'] as const) {
      expect(jornadaDoLote(s).erro).toBe(false);
    }
  });

  it('erro marca erro=true na etapa de processamento', () => {
    const j = jornadaDoLote('erro');
    expect(j.erro).toBe(true);
    expect(j.indiceAtual).toBe(1);
  });

  it('expõe exatamente 4 etapas com label', () => {
    expect(ETAPAS_JORNADA).toHaveLength(4);
    expect(ETAPAS_JORNADA.map((e) => e.label)).toEqual([
      'Enviado',
      'Processando',
      'Revisão',
      'Publicado',
    ]);
  });
});

describe('destinoDoLote', () => {
  it('revisao vai para /revisao', () => {
    expect(destinoDoLote('revisao', 'abc')).toBe('/revisao/abc');
  });
  it('concluido e erro vão para /relatorio', () => {
    expect(destinoDoLote('concluido', 'abc')).toBe('/relatorio/abc');
    expect(destinoDoLote('erro', 'abc')).toBe('/relatorio/abc');
  });
  it('demais (importando/processando/publicando) vão para /progresso', () => {
    expect(destinoDoLote('importando', 'abc')).toBe('/progresso/abc');
    expect(destinoDoLote('processando', 'abc')).toBe('/progresso/abc');
    expect(destinoDoLote('publicando', 'abc')).toBe('/progresso/abc');
  });
});
