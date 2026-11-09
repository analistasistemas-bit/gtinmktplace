import { describe, expect, it } from 'vitest';
import { MODELOS_GALERIA_UI } from '@/lib/ai-modelos';
import { MODELOS_GALERIA, MODELO_GALERIA_PADRAO } from '../../../supabase/functions/_shared/galeria/modelos';

describe('MODELOS_GALERIA_UI', () => {
  it('tem os mesmos slugs do back-end (MODELOS_GALERIA)', () => {
    expect(MODELOS_GALERIA_UI.map((m) => m.slug).sort()).toEqual(Object.keys(MODELOS_GALERIA).sort());
  });

  it('o primeiro é o padrão', () => {
    expect(MODELOS_GALERIA_UI[0].slug).toBe(MODELO_GALERIA_PADRAO.slug);
    expect(MODELOS_GALERIA_UI[0].indisponivel).toBeUndefined();
  });

  it('modelo Higgsfield sem campo de referência medido aparece indisponível', () => {
    for (const m of MODELOS_GALERIA_UI) {
      const back = MODELOS_GALERIA[m.slug];
      const semReferencia = back.provedor === 'higgsfield' && !back.campoReferencia;
      expect(Boolean(m.indisponivel)).toBe(semReferencia);
    }
  });
});
