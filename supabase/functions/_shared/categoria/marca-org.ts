// ADR-0186 — marca própria por organização. Org com `marca_propria` publica BRAND/MANUFACTURER
// sempre com `marca_padrao`: o fornecedor da planilha é onde a mercadoria é comprada e o cliente
// final não pode vê-lo (Zaven). Sem a flag, vale a regra de sempre (fornecedor = marca, Avil).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export interface MarcaOrg {
  marcaPadrao?: string;
  marcaPropria: boolean;
}

const IDS_MARCA = new Set(['BRAND', 'MANUFACTURER']);

export async function lerMarcaOrg(admin: SupabaseClient, orgId: string): Promise<MarcaOrg> {
  const { data, error } = await admin.from('organizations')
    .select('marca_padrao, marca_propria').eq('id', orgId).maybeSingle();
  if (error) throw new Error(`lerMarcaOrg: ${error.message}`);
  const marcaPadrao = (data?.marca_padrao as string | null)?.trim() || undefined;
  const marcaPropria = data?.marca_propria === true;
  // Cair no fornecedor ou no default 'Avil' aqui publicaria exatamente o que a flag proíbe.
  if (marcaPropria && !marcaPadrao) throw new Error('Organização com marca própria sem marca_padrao');
  return { marcaPadrao, marcaPropria };
}

/** A string "marca" que os montadores recebem (antes: o fornecedor cru). */
export function marcaDoProduto(fornecedor: string | null | undefined, org: MarcaOrg): string | undefined {
  if (org.marcaPropria) return org.marcaPadrao;
  return fornecedor?.trim() || undefined;
}

/** Impõe a marca da org sobre atributos preservados/copiados/mesclados (edição, kit, irmão UP).
 *  Só troca o que existe — não inventa BRAND onde a categoria não pede. */
export function forcarMarcaPropria<T extends { id: string; value_name?: string | null; value_id?: string | null }>(
  attrs: T[], org: MarcaOrg,
): T[] {
  if (!org.marcaPropria) return attrs;
  return attrs.map((a) => (IDS_MARCA.has(a.id) ? { id: a.id, value_name: org.marcaPadrao } as T : a));
}
