// ADR-0135 — regras puras do cadastro fiscal (sem imports Deno: testável por vitest).
// Parâmetro fiscal NUNCA defaulta em silêncio: tudo aqui falha nomeando o campo.
// ORIGENS_NFE_POR_ORIGEM, UNIDADES_FISCAIS e validarCnpj têm espelho em src/lib/fiscal.ts
// (o front não compartilha módulo com o Deno). Manter os dois em sincronia.

// D-5: dois campos de origem, sem derivação. A tabela é a da spec §2.3.
export const ORIGENS_NFE_POR_ORIGEM: Record<'nacional' | 'importado', number[]> = {
  nacional: [0, 3, 4, 5, 8],
  importado: [1, 2, 6, 7],
};

export function validarCoerenciaOrigem(
  origem: 'nacional' | 'importado', origemNfe: number,
): string | null {
  if (!ORIGENS_NFE_POR_ORIGEM[origem].includes(origemNfe)) {
    return `origem_nfe ${origemNfe} é incompatível com origem "${origem}" — ` +
      `códigos válidos: ${ORIGENS_NFE_POR_ORIGEM[origem].join(', ')} (ADR-0135 D-5)`;
  }
  return null;
}

// Vocabulário inicial (NF-e usuais). Congelar contra a lista do ML é o item
// "A verificar #3" do ADR-0135 — ajustar aqui é mudança de dado, não de código.
export const UNIDADES_FISCAIS = [
  'UN', 'PC', 'PAR', 'KIT', 'CX', 'PCT', 'RL', 'SC', 'KG', 'G', 'L', 'ML', 'M', 'CM', 'M2',
] as const;

export interface CamposFiscaisFamilia {
  ncm: string | null;
  cest: string | null;
  origem_nfe: number | null;
  fci: string | null;
  ex_tipi: string | null;
  tributacao_icms: string | null;
  tributacao_icms_regime: string | null;
  unidade: string | null;
  origem: 'nacional' | 'importado';
}

/** Lista TODAS as faltas de uma vez (spec §7) — nunca uma por tentativa. */
export function camposFiscaisFaltantes(
  f: CamposFiscaisFamilia, regimeOrg: 'simples' | 'normal',
): string[] {
  const faltas: string[] = [];
  if (!f.ncm || !/^\d{8}$/.test(f.ncm)) faltas.push('ncm (8 dígitos)');
  if (f.origem_nfe == null) {
    faltas.push('origem_nfe (código 0–8)');
  } else {
    const incoerencia = validarCoerenciaOrigem(f.origem, f.origem_nfe);
    if (incoerencia) faltas.push(incoerencia);
    if ([3, 5, 8].includes(f.origem_nfe) && !f.fci?.trim()) {
      faltas.push('fci (obrigatório para origem_nfe 3, 5 ou 8)');
    }
  }
  if (!f.tributacao_icms?.trim()) {
    faltas.push(regimeOrg === 'simples' ? 'csosn (tributacao_icms)' : 'cst de ICMS (tributacao_icms)');
  } else if (f.tributacao_icms_regime !== regimeOrg) {
    faltas.push(
      `tributacao_icms gravado sob regime "${f.tributacao_icms_regime ?? 'nenhum'}" mas a ` +
      `organização é "${regimeOrg}" — recadastre o campo (ADR-0135 D-4)`,
    );
  }
  const unidade = f.unidade?.toUpperCase().trim() ?? '';
  if (!(UNIDADES_FISCAIS as readonly string[]).includes(unidade)) {
    faltas.push(`unidade fiscal (use uma de: ${UNIDADES_FISCAIS.join(', ')})`);
  }
  if (f.cest && !/^\d{7}$/.test(f.cest)) faltas.push('cest (7 dígitos)');
  return faltas;
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
