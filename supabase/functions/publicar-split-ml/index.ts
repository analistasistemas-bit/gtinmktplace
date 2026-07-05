// Worker QStash do SPLIT (ADR-0048): publica um produto que excede 100 cores em N anúncios ML
// ("partições"). Isolado de publish-familia-ml/update-familia-ml — o caminho dos produtos normais
// (≤100 cores) NÃO passa por aqui (o roteamento só manda >100 cores pra este worker).
//
// Cada partição é uma linha de anuncios_externos (fonte de verdade): item_externo_id + titulo +
// mapa variacoes_externas. A ancoragem (sku → partição) vem desse mapa e nunca migra uma cor de
// anúncio entre updates. O cap de 99.999 de estoque é aplicado pelo conector ML (criar/atualizar).
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura, enfileirarVinculacaoCatalogo } from '../_shared/queue.ts';
import { getValidAccessToken } from '../_shared/ml/token.ts';
import { ordenarVariacoesPrincipal } from '../_shared/ml/publicar.ts';
import { pctEfetivo } from '../_shared/preco/desconto.ts';
import { atributosFaltantes, categoriaParaTipo } from '../_shared/categoria/atributos.ts';
import type { TipoAviamento } from '../_shared/categoria/detectar.ts';
import { getConnector } from '../_shared/canais/registry.ts';
import type { AnuncioCanonico, ContextoCanal } from '../_shared/canais/contrato.ts';
import { espelharAnuncioExterno } from '../_shared/anuncios/espelhar.ts';
import { montarAncoragem } from '../_shared/split/ancoragem.ts';
import { particionar } from '../_shared/split/particionar.ts';
import { gerarTituloParticao } from '../_shared/split/titulo-particao.ts';

interface Job { familia_id: string; lote_id: string; listing_type_id?: string; }

const BUCKET = 'imagens';
const TTL_SIGNED = 60 * 60 * 2; // 2h — ML baixa a foto de forma assíncrona.

// Foto recém-enviada fica alguns segundos "em processamento" no ML; criar o item nesse intervalo
// devolve item.pictures.unavailable. Re-tenta o POST /items na mesma execução (igual ao publish).
const FOTO_RETRY_TENTATIVAS = 3;
const FOTO_RETRY_INTERVALO_MS = 4000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Idêntico ao publish/update: reavalia o status do lote quando o worker some da fila.
async function talvezFinalizarLote(admin: ReturnType<typeof adminClient>, loteId: string): Promise<void> {
  const { data: publicando } = await admin.from('familias')
    .select('id').eq('lote_id', loteId).eq('status', 'publicando');
  if (publicando && publicando.length > 0) return;
  const { data: prontas } = await admin.from('familias')
    .select('id').eq('lote_id', loteId).eq('status', 'pronto');
  const novo = prontas && prontas.length > 0 ? 'revisao' : 'concluido';
  await admin.from('lotes').update({ status: novo }).eq('id', loteId);
}

type Conn = ReturnType<typeof getConnector>;

