import { describe, it, expect } from 'vitest';
import { resolverModeloTexto, MODELO_COPY } from '../modelos.ts';

// Fake client mínimo — só a chain usada por resolverModeloTexto (mesmo padrão de
// notificacoes/__tests__/config.test.ts).
function fakeClient(aiModelTexto: string | null) {
  return {
    from: () => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: { ai_model_texto: aiModelTexto }, error: null }),
      };
      return chain;
    },
  } as any;
}

describe('resolverModeloTexto', () => {
  it('devolve o slug configurado pela org quando presente', async () => {
    const client = fakeClient('deepseek/deepseek-v4-flash');
    expect(await resolverModeloTexto(client, 'org-1')).toBe('deepseek/deepseek-v4-flash');
  });

  it('cai no fallback MODELO_COPY quando a org não configurou (null)', async () => {
    const client = fakeClient(null);
    expect(await resolverModeloTexto(client, 'org-1')).toBe(MODELO_COPY);
  });

  it('cai no fallback MODELO_COPY quando a linha não existe (maybeSingle → null)', async () => {
    const client = {
      from: () => {
        const chain: any = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: null, error: null }) };
        return chain;
      },
    } as any;
    expect(await resolverModeloTexto(client, 'org-sem-config')).toBe(MODELO_COPY);
  });
});
