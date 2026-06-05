const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function fmtBRL(valor: number): string {
  return BRL.format(valor);
}

/** Inteiro com separador de milhar pt-BR (ex.: 23482 → "23.482"). */
export function fmtInt(n: number): string {
  return new Intl.NumberFormat('pt-BR').format(n);
}

export function fmtMilhar(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')} mi`;
  if (n >= 1_000) return `${Math.round(n / 1000)} mil`;
  return String(n);
}
