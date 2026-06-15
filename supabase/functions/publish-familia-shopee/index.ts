import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { getValidAccessToken, getShopId } from '../_shared/shopee/token.ts';
import { getConnector } from '../_shared/canais/registry.ts';
import type { AnuncioCanonico, ContextoCanal } from '../_shared/canais/contrato.ts';
import { decidirErroCriarAnuncio, mensagemErroFotoRecuperavel } from '../_shared/publicacao/retry.ts';
import {
  montarAnuncioExternoShopee,
  type MetadadosCanalShopee,
} from '../_shared/shopee/anuncio-externo.ts';

// Worker dedicado de publicação Shopee (Fatia 1: 1 variação simples).
// Espelha publish-familia-ml, MAS o estado vive em anuncios_externos (ADR-0025),
// não em colunas ml_* de familias/variacoes. O caminho ML é inalterado.
//
// Reuso de copy: `titulo_ml`/`descricao_ml` são o TEXTO do produto; o sufixo
// `_ml` é legado (eram colunas nascidas no contexto ML). A Shopee reusa o mesmo
// texto canônico — não há cópia "por canal" na Fatia 1.

interface Job { familia_id: string; lote_id: string; }

const BUCKET = 'imagens';
const TTL_SIGNED = 60 * 60 * 2; // 2h

// Reavalia o status do lote quando o worker some da fila (sucesso ou erro definitivo).
async function talvezFinalizarLote(admin: ReturnType<typeof adminClient>, loteId: string): Promise<void> {
  const { data: publicando } = await admin.from('familias')
    .select('id').eq('lote_id', loteId).eq('status', 'publicando');
  if (publicando && publicando.length > 0) return;
  const { data: prontas } = await admin.from('familias')
    .select('id').eq('lote_id', loteId).eq('status', 'pronto');
  const novo = prontas && prontas.length > 0 ? 'revisao' : 'concluido';
  await admin.from('lotes').update({ status: novo }).eq('id', loteId);
}

// Lê a row Shopee atual (cache de fotos + metadados) para idempotência de retry.
async function lerRowShopee(
  admin: ReturnType<typeof adminClient>,
  userId: string,
  codigoPai: string,
): Promise<{ item_externo_id: string | null; metadados_canal: MetadadosCanalShopee } | null> {
  const { data } = await admin.from('anuncios_externos')
    .select('item_externo_id, metadados_canal')
    .eq('user_id', userId).eq('canal', 'shopee').eq('codigo_pai', codigoPai)
    .maybeSingle();
  return (data as { item_externo_id: string | null; metadados_canal: MetadadosCanalShopee } | null) ?? null;
}

