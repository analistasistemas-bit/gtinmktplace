import { describe, it, expect } from 'vitest';
import { humanizarErroML, ehErroRetentavel, classificarErroML, precisaItemPlano, precisaGtinDePack } from '../erro-ml';

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

  it('atributo com problema → cita o atributo, tudo em pt-BR', () => {
    const json = { message: 'Validation error', cause: [{ type: 'error', code: 'item.attributes.required', message: 'The attribute BRAND is required' }] };
    const msg = humanizarErroML(400, json);
    expect(msg.toLowerCase()).toContain('atributo');
    expect(msg).toContain('BRAND');
    expect(msg).not.toMatch(/\bThe\b|required/);
  });

  // Caso real 15/11: kit 4 de 00000182 (MLB455708) — Diego: "toda e qualquer mensagem em português".
  it('atributos obrigatórios em lista [..] → pt-BR com os códigos, sem o texto em inglês', () => {
    const json = { message: 'Validation error', cause: [{ type: 'error', code: 'item.attribute.missing_required', message: "The attributes [PRODUCT_CONSERVATION] are required for category MLB455708 and channel marketplace. Check the attribute is present in the attributes list or in all variation's attributes_combination or attributes." }] };
    const msg = humanizarErroML(400, json);
    expect(msg).toContain('PRODUCT_CONSERVATION');
    expect(msg).not.toMatch(/The attributes|required for|channel|Check the/);
    expect(msg).not.toContain('MLB455708');
  });

  it('foto com status ERROR (arquivo pesado) → diz para trocar a imagem por uma menor', () => {
    // Caso real 08/11 (Hairfly, PAI 00119571): PNG de 37 MB / 5394×6544 px recusado pelo ML.
    const json = { message: 'Validation error', cause: [{ type: 'error', code: 'item.pictures.invalid', message: 'Picture id 989020-MLB121060606717_112026 cannot be added because it has status ERROR.' }] };
    const msg = humanizarErroML(400, json);
    expect(msg).toMatch(/^Problema nas fotos/); // mantém a limpeza do cache de fotos (ehErroDefinitivoFoto)
    expect(msg).toContain('10 MB');
    expect(msg).toMatch(/troque a foto/i);
    expect(msg).toContain('Reenviar');
    expect(msg).not.toContain('cannot be added');
  });

  it('"does not exist" vira "não existe mais no Mercado Livre" (sinal de ehErroDefinitivoFoto)', () => {
    const json = { message: 'Validation error', cause: [{ type: 'error', code: 'body.invalid_fields', message: 'Picture 123-MLB does not exist' }] };
    const msg = humanizarErroML(400, json);
    expect(msg).toMatch(/^Problema nas fotos/);
    expect(msg).toContain('não existe mais no Mercado Livre');
    expect(msg).not.toContain('does not exist');
  });

  it('texto cru do ML nunca volta, nem com acento (revisão Codex: "Café")', () => {
    const json = { message: 'Validation error', cause: [{ type: 'error', code: 'body.invalid_fields', message: 'Invalid value for field family_name: Café' }] };
    expect(humanizarErroML(400, json)).not.toContain('Invalid value');
    expect(humanizarErroML(400, { message: 'Invalid value: Café' })).toEqual('O Mercado Livre recusou (erro 400).');
  });

  it('foto "does not exist" só na message do topo (sem cause) → mantém o sinal de limpar o cache', () => {
    const msg = humanizarErroML(400, { message: 'Picture id 123-MLB does not exist' });
    expect(msg).toMatch(/^Problema nas fotos/);
    expect(msg).toContain('não existe mais no Mercado Livre');
  });

  it('atributo: não confunde valor nem tipo com código de atributo (revisão Codex)', () => {
    const valor = humanizarErroML(400, { cause: [{ type: 'error', code: 'item.attributes.invalid', message: 'Attribute BRAND has invalid value [12345]' }] });
    expect(valor).toContain('BRAND');
    expect(valor).not.toContain('12345');
    const tipo = humanizarErroML(400, { cause: [{ type: 'error', code: 'item.attributes.invalid', message: 'Attribute BRAND must be STRING' }] });
    expect(tipo).toContain('BRAND');
    expect(tipo).not.toContain('STRING');
  });

  it('código desconhecido com texto em inglês → mensagem genérica em pt-BR', () => {
    const json = { message: 'Validation error', cause: [{ type: 'error', code: 'item.something.weird', message: 'Something weird happened' }] };
    const msg = humanizarErroML(400, json);
    expect(msg).not.toContain('Something');
    expect(msg).toContain('Mercado Livre');
  });

  it('sem cause usável e message do topo em inglês → genérica em pt-BR', () => {
    const msg = humanizarErroML(403, { message: 'Forbidden' });
    expect(msg).not.toContain('Forbidden');
    expect(msg).toContain('403');
  });

  it('só warnings (sem erro real) → ainda devolve algo legível', () => {
    const json = { message: 'Validation error', cause: [{ type: 'warning', code: 'shipping.x', message: 'w' }] };
    expect(humanizarErroML(400, json).length).toBeGreaterThan(0);
  });

  // Bug real 2026-09-06 (Kit Virtual): `cause` às vezes vem como array de STRINGS puras. O texto
  // cru vai para o log (console.error dentro de humanizarErroML); o usuário vê pt-BR.
  it('cause como array de STRINGS (ex.: thumbnail.secureUrl) → problema nas fotos, não "erro não especificado"', () => {
    const json = { message: 'Validation failed for one or more fields', error: 'bad_request', cause: ['thumbnail.secureUrl must not be null'] };
    const msg = humanizarErroML(400, json);
    expect(msg).toMatch(/^Problema nas fotos/);
    expect(msg).not.toContain('must not be null');
    expect(msg).not.toContain('erro não especificado');
  });

  it('cause misturando strings e objetos → os dois formatos viram mensagem legível', () => {
    const json = {
      message: 'Validation error',
      cause: [
        'thumbnail.secureUrl must not be null',
        { type: 'error', code: 'item.title.length.invalid', message: 'Category does not support titles greater than 60 characters' },
      ],
    };
    const msg = humanizarErroML(400, json);
    expect(msg).toContain('fotos');
    expect(msg).toContain('60');
    expect(msg).not.toContain('does not support');
  });

  it('ML sem message nenhuma no topo e sem cause → cai no fallback genérico (não inventa texto)', () => {
    expect(humanizarErroML(500, {})).toEqual('O Mercado Livre recusou (erro 500).');
    expect(humanizarErroML(500, null)).toEqual('O Mercado Livre recusou (erro 500).');
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

// ADR-0151 D-5 (revisada): categorias que exigem GTIN de verdade (ex.: alimentos/MLB455708)
// recusam o kit sem código — e nenhum EMPTY_GTIN_REASON substitui (dry-run /items/validate
// 2026-09-03: os 4 motivos falham; GTIN da unidade + UNITS_PER_PACK passa).
describe('precisaGtinDePack (retry reativo do kit sem GTIN)', () => {
  const causaGtin = {
    cause_id: 7810,
    type: 'error',
    code: 'item.attribute.missing_conditional_required',
    message: "The attributes [GTIN] are required for category [MLB455708]. Check the attribute is present in the attributes list or in all variation's attributes_combination or attributes.",
  };
  it('400 + causa 7810 citando [GTIN] → true', () => {
    expect(precisaGtinDePack(400, [causaGtin])).toBe(true);
  });
  it('outro atributo obrigatório faltando (não GTIN) → false', () => {
    expect(precisaGtinDePack(400, [{ ...causaGtin, message: 'The attributes [BRAND] are required for category [MLB1].' }])).toBe(false);
  });
  it('warning com o mesmo texto não conta', () => {
    expect(precisaGtinDePack(400, [{ ...causaGtin, type: 'warning' }])).toBe(false);
  });
  it('status != 400 → false', () => {
    expect(precisaGtinDePack(500, [causaGtin])).toBe(false);
  });
  it('sem causas → false', () => {
    expect(precisaGtinDePack(400, undefined)).toBe(false);
    expect(precisaGtinDePack(400, [])).toBe(false);
  });
});
