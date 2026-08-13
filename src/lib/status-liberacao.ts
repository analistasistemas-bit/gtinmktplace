/** `sem_direito`: o pedido não é venda faturável (cancelado/devolvido), então não há recebimento
 *  para liberar nem sacar — independente da data que o ML gravou antes da devolução. */
export type StatusLiberacao = 'aliberar' | 'liberado' | 'sacado' | 'sem_data' | 'sem_direito';

export interface DadosStatusLiberacao {
  money_release_date: string | null;
  sacado_em: string | null;
  temMembrosSemDataLiberacao?: boolean;
  /** O pedido é venda faturável (ADR-0038)? Omitido = assume que sim, preservando o comportamento
   *  de quem ainda não tem essa informação em mãos. */
  faturavel?: boolean;
}

/**
 * Em que ponto da régua de recebimento o pedido está.
 *
 * `faturavel: false` vence tudo: a devolução mantém a `money_release_date` que o ML gravou quando
 * a venda ainda valia, então decidir só por data fazia a tela anunciar "liberado" um dinheiro que
 * voltou ao comprador — e, antes das travas do ADR-0117, deixava marcá-lo como sacado.
 */
export function statusLiberacao(v: DadosStatusLiberacao, agoraMs: number = Date.now()): StatusLiberacao {
  if (v.faturavel === false) return 'sem_direito';
  if (v.sacado_em) return 'sacado';
  if (!v.money_release_date) return 'sem_data';
  if (Date.parse(v.money_release_date) > agoraMs) return 'aliberar';
  return v.temMembrosSemDataLiberacao ? 'sem_data' : 'liberado';
}

export function labelStatusLiberacao(status: StatusLiberacao): string {
  switch (status) {
    case 'aliberar': return 'a liberar';
    case 'liberado': return 'liberado';
    case 'sacado': return 'sacado';
    case 'sem_direito': return 'sem direito';
    case 'sem_data': return '—';
  }
}