async function upsertRowShopee(
  admin: ReturnType<typeof adminClient>,
  row: ReturnType<typeof montarAnuncioExternoShopee>,
): Promise<void> {
  const { error } = await admin.from('anuncios_externos')
    .upsert(row, { onConflict: 'user_id,canal,codigo_pai' });
  if (error) console.error('upsert anuncios_externos (shopee) falhou:', error.message);
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

  const userId = familia.user_id as string;
  const codigoPai = familia.codigo_pai as string;

  // shop_id vem da credencial Shopee (canal shop-scoped). Sem credencial → erro definitivo.
  let shopId: string;
  try {
    shopId = await getShopId(userId);
  } catch (e) {
    const msg = `Conta Shopee não conectada: ${(e as Error).message}`;
    await admin.from('familias').update({ status: 'erro', erro_mensagem: msg }).eq('id', job.familia_id);
    await talvezFinalizarLote(admin, job.lote_id);
    return new Response(JSON.stringify({ erro: msg }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const conn = getConnector('shopee');
  const ctx: ContextoCanal = { getToken: () => getValidAccessToken(userId), shopId };

  // Já publicado nesta loja? (idempotência: a row Shopee é a fonte de verdade do canal.)
  const rowAtual = await lerRowShopee(admin, userId, codigoPai);
  if (rowAtual?.item_externo_id) {
    // Descrição já embutida no add_item (capability descricaoSeparada:false) → nada a completar.
    return new Response(JSON.stringify({ jaPublicado: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Cache de fotos do retry anterior (idempotência). metadados também carrega categoria_id.
  const metadados: MetadadosCanalShopee = { ...(rowAtual?.metadados_canal ?? {}), shop_id: shopId };

  try {
    const { data: variacoes } = await admin.from('variacoes')
      .select('*').eq('familia_id', job.familia_id).eq('excluida_da_publicacao', false);
    if (!variacoes || variacoes.length === 0) throw new Error('Sem cores incluídas para publicar');

    // Categoria Shopee (manual, Fatia 1): operador define em metadados_canal.categoria_id.
    // TODO Fatia 4: categoria/atributos por IA na taxonomia Shopee.
    const categoriaId = metadados.categoria_id;
    if (categoriaId == null || categoriaId === '') {
      throw new Error('Categoria Shopee não definida (defina metadados_canal.categoria_id antes de publicar)');
    }

    // Upsert cedo (status 'publicando') para ancorar o cache de fotos do retry.
    metadados.fotos = metadados.fotos ?? {};
    await upsertRowShopee(admin, montarAnuncioExternoShopee({
      user_id: userId, codigo_pai: codigoPai, status: 'publicando', metadados,
    }));

    async function signed(path: string): Promise<string> {
      const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, TTL_SIGNED);
      if (error || !data) throw new Error(`Signed URL falhou para ${path}`);
      return data.signedUrl;
    }

    // Sobe fotos faltantes; cacheia image_id em metadados.fotos (idempotente no retry).
    async function subirSeFaltar(chave: string, storagePath: string | null): Promise<string | null> {
      if (!storagePath) return null;
      const cacheado = metadados.fotos![chave];
      if (cacheado) return cacheado;
      const imageId = await conn.subirFoto(ctx, await signed(storagePath));
      metadados.fotos![chave] = imageId;
      await upsertRowShopee(admin, montarAnuncioExternoShopee({
        user_id: userId, codigo_pai: codigoPai, status: 'publicando', metadados,
      }));
      return imageId;
    }

    const capaFotoId = await subirSeFaltar('capa', familia.capa_storage_path ?? null);
    const capa2FotoId = await subirSeFaltar('capa2', familia.capa2_storage_path ?? null);
    const capa3FotoId = await subirSeFaltar('capa3', familia.capa3_storage_path ?? null);

    // Fatia 1: 1 variação. TODO Fatia 2: tier_variation/model para N variações.
    const v = variacoes[0];
    const fotoVarId = await subirSeFaltar(v.codigo, v.imagem_path ?? null);

    const dimensoes = {
      altura_cm: v.altura_cm != null ? Number(v.altura_cm) : null,
      largura_cm: v.largura_cm != null ? Number(v.largura_cm) : null,
      comprimento_cm: v.comprimento_cm != null ? Number(v.comprimento_cm) : null,
      peso_gramas: v.peso_gramas != null ? Number(v.peso_gramas) : null,
    };

    const anuncio: AnuncioCanonico = {
      titulo: familia.titulo_ml,        // copy canônica (sufixo _ml é legado)
      descricao: familia.descricao_ml,  // copy canônica (sufixo _ml é legado)
      categoriaId: String(categoriaId),
      atributos: [],                    // TODO Fatia 4: atributos por categoria Shopee.
      capaFotoId,
      capa2FotoId,
      capa3FotoId,
      desconto: null,                   // TODO Fatia 3: desconto/promoção Shopee.
      dimensoes,
      variacoes: [{
        sku: v.codigo, cor: v.cor, estoque: v.estoque,
        preco: v.preco_publicacao, gtin: v.gtin, fotoId: fotoVarId,
      }],
    };

    const res = await conn.criarAnuncio(ctx, anuncio);
    if (!res.ok) {
      const e = res.erro!;
      const tentativas = Number(req.headers.get('Upstash-Retried') ?? '0');
      if (decidirErroCriarAnuncio(e, tentativas) === 'retentar') {
        // Mantém 'publicando' + cache de fotos; QStash retenta (500).
        return new Response(e.mensagemOperador, { status: 500, headers: corsHeaders });
      }
      const msg = e.codigo === 'FOTO' ? mensagemErroFotoRecuperavel(e.mensagemOperador) : e.mensagemOperador;
      await upsertRowShopee(admin, montarAnuncioExternoShopee({
        user_id: userId, codigo_pai: codigoPai, status: 'erro', erroMensagem: msg, metadados,
      }));
      await admin.from('familias').update({ status: 'erro', erro_mensagem: msg }).eq('id', job.familia_id);
      await talvezFinalizarLote(admin, job.lote_id);
      return new Response(JSON.stringify({ erro: msg }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const ref = res.valor!;
    const agora = new Date().toISOString();
    await upsertRowShopee(admin, montarAnuncioExternoShopee({
      user_id: userId, codigo_pai: codigoPai, status: 'publicado',
      itemExternoId: ref.itemExternoId, permalink: ref.permalink ?? null,
      variacoesExternas: ref.variacoesExternas, metadados, publicadoEm: agora,
    }));
    await admin.from('familias').update({
      status: 'publicado', publicado_em: agora,
    }).eq('id', job.familia_id);

    await talvezFinalizarLote(admin, job.lote_id);
    return new Response(JSON.stringify({ shopee_item_id: ref.itemExternoId }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = (err as { status?: number }).status;
    const tentativas = Number(req.headers.get('Upstash-Retried') ?? '0');
    // 5xx: transitório — mantém 'publicando' e relança para o QStash retentar.
    if (status && status >= 500 && tentativas < 3) {
      return new Response(msg, { status: 500, headers: corsHeaders });
    }
    // Definitivo: persiste erro na row Shopee e na família, reavalia o lote.
    await upsertRowShopee(admin, montarAnuncioExternoShopee({
      user_id: userId, codigo_pai: codigoPai, status: 'erro', erroMensagem: msg, metadados,
    }));
    await admin.from('familias').update({ status: 'erro', erro_mensagem: msg }).eq('id', job.familia_id);
    await talvezFinalizarLote(admin, job.lote_id);
    return new Response(JSON.stringify({ erro: msg }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
