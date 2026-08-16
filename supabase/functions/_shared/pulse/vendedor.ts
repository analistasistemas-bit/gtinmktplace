// Grava snapshot do vendedor só quando transactions_total mudou (ou 1ª vez).
export function deveGravarVendedor(anterior: { transactions_total: number | null } | null, atualTotal: number | null): boolean {
  if (anterior == null) return true;
  return anterior.transactions_total !== atualTotal;
}
