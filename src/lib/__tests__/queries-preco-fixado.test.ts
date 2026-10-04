// D15 (reajuste em massa): `preco_editado_pelo_operador` é a marca que faz o preço sobreviver ao
// re-ingest. Editar grava a marca; "Voltar ao automático" só a remove (o valor é recalculado no
// próximo lote, não aqui).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const update = vi.fn();
const eq = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (t: string) => ({
      update: (p: unknown) => {
        update(t, p);
        return { eq: (c: string, v: string) => { eq(c, v); return Promise.resolve({ error: null }); } };
      },
    }),
  },
}));

import { updateVariacaoPreco, voltarPrecoAutomatico } from '@/lib/queries';

beforeEach(() => { update.mockClear(); eq.mockClear(); });

describe('marca de preço fixado pelo operador', () => {
  it('editar o valor grava o preço e mantém a marca', async () => {
    await updateVariacaoPreco('v1', 42.5);
    expect(update).toHaveBeenCalledWith('variacoes', { preco_publicacao: 42.5, preco_editado_pelo_operador: true });
    expect(eq).toHaveBeenCalledWith('id', 'v1');
  });

  it('voltarPrecoAutomatico remove só a marca, sem tocar no preço', async () => {
    await voltarPrecoAutomatico('v1');
    expect(update).toHaveBeenCalledWith('variacoes', { preco_editado_pelo_operador: false });
    expect(eq).toHaveBeenCalledWith('id', 'v1');
  });
});
