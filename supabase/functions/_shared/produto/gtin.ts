import { gtinValido } from '../nfe/regras.ts';

/**
 * GTIN a gravar em `variacoes.gtin`: o digitado, ou `null` quando o ML vai recusar (comprimento
 * fora de 8/12/13/14 ou dígito verificador GS1 errado). Lixo nunca chega à Revisão — NF 1051
 * (17/10/2026): quantidades digitadas na aba GTIN viraram EAN "1"/"2" em 34 SKUs. `3000*` é código
 * interno conhecido e fica (mesma régua de `gtinInvalido` em src/lib/gtin.ts).
 */
export function gtinOuNull(gtin: string | null | undefined): string | null {
  const s = (gtin ?? '').trim();
  if (s === '') return null;
  return s.startsWith('3000') || gtinValido(s) ? s : null;
}
