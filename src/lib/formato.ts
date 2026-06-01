const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function fmtBRL(valor: number): string {
  return BRL.format(valor);
}
