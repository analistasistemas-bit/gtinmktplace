import { describe, it, expect, vi } from 'vitest';

// client.ts importa 'npm:openai@^4' (specifier estilo Deno), que o vitest deste repo não
// resolve — mesmo mock usado em copywriter-schema.test.ts, só pra poder importar coagirSlots
// sem puxar o cliente OpenRouter real.
vi.mock('../client.ts', () => ({ openrouterClient: () => ({}) }));

import { coagirSlots } from '../copywriter';
import { ORDEM_LEITURA, SLOTS_VAZIOS } from '../titulo-slots';

describe('coagirSlots (IMPORTANT-3)', () => {
  it('coage número pra string', () => {
    const out = coagirSlots({ produto: 'FITA', medida: 25 as unknown as string });
    expect(out.medida).toBe('25');
  });

  it('coage null pra string vazia, não deixa "null" literal', () => {
    const out = coagirSlots({ produto: 'FITA', marca: null as unknown as string });
    expect(out.marca).toBe('');
  });

  it('preenche chave ausente com string vazia (contrato de dez chaves)', () => {
    const out = coagirSlots({ produto: 'FITA' });
    for (const slot of ORDEM_LEITURA) {
      if (slot === 'produto') continue;
      expect(out[slot]).toBe('');
    }
  });

  it('titulo_slots inteiro undefined não estoura — devolve SLOTS_VAZIOS', () => {
    expect(coagirSlots(undefined)).toEqual(SLOTS_VAZIOS);
  });
});
