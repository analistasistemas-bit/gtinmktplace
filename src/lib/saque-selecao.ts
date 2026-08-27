import { round2 } from './formato';
import type { Pedido } from './pedidos-faturamento';

/** Acima disto, registrar ou desfazer saque pede confirmação. */
export const LIMITE_CONFIRMA_SAQUE = 20;

/** Atualiza a seleção do filtro inteiro; a paginação só limita o que é renderizado. */
export function selecionarPedidosFaturaveis(
  selecionados: Set<string>,
  pedidos: Pedido[],
  checked: boolean,
): Set<string> {
  const next = new Set(selecionados);
  for (const pedido of pedidos) {
    if (!pedido.faturavel) continue;
    if (checked) next.add(pedido.chave);
    else next.delete(pedido.chave);
  }
  return next;
}

export interface ResumoSelecaoSaque {
  quantidade: number;
  /** Σ líquido da seleção, na mesma base que a coluna "Líquido" da tela exibe (sem descontar
   *  imposto — ADR-0066), para o número da confirmação bater com o que o operador está lendo. */
  valor: number;
  precisaConfirmar: boolean;
}

export function resumoSelecaoSaque(selecionados: Pedido[]): ResumoSelecaoSaque {
  let valor = 0;
  for (const p of selecionados) valor += p.liquido + p.imposto;
  return {
    quantidade: selecionados.length,
    valor: round2(valor),
    precisaConfirmar: selecionados.length > LIMITE_CONFIRMA_SAQUE,
  };
}
