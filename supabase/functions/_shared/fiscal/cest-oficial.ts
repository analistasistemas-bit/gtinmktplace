// ADR-0197 (emenda D-7): CEST que não existe em `cest_oficial` é recusado ao salvar — o ML recusa o
// push com "Invalid cest" (10088) e o anúncio fica "Fiscal pendente". CEST que existe mas não casa
// com o NCM só gera aviso na tela (a tabela sugere, não decide o enquadramento).
// Erro de leitura LANÇA: nunca vira "válido".
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

/** Mensagem de recusa, ou null quando o CEST está vazio ou existe na tabela. */
export async function cestInexistente(
  admin: SupabaseClient,
  cest: string | null | undefined,
): Promise<string | null> {
  const c = cest?.trim();
  if (!c) return null;
  const { data, error } = await admin.from('cest_oficial').select('cest').eq('cest', c).limit(1);
  if (error) throw new Error(`cest_oficial: ${error.message}`);
  return data?.length ? null : `CEST ${c} não existe na tabela oficial (Convênio ICMS 142/2018)`;
}
