import { describe, expect, it, vi } from 'vitest';
import { MLApiError } from '../../_shared/ml/erro-ml.ts';
import { processarRenovacao, type DepsRenovador, type ResultadoRenovacaoProativa } from '../processar.ts';

function cx(id: string) {
  return { id, orgId: `org-${id}`, canal: 'mercado_livre', contaExternaId: id, expiresAt: null };
}

describe('processarRenovacao (ADR-0171)', () => {
  it('renova em ordem, com pausa de 2s entre conexões (não depois da última), sempre 200', async () => {
    const conexoes = [cx('a'), cx('b'), cx('c')];
    const ordem: string[] = [];
    const sleep = vi.fn().mockResolvedValue(undefined);
    const renovar = vi.fn(async (c: ReturnType<typeof cx>) => {
      ordem.push(c.id);
      return 'renovado' as ResultadoRenovacaoProativa;
    });
    const deps: DepsRenovador = { listarConexoesAExpirar: async () => conexoes, renovar, sleep };

    const r = await processarRenovacao(deps);

    expect(ordem).toEqual(['a', 'b', 'c']);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(r).toEqual({ ok: true, renovadas: 3, puladas: 0, falhas: 0, interrompido_429: false });
  });

  it('429 (MLApiError) encerra a rodada — as conexões seguintes não são tentadas', async () => {
    const conexoes = [cx('a'), cx('b'), cx('c')];
    const sleep = vi.fn().mockResolvedValue(undefined);
    const renovar = vi.fn(async (c: ReturnType<typeof cx>) => {
      if (c.id === 'b') throw new MLApiError(429, 'ML /oauth/token 429: rate limit');
      return 'renovado' as ResultadoRenovacaoProativa;
    });

    const r = await processarRenovacao({ listarConexoesAExpirar: async () => conexoes, renovar, sleep });

    expect(renovar).toHaveBeenCalledTimes(2); // a, b — nunca chega em c
    expect(r).toEqual({ ok: true, renovadas: 1, puladas: 0, falhas: 0, interrompido_429: true });
  });

  it('erro genérico (inclusive Redis) numa conexão não interrompe as demais', async () => {
    const conexoes = [cx('a'), cx('b')];
    const sleep = vi.fn().mockResolvedValue(undefined);
    const renovar = vi.fn(async (c: ReturnType<typeof cx>) => {
      if (c.id === 'a') throw new Error('Redis 500: boom');
      return 'pulado_fora_limite' as ResultadoRenovacaoProativa;
    });

    const r = await processarRenovacao({ listarConexoesAExpirar: async () => conexoes, renovar, sleep });

    expect(renovar).toHaveBeenCalledTimes(2);
    expect(r).toEqual({ ok: true, renovadas: 0, puladas: 1, falhas: 1, interrompido_429: false });
  });

  it('lista vazia: 200 sem chamar renovar nem sleep', async () => {
    const sleep = vi.fn();
    const renovar = vi.fn();
    const r = await processarRenovacao({ listarConexoesAExpirar: async () => [], renovar, sleep });
    expect(renovar).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: true, renovadas: 0, puladas: 0, falhas: 0, interrompido_429: false });
  });
});
