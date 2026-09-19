// ADR-0166: tipo de produto (roupa/calcado) por organizacao. Espelha a forma de
// `_shared/produto/modulo.ts`, mas NAO e modulo: modulo libera tela paga (ADR-0047), tipo de
// produto muda a estrutura do cadastro (o SKU passa a ser cor x tamanho).
//
// INVARIANTE (INV-1): lista vazia = comportamento padrao do sistema inteiro. Todo chamador
// trata `[]` como "nada muda". Nao existe default.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
// R7: a whitelist vive num lugar só (`tipos-produto-valores.ts`). Reexportada aqui por
// conveniencia dos chamadores Deno — nunca redigitada.
import { TIPOS_PRODUTO_VALIDOS, type TipoProduto } from './tipos-produto-valores.ts';

export { TIPOS_PRODUTO_VALIDOS };
export type { TipoProduto };

export function temTipoProduto(tipos: readonly string[], tipo: TipoProduto): boolean {
  return tipos.includes(tipo);
}

// Diferente de `exigirModulo` (que fecha o gate em erro de leitura, porque menos acesso e o lado
// seguro), aqui `false`/`[]` NAO e o lado seguro: uma falha transitoria de banco viraria "org
// padrao" e o cadastro gravaria um produto de roupa SEM tamanho, em silencio. Por isso lanca —
// quem chama deixa o throw propagar como falha transitoria (sem `.status`, o QStash retenta).
// Mesma logica de `moduloHabilitadoStrict`.
export async function tiposProdutoDaOrg(
  admin: SupabaseClient, orgId: string,
): Promise<TipoProduto[]> {
  const { data, error } = await admin.from('organizations')
    .select('tipos_produto_habilitados').eq('id', orgId).maybeSingle();
  if (error) throw new Error(`tiposProdutoDaOrg: organizations: ${error.message}`);
  const brutos = (data?.tipos_produto_habilitados ?? []) as string[];
  // Filtra valor desconhecido: um valor gravado por engano nunca deve ligar um caminho novo.
  return TIPOS_PRODUTO_VALIDOS.filter((t) => brutos.includes(t));
}
