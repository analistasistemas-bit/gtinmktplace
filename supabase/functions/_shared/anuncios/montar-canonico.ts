// E6 (ADR-0061 / Task 5): builder compartilhado do AnuncioCanonico. Extração pura do bloco
// que vivia inline em publish-familia-ml (fotos idempotentes, atributos/dimensões/desconto,
// variações) — nenhuma linha de lógica muda, só o endereço. O worker ML e o worker genérico
// `publicar-anuncio` (Task 6) compartilham esta função.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { AnuncioCanonico, AtributoItem, ChannelConnector, ContextoCanal } from '../canais/contrato.ts';
import { ordenarVariacoesPrincipal } from '../ml/publicar.ts';
import { pctEfetivo } from '../preco/desconto.ts';

const BUCKET = 'imagens';
const TTL_SIGNED = 60 * 60 * 2; // 2h — o canal baixa a foto de forma assíncrona (gap §569)

export interface FamiliaParaMontar {
  id: string;
  user_id: string;
  org_id: string;
  titulo_ml: string | null;
  descricao_ml: string | null;
  categoria_ml_id: string | null;
  atributos_ml: AtributoItem[] | null;
  capa_storage_path: string | null;
  capa_ml_picture_id: string | null;
  capa2_storage_path: string | null;
  capa2_ml_picture_id: string | null;
  capa3_storage_path: string | null;
  capa3_ml_picture_id: string | null;
  variacao_principal_codigo: string | null;
  exibir_com_desconto: boolean | null;
  desconto_pct: number | string | null;
}

export interface VariacaoParaMontar {
  id: string;
  codigo: string;
  cor: string | null;
  estoque: number;
  preco_publicacao: number | string | null;
  gtin: string | null;
  imagem_path: string | null;
  ml_picture_id: string | null;
  altura_cm: number | string | null;
  largura_cm: number | string | null;
  comprimento_cm: number | string | null;
  peso_gramas: number | string | null;
}

/**
 * Monta o AnuncioCanonico (CREATE) a partir da família/variações: sobe fotos idempotentes
 * (reaproveita capa_ml_picture_id/ml_picture_id já persistidos), resolve o desconto efetivo
 * (config do usuário x override da família), calcula dimensões da variação representativa e
 * monta o array de variações canônicas ordenado pela principal.
 * `listingTypeId` era fechado sobre `job.listing_type_id` no publish-familia-ml original —
 * vira parâmetro explícito aqui (única mudança de forma exigida pela extração).
 */
export async function montarAnuncioCanonico(
  admin: SupabaseClient,
  conn: ChannelConnector,
  ctx: ContextoCanal,
  familia: FamiliaParaMontar,
  variacoes: VariacaoParaMontar[],
  listingTypeId?: string,
): Promise<AnuncioCanonico> {
  let desconto: { pct: number } | null = null;
  if (familia.exibir_com_desconto) {
    const { data: cfg } = await admin.from('configuracoes')
      .select('desconto_pct').eq('org_id', familia.org_id).maybeSingle();
    const global = cfg?.desconto_pct != null ? Number(cfg.desconto_pct) : 15;
    const fam = familia.desconto_pct != null ? Number(familia.desconto_pct) : null;
    desconto = { pct: pctEfetivo(fam, global) };
  }

  const signed = async (path: string): Promise<string> => {
    const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, TTL_SIGNED);
    if (error || !data) throw new Error(`Signed URL falhou para ${path}`);
    return data.signedUrl;
  };

  // Capa: reusa o picture_id já subido (idempotente em retries).
  let capaPictureId: string | null = familia.capa_ml_picture_id ?? null;
  if (!capaPictureId && familia.capa_storage_path) {
    capaPictureId = await conn.subirFoto(ctx, await signed(familia.capa_storage_path));
    await admin.from('familias').update({ capa_ml_picture_id: capaPictureId }).eq('id', familia.id);
  }

  let capa2PictureId: string | null = familia.capa2_ml_picture_id ?? null;
  if (!capa2PictureId && familia.capa2_storage_path) {
    capa2PictureId = await conn.subirFoto(ctx, await signed(familia.capa2_storage_path));
    await admin.from('familias').update({ capa2_ml_picture_id: capa2PictureId }).eq('id', familia.id);
  }

  let capa3PictureId: string | null = familia.capa3_ml_picture_id ?? null;
  if (!capa3PictureId && familia.capa3_storage_path) {
    capa3PictureId = await conn.subirFoto(ctx, await signed(familia.capa3_storage_path));
    await admin.from('familias').update({ capa3_ml_picture_id: capa3PictureId }).eq('id', familia.id);
  }

  const variacoesComFoto = [];
  for (const v of variacoes) {
    let picId = v.ml_picture_id as string | null;
    if (!picId && v.imagem_path) {
      picId = await conn.subirFoto(ctx, await signed(v.imagem_path));
      await admin.from('variacoes').update({ ml_picture_id: picId }).eq('id', v.id);
    }
    variacoesComFoto.push({ ...v, ml_picture_id: picId });
  }

  const ordenadas = ordenarVariacoesPrincipal(variacoesComFoto, familia.variacao_principal_codigo ?? null);
  // Dimensões/peso (ADR-0018): da variação representativa (a principal, 1ª ordenada).
  const rep = ordenadas[0];
  const dimensoes = rep ? {
    altura_cm: rep.altura_cm != null ? Number(rep.altura_cm) : null,
    largura_cm: rep.largura_cm != null ? Number(rep.largura_cm) : null,
    comprimento_cm: rep.comprimento_cm != null ? Number(rep.comprimento_cm) : null,
    peso_gramas: rep.peso_gramas != null ? Number(rep.peso_gramas) : null,
  } : null;

  return {
    titulo: familia.titulo_ml,
    descricao: familia.descricao_ml,
    categoriaId: familia.categoria_ml_id,
    atributos: familia.atributos_ml ?? [],
    capaFotoId: capaPictureId,
    capa2FotoId: capa2PictureId,
    capa3FotoId: capa3PictureId,
    listingTypeId,
    desconto,
    dimensoes,
    variacoes: ordenadas.map((v) => ({
      sku: v.codigo, cor: v.cor, estoque: v.estoque,
      preco: v.preco_publicacao as number | null, gtin: v.gtin, fotoId: v.ml_picture_id,
    })),
  };
}
