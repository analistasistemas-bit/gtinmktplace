import { describe, it, expect } from 'vitest';

// Sem seam testável para o handler completo (Deno.serve inline); testa isoladamente a regex de
// validação do pack_id usada em responder-mensagem/index.ts antes de montar a query .or() do ML.
const PACK_ID_RE = /^\d+$/;

describe('validação de pack_id (responder-mensagem)', () => {
  it('aceita string só de dígitos', () => {
    expect(PACK_ID_RE.test('123')).toBe(true);
  });

  it('rejeita letras', () => {
    expect(PACK_ID_RE.test('abc')).toBe(false);
  });

  it('rejeita vírgula (quebraria a gramática do .or() do PostgREST)', () => {
    expect(PACK_ID_RE.test('1,2')).toBe(false);
  });

  it('rejeita string vazia', () => {
    expect(PACK_ID_RE.test('')).toBe(false);
  });
});
