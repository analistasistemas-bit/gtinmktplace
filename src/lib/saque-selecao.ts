import { round2 } from './formato';
import type { Pedido } from './pedidos-faturamento';

/** Acima disto, registrar saque pede confirmação. "Selecionar todos" cobre a página inteira (50),
 *  então sem um limite um clique marcava dezenas de pedidos de uma vez. */
export const LIMITE_CONFIRMA_SAQUE = 20;

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
