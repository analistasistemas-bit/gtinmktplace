const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function fmtBRL(valor: number): string {
  return BRL.format(valor);
}

/** Arredonda a 2 casas (centavos). Fonte única do arredondamento monetário no frontend. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** BRL sem símbolo (ex.: 1234.5 → "1.234,50"). Quem precisa de "R$ " prefixa. */
export function fmtBRLSemSimbolo(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

/** Markup como percentual com sinal (ex.: 0.42 → "+42%"). `null`/`undefined` → "—". */
export function fmtMarkup(m: number | null | undefined): string {
  if (m == null) return '—';
  const pct = Math.round(m * 100);
  return `${pct >= 0 ? '+' : ''}${pct}%`;
}
