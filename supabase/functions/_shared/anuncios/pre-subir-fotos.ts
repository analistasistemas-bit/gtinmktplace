import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { ChannelConnector, ContextoCanal } from '../canais/contrato.ts';

const BUCKET = 'imagens';
const TTL_SIGNED = 60 * 60 * 2; // 2h — o ML baixa a foto de forma assíncrona (mesmo TTL do montar-canonico)

interface FotoPendente {
  picId: string | null;
  path: string | null;
  tabela: 'familias' | 'variacoes';
  coluna: 'capa_ml_picture_id' | 'capa2_ml_picture_id' | 'capa3_ml_picture_id' | 'ml_picture_id';
  id: string;
}

/**
 * Pré-sobe ao ML as fotos da família cujo picture_id ainda não foi persistido, ANTES do publish
 * (ADR-0033). O ML leva ~2,5 min (pior caso ~5 min) para tornar uma foto recém-subida via
 * `POST /pictures {source}` utilizável no `POST /items`. Subindo aqui — no process-familia — a
 * propagação corre em paralelo ao restante do processamento e à revisão do operador; no publish o
 * item.create acha o picture_id já propagado e cria o anúncio de primeira, em segundos, em vez de
 * esperar os retries do QStash cobrirem a janela.
 *
 * Idempotente e best-effort: reusa picture_ids já persistidos (mesmas colunas que o montarAnuncioCanonico
 * lê) e engole erro por foto — se um pré-upload falhar, o montarAnuncioCanonico re-sobe no publish
 * como rede de segurança. Retorna quantas fotos foram efetivamente subidas (para log).
 *
 * Invariante de correção: quem TROCA uma foto (upload-imagens-lote/processar.ts, remoções em
 * src/lib/upload-imagens.ts) DEVE zerar o picture_id correspondente — senão reusaríamos o id de uma
 * imagem antiga que o ML já cacheou e publicaríamos a foto errada.
 */
export async function preSubirFotosFamilia(
  admin: SupabaseClient,
  conn: ChannelConnector,
  ctx: ContextoCanal,
  familiaId: string,
): Promise<number> {
  const { data: fam } = await admin.from('familias')
    .select('capa_storage_path, capa_ml_picture_id, capa2_storage_path, capa2_ml_picture_id, capa3_storage_path, capa3_ml_picture_id')
    .eq('id', familiaId).maybeSingle();

  const { data: vars } = await admin.from('variacoes')
    .select('id, imagem_path, ml_picture_id')
    .eq('familia_id', familiaId).eq('excluida_da_publicacao', false);

  const pendentes: FotoPendente[] = [];
  if (fam) {
    pendentes.push(
      { picId: fam.capa_ml_picture_id, path: fam.capa_storage_path, tabela: 'familias', coluna: 'capa_ml_picture_id', id: familiaId },
      { picId: fam.capa2_ml_picture_id, path: fam.capa2_storage_path, tabela: 'familias', coluna: 'capa2_ml_picture_id', id: familiaId },
      { picId: fam.capa3_ml_picture_id, path: fam.capa3_storage_path, tabela: 'familias', coluna: 'capa3_ml_picture_id', id: familiaId },
    );
  }
  for (const v of vars ?? []) {
    pendentes.push({ picId: v.ml_picture_id, path: v.imagem_path, tabela: 'variacoes', coluna: 'ml_picture_id', id: v.id });
  }

  // ponytail: upload sequencial. Uma foto isolada = 1 chamada; famílias multi-cor sobem N em série.
  // Como roda async (fora do caminho do operador) e o montar-canonico fazia o mesmo trabalho no
  // publish, o custo total não muda — só antecipa. Paralelizar (pool) só se virar gargalo real.
  let subiu = 0;
  for (const f of pendentes) {
    if (f.picId || !f.path) continue; // já subida (reuso idempotente) ou sem foto
    try {
      const { data: signed, error } = await admin.storage.from(BUCKET).createSignedUrl(f.path, TTL_SIGNED);
      if (error || !signed?.signedUrl) continue;
      const picId = await conn.subirFoto(ctx, signed.signedUrl);
      await admin.from(f.tabela).update({ [f.coluna]: picId }).eq('id', f.id);
      subiu++;
    } catch (e) {
      console.warn(`pré-upload de foto (${f.coluna}, ${f.id}) falhou: ${(e as Error).message}`);
    }
  }
  return subiu;
}
