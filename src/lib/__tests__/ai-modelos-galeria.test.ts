import { describe, expect, it } from 'vitest';
import { MODELOS_GALERIA_UI, slugGaleriaExibido } from '@/lib/ai-modelos';
import { MODELOS_GALERIA, MODELO_GALERIA_PADRAO } from '../../../supabase/functions/_shared/galeria/modelos';

describe('MODELOS_GALERIA_UI', () => {
  it('tem os mesmos slugs do back-end (MODELOS_GALERIA)', () => {
    expect(MODELOS_GALERIA_UI.map((m) => m.slug).sort()).toEqual(Object.keys(MODELOS_GALERIA).sort());
  });

  it('o primeiro é o padrão', () => {
    expect(MODELOS_GALERIA_UI[0].slug).toBe(MODELO_GALERIA_PADRAO.slug);
    expect(MODELOS_GALERIA_UI[0].indisponivel).toBeUndefined();
  });

  it('modelo Higgsfield sem campo de referência ou de proporção confirmado aparece indisponível', () => {
    for (const m of MODELOS_GALERIA_UI) {
      const back = MODELOS_GALERIA[m.slug];
      const naoConfirmado = back.provedor === 'higgsfield' && (!back.campoReferencia || !back.campoProporcao);
      expect(Boolean(m.indisponivel)).toBe(naoConfirmado);
    }
  });

  it('seletor mostra o padrão para slug nulo, desconhecido ou indisponível', () => {
    const padrao = MODELOS_GALERIA_UI[0].slug;
    expect(slugGaleriaExibido(null)).toBe(padrao);
    expect(slugGaleriaExibido('xyz/desconhecido')).toBe(padrao);
    for (const m of MODELOS_GALERIA_UI.filter((o) => o.indisponivel)) expect(slugGaleriaExibido(m.slug)).toBe(padrao);
    expect(slugGaleriaExibido('xai/grok-imagine-image-2.0')).toBe('xai/grok-imagine-image-2.0');
  });
});
