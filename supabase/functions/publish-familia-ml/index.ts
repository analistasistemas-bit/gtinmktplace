import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura, enfileirarVinculacaoCatalogo } from '../_shared/queue.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import type { FaixaAtacado } from '../_shared/ml/atacado.ts';
import { atributosFaltantes, categoriaParaTipo } from '../_shared/categoria/atributos.ts';
import type { TipoAviamento } from '../_shared/categoria/detectar.ts';
import { getConnector } from '../_shared/canais/registry.ts';
import { espelharAnuncioExterno } from '../_shared/anuncios/espelhar.ts';
import { montarAnuncioCanonico } from '../_shared/anuncios/montar-canonico.ts';
import { garantirPrecoUniforme } from '../_shared/preco/grupos.ts';
import { decidirErroCriarAnuncio, mensagemErroFotoRecuperavel, decidirRetryTransitorio } from '../_shared/publicacao/retry.ts';

interface Job { familia_id: string; lote_id: string; listing_type_id?: string; }

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

  const conn = getConnector('mercado_livre');
  const conexao = await resolverConexao(admin, familia.org_id, 'mercado_livre');
  const ctx = {
    getToken: () => conexao
      ? getValidAccessTokenConexao(conexao)
      : Promise.reject(new Error('Organização sem conexão com o Mercado Livre')),
  };

  if (familia.ml_item_id) {
    // Já publicado: garante só a descrição (recurso separado pode ter faltado antes).
    if (familia.descricao_ml) {
      try {
        await conn.garantirDescricao(ctx, familia.ml_item_id, familia.descricao_ml);
      } catch (e) {
        console.error(`descrição (retry) falhou para ${familia.ml_item_id}:`, e);
      }
    }
    // Atacado (PxQ): garante a aplicação se há faixas e ainda não aplicado (retry/idempotência).
    try {
      const faixasJa = Array.isArray(familia.atacado) ? (familia.atacado as FaixaAtacado[]) : [];
      if (faixasJa.length > 0 && familia.atacado_status !== 'aplicado') {
        const { data: vs } = await admin.from('variacoes')
          .select('preco_publicacao').eq('familia_id', job.familia_id).eq('excluida_da_publicacao', false);
        const baseRaw = vs?.find((v) => v.preco_publicacao != null)?.preco_publicacao;
        const base = baseRaw != null ? Number(baseRaw) : null;
        if (base != null) {
          try {
            await conn.aplicarAtacado(ctx, familia.ml_item_id, base, faixasJa);
            await admin.from('familias').update({ atacado_status: 'aplicado', atacado_erro: null }).eq('id', job.familia_id);
          } catch (e) {
            const m = e instanceof Error ? e.message : String(e);
            console.error(`atacado (retry) falhou para ${familia.ml_item_id}:`, m);
            await admin.from('familias').update({ atacado_status: 'erro', atacado_erro: m }).eq('id', job.familia_id);
          }
        } else {
          console.warn('atacado (retry): sem preco_publicacao nas variacoes para familia', job.familia_id);
        }
      }
    } catch (e) {
      console.error('atacado (bloco retry) falhou inesperadamente:', e instanceof Error ? e.message : String(e));
    }
    return new Response(JSON.stringify({ jaPublicado: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    const { data: variacoes } = await admin.from('variacoes')
      .select('*').eq('familia_id', job.familia_id).eq('excluida_da_publicacao', false);
    if (!variacoes || variacoes.length === 0) throw new Error('Sem cores incluídas para publicar');

    // ADR-0078 F2 (invariante #1): este worker publica preço único. Divergência aqui = bug de
    // roteamento (deveria ter ido ao split) → LOUD, nada é enviado ao ML.
    garantirPrecoUniforme(variacoes, 'CREATE');

    // Gate de atributos obrigatórios. Aviamento conhecido (override) → validador por-tipo (atual);
    // categoria prevista/manual → lista genérica persistida (E3/E4, schema da API); sem categoria → bloqueia.
    const tipoAviamento = (familia.tipo_aviamento ?? 'outro') as TipoAviamento;
    const faltam = categoriaParaTipo(tipoAviamento) != null
      ? atributosFaltantes(tipoAviamento, familia.atributos_ml ?? [])
      : (familia.categoria_ml_id ? ((familia.atributos_faltantes as string[] | null) ?? []) : ['CATEGORIA']);
    if (faltam.length) throw new Error(`Atributos obrigatórios faltando: ${faltam.join(', ')}`);

    const anuncio = await montarAnuncioCanonico(admin, conn, ctx, familia, variacoes, job.listing_type_id);

    const res = await conn.criarAnuncio(ctx, anuncio);
    if (!res.ok) {
      const e = res.erro!;
      const tentativas = Number(req.headers.get('Upstash-Retried') ?? '0');
      // item.pictures.unavailable: a foto recém-subida ainda propaga no ML (~2,5 min, medido no
      // lote #31 — ACTIVE em ~2s, mas utilizável no POST /items só em ~142s). NÃO re-subimos nem
      // limpamos o picture_id (re-subir reinicia o relógio de propagação); reusamos o mesmo id e
      // retentamos via QStash, cujo retryDelay (queue.ts) cobre a janela. Só marca 'erro' visível
      // quando esgotam os retries.
      if (decidirErroCriarAnuncio(e, tentativas) === 'retentar') {
        return new Response(e.mensagemOperador, { status: 500, headers: corsHeaders });
      }
      const msg = e.codigo === 'FOTO' ? mensagemErroFotoRecuperavel(e.mensagemOperador) : e.mensagemOperador;
      await admin.from('familias').update({ status: 'erro', erro_mensagem: msg }).eq('id', job.familia_id);
      await talvezFinalizarLote(admin, job.lote_id);
      return new Response(JSON.stringify({ erro: msg }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const ref = res.valor!;

    const { error: upErr } = await admin.from('familias').update({
      ml_item_id: ref.itemExternoId,
      ml_permalink: ref.permalink,
      status: 'publicado',
      publicado_em: new Date().toISOString(),
    }).eq('id', job.familia_id);
    if (upErr) {
      // O anúncio JÁ existe no ML mas não persistiu — evita re-publicação silenciosa no retry.
      console.error(`CRÍTICO: item ${ref.itemExternoId} criado no ML mas falhou ao persistir: ${upErr.message}`);
    }

    // Descrição: recurso separado no ML. Falha aqui não derruba o anúncio (já criado);
    // um retry posterior a completa via o ramo de item já publicado.
    if (familia.descricao_ml) {
      try {
        await conn.garantirDescricao(ctx, ref.itemExternoId, familia.descricao_ml);
      } catch (e) {
        console.error(`descrição falhou para ${ref.itemExternoId}:`, e);
      }
    }

    // Casa ml_variation_id por codigo (sku) via variacoesExternas do conector.
    // ADR-0078 F1: grava também preco_publicado_ml = preço enviado da variação (base do badge
    // "preço alterado"). No CREATE não há "só estoque": é o próprio preço publicado (preco_publicacao,
    // mesma base do precoFamilia do update — não o descontado).
    const precoEnviadoPorSku = new Map(anuncio.variacoes.map((v) => [v.sku, v.preco]));
    for (const [codigo, variationId] of Object.entries(ref.variacoesExternas)) {
      const precoSku = precoEnviadoPorSku.get(codigo);
      const patch: { ml_variation_id: string; preco_publicado_ml?: number } = { ml_variation_id: variationId };
      if (precoSku != null) patch.preco_publicado_ml = Number(precoSku);
      await admin.from('variacoes').update(patch)
        .eq('familia_id', job.familia_id).eq('codigo', codigo);
    }

    // Atacado (PxQ B2B): recurso separado pós-criação. Best-effort — não derruba o anúncio.
    try {
      const faixasAtacado = Array.isArray(familia.atacado) ? (familia.atacado as FaixaAtacado[]) : [];
      if (faixasAtacado.length > 0) {
        // Base do PxQ = preço da família (cores incluídas compartilham o mesmo preço; o
        // primeiro não-nulo == o menor, alinhado ao preview do front). ADR-0041.
        const baseRaw = anuncio.variacoes.find((v) => v.preco != null)?.preco;
        const base = baseRaw != null ? Number(baseRaw) : null;
        if (base != null) {
          try {
            await conn.aplicarAtacado(ctx, ref.itemExternoId, base, faixasAtacado);
            await admin.from('familias').update({ atacado_status: 'aplicado', atacado_erro: null }).eq('id', job.familia_id);
          } catch (e) {
            const m = e instanceof Error ? e.message : String(e);
            console.error(`atacado falhou para ${ref.itemExternoId}:`, m);
            await admin.from('familias').update({ atacado_status: 'erro', atacado_erro: m }).eq('id', job.familia_id);
          }
        }
      }
    } catch (e) {
      console.error('atacado (bloco criacao) falhou inesperadamente:', e instanceof Error ? e.message : String(e));
    }

    // Catálogo (ADR-0021): o opt-in roda DEFERIDO. A elegibilidade de catálogo do ML só fica
    // pronta minutos após o POST /items, então rodar síncrono aqui marcaria tudo como não
    // elegível. Enfileira o job com delay/retry; best-effort (falha ao enfileirar não derruba
    // o anúncio já criado).
    try {
      await enfileirarVinculacaoCatalogo(job.familia_id);
    } catch (e) {
      console.error(`enfileirar catálogo falhou para ${ref.itemExternoId}:`, e);
    }

    // E2 (ADR-0025): espelha o estado em anuncios_externos (best-effort, não derruba a publicação).
    const { data: varsEspelho } = await admin.from('variacoes')
      .select('codigo, ml_variation_id, catalog_product_id, catalog_listing_id, catalog_status')
      .eq('familia_id', job.familia_id);
    await espelharAnuncioExterno(admin, {
      user_id: familia.user_id,
      org_id: familia.org_id,
      codigo_pai: familia.codigo_pai,
      ml_item_id: ref.itemExternoId,
      ml_permalink: ref.permalink ?? null,
      publicado_em: new Date().toISOString(),
    }, varsEspelho ?? []);

    await talvezFinalizarLote(admin, job.lote_id);
    return new Response(JSON.stringify({ ml_item_id: ref.itemExternoId }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const retentavelFoto = (err as { retentavel?: boolean }).retentavel === true;
    const tentativas = Number(req.headers.get('Upstash-Retried') ?? '0');
    // Transitório (foto retentável — item.pictures.unavailable ainda propagando —, 5xx, 429 ou
    // status desconhecido) ENQUANTO houver tentativa do QStash: relança 500 reusando o MESMO
    // picture_id (mantém 'publicando'). Ao ESGOTAR as tentativas vira definitivo (senão a mensagem
    // ia pra DLQ e a família ficava presa em 'publicando'). Mesma decisão dos workers irmãos.
    if (decidirRetryTransitorio(err, tentativas) === 'retentar') {
      return new Response(msg, { status: 500, headers: corsHeaders });
    }
    // Definitivo (4xx, erro local, ou transitório após esgotar os retries): persiste erro e reavalia o lote.
    await admin.from('familias').update({
      status: 'erro',
      erro_mensagem: retentavelFoto ? mensagemErroFotoRecuperavel(msg) : msg,
    }).eq('id', job.familia_id);
    await talvezFinalizarLote(admin, job.lote_id);
    return new Response(JSON.stringify({ erro: msg }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
