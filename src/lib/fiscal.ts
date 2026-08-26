// ADR-0135 — espelho de supabase/functions/_shared/fiscal/validar.ts.
// Manter os dois em sincronia (o front e o Deno não compartilham módulo).

export const ORIGENS_NFE_POR_ORIGEM: Record<'nacional' | 'importado', number[]> = {
  nacional: [0, 3, 4, 5, 8],
  importado: [1, 2, 6, 7],
};

export const UNIDADES_FISCAIS = [
  'UN', 'PC', 'PAR', 'KIT', 'CX', 'PCT', 'RL', 'SC', 'KG', 'G', 'L', 'ML', 'M', 'CM', 'M2',
] as const;

export interface CamposFiscaisResumo {
  ncm: string | null | undefined;
  cest: string | null | undefined;
  origemNfe: number | null | undefined;
  fci: string | null | undefined;
  tributacaoIcms: string | null | undefined;
  tributacaoIcmsRegime: string | null | undefined;
  unidade: string | null | undefined;
  origem: 'nacional' | 'importado';
}

/** Espelho de `camposFiscaisFaltantes` (supabase/functions/_shared/fiscal/validar.ts) — manter em
 *  sincronia (mesma convenção deste arquivo: front + Deno, sem 3º módulo compartilhado). Difere
 *  do gate real só na forma (boolean, não lista de mensagens) — usado pelo filtro "Fiscal
 *  pendente" da tela Estoque pra bater com o que a edge realmente reprova, não só 4 campos null. */
export function fiscalIncompleto(f: CamposFiscaisResumo, regimeOrg: 'simples' | 'normal'): boolean {
  if (!f.ncm || !/^\d{8}$/.test(f.ncm)) return true;
  if (f.origemNfe == null) return true;
  if (!ORIGENS_NFE_POR_ORIGEM[f.origem].includes(f.origemNfe)) return true;
  if ([3, 5, 8].includes(f.origemNfe) && !f.fci?.trim()) return true;
  if (!f.tributacaoIcms?.trim()) return true;
  if (f.tributacaoIcmsRegime !== regimeOrg) return true;
  const unidade = f.unidade?.toUpperCase().trim() ?? '';
  if (!(UNIDADES_FISCAIS as readonly string[]).includes(unidade)) return true;
  if (f.cest && !/^\d{7}$/.test(f.cest)) return true;
  return false;
}

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
