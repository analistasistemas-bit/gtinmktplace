import { describe, it, expect } from 'vitest';
import { processarDesfazer, type DepsDesfazer } from '../processar';

describe('processarDesfazer', () => {
  it('chama a RPC e enfileira push SEM reativar; repetição (ja_estava) também reenfileira', async () => {
    for (const ja of [false, true]) {
      const jobs: Array<{ codigo_pai: string; reativar: boolean }> = [];
      const d: DepsDesfazer = {
        rpc: async () => ({ data: { codigos_pai: ['P1'], ja_estava: ja }, error: null }),
        enfileirar: async (j) => { jobs.push({ codigo_pai: j.codigo_pai, reativar: j.reativar }); return 'm'; },
      };
      const r = await processarDesfazer(d, { orgId: 'o', userId: 'u', notaId: 'n', status: 'desfeita' });
      expect(jobs).toEqual([{ codigo_pai: 'P1', reativar: false }]);
      expect(r).toEqual({ pushOk: true, jaEstava: ja });
    }
  });
  it('erro de saldo insuficiente propaga', async () => {
    const d: DepsDesfazer = {
      rpc: async () => ({ data: null, error: { message: 'desfazer_nota_compra: saldo insuficiente em 09300002' } }),
      enfileirar: async () => 'm',
    };
    await expect(processarDesfazer(d, { orgId: 'o', userId: 'u', notaId: 'n', status: 'desfeita' })).rejects.toThrow(/saldo/);
  });
});
