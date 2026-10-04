// I5 C4 — contrato monetário em centavos inteiros, compartilhado front/servidor (sem import Deno-only).
import type { Ajuste } from './tipos.ts';

/** Partes decimais de `String(v)` (round-trip mais curto do JS). Exponencial/não finito → lança. */
function partes(v: number): { neg: boolean; int: string; frac: string } {
  const s = String(v);
  if (!Number.isFinite(v) || /e/i.test(s)) throw new Error(`Valor monetário não representável: ${s}`);
  const neg = s.startsWith('-');
  const [int, frac = ''] = (neg ? s.slice(1) : s).split('.');
  return { neg, int, frac };
}

/** Half-up decimal exato sobre a string (só a 3ª casa decide), sem arredondamento intermediário; simétrico no sinal. */
export function centavos(v: number): number {
  const { neg, int, frac } = partes(v);
  const f = (frac + '000').slice(0, 3);
  const c = Number(int) * 100 + Number(f.slice(0, 2)) + (Number(f[2]) >= 5 ? 1 : 0);
  return neg ? -c : c;
}

export function maxDuasCasas(v: number): boolean {
  try {
    return partes(v).frac.length <= 2;
  } catch {
    return false;
  }
}

export function reais(c: number): number {
  return c / 100;
}

/** Alvo em reais (2 casas) ou null se ≤ 0. pct: valor tem até 2 casas → pontos-base inteiros. */
export function calcularAlvo(base: number, a: Ajuste): number | null {
  const c = centavos(base);
  const s = a.sentido === '+' ? 1 : -1;
  const v = centavos(a.valor);
  let cent: number;
  if (a.tipo === 'pct') {
    const q = c * (10000 + s * v);
    // half-up exato só vale para q ≥ 0; q < 0 cai em ≤ 0 → null
    cent = q <= 0 ? 0 : Math.floor((2 * q + 10000) / 20000);
  } else {
    cent = c + s * v;
  }
  return cent <= 0 ? null : reais(cent);
}

export function semAlteracao(base: number, alvo: number): boolean {
  return centavos(base) === centavos(alvo);
}
