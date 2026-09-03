// ADR-0151 D-6 — linhas de alerta de estoque cientes de kit vinculado.
//
// Oversell intra-canal é risco ACEITO nesta v1 (nenhuma reserva prévia): este alerta é toda
// a mitigação que existe. Por isso o texto precisa ser inequívoco — o operador vê N kits no
// pedido do ML e o saldo da base caiu N× mais; sem a tradução, o número parece um bug.
export interface ItemAcimaSaldo {
  codigo: string;
  /** SEMPRE em unidades da BASE (quantidade vendida × multiplicador). */
  pedido: number;
  anterior: number;
  aplicado: number;
  kitCodigoPai: string | null;
  multiplicador: number;
}

export function linhaVendaAcimaSaldo(i: ItemAcimaSaldo): string {
  if (i.kitCodigoPai == null || i.multiplicador <= 1) {
    // Texto preservado byte a byte do que sync-venda/index.ts:165 já enviava.
    return `• ${i.codigo} — pedido de ${i.pedido} un., havia ${i.anterior}, baixou ${i.aplicado}`;
  }
  const kits = Math.round(i.pedido / i.multiplicador);
  return `• ${i.codigo} (kit ${i.kitCodigoPai}) — pedido de ${kits} kit(s) de ${i.multiplicador} un. `
    + `= ${i.pedido} un. do produto-base, havia ${i.anterior}, baixou ${i.aplicado}`;
}

export interface ItemDesyncMl {
  codigo: string;
  /** SEMPRE em unidades da BASE (quantidade vendida × multiplicador). */
  pedido: number;
  kitCodigoPai: string | null;
  multiplicador: number;
}

export function linhaDesyncMl(i: ItemDesyncMl): string {
  if (i.kitCodigoPai == null || i.multiplicador <= 1) {
    // Texto preservado byte a byte do que sync-venda/index.ts já enviava.
    return `• ${i.codigo} — pedido de ${i.pedido} un.`;
  }
  const kits = Math.round(i.pedido / i.multiplicador);
  return `• ${i.codigo} (kit ${i.kitCodigoPai}) — pedido de ${kits} kit(s) de ${i.multiplicador} un. `
    + `= ${i.pedido} un. do produto-base`;
}
