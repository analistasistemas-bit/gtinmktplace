import { describe, it, expect } from 'vitest';
import { humanizarErroML, ehErroRetentavel, classificarErroML, precisaItemPlano } from '../erro-ml';

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

describe('precisaItemPlano (ADR-0087: detecção reativa da assinatura do ADR-0084)', () => {
  const causaReq = { code: 'body.required_fields', cause_id: 369, type: 'error', message: 'The body does not contains some or none of the following properties [family_name, price, available_quantity]' };
  const causaInv = { code: 'body.invalid_fields', cause_id: 374, type: 'error', message: 'The field variations is invalid with family name' };

  it('assinatura exata (369+374, status 400, mensagens batem) → true', () => {
    expect(precisaItemPlano(400, [causaReq, causaInv])).toBe(true);
  });
  it('status diferente de 400 (ex.: timeout/5xx) → false, mesmo com a assinatura', () => {
    expect(precisaItemPlano(500, [causaReq, causaInv])).toBe(false);
    expect(precisaItemPlano(null, [causaReq, causaInv])).toBe(false);
  });
  it('só 369 (outro erro de catálogo reaproveitando o código) → false', () => {
    expect(precisaItemPlano(400, [causaReq])).toBe(false);
  });
  it('só 374 → false', () => {
    expect(precisaItemPlano(400, [causaInv])).toBe(false);
  });
  it('369+374 + uma 3ª causa bloqueante (ex.: GTIN inválido) → false (não esconde erro de dado real)', () => {
    const causaGtin = { code: 'item.attributes.gtin.invalid', cause_id: 999, type: 'error', message: 'GTIN inválido' };
    expect(precisaItemPlano(400, [causaReq, causaInv, causaGtin])).toBe(false);
  });
  it('369+374 + uma 3ª causa em warning (não bloqueante) → continua true', () => {
    const aviso = { code: 'shipping.free_shipping.cost_exceeded', cause_id: 1, type: 'warning', message: 'Free shipping costs exceeds sale' };
    expect(precisaItemPlano(400, [causaReq, causaInv, aviso])).toBe(true);
  });
  it('369+374 com mensagens que não mencionam os termos esperados (código reaproveitado por coincidência) → false', () => {
    const reqSemTermos = { ...causaReq, message: 'Algo genérico sem relação' };
    const invSemTermos = { ...causaInv, message: 'Outra coisa qualquer' };
    expect(precisaItemPlano(400, [reqSemTermos, invSemTermos])).toBe(false);
  });
  // Achado da revisão adversarial do Codex: a alternação `family_name|price|available_quantity`
  // deixava passar uma causa 369 com só 1 dos 3 termos — a matriz abaixo cobre cada termo isolado
  // e cada combinação incompleta (2 de 3), pra travar a regressão nos dois eixos que o Codex pediu.
  it.each([
    ['só family_name', '[family_name]'],
    ['só price', '[price]'],
    ['só available_quantity', '[available_quantity]'],
    ['family_name + price (falta available_quantity)', '[family_name, price]'],
    ['family_name + available_quantity (falta price)', '[family_name, available_quantity]'],
    ['price + available_quantity (falta family_name)', '[price, available_quantity]'],
  ])('369 com termo(s) incompleto(s) — %s → false', (_desc, campos) => {
    const reqParcial = { ...causaReq, message: `The body does not contains some or none of the following properties ${campos}` };
    expect(precisaItemPlano(400, [reqParcial, causaInv])).toBe(false);
  });
  it('369 com os 3 termos juntos (qualquer ordem) → true', () => {
    const reqCompleto = { ...causaReq, message: 'The body does not contains some or none of the following properties [available_quantity, family_name, price]' };
    expect(precisaItemPlano(400, [reqCompleto, causaInv])).toBe(true);
  });
  it('sem mlCauses (undefined/null) → false', () => {
    expect(precisaItemPlano(400, undefined)).toBe(false);
    expect(precisaItemPlano(400, null)).toBe(false);
  });
});

describe('classificarErroML (liveness da integração, ADR-0069)', () => {
  it('401 → permanente-auth', () => { expect(classificarErroML(401)).toBe('permanente-auth'); });
  it('403 → permanente-auth', () => { expect(classificarErroML(403)).toBe('permanente-auth'); });
  it('404 → nao-encontrado', () => { expect(classificarErroML(404)).toBe('nao-encontrado'); });
  it('429 → transiente', () => { expect(classificarErroML(429)).toBe('transiente'); });
  it('500 → transiente', () => { expect(classificarErroML(500)).toBe('transiente'); });
  it('null (erro de rede/timeout sem status HTTP) → transiente', () => { expect(classificarErroML(null)).toBe('transiente'); });
  it('400 sem oauthError → transiente (comportamento preservado)', () => { expect(classificarErroML(400)).toBe('transiente'); });
  it('400 + invalid_grant (refresh_token revogado, ADR-0012) → permanente-auth', () => { expect(classificarErroML(400, 'invalid_grant')).toBe('permanente-auth'); });
  it('400 + invalid_client (outro erro OAuth2, não é prova de token morto) → transiente', () => { expect(classificarErroML(400, 'invalid_client')).toBe('transiente'); });
  it('401 + invalid_grant → permanente-auth (qualquer uma das duas condições já basta)', () => { expect(classificarErroML(401, 'invalid_grant')).toBe('permanente-auth'); });
});
