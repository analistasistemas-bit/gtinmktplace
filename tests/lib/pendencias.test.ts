import { describe, it, expect } from 'vitest';
import { montarPendencias } from '@/lib/pendencias';
import type { Lote } from '@/lib/tipos-dominio';

function makeLote(over: Partial<Lote>): Lote {
  return {
    id: 'l1',
    numero: 1,
    criadoEm: '2026-06-01T00:00:00Z',
    status: 'concluido',
    totalFamilias: 10,
    totalPublicadas: 10,
    totalErros: 0,
    anomalias: { codigos_duplicados: [], filhos_orfaos: [], familias_sem_filho: [] },
    ...over,
  };
}

describe('montarPendencias', () => {
  it('sem pendências retorna vazio', () => {
    expect(montarPendencias(0, [makeLote({})])).toEqual([]);
  });

  it('anúncios com problema (singular)', () => {
    const p = montarPendencias(1, []);
    expect(p).toHaveLength(1);
    expect(p[0].chave).toBe('problema');
    expect(p[0].label).toBe('1 anúncio com problema');
    expect(p[0].destino).toBe('/publicados');
  });

  it('anúncios com problema (plural)', () => {
    expect(montarPendencias(3, [])[0].label).toBe('3 anúncios com problema');
  });

  it('erros de publicação somam e apontam para o lote mais recente com erro', () => {
    const lotes = [
      makeLote({ id: 'antigo', criadoEm: '2026-06-01T00:00:00Z', totalErros: 2 }),
      makeLote({ id: 'novo', criadoEm: '2026-06-10T00:00:00Z', totalErros: 1 }),
      makeLote({ id: 'semerro', criadoEm: '2026-06-15T00:00:00Z', totalErros: 0 }),
    ];
    const p = montarPendencias(0, lotes);
    expect(p).toHaveLength(1);
    expect(p[0].chave).toBe('erro');
    expect(p[0].label).toBe('3 erros de publicação');
    expect(p[0].destino).toBe('/relatorio/novo');
  });

  it('erro singular', () => {
    const p = montarPendencias(0, [makeLote({ id: 'x', totalErros: 1 })]);
    expect(p[0].label).toBe('1 erro de publicação');
  });

  it('ambas as pendências aparecem', () => {
    const p = montarPendencias(2, [makeLote({ id: 'x', totalErros: 1 })]);
    expect(p.map((x) => x.chave)).toEqual(['problema', 'erro']);
  });
});
