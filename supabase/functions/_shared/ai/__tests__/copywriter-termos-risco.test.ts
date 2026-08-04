import { describe, it, expect, vi } from 'vitest';

// Mesmo mock de copywriter-schema.test.ts: client.ts importa 'npm:openai@^4' (specifier Deno),
// que o vitest deste repo não resolve.
vi.mock('../client.ts', () => ({ openrouterClient: () => ({}) }));

import { SCHEMA_COPY, coagirTermosComRisco, MAX_TERMOS_COM_RISCO } from '../copywriter';
import { ORDEM_LEITURA, SLOTS_VAZIOS } from '../titulo-slots';

describe('schema — termos_com_risco (ADR-0100)', () => {
  const props = SCHEMA_COPY.schema.properties as Record<string, unknown>;

  it('declara o campo como array de string', () => {
    expect(props.termos_com_risco).toEqual({ type: 'array', items: { type: 'string' } });
  });

  it('é obrigatório (strict exige toda propriedade em required)', () => {
    expect(SCHEMA_COPY.schema.required).toContain('termos_com_risco');
  });

  /**
   * A invariante central do ADR-0100: o campo mora FORA de titulo_slots, e é isso — não uma
   * promessa no prompt — que o impede de chegar ao título. posProcessarTitulo só recebe
   * TituloSlots; um campo que não é slot não tem caminho de código até o texto final.
   *
   * Sem este teste, uma refatoração futura que "unifique os campos do copy" moveria o campo para
   * dentro de titulo_slots e reabriria a Causa C (ADR-0098) em silêncio — a mesma classe das 8
   * travas perdidas na migração do ADR-0099.
   */
  it('NÃO é um slot de título — não está em titulo_slots nem em ORDEM_LEITURA', () => {
    const slotsSchema = props.titulo_slots as { properties: Record<string, unknown>; required: string[] };
    expect(slotsSchema.properties.termos_com_risco).toBeUndefined();
    expect(slotsSchema.required).not.toContain('termos_com_risco');
    expect(ORDEM_LEITURA as readonly string[]).not.toContain('termos_com_risco');
    expect(Object.keys(SLOTS_VAZIOS)).not.toContain('termos_com_risco');
  });
});

describe('coagirTermosComRisco', () => {
  it('devolve [] para ausente, null ou não-array', () => {
    expect(coagirTermosComRisco(undefined)).toEqual([]);
    expect(coagirTermosComRisco(null)).toEqual([]);
    expect(coagirTermosComRisco('HB' as unknown)).toEqual([]);
    expect(coagirTermosComRisco({ 0: 'HB' } as unknown)).toEqual([]);
  });

  it('mantém as strings úteis e descarta item não-string', () => {
    expect(coagirTermosComRisco(['HB', 7, null, 'Escolar', undefined])).toEqual(['HB', 'Escolar']);
  });

  it('faz trim e descarta vazio/whitespace', () => {
    expect(coagirTermosComRisco(['  HB  ', '', '   ', 'Escolar'])).toEqual(['HB', 'Escolar']);
  });

  it('deduplica preservando a primeira ocorrência', () => {
    expect(coagirTermosComRisco(['HB', 'Escolar', 'HB'])).toEqual(['HB', 'Escolar']);
  });

  /**
   * coagirSlots é limitado por construção (itera lista fixa de chaves); um array não é. Um modelo
   * que interprete T8 mal pode devolver dezenas de termos, e a lista vai para console.warn a cada
   * família.
   */
  it(`corta em ${MAX_TERMOS_COM_RISCO} termos`, () => {
    const muitos = Array.from({ length: 40 }, (_, i) => `termo${i}`);
    const out = coagirTermosComRisco(muitos);
    expect(out).toHaveLength(MAX_TERMOS_COM_RISCO);
    expect(out[0]).toBe('termo0');
  });
});
