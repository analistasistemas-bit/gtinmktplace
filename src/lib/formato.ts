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

/**
 * Abreviação pt-BR: 1.234.567 → "1,2 mi", 154.100 → "154 mil" (ou "154,1 mil" com
 * `decimaisMil=1`), 60 → "60". O decimal no ramo dos milhares é opcional para não mudar as telas
 * que já usam a forma redonda; o ramo dos milhões sempre teve 1 casa e continua tendo. Um decimal
 * que dá zero é omitido ("10,0 mil" → "10 mil"), senão o número redondo fica com cara de precisão.
 */
export function fmtMilhar(n: number, decimaisMil = 0): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')} mi`;
  if (n >= 1_000) {
    return `${(n / 1000).toFixed(decimaisMil).replace('.', ',').replace(/,0$/, '')} mil`;
  }
  return String(n);
}

/** Markup como percentual com sinal (ex.: 0.42 → "+42%"). `null`/`undefined` → "—". */
export function fmtMarkup(m: number | null | undefined): string {
  if (m == null) return '—';
  const pct = Math.round(m * 100);
  return `${pct >= 0 ? '+' : ''}${pct}%`;
}

/**
 * Parse de número em texto digitado no padrão pt-BR. `null` = campo vazio. `NaN` = texto
 * inválido — NUNCA vira "vazio" em silêncio, quem chama precisa tratar como erro.
 *
 * Heurística (documentada porque a ambiguidade é real, não um detalhe de implementação):
 * - Casa o padrão COMPLETO de milhar pt-BR (1.234 / 1.234.567 / 1.234,56) → ponto é
 *   separador de milhar, remove todos antes de trocar a vírgula por ponto decimal.
 * - Senão, se tem vírgula, ela é o separador decimal (troca por ponto).
 * - Senão, o texto já está em formato "solto" (ex.: "12.5" digitado com ponto decimal,
 *   "10", "0.5") — passa direto pro Number().
 * Ambiguidade que sobra, aceita conscientemente: "1.234" SEMPRE é lido como o inteiro 1234
 * (milhar), nunca como o decimal 1,234 — é a leitura que um usuário pt-BR espera na
 * esmagadora maioria dos casos, e é exatamente o que a leitura ingênua anterior fazia errado.
 */
export function parseNumeroPtBr(v: string): number | null | typeof NaN {
  const t = v.trim();
  if (t === '') return null;
  const semTexto = /^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)
    ? t.replace(/\./g, '').replace(',', '.')
    : t.includes(',') ? t.replace(',', '.') : t;
  const n = Number(semTexto);
  return Number.isFinite(n) ? n : NaN;
}
