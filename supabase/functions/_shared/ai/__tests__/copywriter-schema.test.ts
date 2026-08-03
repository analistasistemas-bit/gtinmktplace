import { describe, it, expect, vi } from 'vitest';

// client.ts importa 'npm:openai@^4' (specifier estilo Deno) — o Vite/vitest deste repo não
// resolve esse prefixo (openai nem está em node_modules; é dependência só da edge function).
// Nenhum outro teste importa copywriter.ts/client.ts na cadeia por isso. Mock para poder testar
// só o schema exportado, sem tocar client real.
vi.mock('../client.ts', () => ({ openrouterClient: () => ({}) }));

import { SCHEMA_COPY } from '../copywriter';
import { SLOTS_VAZIOS } from '../titulo-slots';

describe('json_schema do copywriter', () => {
  const props = SCHEMA_COPY.schema.properties as Record<string, unknown>;
  const slotsSchema = props.titulo_slots as {
    type: string;
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: boolean;
  };

  it('não aceita mais `titulo` como string no contrato novo', () => {
    expect(props.titulo).toBeUndefined();
  });

  it('exige titulo_slots', () => {
    expect(SCHEMA_COPY.schema.required).toContain('titulo_slots');
  });

  it('declara as dez chaves e todas obrigatórias', () => {
    const chaves = Object.keys(SLOTS_VAZIOS);
    expect(Object.keys(slotsSchema.properties).sort()).toEqual(chaves.sort());
    expect(slotsSchema.required.sort()).toEqual(chaves.sort());
  });

  it('proíbe chave desconhecida — o modelo não pode improvisar um slot `diferencial`', () => {
    expect(slotsSchema.additionalProperties).toBe(false);
    expect(SCHEMA_COPY.schema.additionalProperties).toBe(false);
    expect(slotsSchema.properties.diferencial).toBeUndefined();
  });

  it('todo slot é string', () => {
    for (const v of Object.values(slotsSchema.properties)) {
      expect(v).toEqual({ type: 'string' });
    }
  });
});
