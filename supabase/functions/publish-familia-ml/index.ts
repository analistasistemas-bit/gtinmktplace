import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { getValidAccessToken } from '../_shared/ml/token.ts';
import { subirFotoML } from '../_shared/ml/fotos.ts';
import { montarPayloadItem } from '../_shared/ml/publicar.ts';
import { criarItemML } from '../_shared/ml/criar-item.ts';
import { atributosFaltantes } from '../_shared/categoria/atributos.ts';
import type { TipoAviamento } from '../_shared/categoria/detectar.ts';

interface Job { familia_id: string; lote_id: string; }

const BUCKET = 'imagens';
const TTL_SIGNED = 60 * 60 * 2; // 2h — ML baixa a foto de forma assíncrona (gap §569)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) {
    return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  }
  const job: Job = JSON.parse(body);
  const admin = adminClient();

  const { data: familia } = await admin.from('familias').select('*').eq('id', job.familia_id).single();
  if (!familia) return new Response('familia não encontrada', { status: 404, headers: corsHeaders });
  if (familia.ml_item_id) {
    return new Response(JSON.stringify({ jaPublicado: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    const { data: variacoes } = await admin.from('variacoes')
      .select('*').eq('familia_id', job.familia_id).eq('excluida_da_publicacao', false);
    if (!variacoes || variacoes.length === 0) throw new Error('Sem cores incluídas para publicar');

    const tipoAviamento = (familia.tipo_aviamento ?? 'outro') as TipoAviamento;
    const faltam = atributosFaltantes(tipoAviamento, familia.atributos_ml ?? []);
    if (faltam.length) throw new Error(`Atributos obrigatórios faltando: ${faltam.join(', ')}`);

    const token = await getValidAccessToken(familia.user_id);

    async function signed(path: string): Promise<string> {
      const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, TTL_SIGNED);
      if (error || !data) throw new Error(`Signed URL falhou para ${path}`);
      return data.signedUrl;
    }

    let capaPictureId: string | null = null;
    if (familia.capa_storage_path) {
      capaPictureId = await subirFotoML(token, await signed(familia.capa_storage_path));
    }
    const variacoesComFoto = [];
    for (const v of variacoes) {
      let picId = v.ml_picture_id as string | null;
      if (!picId && v.imagem_path) {
        picId = await subirFotoML(token, await signed(v.imagem_path));
        await admin.from('variacoes').update({ ml_picture_id: picId }).eq('id', v.id);
      }
      variacoesComFoto.push({ ...v, ml_picture_id: picId });
    }

    const payload = montarPayloadItem(
      { titulo_ml: familia.titulo_ml, descricao_ml: familia.descricao_ml, categoria_ml_id: familia.categoria_ml_id, atributos_ml: familia.atributos_ml ?? [] },
      variacoesComFoto.map((v) => ({ codigo: v.codigo, cor: v.cor, estoque: v.estoque, preco_publicacao: v.preco_publicacao, gtin: v.gtin, ml_picture_id: v.ml_picture_id })),
      capaPictureId,
    );

    const resultado = await criarItemML(token, payload);

    await admin.from('familias').update({
      ml_item_id: resultado.id,
      ml_permalink: resultado.permalink,
      status: 'publicado',
      publicado_em: new Date().toISOString(),
    }).eq('id', job.familia_id);

    for (const mv of resultado.variations) {
      if (mv.seller_custom_field) {
        await admin.from('variacoes').update({ ml_variation_id: String(mv.id) })
          .eq('familia_id', job.familia_id).eq('codigo', mv.seller_custom_field);
      }
    }

    return new Response(JSON.stringify({ ml_item_id: resultado.id }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = (err as { status?: number }).status;
    await admin.from('familias').update({ status: 'erro', erro_mensagem: msg }).eq('id', job.familia_id);
    if (status && status >= 500) return new Response(msg, { status: 500, headers: corsHeaders });
    return new Response(JSON.stringify({ erro: msg }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