// Cria o anúncio retentando o erro transitório de foto (foto ainda processando no ML). Em falha
// definitiva, lança Error com o status HTTP nativo → o catch externo decide retry (5xx) ou erro.
async function criarComRetryFoto(conn: Conn, ctx: ContextoCanal, anuncio: AnuncioCanonico) {
  let res = await conn.criarAnuncio(ctx, anuncio);
  for (let i = 0; i < FOTO_RETRY_TENTATIVAS && !res.ok && res.erro!.codigo === 'FOTO'; i++) {
    await sleep(FOTO_RETRY_INTERVALO_MS);
    res = await conn.criarAnuncio(ctx, anuncio);
  }
  if (!res.ok) {
    const e = res.erro!;
    const err = new Error(e.mensagemOperador) as Error & { status?: number };
    err.status = e.status;
    throw err;
  }
  return res.valor!;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) {
    return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  }

  let job: Job;
  try { job = JSON.parse(body); }
  catch { return new Response('Body inválido', { status: 400, headers: corsHeaders }); }

  const admin = adminClient();
  const { data: familia } = await admin.from('familias').select('*').eq('id', job.familia_id).single();
  if (!familia) return new Response('familia não encontrada', { status: 404, headers: corsHeaders });

  // Idempotência: só processa o claim ativo ('publicando'). Re-entrega do QStash após o lote já
  // ter sido finalizado é ignorada sem reprocessar (mesma regra do update-familia-ml).
  if (familia.status !== 'publicando') {
    return new Response(JSON.stringify({ skip: true, status: familia.status }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const conn = getConnector('mercado_livre');
  const ctx: ContextoCanal = { getToken: () => getValidAccessToken(familia.user_id) };

  try {
    const { data: variacoes } = await admin.from('variacoes')
      .select('*').eq('familia_id', job.familia_id).eq('excluida_da_publicacao', false);
    if (!variacoes || variacoes.length === 0) throw new Error('Sem cores incluídas para publicar');

    // Gate de atributos obrigatórios (igual ao publish): vale para todas as partições.
    const tipoAviamento = (familia.tipo_aviamento ?? 'outro') as TipoAviamento;
    const faltam = categoriaParaTipo(tipoAviamento) != null
      ? atributosFaltantes(tipoAviamento, familia.atributos_ml ?? [])
      : (familia.categoria_ml_id ? ((familia.atributos_faltantes as string[] | null) ?? []) : ['CATEGORIA']);
    if (faltam.length) throw new Error(`Atributos obrigatórios faltando: ${faltam.join(', ')}`);

    let descontoPct: number | null = null;
    if (familia.exibir_com_desconto) {
      const { data: cfg } = await admin.from('configuracoes')
        .select('desconto_pct').eq('user_id', familia.user_id).maybeSingle();
      const global = cfg?.desconto_pct != null ? Number(cfg.desconto_pct) : 15;
      const fam = familia.desconto_pct != null ? Number(familia.desconto_pct) : null;
      descontoPct = pctEfetivo(fam, global);
    }

    const signed = async (path: string): Promise<string> => {
      const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, TTL_SIGNED);
      if (error || !data) throw new Error(`Signed URL falhou para ${path}`);
      return data.signedUrl;
    };

    // Capas comuns: reusa o picture_id já subido (idempotente em retries).
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

    // Foto de cada variação (idempotente via ml_picture_id).
    const variacoesComFoto: Array<typeof variacoes[number] & { ml_picture_id: string | null }> = [];
    for (const v of variacoes) {
      let picId = v.ml_picture_id as string | null;
      if (!picId && v.imagem_path) {
        picId = await conn.subirFoto(ctx, await signed(v.imagem_path));
        await admin.from('variacoes').update({ ml_picture_id: picId }).eq('id', v.id);
      }
      variacoesComFoto.push({ ...v, ml_picture_id: picId });
    }

    // Ancoragem (partições já no ar) + particionamento das cores incluídas.
    const { data: linhas } = await admin.from('anuncios_externos')
      .select('particao, item_externo_id, permalink, titulo, variacoes_externas')
      .eq('org_id', familia.org_id).eq('canal', 'mercado_livre').eq('codigo_pai', familia.codigo_pai);
    const ancoragem = montarAncoragem(linhas ?? []);
    const mapaParticao = particionar(
      variacoesComFoto.map((v) => ({ sku: v.codigo, cor: v.cor })),
      ancoragem,
    );

    const grupos = new Map<number, typeof variacoesComFoto>();
    for (const v of variacoesComFoto) {
      const p = mapaParticao.get(v.codigo) ?? 0;
      (grupos.get(p) ?? grupos.set(p, []).get(p)!).push(v);
    }
    const linhaPorParticao = new Map<number, NonNullable<typeof linhas>[number]>();
    for (const l of linhas ?? []) linhaPorParticao.set(l.particao, l);

    const marca = (familia.fornecedor as string | null)?.trim() || null;
    const precoFamiliaRaw = variacoesComFoto.find((v) => v.preco_publicacao != null)?.preco_publicacao;
    const precoFamilia = precoFamiliaRaw != null ? Number(precoFamiliaRaw) : null;

    const dimensoesDe = (rep: typeof variacoesComFoto[number] | undefined) => rep ? {
      altura_cm: rep.altura_cm != null ? Number(rep.altura_cm) : null,
      largura_cm: rep.largura_cm != null ? Number(rep.largura_cm) : null,
      comprimento_cm: rep.comprimento_cm != null ? Number(rep.comprimento_cm) : null,
      peso_gramas: rep.peso_gramas != null ? Number(rep.peso_gramas) : null,
    } : null;

    for (const p of [...grupos.keys()].sort((a, b) => a - b)) {
      const coresP = grupos.get(p)!;
      const linhaP = linhaPorParticao.get(p);
      // Partição 0 herda o ml_item_id já publicado da família quando um produto que era de 1
      // anúncio passa a split (anuncios_externos pode não ter a linha ainda) — evita recriar e
      // abandonar o anúncio existente.
      const itemExternoId = linhaP?.item_externo_id ?? (p === 0 ? (familia.ml_item_id as string | null) : null);

      const tituloP = p === 0
        ? familia.titulo_ml
        : (linhaP?.titulo ?? await gerarTituloParticao({
            nome: familia.nome_pai,
            descricao_detalhado: familia.descricao_pai ?? '',
            unidade: (familia.unidade as string | null) ?? null,
            cores: coresP.map((v) => ({ codigo: v.codigo, cor: v.cor, preco: Number(v.preco_publicacao ?? 0) })),
            tituloBase: familia.titulo_ml ?? familia.nome_pai,
            particao: p,
          }));

      let itemIdP = itemExternoId;
      let permalinkP = linhaP?.permalink ?? null;

      if (!itemExternoId) {
        // CREATE da partição.
        const ordenadas = ordenarVariacoesPrincipal(coresP, familia.variacao_principal_codigo ?? null);
        const anuncio: AnuncioCanonico = {
          titulo: tituloP,
          descricao: familia.descricao_ml,
          categoriaId: familia.categoria_ml_id,
          atributos: familia.atributos_ml ?? [],
          capaFotoId: capaPictureId,
          capa2FotoId: capa2PictureId,
          capa3FotoId: capa3PictureId,
          listingTypeId: job.listing_type_id,
          desconto: descontoPct != null ? { pct: descontoPct } : null,
          dimensoes: dimensoesDe(ordenadas[0]),
          variacoes: ordenadas.map((v) => ({
            sku: v.codigo, cor: v.cor, estoque: v.estoque,
            preco: v.preco_publicacao, gtin: v.gtin, fotoId: v.ml_picture_id,
          })),
        };
        const ref = await criarComRetryFoto(conn, ctx, anuncio);
        itemIdP = ref.itemExternoId;
        permalinkP = ref.permalink ?? null;

        // Crava o item da partição + seus SKUs em anuncios_externos ANTES de casar no banco
        // local: se algo falhar no meio, o retry do QStash vê o item (e a ancoragem dos SKUs) e
        // entra no ramo UPDATE — não recria o anúncio (sem duplicar) nem move a cor de partição.
        const varsRef = Object.entries(ref.variacoesExternas).map(([codigo, vid]) => ({
          codigo, ml_variation_id: vid,
          catalog_product_id: null, catalog_listing_id: null, catalog_status: null,
        }));
        await espelharAnuncioExterno(admin, {
          user_id: familia.user_id, org_id: familia.org_id, codigo_pai: familia.codigo_pai,
          ml_item_id: itemIdP, ml_permalink: permalinkP, publicado_em: new Date().toISOString(),
        }, varsRef, { particao: p, titulo: tituloP });

        for (const [codigo, variationId] of Object.entries(ref.variacoesExternas)) {
          await admin.from('variacoes').update({ ml_variation_id: variationId })
            .eq('familia_id', job.familia_id).eq('codigo', codigo);
        }
        if (familia.descricao_ml) {
          try { await conn.garantirDescricao(ctx, ref.itemExternoId, familia.descricao_ml); }
          catch (e) { console.error(`descrição falhou para ${ref.itemExternoId}:`, e); }
        }
        if (p === 0) {
          await admin.from('familias').update({
            ml_item_id: ref.itemExternoId, ml_permalink: ref.permalink ?? null,
          }).eq('id', job.familia_id);
        }
      } else {
        // UPDATE da partição já no ar: repõe estoque das casadas + cria as cores novas.
        const casadas = coresP.filter((v) => v.ml_variation_id);
        const novas = coresP.filter((v) => !v.ml_variation_id);
        const repUpd = coresP.find((v) => v.codigo === familia.variacao_principal_codigo) ?? coresP[0];
        const desconto = descontoPct != null ? {
          pct: descontoPct,
          precoPorCodigo: Object.fromEntries(coresP.map((v) =>
            [v.codigo, v.preco_publicacao != null ? Number(v.preco_publicacao) : null])),
        } : null;
        const res = await conn.atualizarAnuncio(ctx, {
          itemExternoId,
          existentes: casadas.map((v) => ({ sku: v.codigo, estoque: v.estoque })),
          novas: novas.map((v) => ({
            sku: v.codigo, cor: v.cor, estoque: v.estoque,
            preco: v.preco_publicacao, gtin: v.gtin, fotoId: v.ml_picture_id,
          })),
          capaFotoId: capaPictureId,
          capa2FotoId: capa2PictureId,
          capa3FotoId: capa3PictureId,
          categoriaId: familia.categoria_ml_id,
          marca,
          dimensoes: dimensoesDe(repUpd),
          desconto,
          precoFamilia,
        });
        if (!res.ok) {
          const e = res.erro!;
          const err = new Error(e.mensagemOperador) as Error & { status?: number };
          err.status = e.status;
          throw err;
        }
        const persistidas = new Set<string>();
        for (const [codigo, variationId] of Object.entries(res.valor!.variacoesExternas)) {
          if (novas.some((v) => v.codigo === codigo)) {
            await admin.from('variacoes').update({ ml_variation_id: variationId })
              .eq('familia_id', job.familia_id).eq('codigo', codigo);
            persistidas.add(codigo);
          }
        }
        const novasSemVinculo = novas.filter((v) => !persistidas.has(v.codigo));
        if (novasSemVinculo.length > 0) {
          throw new Error(`ML não vinculou as cores novas ${novasSemVinculo.map((v) => v.codigo).join(', ')} na partição ${p} — confira no ML antes de republicar para não duplicar (400)`);
        }
      }

      // Espelha a partição em anuncios_externos (fonte de verdade da ancoragem).
      const { data: varsEspelho } = await admin.from('variacoes')
        .select('codigo, ml_variation_id, catalog_product_id, catalog_listing_id, catalog_status')
        .eq('familia_id', job.familia_id).in('codigo', coresP.map((v) => v.codigo));
      await espelharAnuncioExterno(admin, {
        user_id: familia.user_id,
        org_id: familia.org_id,
        codigo_pai: familia.codigo_pai,
        ml_item_id: itemIdP,
        ml_permalink: permalinkP,
        publicado_em: new Date().toISOString(),
      }, varsEspelho ?? [], { particao: p, titulo: tituloP });
    }

    // Catálogo (ADR-0021): best-effort, deferido. TODO(ADR-0048): vincular-catalogo lê só
    // familias.ml_item_id (partição 0); o opt-in por-partição (itera por item_externo_id) é
    // follow-up. Por ora cobre a partição 0; não bloqueia o restante.
    try {
      await enfileirarVinculacaoCatalogo(job.familia_id);
    } catch (e) {
      console.error(`enfileirar catálogo (split) falhou para familia ${job.familia_id}:`, e);
    }

    await admin.from('familias').update({
      status: 'publicado', publicado_em: new Date().toISOString(),
    }).eq('id', job.familia_id);
    await talvezFinalizarLote(admin, job.lote_id);
    return new Response(JSON.stringify({ ok: true, particoes: grupos.size }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = (err as { status?: number }).status;
    // 5xx/429: transitório — mantém 'publicando' e relança para o QStash retentar.
    if (status && (status >= 500 || status === 429)) {
      return new Response(msg, { status: 500, headers: corsHeaders });
    }
    // 4xx ou erro local: definitivo — persiste erro e reavalia o lote.
    await admin.from('familias').update({ status: 'erro', erro_mensagem: msg }).eq('id', job.familia_id);
    await talvezFinalizarLote(admin, job.lote_id);
    return new Response(JSON.stringify({ erro: msg }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
