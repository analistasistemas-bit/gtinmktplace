// ADR-0186/0188 — marca de produto. A marca que vai ao ML fica gravada no produto (`familias.marca`):
// o fornecedor é onde a mercadoria é comprada e, na org com marca própria (Zaven), o cliente final não
// pode vê-lo. `marca_propria` da org só define o default do cadastro pelo Estoque (trigger no banco).
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

/** ADR-0188 — a marca do produto (`familias.marca`) vence o fornecedor. Planilha nasce sem marca. */
export interface FamiliaMarca { marca?: string | null; fornecedor?: string | null }

/** CREATE: marca → fornecedor; vazio = o montador aplica `marca_padrao`/'Avil' como sempre fez. */
export function marcaParaCriacao(f: FamiliaMarca): string | undefined {
  return f.marca?.trim() || f.fornecedor?.trim() || undefined;
}

/** UPDATE/split: marca → fornecedor; null = não envia BRAND (preserva a do ML — ADR-0016). */
export function marcaParaUpdate(f: FamiliaMarca): string | null {
  return f.marca?.trim() || f.fornecedor?.trim() || null;
}

/** Impõe a marca do produto sobre atributos preservados/copiados/mesclados (edição, kit, irmão UP).
 *  Só troca o que existe — não inventa BRAND onde a categoria não pede. Valor que já é a marca fica
 *  como está, com o `value_id` do ML: trocá-lo por texto cru divergiria do irmão e desagruparia a
 *  família UP (lote 54, ADR-0088). Sem marca no produto, nada é imposto. */
export function forcarMarcaDoProduto<T extends { id?: string; value_name?: string | null; value_id?: string | null }>(
  attrs: T[], marca: string | null | undefined,
): T[] {
  const alvo = marca?.trim();
  if (!alvo) return attrs;
  return attrs.map((a) => (IDS_MARCA.has(a.id ?? '') && a.value_name?.trim().toLowerCase() !== alvo.toLowerCase()
    ? { id: a.id, value_name: alvo } as T
    : a));
}
