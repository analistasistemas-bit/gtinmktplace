import { describe, it, expect } from 'vitest';
import { humanizarErroML, ehErroRetentavel, classificarErroML } from '../erro-ml';

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

describe('ehErroRetentavel (erro transiente que o ML pede para reenviar)', () => {
  it('foto não processada ("envie-a novamente") → retentável', () => {
    const json = { message: 'Validation error', cause: [{ type: 'error', code: 'item.pictures.error', message: 'Ocorreu um erro ao processar a foto. Por favor, envie-a novamente.' }] };
    expect(ehErroRetentavel(json)).toBe(true);
  });
  it('inglês "please try again" → retentável', () => {
    const json = { cause: [{ type: 'error', code: 'item.pictures.error', message: 'Error processing picture, please try again' }] };
    expect(ehErroRetentavel(json)).toBe(true);
  });
  it('título >60 (erro permanente) → NÃO retentável', () => {
    const json = { cause: [{ type: 'error', code: 'item.title.length.invalid', message: 'Category does not support titles greater than 60 characters' }] };
    expect(ehErroRetentavel(json)).toBe(false);
  });
  it('foto de baixa qualidade (permanente, não pede reenvio) → NÃO retentável', () => {
    const json = { cause: [{ type: 'error', code: 'item.pictures.poor_quality', message: 'A imagem tem baixa qualidade' }] };
    expect(ehErroRetentavel(json)).toBe(false);
  });
  it('warning não conta como retentável', () => {
    const json = { cause: [{ type: 'warning', code: 'x', message: 'envie novamente' }] };
    expect(ehErroRetentavel(json)).toBe(false);
  });
  it('json vazio → não retentável', () => {
    expect(ehErroRetentavel({})).toBe(false);
  });
});

describe('classificarErroML (liveness da integração, ADR-0069)', () => {
  it('401 → permanente-auth', () => { expect(classificarErroML(401)).toBe('permanente-auth'); });
  it('403 → permanente-auth', () => { expect(classificarErroML(403)).toBe('permanente-auth'); });
  it('404 → nao-encontrado', () => { expect(classificarErroML(404)).toBe('nao-encontrado'); });
  it('429 → transiente', () => { expect(classificarErroML(429)).toBe('transiente'); });
  it('500 → transiente', () => { expect(classificarErroML(500)).toBe('transiente'); });
  it('null (erro de rede/timeout sem status HTTP) → transiente', () => { expect(classificarErroML(null)).toBe('transiente'); });
});
