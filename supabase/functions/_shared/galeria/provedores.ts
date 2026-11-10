import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

import { MODELO_GALERIA_PADRAO, modeloGaleria, type ModeloGaleria } from './modelos.ts';

export { MODELOS_GALERIA, MODELO_GALERIA_PADRAO, modeloGaleria, type ModeloGaleria } from './modelos.ts';

/** configuracoes.ai_model_galeria (coluna criada na Task 5); nulo, desconhecido, erro ou modelo Higgsfield sem campo
 * de referência ou de proporção confirmado na saída → padrão. */
export async function resolverModeloGaleria(admin: SupabaseClient, orgId: string): Promise<ModeloGaleria> {
  try {
    const { data } = await admin
      .from('configuracoes')
      .select('ai_model_galeria')
      .eq('org_id', orgId)
      .maybeSingle()
    const modelo = modeloGaleria(data?.ai_model_galeria)
    return modelo.provedor === 'higgsfield' && (!modelo.campoReferencia || !modelo.campoProporcao) ? MODELO_GALERIA_PADRAO : modelo
  } catch {
    return MODELO_GALERIA_PADRAO
  }
}

/** Corpo do POST da Higgsfield: só campos medidos. Referências além do máximo são cortadas; modelo sem campo de
 * referência medido lança se receber referência. */
export function corpoHF(modelo: ModeloGaleria, prompt: string, imageUrls: string[]): Record<string, unknown> {
  const corpo: Record<string, unknown> = { prompt, ...modelo.extra }
  if (imageUrls.length > 0) {
    if (!modelo.campoReferencia) throw new Error(`${modelo.slug}: campo de referência não medido`)
    corpo[modelo.campoReferencia] = imageUrls.slice(0, modelo.maxReferencias)
  }
  if (modelo.campoProporcao) corpo[modelo.campoProporcao] = '3:4'
  return corpo
}
