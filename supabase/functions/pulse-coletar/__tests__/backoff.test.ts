import { describe, expect, it, vi } from 'vitest';

// ml/token.ts importa _shared/supabase.ts, que faz `import { createClient } from 'jsr:...'`
// (valor real, não elidido pelo bundler). Sob vitest isso quebra a resolução do módulo.
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: async () => 'fake-token' }));

import { DIAS_BACKOFF, FALHAS_BACKOFF, elegivelPorBackoff } from '../processar.ts';

const AGORA = Date.parse('2026-09-27T12:00:00Z');
const UM_DIA_MS = 24 * 60 * 60 * 1000;

describe('elegivelPorBackoff (ADR-0173)', () => {
  it('falhas abaixo do teto → sempre elegível, em qualquer tier', () => {
    expect(FALHAS_BACKOFF).toBe(3);
    expect(elegivelPorBackoff({ coleta_falhas_seguidas: 0, coleta_tentativa_em: null }, AGORA, 'completo')).toBe(true);
    expect(elegivelPorBackoff({ coleta_falhas_seguidas: 2, coleta_tentativa_em: new Date(AGORA).toISOString() }, AGORA, 'quente')).toBe(true);
  });

  it('3 falhas seguidas no tier quente → nunca elegível', () => {
    expect(elegivelPorBackoff({ coleta_falhas_seguidas: 3, coleta_tentativa_em: null }, AGORA, 'quente')).toBe(false);
    expect(elegivelPorBackoff({ coleta_falhas_seguidas: 10, coleta_tentativa_em: new Date(AGORA).toISOString() }, AGORA, 'quente')).toBe(false);
  });

  it('3 falhas seguidas no tier completo → espera DIAS_BACKOFF desde a última tentativa', () => {
    expect(DIAS_BACKOFF).toBe(3);
    const haUmDia = new Date(AGORA - UM_DIA_MS).toISOString();
    expect(elegivelPorBackoff({ coleta_falhas_seguidas: 3, coleta_tentativa_em: haUmDia }, AGORA, 'completo')).toBe(false);

    const haTresDias = new Date(AGORA - 3 * UM_DIA_MS).toISOString();
    expect(elegivelPorBackoff({ coleta_falhas_seguidas: 3, coleta_tentativa_em: haTresDias }, AGORA, 'completo')).toBe(true);
  });

  it('3 falhas seguidas no tier completo sem tentativa anterior (null) → elegível', () => {
    expect(elegivelPorBackoff({ coleta_falhas_seguidas: 3, coleta_tentativa_em: null }, AGORA, 'completo')).toBe(true);
  });
});
