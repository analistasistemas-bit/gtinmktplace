import { describe, it, expect } from 'vitest';
import { humanizarErroML } from '../erro-ml';

describe('humanizarErroML', () => {
  it('título acima de 60 → mensagem clara em PT (ignora os warnings de frete)', () => {
    const json = {
      message: 'Validation error',
      cause: [
        { type: 'error', code: 'item.title.length.invalid', message: 'Category MLB255054 does not support titles greater than 60 characters long.' },
        { type: 'warning', code: 'shipping.free_shipping.cost_exceeded', message: 'Free shipping costs exceeds sale' },
      ],
    };
    const msg = humanizarErroML(400, json);
    expect(msg).toContain('título');
    expect(msg).toContain('60');
    expect(msg).not.toContain('Free shipping');
  });

  it('atributo com problema mantém o detalhe do ML', () => {
    const json = { message: 'Validation error', cause: [{ type: 'error', code: 'item.attributes.required', message: 'The attribute BRAND is required' }] };
    const msg = humanizarErroML(400, json);
    expect(msg.toLowerCase()).toContain('atributo');
    expect(msg).toContain('BRAND');
  });

  it('código desconhecido cai para a mensagem específica do ML (não "Validation error")', () => {
    const json = { message: 'Validation error', cause: [{ type: 'error', code: 'item.something.weird', message: 'Algo específico aconteceu' }] };
    expect(humanizarErroML(400, json)).toContain('Algo específico aconteceu');
  });

  it('sem cause usável → usa a message do topo', () => {
    expect(humanizarErroML(403, { message: 'Forbidden' })).toContain('Forbidden');
  });

  it('só warnings (sem erro real) → ainda devolve algo legível', () => {
    const json = { message: 'Validation error', cause: [{ type: 'warning', code: 'shipping.x', message: 'w' }] };
    expect(humanizarErroML(400, json).length).toBeGreaterThan(0);
  });
});
