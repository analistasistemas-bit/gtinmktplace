// ADR-0207 §16 — recusas do pedido de compra vindas das RPCs de entrada (`reposicao_validar_pedido`,
// `reposicao_receber`, `importar_nota_compra`) em pt-BR de operador: sem o nome da função nem o status cru.
// Mensagem que não é do pedido passa intacta (o contrato de hoje das edges não muda).

/** Validação comum às edges de entrada: o id vai para um parâmetro uuid da RPC; sem isto o PostgREST
 *  responde com erro de cast em inglês. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS: Record<string, string> = {
  rascunho: 'está em rascunho e não recebe mercadoria. Aprove o pedido ou escolha outro.',
  saldo_encerrado: 'está com o saldo encerrado e não recebe mercadoria. Reabra o saldo ou escolha outro pedido.',
};

export function mensagemErroPedido(msg: string): string {
  if (!/^(reposicao_validar_pedido|reposicao_receber|importar_nota_compra): /.test(msg)) return msg;
  if (/pedido de compra não encontrado/.test(msg)) return 'Pedido de compra não encontrado.';
  const status = /o pedido está (\w+);/.exec(msg)?.[1];
  if (status) return `Este pedido ${STATUS[status] ?? 'não recebe mercadoria. Escolha outro pedido.'}`;
  const produto = /o produto (\S+) não está neste pedido/.exec(msg)?.[1];
  if (produto) return `O produto ${produto} não está neste pedido. Escolha outro pedido ou "Nenhum".`;
  if (/nenhum produto da nota está neste pedido/.test(msg)) {
    return 'Nenhum produto da nota está neste pedido. Escolha outro pedido ou "Nenhum".';
  }
  if (/fornecedor do pedido sem CNPJ/.test(msg)) {
    return 'O fornecedor deste pedido ainda não tem CNPJ. Confirme que ele passa a ser identificado pelo CNPJ do emitente da nota.';
  }
  if (/pedido de outro fornecedor/.test(msg)) {
    return 'Este pedido é de outro fornecedor: o CNPJ do pedido não é o do emitente da nota. Escolha o pedido certo ou "Nenhum".';
  }
  return msg;
}
