import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura, enfileirarVinculacaoCatalogo } from '../_shared/queue.ts';
import { getValidAccessToken } from '../_shared/ml/token.ts';
import { subirFotoML } from '../_shared/ml/fotos.ts';
import { montarPayloadItem, ordenarVariacoesPrincipal } from '../_shared/ml/publicar.ts';
import { pctEfetivo } from '../_shared/preco/desconto.ts';
import { criarItemML, garantirDescricaoML } from '../_shared/ml/criar-item.ts';
import { atributosFaltantes } from '../_shared/categoria/atributos.ts';
import type { TipoAviamento } from '../_shared/categoria/detectar.ts';

interface Job { familia_id: string; lote_id: string; listing_type_id?: string; }

const BUCKET = 'imagens';
const TTL_SIGNED = 60 * 60 * 2; // 2h — ML baixa a foto de forma assíncrona (gap §569)

// Reavalia o status do lote quando o worker some da fila (sucesso ou erro definitivo).
// Sem famílias 'publicando' → 'concluido', ou 'revisao' se ainda restam publicáveis ('pronto').
async function talvezFinalizarLote(admin: ReturnType<typeof adminClient>, loteId: string): Promise<void> {
  const { data: publicando } = await admin.from('familias')
    .select('id').eq('lote_id', loteId).eq('status', 'publicando');
  if (publicando && publicando.length > 0) return;
  const { data: prontas } = await admin.from('familias')
    .select('id').eq('lote_id', loteId).eq('status', 'pronto');
  const novo = prontas && prontas.length > 0 ? 'revisao' : 'concluido';
  await admin.from('lotes').update({ status: novo }).eq('id', loteId);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) {
    return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  }

  let job: Job;
  try {
    job = JSON.parse(body);
  } catch {
    return new Response('Body inválido', { status: 400, headers: corsHeaders });
  }
  const admin = adminClient();

  const { data: familia } = await admin.from('familias').select('*').eq('id', job.familia_id).single();
  if (!familia) return new Response('familia não encontrada', { status: 404, headers: corsHeaders });
  if (familia.ml_item_id) {
    // Já publicado: garante só a descrição (recurso separado pode ter faltado antes).
    if (familia.descricao_ml) {
      try {
        const tk = await getValidAccessToken(familia.user_id);
        await garantirDescricaoML(tk, familia.ml_item_id, familia.descricao_ml);
      } catch (e) {
        console.error(`descrição (retry) falhou para ${familia.ml_item_id}:`, e);
      }
    }
    return new Response(JSON.stringify({ jaPublicado: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    const { data: variacoes } = await admin.from('variacoes')
      .select('*').eq('familia_id', job.familia_id).eq('excluida_da_publicacao', false);
    if (!variacoes || variacoes.length === 0) throw new Error('Sem cores incluídas para publicar');

    let desconto: { pct: number } | null = null;
    if (familia.exibir_com_desconto) {
      const { data: cfg } = await admin.from('configuracoes')
        .select('desconto_pct').eq('user_id', familia.user_id).maybeSingle();
      const global = cfg?.desconto_pct != null ? Number(cfg.desconto_pct) : 15;
      const fam = familia.desconto_pct != null ? Number(familia.desconto_pct) : null;
      desconto = { pct: pctEfetivo(fam, global) };
    }

    const tipoAviamento = (familia.tipo_aviamento ?? 'outro') as TipoAviamento;
    const faltam = atributosFaltantes(tipoAviamento, familia.atributos_ml ?? []);
    if (faltam.length) throw new Error(`Atributos obrigatórios faltando: ${faltam.join(', ')}`);

    const token = await getValidAccessToken(familia.user_id);

    async function signed(path: string): Promise<string> {
      const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, TTL_SIGNED);
      if (error || !data) throw new Error(`Signed URL falhou para ${path}`);
      return data.signedUrl;
    }

    // Capa: reusa o picture_id já subido (idempotente em retries).
    let capaPictureId: string | null = familia.capa_ml_picture_id ?? null;
    if (!capaPictureId && familia.capa_storage_path) {
      capaPictureId = await subirFotoML(token, await signed(familia.capa_storage_path));
      await admin.from('familias').update({ capa_ml_picture_id: capaPictureId }).eq('id', job.familia_id);
    }

    let capa2PictureId: string | null = familia.capa2_ml_picture_id ?? null;
    if (!capa2PictureId && familia.capa2_storage_path) {
      capa2PictureId = await subirFotoML(token, await signed(familia.capa2_storage_path));
      await admin.from('familias').update({ capa2_ml_picture_id: capa2PictureId }).eq('id', job.familia_id);
    }

    let capa3PictureId: string | null = familia.capa3_ml_picture_id ?? null;
    if (!capa3PictureId && familia.capa3_storage_path) {
      capa3PictureId = await subirFotoML(token, await signed(familia.capa3_storage_path));
      await admin.from('familias').update({ capa3_ml_picture_id: capa3PictureId }).eq('id', job.familia_id);
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

    const ordenadas = ordenarVariacoesPrincipal(variacoesComFoto, familia.variacao_principal_codigo ?? null);
    // Dimensões/peso (ADR-0018): da variação representativa (a principal, 1ª ordenada).
    const rep = ordenadas[0];
    const dimensoes = rep ? {
      altura_cm: rep.altura_cm != null ? Number(rep.altura_cm) : null,
      largura_cm: rep.largura_cm != null ? Number(rep.largura_cm) : null,
      comprimento_cm: rep.comprimento_cm != null ? Number(rep.comprimento_cm) : null,
      peso_gramas: rep.peso_gramas != null ? Number(rep.peso_gramas) : null,
    } : null;
    const payload = montarPayloadItem(
      { titulo_ml: familia.titulo_ml, descricao_ml: familia.descricao_ml, categoria_ml_id: familia.categoria_ml_id, atributos_ml: familia.atributos_ml ?? [] },
      ordenadas.map((v) => ({ codigo: v.codigo, cor: v.cor, estoque: v.estoque, preco_publicacao: v.preco_publicacao, gtin: v.gtin, ml_picture_id: v.ml_picture_id })),
      capaPictureId,
      capa2PictureId,
      capa3PictureId,
      job.listing_type_id,
      desconto,
      dimensoes,
    );

    const resultado = await criarItemML(token, payload);

    const { error: upErr } = await admin.from('familias').update({
      ml_item_id: resultado.id,
      ml_permalink: resultado.permalink,
      status: 'publicado',
      publicado_em: new Date().toISOString(),
    }).eq('id', job.familia_id);
    if (upErr) {
      // O anúncio JÁ existe no ML mas não persistiu — evita re-publicação silenciosa no retry.
      console.error(`CRÍTICO: item ${resultado.id} criado no ML mas falhou ao persistir: ${upErr.message}`);
    }

    // Descrição: recurso separado no ML. Falha aqui não derruba o anúncio (já criado);
    // um retry posterior a completa via o ramo de item já publicado.
    if (familia.descricao_ml) {
      try {
        await garantirDescricaoML(token, resultado.id, familia.descricao_ml);
      } catch (e) {
        console.error(`descrição falhou para ${resultado.id}:`, e);
      }
    }

    // Casa ml_variation_id por seller_custom_field; fallback por índice se o ML não ecoar e as contagens baterem.
    const casaPorIndice = resultado.variations.length === variacoesComFoto.length;
    for (let i = 0; i < resultado.variations.length; i++) {
      const mv = resultado.variations[i];
      const codigo = mv.seller_custom_field ?? (casaPorIndice ? variacoesComFoto[i].codigo : undefined);
      if (codigo) {
        await admin.from('variacoes').update({ ml_variation_id: String(mv.id) })
          .eq('familia_id', job.familia_id).eq('codigo', codigo);
      }
    }

    // Catálogo (ADR-0021): o opt-in roda DEFERIDO. A elegibilidade de catálogo do ML só fica
    // pronta minutos após o POST /items, então rodar síncrono aqui marcaria tudo como não
    // elegível. Enfileira o job com delay/retry; best-effort (falha ao enfileirar não derruba
    // o anúncio já criado).
    try {
      await enfileirarVinculacaoCatalogo(job.familia_id);
    } catch (e) {
      console.error(`enfileirar catálogo falhou para ${resultado.id}:`, e);
    }

    await talvezFinalizarLote(admin, job.lote_id);
    return new Response(JSON.stringify({ ml_item_id: resultado.id }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = (err as { status?: number }).status;
    // Erro de foto que o ML pede para reenviar é transiente (timing de processamento
    // assíncrono de imagem). Retenta via QStash enquanto restar tentativa; ao esgotar
    // (retries=3 do enfileirarPublicacao) cai no fluxo definitivo e marca 'erro'.
    const retentavelFoto =
      (err as { retentavel?: boolean }).retentavel === true &&
      Number(req.headers.get('Upstash-Retried') ?? '0') < 3;
    // 5xx/429: transitório — mantém 'publicando' e relança para o QStash retentar.
    if ((status && status >= 500) || retentavelFoto) {
      return new Response(msg, { status: 500, headers: corsHeaders });
    }
    // 4xx ou erro local: definitivo — persiste erro e reavalia o lote.
    await admin.from('familias').update({ status: 'erro', erro_mensagem: msg }).eq('id', job.familia_id);
    await talvezFinalizarLote(admin, job.lote_id);
    return new Response(JSON.stringify({ erro: msg }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
