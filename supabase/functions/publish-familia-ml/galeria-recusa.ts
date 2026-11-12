// ADR-0204 item 4: o ML recusou uma foto do CREATE que levou a galeria da base do kit vinculado. Rebaixa para só a capa:
// zera `variacoes.galeria_ml_fotos` da família e avisa. NUNCA limpa o cache da capa (`limparCacheFotosFamilia`): a culpada
// é a galeria, e apagar o picture_id da capa obrigaria a re-subir sem motivo. Nunca lança.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { erroDeFoto } from '../_shared/kit-variacao/galeria-criar.ts';
import { MAX_RETRIES_TRANSIENTES } from '../_shared/publicacao/retry.ts';
import { notificarCategoria } from '../_shared/notificacoes/config.ts';

/** O erro chega em dois formatos (Legacy: `ErroCanal` com `raw.mlCauses`; UP: exceção crua com `mlCauses`).
 *  `retentavel` = `item.pictures.unavailable` nativo (foto ainda propagando), nunca 5xx. */
export type ErroFoto = { status: number | undefined; mlCauses: unknown; retentavel: boolean };

/** true = galeria zerada, vale tentar de novo sem ela. Age só se a galeria foi usada e o erro é recusa definitiva de foto
 *  (`erroDeFoto`) ou `unavailable` com as tentativas do QStash esgotadas. */
export async function rebaixarGaleriaSeRecusada(p: {
  admin: SupabaseClient; orgId: string; familiaId: string; codigo: string; galeriaUsada: boolean; tentativas: number;
  erro: ErroFoto; notificar?: typeof notificarCategoria;
}): Promise<boolean> {
  if (!p.galeriaUsada) return false;
  const esgotado = p.erro.retentavel && p.tentativas >= MAX_RETRIES_TRANSIENTES;
  if (!esgotado && !erroDeFoto(p.erro.status ?? 0, { cause: p.erro.mlCauses })) return false;
  try {
    // Array, nunca a string '[]' (jsonb viraria string).
    const { error } = await p.admin.from('variacoes').update({ galeria_ml_fotos: [] })
      .eq('org_id', p.orgId).eq('familia_id', p.familiaId);
    if (error) throw new Error(error.message);
  } catch (e) { console.warn('kit_galeria_zerar_falhou', String(e)); }
  try {
    await (p.notificar ?? notificarCategoria)(p.admin, p.orgId, 'estoque',
      `Kit ${p.codigo}: o Mercado Livre recusou uma foto da galeria das peças ao criar o anúncio. `
      + 'A galeria foi desligada para esse anúncio e a próxima tentativa sai só com a capa.',
      { chave: `kit_galeria:${p.codigo}:recusada` });
  } catch (e) { console.warn('kit_galeria_avisar_falhou', String(e)); }
  return true;
}
