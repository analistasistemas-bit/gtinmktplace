import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura, enfileirarVinculacaoCatalogo } from '../_shared/queue.ts';
import { getValidAccessToken } from '../_shared/ml/token.ts';
import { ordenarVariacoesPrincipal } from '../_shared/ml/publicar.ts';
import { pctEfetivo } from '../_shared/preco/desconto.ts';
import type { FaixaAtacado } from '../_shared/ml/atacado.ts';
import { atributosFaltantes, categoriaParaTipo } from '../_shared/categoria/atributos.ts';
import type { TipoAviamento } from '../_shared/categoria/detectar.ts';
import { getConnector } from '../_shared/canais/registry.ts';
import type { AnuncioCanonico } from '../_shared/canais/contrato.ts';
import { espelharAnuncioExterno } from '../_shared/anuncios/espelhar.ts';
import { decidirErroCriarAnuncio, mensagemErroFotoRecuperavel } from '../_shared/publicacao/retry.ts';

interface Job { familia_id: string; lote_id: string; listing_type_id?: string; }

const BUCKET = 'imagens';
const TTL_SIGNED = 60 * 60 * 2; // 2h — ML baixa a foto de forma assíncrona (gap §569)

// Foto recém-enviada fica alguns segundos "em processamento" no ML; criar o item nesse
// intervalo devolve item.pictures.unavailable ("envie a foto novamente") — um 400 transitório
// que some assim que a foto processa. Em vez de devolver 500 e esperar o backoff longo do
// QStash (minutos em 'publicando'), re-tentamos o POST /items na mesma execução.
const FOTO_RETRY_TENTATIVAS = 3;
const FOTO_RETRY_INTERVALO_MS = 4000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  const ctx = { getToken: () => getValidAccessToken(familia.user_id) };

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

    let desconto: { pct: number } | null = null;
    if (familia.exibir_com_desconto) {
      const { data: cfg } = await admin.from('configuracoes')
        .select('desconto_pct').eq('user_id', familia.user_id).maybeSingle();
      const global = cfg?.desconto_pct != null ? Number(cfg.desconto_pct) : 15;
      const fam = familia.desconto_pct != null ? Number(familia.desconto_pct) : null;
      desconto = { pct: pctEfetivo(fam, global) };
    }

    // Gate de atributos obrigatórios. Aviamento conhecido (override) → validador por-tipo (atual);
    // categoria prevista/manual → lista genérica persistida (E3/E4, schema da API); sem categoria → bloqueia.
    const tipoAviamento = (familia.tipo_aviamento ?? 'outro') as TipoAviamento;
    const faltam = categoriaParaTipo(tipoAviamento) != null
      ? atributosFaltantes(tipoAviamento, familia.atributos_ml ?? [])
      : (familia.categoria_ml_id ? ((familia.atributos_faltantes as string[] | null) ?? []) : ['CATEGORIA']);
    if (faltam.length) throw new Error(`Atributos obrigatórios faltando: ${faltam.join(', ')}`);

    const signed = async (path: string): Promise<string> => {
      const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, TTL_SIGNED);
      if (error || !data) throw new Error(`Signed URL falhou para ${path}`);
      return data.signedUrl;
    };

    // Capa: reusa o picture_id já subido (idempotente em retries).
    let capaPictureId: string | null = familia.capa_ml_picture_id ?? null;
    if (!capaPictureId && familia.capa_storage_path) {
      capaPictureId = await conn.subirFoto(ctx, await signed(familia.capa_storage_path));
      await admin.from('familias').update({ capa_ml_picture_id: capaPictureId }).eq('id', job.familia_id);
    }

    let capa2PictureId: string | null = familia.capa2_ml_picture_id ?? null;
    if (!capa2PictureId && familia.capa2_storage_path) {
      capa2PictureId = await conn.subirFoto(ctx, await signed(familia.capa2_storage_path));
      await admin.from('familias').update({ capa2_ml_picture_id: capa2PictureId }).eq('id', job.familia_id);
    }

    let capa3PictureId: string | null = familia.capa3_ml_picture_id ?? null;
    if (!capa3PictureId && familia.capa3_storage_path) {
      capa3PictureId = await conn.subirFoto(ctx, await signed(familia.capa3_storage_path));
      await admin.from('familias').update({ capa3_ml_picture_id: capa3PictureId }).eq('id', job.familia_id);
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

    const anuncio: AnuncioCanonico = {
      titulo: familia.titulo_ml,
      descricao: familia.descricao_ml,
      categoriaId: familia.categoria_ml_id,
      atributos: familia.atributos_ml ?? [],
      capaFotoId: capaPictureId,
      capa2FotoId: capa2PictureId,
      capa3FotoId: capa3PictureId,
      listingTypeId: job.listing_type_id,
      desconto,
      dimensoes,
      variacoes: ordenadas.map((v) => ({
        sku: v.codigo, cor: v.cor, estoque: v.estoque,
        preco: v.preco_publicacao, gtin: v.gtin, fotoId: v.ml_picture_id,
      })),
    };

    let res = await conn.criarAnuncio(ctx, anuncio);
    // Retry interno para a foto ainda em processamento no ML: espera curta e re-tenta na
    // mesma execução, reusando os picture_ids já enviados (não limpa cache aqui). Resolve em
    // segundos; se esgotar, cai no tratamento abaixo (rede de segurança do QStash).
    for (let i = 0; i < FOTO_RETRY_TENTATIVAS && !res.ok && res.erro!.codigo === 'FOTO'; i++) {
      await sleep(FOTO_RETRY_INTERVALO_MS);
      res = await conn.criarAnuncio(ctx, anuncio);
    }
    if (!res.ok) {
      const e = res.erro!;
      const tentativas = Number(req.headers.get('Upstash-Retried') ?? '0');
      // Erro de foto é transiente (a foto recém-enviada ainda processa no ML). NÃO limpamos
      // o cache de picture_ids: re-subir a mesma imagem só reinicia o processamento e nunca
      // assenta. Reusar o mesmo picture_id no retry deixa o ML terminar e o item publica.
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
    for (const [codigo, variationId] of Object.entries(ref.variacoesExternas)) {
      await admin.from('variacoes').update({ ml_variation_id: variationId })
        .eq('familia_id', job.familia_id).eq('codigo', codigo);
    }

    // Atacado (PxQ B2B): recurso separado pós-criação. Best-effort — não derruba o anúncio.
    try {
      const faixasAtacado = Array.isArray(familia.atacado) ? (familia.atacado as FaixaAtacado[]) : [];
      if (faixasAtacado.length > 0) {
        // Base do PxQ = preço da família (cores incluídas compartilham o mesmo preço; o
        // primeiro não-nulo == o menor, alinhado ao preview do front). ADR-0041.
        const baseRaw = ordenadas.find((v) => v.preco_publicacao != null)?.preco_publicacao;
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
    const status = (err as { status?: number }).status;
    // Erro de foto que o ML pede para reenviar é transiente (a foto ainda processa). Retenta
    // via QStash reusando o MESMO picture_id (sem re-subir) enquanto restar tentativa; ao
    // esgotar, marca erro visível com mensagem recuperável.
    const retentavelFoto = (err as { retentavel?: boolean }).retentavel === true;
    const tentativas = Number(req.headers.get('Upstash-Retried') ?? '0');
    if (retentavelFoto && tentativas < 3) {
      return new Response(msg, { status: 500, headers: corsHeaders });
    }
    // 5xx/429: transitório — mantém 'publicando' e relança para o QStash retentar.
    if (status && status >= 500) {
      return new Response(msg, { status: 500, headers: corsHeaders });
    }
    // 4xx ou erro local: definitivo — persiste erro e reavalia o lote.
    await admin.from('familias').update({
      status: 'erro',
      erro_mensagem: retentavelFoto ? mensagemErroFotoRecuperavel(msg) : msg,
    }).eq('id', job.familia_id);
    await talvezFinalizarLote(admin, job.lote_id);
    return new Response(JSON.stringify({ erro: msg }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
