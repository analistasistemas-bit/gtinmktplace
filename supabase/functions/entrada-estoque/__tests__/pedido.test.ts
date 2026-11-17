// ADR-0207 §16 — entrada manual vinculada a um pedido de compra. O vínculo (trava, baixa, recusa) é do SQL
// (`registrar_entrada` + `reposicao_validar_pedido`, provado em supabase/tests/reposicao.sql); aqui só o repasse
// do parâmetro, a mensagem em pt-BR e o contrato intacto sem pedido.
import { describe, it, expect } from 'vitest';
import { processarEntrada, respostaEntrada, type DepsEntrada } from '../processar';
import { validarEntrada, type ItemEntrada } from '../validar';
import { mensagemErroPedido } from '../../_shared/reposicao/erro-pedido';

const PED = '3f2a9c1e-8b7d-4e6f-9a01-23456789abcd';

function deps(erro?: string) {
  const chamadas: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const jobs: unknown[] = [];
  const d: DepsEntrada = {
    rpc: (nome, args) => {
      chamadas.push({ nome, args });
      if (erro) return Promise.resolve({ data: null, error: { message: erro } });
      // A RPC de lote devolve o resultado por cor, lido do movimento.
      if (nome === 'registrar_entrada_lote') {
        return Promise.resolve({ data: (args.p_itens as Array<{ codigo: string }>).map((i, n) => ({
          codigo: i.codigo, codigo_pai: 'P1', estoque: 7 + n, duplicada: false,
        })), error: null });
      }
      return Promise.resolve({ data: 7, error: null });
    },
    lerMovimento: () => Promise.resolve({ codigo_pai: 'P1', estoque_resultante: 7 }),
    enfileirar: (job) => { jobs.push(job); return Promise.resolve('m'); },
  };
  return { d, chamadas, jobs };
}
const P = { orgId: 'org-1', userId: 'u-1', documento: 'NF 1', observacao: null, ref: 'r-1' };
const itensDe = (v: ReturnType<typeof validarEntrada>): ItemEntrada[] => {
  if (!v.ok) throw new Error(v.erro);
  return v.itens;
};

describe('sem pedidoCompraId: contrato de hoje intacto', () => {
  it('validar devolve o item sem chave nova', () => {
    expect(validarEntrada({ codigo: 'A1', quantidade: 5, custo: 10 }))
      .toEqual({ ok: true, unico: true, itens: [{ codigo: 'A1', quantidade: 5, custo: 10 }] });
  });

  it('args da RPC idênticos aos de hoje (sem p_pedido_compra: a RPC de 8 args continua servindo)', async () => {
    const { d, chamadas } = deps();
    await processarEntrada(d, { ...P, unico: true, itens: [{ codigo: 'A1', quantidade: 5, custo: 10 }] });
    expect(chamadas).toEqual([{ nome: 'registrar_entrada', args: {
      p_org: 'org-1', p_codigo: 'A1', p_qtd: 5, p_custo: 10, p_doc: 'NF 1', p_obs: null, p_criado_por: 'u-1', p_ref: 'entrada:r-1',
    } }]);
  });

  it('resposta de uma cor e de lote idênticas às de hoje', async () => {
    const r = await processarEntrada(deps().d, { ...P, unico: true, itens: [{ codigo: 'A1', quantidade: 5, custo: null }] });
    expect(respostaEntrada(r, true)).toEqual({ status: 200, body: { estoque: 7, duplicada: false, pushOk: true } });
    const lote = await processarEntrada(deps().d, { ...P, unico: false, itens: [{ codigo: 'A1', quantidade: 5, custo: null }] });
    expect(respostaEntrada(lote, false)).toEqual({ status: 200, body: {
      resultados: [{ codigo: 'A1', estoque: 7, duplicada: false }], pushOk: true,
    } });
  });

  it('erro de uma cor continua 400 com a mensagem crua da RPC', async () => {
    const msg = 'sku_em_transferencia: A1 está em transferência de kit. Repita a entrada depois.';
    const r = await processarEntrada(deps(msg).d, { ...P, unico: true, itens: [{ codigo: 'A1', quantidade: 5, custo: null }] });
    expect(respostaEntrada(r, true)).toEqual({ status: 400, body: { error: msg } });
  });
});

