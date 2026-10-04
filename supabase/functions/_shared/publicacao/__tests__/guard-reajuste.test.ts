import { describe, it, expect, vi } from 'vitest';
import { exigirSemReajusteAtivo, MENSAGEM_REAJUSTE_ATIVO } from '../guard-reajuste';
import { decidirRetryTransitorio } from '../retry';

// Guard usado por publish-familia-ml, update-familia-ml e publicar-split-ml (spec reajuste C2).
// publicar-split-ml não tem __tests__ (lógica no Deno.serve): este arquivo cobre o guard dele.
function admin(res: { data: unknown; error: { message: string } | null }) {
  const rpc = vi.fn(async () => res);
  return { a: { rpc } as never, rpc };
}

describe('exigirSemReajusteAtivo', () => {
  it('sem reajuste → passa, consultando org + codigo_pai', async () => {
    const { a, rpc } = admin({ data: null, error: null });
    await expect(exigirSemReajusteAtivo(a, 'org-1', 'P1')).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith('reajuste_ativo_produto', { p_org: 'org-1', p_codigo_pai: 'P1' });
  });

  it('reajuste ativo → 400 definitivo', async () => {
    const { a } = admin({ data: 'MLB1', error: null });
    const err = await exigirSemReajusteAtivo(a, 'org-1', 'P1').catch((e) => e);
    expect(err.message).toBe(MENSAGEM_REAJUSTE_ATIVO);
    expect(err.status).toBe(400);
    expect(decidirRetryTransitorio(err, 0)).toBe('definitivo');
  });

  it('erro da RPC → retentável (sem status), nunca segue publicando', async () => {
    const { a } = admin({ data: null, error: { message: 'timeout' } });
    const err = await exigirSemReajusteAtivo(a, 'org-1', 'P1').catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBeUndefined();
    expect(decidirRetryTransitorio(err, 0)).toBe('retentar');
  });
});
