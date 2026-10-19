// ADR-0187 — NCM validado na tabela oficial (ncm_oficial). A regra de vigência vive só em SQL
// (ncm_consultar); aqui só se interpreta o retorno. Erro de leitura LANÇA: nunca vira "válido".
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export type NcmInvalido = { codigo: string; motivo: 'inexistente' | 'vencido' };

/** NCMs (distintos, não vazios) que não existem na tabela oficial ou não estão vigentes.
 *  Uma única chamada ao rpc; código ausente do retorno = inexistente. */
export async function ncmsInvalidos(
  admin: SupabaseClient,
  ncms: (string | null | undefined)[],
): Promise<NcmInvalido[]> {
  const codigos = [...new Set(ncms.filter((n): n is string => !!n))];
  if (codigos.length === 0) return [];
  const { data, error } = await admin.rpc('ncm_consultar', { p_codigos: codigos });
  if (error) throw new Error(`ncm_consultar: ${error.message}`);
  const linhas = (data ?? []) as { codigo: string; vigente: boolean }[];
  const vigentePorCodigo = new Map(linhas.map((r) => [r.codigo, r.vigente]));
  const invalidos: NcmInvalido[] = [];
  for (const codigo of codigos) {
    const vigente = vigentePorCodigo.get(codigo);
    if (vigente === undefined) invalidos.push({ codigo, motivo: 'inexistente' });
    else if (!vigente) invalidos.push({ codigo, motivo: 'vencido' });
  }
  return invalidos;
}

export function mensagemNcm(i: NcmInvalido): string {
  return i.motivo === 'inexistente'
    ? `NCM ${i.codigo} não existe na tabela oficial`
    : `NCM ${i.codigo} não está mais vigente`;
}
