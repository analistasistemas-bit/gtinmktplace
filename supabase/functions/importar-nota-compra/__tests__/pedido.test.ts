// ADR-0207 §16 — nota de compra vinculada a um pedido. A recusa (CNPJ, SKU, status) é do SQL e "estoque intacto"
// está provado em supabase/tests/reposicao.sql (bloco "outro fornecedor"); aqui o repasse e a mensagem.
import { describe, it, expect } from 'vitest';
import { processarImportacao, type DepsImportacao } from '../processar';
import { validarImportacao } from '../validar';
import type { NotaCompraLida, ItemConciliado, DecisaoImportacao } from '../../_shared/nfe/tipos';

const item: ItemConciliado = { nItem: 1, cProd: 'REF 06', xProd: 'Short', ncm: '62034900', cfop: '5102', gtin: null,
  uCom: 'PC', qCom: 3, vProd: 100, vFrete: 0, vSeg: 0, vDesc: 0, vOutro: 0, vIPI: 0, vST: 0, vFCPST: 0, orig: 0, rateio: {} };
const nota = { chave: '26261011222333000181550010000010511000030324', numero: 1051, serie: 1,
  emitenteCnpj: '11222333000181', emitenteNome: 'F', emitidaEm: '2026-10-13T15:57:33-03:00',
  totais: { vNF: 100 }, assinada: false } as unknown as NotaCompraLida;
const decisoes: DecisaoImportacao[] = [{ nItem: 1, codigoPai: 'P1', fator: 1,
  distribuicao: [{ codigo: 'S1', quantidade: 3, custoPrecificacao: 40 }] }];
const P = { orgId: 'org-1', userId: 'u', nota, itens: [item], decisoes, xml: '<x/>', sha256: 'h1', divergenciaTotal: 0 };
const PED_A = '3f2a9c1e-8b7d-4e6f-9a01-23456789abcd';

function deps(erro?: string) {
  const chamadas: Array<Record<string, unknown>> = [];
  const jobs: string[] = [];
  const d: DepsImportacao = {
    notaExistente: async () => null,
    upload: async () => 'criado',
    rpc: async (_n, args) => {
      chamadas.push(args);
      return erro ? { data: null, error: { message: erro } } : { data: { nota_id: 'n1', duplicada: false, codigos_pai: ['P1'] }, error: null };
    },
    enfileirar: async (job) => { jobs.push(job.codigo_pai); return 'm'; },
  };
  return { d, chamadas, jobs };
}

describe('sem pedidoCompraId: contrato de hoje', () => {
  it('args da RPC sem p_pedido_compra (a RPC de 4 args continua servindo) e resposta igual', async () => {
    const { d, chamadas } = deps();
    const r = await processarImportacao(d, P);
    expect(Object.keys(chamadas[0]!).sort()).toEqual(['p_itens', 'p_nota', 'p_org', 'p_user']);
    expect(r).toEqual({ notaId: 'n1', duplicada: false, pushOk: true });
  });

  it('erro que não é do pedido passa cru (como hoje)', async () => {
    const { d } = deps('importar_nota_compra: a nota X está desfeita; não pode ser reimportada');
    await expect(processarImportacao(d, P)).rejects.toThrow('importar_nota_compra: a nota X está desfeita; não pode ser reimportada');
  });
});

describe('com pedidoCompraId', () => {
  it('repassa o pedido à RPC', async () => {
    const { d, chamadas } = deps();
    await processarImportacao(d, { ...P, pedidoCompraId: PED_A });
    expect(chamadas[0]!.p_pedido_compra).toBe(PED_A);
  });

  it('aceite 4 — fornecedor B nao baixa A: nota de B no pedido de A → erro em pt-BR e nenhum push', async () => {
    const { d, jobs } = deps('importar_nota_compra: pedido de outro fornecedor (CNPJ do pedido 99888777000166, da nota 11222333000181)');
    await expect(processarImportacao(d, { ...P, pedidoCompraId: PED_A })).rejects.toThrow(
      'Este pedido é de outro fornecedor: o CNPJ do pedido não é o do emitente da nota. Escolha o pedido certo ou "Nenhum".');
    expect(jobs).toEqual([]);
  });

  it('vincularCnpj só vai à RPC com o pedido; sem confirmação, a recusa sai em pt-BR', async () => {
    const com = deps();
    await processarImportacao(com.d, { ...P, pedidoCompraId: PED_A, vincularCnpj: true });
    expect(com.chamadas[0]!.p_vincular_cnpj).toBe(true);
    const semPedido = deps();
    await processarImportacao(semPedido.d, { ...P, vincularCnpj: true });
    expect(semPedido.chamadas[0]).not.toHaveProperty('p_vincular_cnpj');
    const sem = deps();
    await processarImportacao(sem.d, { ...P, pedidoCompraId: PED_A });
    expect(sem.chamadas[0]).not.toHaveProperty('p_vincular_cnpj');
    const { d } = deps('importar_nota_compra: fornecedor do pedido sem CNPJ; confirme que ele passa a ser identificado pelo CNPJ 11222333000181');
    await expect(processarImportacao(d, { ...P, pedidoCompraId: PED_A })).rejects.toThrow(
      'O fornecedor deste pedido ainda não tem CNPJ. Confirme que ele passa a ser identificado pelo CNPJ do emitente da nota.');
  });

  it('validar recusa pedidoCompraId que não é uuid antes de ler o XML', () => {
    expect(validarImportacao({ xml: '<x/>', decisoes: [], pedidoCompraId: 'abc' }, '1'))
      .toEqual({ ok: false, erro: 'Pedido de compra inválido.' });
  });
});
