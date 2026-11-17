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

// ADR-0207 §16: desfazer a nota desfaz a baixa do pedido DENTRO da RPC (`desfazer_nota_compra` chama
// `reposicao_desfazer_recebimentos`; "recebida volta" provado em supabase/tests/reposicao.sql). A edge não muda:
// mesmos args e nenhuma chamada extra.
describe('processarDesfazer — pedido de compra', () => {
  it('uma única RPC, com os args de sempre (a baixa do pedido é desfeita lá dentro)', async () => {
    const chamadas: Array<{ nome: string; args: Record<string, unknown> }> = [];
    const d: DepsDesfazer = {
      rpc: async (nome, args) => { chamadas.push({ nome, args }); return { data: { codigos_pai: [], ja_estava: false }, error: null }; },
      enfileirar: async () => 'm',
    };
    await processarDesfazer(d, { orgId: 'o', userId: 'u', notaId: 'n', status: 'desfeita' });
    expect(chamadas).toEqual([{ nome: 'desfazer_nota_compra', args: { p_org: 'o', p_user: 'u', p_nota_id: 'n', p_status: 'desfeita' } }]);
  });
});
