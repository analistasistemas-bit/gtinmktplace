import { describe, it, expect } from 'vitest';
import { decidirResultadoRodadaCatalogo, type ResumoCatalogo } from '../../_shared/ml/catalogo';

describe('fluxo de decisão do worker (regressão do incidente 2026-07-15 + bug de ordenação da revisão)', () => {
  const base: ResumoCatalogo = { vinculado: 0, sem_produto: 0, family_diff: 0, nao_elegivel: 0, pendente: 0, erro: 0, pulou: 0, ficha_divergente: 0, sem_variation_id: 0 };

  it('mistura pendente+nao_elegivel: NUNCA reagenda pro backoff longo — sempre aguarda o retry rápido nativo primeiro', () => {
    const r = decidirResultadoRodadaCatalogo({ ...base, pendente: 3, nao_elegivel: 5 }, 1);
    expect(r.acao).toBe('aguardar_elegibilidade');
  });

  it('1ª rodada só com nao_elegivel: reagenda e NÃO alerta ainda', () => {
    const r = decidirResultadoRodadaCatalogo({ ...base, nao_elegivel: 8 }, 1);
    expect(r.acao).toBe('reagendar');
  });

  it('última rodada ainda nao_elegivel: finaliza e alerta', () => {
    const r = decidirResultadoRodadaCatalogo({ ...base, nao_elegivel: 8 }, 5);
    expect(r).toEqual({ acao: 'finalizar', deveAlertar: true });
  });

  it.each([
    { sem_variation_id: 2 },
    { ficha_divergente: 2 },
  ])('nao_elegivel misturado com $sem_variation_id$ficha_divergente reagenda enquanto há tentativa', (extra) => {
    expect(decidirResultadoRodadaCatalogo({ ...base, nao_elegivel: 1, ...extra }, 1).acao).toBe('reagendar');
  });

  it.each([
    { sem_variation_id: 2 },
    { ficha_divergente: 2 },
  ])('nao_elegivel misturado finaliza e alerta ao esgotar', (extra) => {
    expect(decidirResultadoRodadaCatalogo({ ...base, nao_elegivel: 1, ...extra }, 5)).toEqual({
      acao: 'finalizar',
      deveAlertar: true,
    });
  });
});
