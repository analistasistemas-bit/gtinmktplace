import { expect, it } from 'vitest';
import { SEMAFORO_UI } from '../contagem-semaforo';

// ADR-0194: mesmo texto no card da sugestão e no painel de Aderir.
it('amarelo em Promoções diz "Abaixo do piso"', () => {
  expect(SEMAFORO_UI.amarelo.label).toBe('Abaixo do piso');
});