describe('com pedidoCompraId: uma transação só (registrar_entrada_lote)', () => {
  it('uma cor: vai pela RPC de lote, com a ref histórica e a resposta de uma cor de sempre', async () => {
    const v = validarEntrada({ codigo: 'A1', quantidade: 5, pedidoCompraId: PED });
    expect(v).toEqual({ ok: true, unico: true, itens: [{ codigo: 'A1', quantidade: 5, custo: null, pedidoCompraId: PED }] });
    const { d, chamadas, jobs } = deps();
    const r = await processarEntrada(d, { ...P, unico: true, itens: itensDe(v) });
    expect(chamadas).toEqual([{ nome: 'registrar_entrada_lote', args: {
      p_org: 'org-1', p_doc: 'NF 1', p_obs: null, p_criado_por: 'u-1', p_pedido_compra: PED,
      p_itens: [{ codigo: 'A1', quantidade: 5, custo: null, ref: 'entrada:r-1', com_pedido: true }],
    } }]);
    expect(respostaEntrada(r, true)).toEqual({ status: 200, body: { estoque: 7, duplicada: false, pushOk: true } });
    expect(jobs).toEqual([{ org_id: 'org-1', codigo_pai: 'P1', canal_origem: null, reativar: true }]);
  });

  it('lote: UMA chamada; cor fora do pedido vai com com_pedido false (entra sem baixa)', async () => {
    const v = validarEntrada({ itens: [{ codigo: 'A1', quantidade: 5, pedidoCompraId: PED }, { codigo: 'A2', quantidade: 1 }] });
    const { d, chamadas, jobs } = deps();
    const r = await processarEntrada(d, { ...P, unico: false, itens: itensDe(v) });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]!.args.p_itens).toEqual([
      { codigo: 'A1', quantidade: 5, custo: null, ref: 'entrada:r-1:A1', com_pedido: true },
      { codigo: 'A2', quantidade: 1, custo: null, ref: 'entrada:r-1:A2', com_pedido: false },
    ]);
    expect(respostaEntrada(r, false)).toEqual({ status: 200, body: { pushOk: true, resultados: [
      { codigo: 'A1', estoque: 7, duplicada: false }, { codigo: 'A2', estoque: 8, duplicada: false },
    ] } });
    expect(jobs).toHaveLength(1); // um push por produto, só depois do sucesso do lote
  });

  it('lote misto recusado (cor fora do pedido marcada): 400 em pt-BR, nada gravado, nenhum push', async () => {
    const { d, jobs } = deps('reposicao_validar_pedido: o produto A2 não está neste pedido');
    const v = validarEntrada({ itens: [{ codigo: 'A1', quantidade: 5 }, { codigo: 'A2', quantidade: 1, pedidoCompraId: PED }] });
    const r = await processarEntrada(d, { ...P, unico: false, itens: itensDe(v) });
    expect(respostaEntrada(r, false)).toEqual({ status: 400, body: {
      error: 'O produto A2 não está neste pedido. Escolha outro pedido ou "Nenhum".',
    } });
    expect(jobs).toEqual([]);
  });

  it('dois pedidos diferentes numa submissão: recusado antes da RPC', () => {
    expect(validarEntrada({ itens: [
      { codigo: 'A1', quantidade: 5, pedidoCompraId: PED },
      { codigo: 'A2', quantidade: 1, pedidoCompraId: '3f2a9c1e-8b7d-4e6f-9a01-000000000000' },
    ] })).toEqual({ ok: false, erro: 'Uma entrada baixa um pedido só.' });
  });

  it('id que não é uuid é recusado antes da RPC', () => {
    expect(validarEntrada({ codigo: 'A1', quantidade: 5, pedidoCompraId: 'abc' }))
      .toEqual({ ok: false, erro: 'Pedido de compra inválido.' });
    expect(validarEntrada({ itens: [{ codigo: 'A1', quantidade: 5, pedidoCompraId: 7 }] }))
      .toEqual({ ok: false, erro: 'Pedido de compra inválido.' });
  });

  it('pedido encerrado: 400 em pt-BR, sem push (a RPC desfez a entrada inteira)', async () => {
    const { d, jobs } = deps('reposicao_validar_pedido: o pedido está saldo_encerrado; não recebe mercadoria');
    const r = await processarEntrada(d, { ...P, unico: true, itens: [{ codigo: 'A1', quantidade: 5, custo: null, pedidoCompraId: PED }] });
    expect(respostaEntrada(r, true)).toEqual({ status: 400, body: {
      error: 'Este pedido está com o saldo encerrado e não recebe mercadoria. Reabra o saldo ou escolha outro pedido.',
    } });
    expect(jobs).toEqual([]);
  });
});

describe('mensagemErroPedido', () => {
  it.each([
    ['reposicao_validar_pedido: pedido de compra não encontrado nesta organização', 'Pedido de compra não encontrado.'],
    ['reposicao_validar_pedido: o pedido está rascunho; não recebe mercadoria',
      'Este pedido está em rascunho e não recebe mercadoria. Aprove o pedido ou escolha outro.'],
    ['reposicao_receber: o pedido está rascunho; só pedido aprovado, enviado, parcial ou recebido recebe mercadoria',
      'Este pedido está em rascunho e não recebe mercadoria. Aprove o pedido ou escolha outro.'],
    ['reposicao_validar_pedido: o produto 0981 não está neste pedido', 'O produto 0981 não está neste pedido. Escolha outro pedido ou "Nenhum".'],
    ['importar_nota_compra: nenhum produto da nota está neste pedido', 'Nenhum produto da nota está neste pedido. Escolha outro pedido ou "Nenhum".'],
    ['importar_nota_compra: pedido de outro fornecedor (CNPJ do pedido 99888777000166, da nota 11222333000181)',
      'Este pedido é de outro fornecedor: o CNPJ do pedido não é o do emitente da nota. Escolha o pedido certo ou "Nenhum".'],
    ['importar_nota_compra: pedido de compra não encontrado nesta organização', 'Pedido de compra não encontrado.'],
    ['importar_nota_compra: o pedido está saldo_encerrado; não recebe mercadoria',
      'Este pedido está com o saldo encerrado e não recebe mercadoria. Reabra o saldo ou escolha outro pedido.'],
  ])('%s', (cru, pt) => expect(mensagemErroPedido(cru)).toBe(pt));

  it('mensagem que não é do pedido passa intacta', () => {
    const m = 'registrar_entrada: SKU X não encontrado na organização';
    expect(mensagemErroPedido(m)).toBe(m);
  });
});
