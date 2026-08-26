// ADR-0135 — espelho de supabase/functions/_shared/fiscal/validar.ts.
// Manter os dois em sincronia (o front e o Deno não compartilham módulo).

export const ORIGENS_NFE_POR_ORIGEM: Record<'nacional' | 'importado', number[]> = {
  nacional: [0, 3, 4, 5, 8],
  importado: [1, 2, 6, 7],
};

export const UNIDADES_FISCAIS = [
  'UN', 'PC', 'PAR', 'KIT', 'CX', 'PCT', 'RL', 'SC', 'KG', 'G', 'L', 'ML', 'M', 'CM', 'M2',
] as const;

export function validarCnpj(cnpj: string): boolean {
  const d = cnpj.replace(/\D/g, '');
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (base: string): number => {
    let peso = base.length - 7;
    let soma = 0;
    for (const ch of base) {
      soma += Number(ch) * peso;
      peso = peso === 2 ? 9 : peso - 1;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(d.slice(0, 12)) === Number(d[12]) && dv(d.slice(0, 13)) === Number(d[13]);
}
