import { describe, it, expect } from 'vitest';
import { processarImportacao, montarItensRpc, reenviarPush, type DepsImportacao } from '../processar';
import type { NotaCompraLida, ItemConciliado, DecisaoImportacao } from '../../_shared/nfe/tipos';

const item: ItemConciliado = { nItem: 1, cProd: 'REF 06', xProd: 'Short', ncm: '62034900', cfop: '5102', gtin: null,
  uCom: 'PC', qCom: 3, vProd: 100, vFrete: 0, vSeg: 0, vDesc: 0, vOutro: 0, vIPI: 0, vST: 0, vFCPST: 0, orig: 0, rateio: {} };
const nota = { chave: '26261011222333000181550010000010511000030324', numero: 1051, serie: 1,
  emitenteCnpj: '11222333000181', emitenteNome: 'F', emitidaEm: '2026-10-13T15:57:33-03:00',
  totais: { vNF: 100 }, assinada: false } as unknown as NotaCompraLida;
const decisoes: DecisaoImportacao[] = [{ nItem: 1, codigoPai: 'P1', fator: 1,
  distribuicao: [{ codigo: 'S1', quantidade: 3, custoPrecificacao: 40 }] }];
const P = { orgId: 'org-1', userId: 'u', nota, itens: [item], decisoes, xml: '<x/>', sha256: 'h1', divergenciaTotal: 0 };

function deps(over: Partial<DepsImportacao> = {}) {
  const log: string[] = [];
  const jobs: string[] = [];
  const d: DepsImportacao = {
    notaExistente: async () => { log.push('existe?'); return null; },
    upload: async (path) => { log.push(`upload:${path}`); return 'criado'; },
    rpc: async () => { log.push('rpc'); return { data: { nota_id: 'n1', duplicada: false, codigos_pai: ['P1', 'P2'] }, error: null }; },
    enfileirar: async (job) => { jobs.push(job.codigo_pai); return 'm'; },
    ...over,
  };
  return { d, log, jobs };
}

describe('montarItensRpc', () => {
  it('custo de aquisição exato (100/3) e precificação informada; rateio vai junto', () => {
    const [i] = montarItensRpc([item], decisoes);
    const dist = (i.distribuicao as Array<Record<string, number>>)[0];
    expect(dist.custo_aquisicao_unit).toBeCloseTo(33.333333, 6);
    expect(dist.custo_precificacao_unit).toBe(40);
    expect(i).toMatchObject({ n_item: 1, cprod: 'REF 06', codigo_pai: 'P1', fator_conversao: 1, rateio: {} });
  });
});

describe('processarImportacao', () => {
  it('confere existência, sobe XML endereçado pelo hash, chama RPC e enfileira todos os produtos', async () => {
    const { d, log, jobs } = deps();
    const r = await processarImportacao(d, P);
    expect(log).toEqual(['existe?', `upload:org-1/${nota.chave}/h1.xml`, 'rpc']);
    expect(jobs).toEqual(['P1', 'P2']);
    expect(r).toEqual({ notaId: 'n1', duplicada: false, pushOk: true });
  });
  it('nota já importada: NÃO sobe XML de novo, chama a RPC (devolve duplicada) e reenfileira push', async () => {
    const { d, log } = deps({
      notaExistente: async () => ({ status: 'importada' }),
      rpc: async () => ({ data: { nota_id: 'n1', duplicada: true, codigos_pai: ['P1'] }, error: null }),
    });
    const r = await processarImportacao(d, P);
    expect(log.some((l) => l.startsWith('upload'))).toBe(false);
    expect(r.duplicada).toBe(true);
  });
  it('nota desfeita/cancelada: recusa sem subir nem chamar RPC', async () => {
    const { d, log } = deps({ notaExistente: async () => ({ status: 'desfeita' }) });
    await expect(processarImportacao(d, P)).rejects.toThrow(/desfeita/);
    expect(log).toEqual([]);
  });
  it('objeto já existe no storage (mesmo hash = mesmo conteúdo): segue para a RPC sem sobrescrever', async () => {
    const { d, log } = deps({ upload: async () => 'ja_existia' });
    const r = await processarImportacao(d, P);
    expect(log).toContain('rpc');
    expect(r.notaId).toBe('n1');
  });
  it('reenviarPush: só enfileira os produtos da nota, sem RPC de estoque', async () => {
    for (const [status, reativa] of [['importada', true], ['desfeita', false], ['cancelada', false]] as const) {
      const jobs: Array<{ codigo_pai: string; reativar: boolean }> = [];
      const r = await reenviarPush({
        codigosDaNota: async () => ['P1', 'P2'],
        statusDaNota: async () => status,
        enfileirar: async (j) => { jobs.push({ codigo_pai: j.codigo_pai, reativar: j.reativar }); return 'm'; },
      }, 'org-1', nota.chave);
      expect(jobs).toEqual([{ codigo_pai: 'P1', reativar: reativa }, { codigo_pai: 'P2', reativar: reativa }]);
      expect(r).toEqual({ pushOk: true });
    }
  });
  it('erro da RPC propaga; falha de push dá pushOk=false', async () => {
    await expect(processarImportacao(deps({ rpc: async () => ({ data: null, error: { message: 'x' } }) }).d, P)).rejects.toThrow('x');
    const r = await processarImportacao(deps({ enfileirar: async () => { throw new Error('q'); } }).d, P);
    expect(r.pushOk).toBe(false);
  });
});
