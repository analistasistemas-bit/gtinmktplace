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
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { ordenarVariacoesPrincipal } from '../_shared/ml/publicar.ts';
import { pctEfetivo } from '../_shared/preco/desconto.ts';
import { atributosFaltantes, categoriaParaTipo } from '../_shared/categoria/atributos.ts';
import type { TipoAviamento } from '../_shared/categoria/detectar.ts';
import { getConnector } from '../_shared/canais/registry.ts';
import type { AnuncioCanonico, ContextoCanal } from '../_shared/canais/contrato.ts';
import { espelharAnuncioExterno } from '../_shared/anuncios/espelhar.ts';
import { montarAncoragem } from '../_shared/split/ancoragem.ts';
import { particionarPorPreco } from '../_shared/split/particionar.ts';
import { gerarTituloParticao } from '../_shared/split/titulo-particao.ts';
import { decidirRetryTransitorio, mensagemErroFotoRecuperavel } from '../_shared/publicacao/retry.ts';
import { resolverModeloTexto } from '../_shared/ai/modelos.ts';
import { precoAConfirmar } from '../_shared/preco/preco-confirmado.ts';
import { precosDivergentes, precoCentavos } from '../_shared/preco/grupos.ts';
import { resolverConfigGrupo, agregarAtacadoStatus } from '../_shared/preco/config-grupo.ts';

interface Job { familia_id: string; lote_id: string; listing_type_id?: string; somenteEstoque?: boolean; }

const BUCKET = 'imagens';
const TTL_SIGNED = 60 * 60 * 2; // 2h — ML baixa a foto de forma assíncrona.

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

// Cria o anúncio da partição. Em falha, lança Error com status + retentavel → o catch externo
// retenta via QStash (foto ainda propagando: item.pictures.unavailable, reusando o picture_id;
// o retryDelay cobre a propagação de minutos, ADR-0033) ou marca erro definitivo.
async function criarAnuncioParticao(conn: Conn, ctx: ContextoCanal, anuncio: AnuncioCanonico) {
  const res = await conn.criarAnuncio(ctx, anuncio);
  if (!res.ok) {
    const e = res.erro!;
    const err = new Error(e.mensagemOperador) as Error & { status?: number; retentavel?: boolean };
    err.status = e.status;
    err.retentavel = e.retentavel;
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
  const conexao = await resolverConexao(admin, familia.org_id, 'mercado_livre');
  const modeloTexto = await resolverModeloTexto(admin, familia.org_id as string);
  const ctx: ContextoCanal = {
    getToken: () => conexao
      ? getValidAccessTokenConexao(conexao)
      : Promise.reject(new Error('Organização sem conexão com o Mercado Livre')),
  };

  try {
    const { data: variacoes } = await admin.from('variacoes')
      .select('*').eq('familia_id', job.familia_id).eq('excluida_da_publicacao', false);
    if (!variacoes || variacoes.length === 0) {
      const err = new Error('Sem cores incluídas para publicar') as Error & { status?: number };
      err.status = 400;
      throw err;
    }

    // Gate de atributos obrigatórios (igual ao publish): vale para todas as partições.
    const tipoAviamento = (familia.tipo_aviamento ?? 'outro') as TipoAviamento;
    const faltam = categoriaParaTipo(tipoAviamento) != null
      ? atributosFaltantes(tipoAviamento, familia.atributos_ml ?? [])
      : (familia.categoria_ml_id ? ((familia.atributos_faltantes as string[] | null) ?? []) : ['CATEGORIA']);
    if (faltam.length) {
      const err = new Error(`Atributos obrigatórios faltando: ${faltam.join(', ')}`) as Error & { status?: number };
      err.status = 400;
      throw err;
    }

    // ADR-0078 F2: o % global vale para QUALQUER grupo com desconto (a família pode estar
    // desligada e um grupo ligado). Busca única, barata.
    const { data: cfgGlobal } = await admin.from('configuracoes')
      .select('desconto_pct').eq('user_id', familia.user_id).maybeSingle();
    const descontoPctGlobal = cfgGlobal?.desconto_pct != null ? Number(cfgGlobal.desconto_pct) : 15;

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

    // Ancoragem (partições já no ar) + particionamento por PREÇO (ADR-0078 F2).
    const { data: linhas } = await admin.from('anuncios_externos')
      .select('particao, item_externo_id, permalink, titulo, variacoes_externas, atacado_status')
      .eq('org_id', familia.org_id).eq('canal', 'mercado_livre').eq('codigo_pai', familia.codigo_pai);
    const ancoragem = montarAncoragem(linhas ?? []);
    const divergente = precosDivergentes(variacoesComFoto);

    // Faixa VIVA por partição: preco_publicado_ml das ancoradas; faltando, GET ao vivo
    // (lerStatus) — nunca inferência local ambígua (spec ADR-0078, "Particionamento").
    const faixaVivaPorParticao = new Map<number, number>();
    for (const l of linhas ?? []) {
      const skus = new Set(Object.keys((l.variacoes_externas as Record<string, unknown>) ?? {}));
      const viva = variacoesComFoto.find((v) => skus.has(v.codigo) && v.preco_publicado_ml != null);
      const cent = viva ? precoCentavos(viva.preco_publicado_ml) : null;
      if (cent != null) faixaVivaPorParticao.set(l.particao, cent);
    }
    if (job.somenteEstoque) {
      const semFaixa = (linhas ?? []).filter((l) => l.item_externo_id && !faixaVivaPorParticao.has(l.particao));
      if (semFaixa.length > 0) {
        const status = await conn.lerStatus(ctx, semFaixa.map((l) => l.item_externo_id as string));
        for (const l of semFaixa) {
          const preco = status[l.item_externo_id as string]?.preco;
          const cent = precoCentavos(preco ?? null);
          if (cent != null) faixaVivaPorParticao.set(l.particao, cent);
        }
      }
    }

    const particionamento = particionarPorPreco({
      cores: variacoesComFoto.map((v) => ({
        sku: v.codigo, cor: v.cor, precoCentavos: precoCentavos(v.preco_publicacao),
      })),
      ancoragem,
      faixaVivaPorParticao,
      somenteEstoque: !!job.somenteEstoque,
    });
    // Invariante #4: cruzar faixa / anúncio ficaria divergente → LOUD, nada é enviado. O
    // operador decide na Revisão (repreçar uniforme, "somente estoque", ou remover+republicar).
    if (particionamento.conflitos.length > 0) {
      const err = new Error(
        `Preços exigem dividir/migrar anúncio publicado — decida na Revisão (nada foi enviado): ` +
        `${particionamento.conflitos.join('; ')} (400)`,
      ) as Error & { status?: number };
      err.status = 400;
      throw err;
    }
    const mapaParticao = particionamento.mapa;

    const grupos = new Map<number, typeof variacoesComFoto>();
    for (const v of variacoesComFoto) {
      const p = mapaParticao.get(v.codigo) ?? 0;
      (grupos.get(p) ?? grupos.set(p, []).get(p)!).push(v);
    }
    const linhaPorParticao = new Map<number, NonNullable<typeof linhas>[number]>();
    for (const l of linhas ?? []) linhaPorParticao.set(l.particao, l);

    const marca = (familia.fornecedor as string | null)?.trim() || null;

    // Status de atacado por partição (agregado vai a familias no fim). Em "somente estoque"
    // o PxQ vivo é preservado (F1) — nada é registrado nem sobrescrito.
    const atacadoPorParticao: Array<{ status: 'aplicado' | 'erro' | null; erro: string | null }> = [];

    const dimensoesDe = (rep: typeof variacoesComFoto[number] | undefined) => rep ? {
      altura_cm: rep.altura_cm != null ? Number(rep.altura_cm) : null,
      largura_cm: rep.largura_cm != null ? Number(rep.largura_cm) : null,
      comprimento_cm: rep.comprimento_cm != null ? Number(rep.comprimento_cm) : null,
      peso_gramas: rep.peso_gramas != null ? Number(rep.peso_gramas) : null,
    } : null;

    for (const p of [...grupos.keys()].sort((a, b) => a - b)) {
      const coresP = grupos.get(p)!;
      const linhaP = linhaPorParticao.get(p);
      const precoGrupoCent = particionamento.precoPorParticao.get(p) ?? null;
      // Preço único do anúncio desta partição. null (só em UPDATE sem preço novo) = preserva o vivo.
      const precoGrupo = precoGrupoCent != null ? precoGrupoCent / 100 : null;
      // Config financeira POR GRUPO (invariante #2: LOUD se herdaria config ativa em divergência).
      const cfgGrupo = resolverConfigGrupo(familia, coresP, divergente);
      const pctGrupo = cfgGrupo.exibirComDesconto
        ? pctEfetivo(cfgGrupo.descontoPct, descontoPctGlobal)
        : null;
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
            modelo: modeloTexto,
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
          desconto: pctGrupo != null ? { pct: pctGrupo } : null,
          dimensoes: dimensoesDe(ordenadas[0]),
          variacoes: ordenadas.map((v) => ({
            sku: v.codigo, cor: v.cor, estoque: v.estoque,
            preco: v.preco_publicacao ?? precoGrupo, gtin: v.gtin, fotoId: v.ml_picture_id,
          })),
        };
        const ref = await criarAnuncioParticao(conn, ctx, anuncio);
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

        // ADR-0078 F1: no CREATE não há "só estoque" — grava o preço enviado por SKU
        // (preco_publicacao, base do badge "preço alterado"), espelhando o publish normal.
        const precoEnviadoPorSku = new Map(anuncio.variacoes.map((v) => [v.sku, v.preco]));
        for (const [codigo, variationId] of Object.entries(ref.variacoesExternas)) {
          const precoSku = precoEnviadoPorSku.get(codigo);
          const patch: { ml_variation_id: string; preco_publicado_ml?: number } = { ml_variation_id: variationId };
          if (precoSku != null) patch.preco_publicado_ml = Number(precoSku);
          await admin.from('variacoes').update(patch)
            .eq('familia_id', job.familia_id).eq('codigo', codigo);
        }
        if (familia.descricao_ml) {
          try { await conn.garantirDescricao(ctx, ref.itemExternoId, familia.descricao_ml); }
          catch (e) { console.error(`descrição falhou para ${ref.itemExternoId}:`, e); }
        }
        // Atacado (PxQ) POR PARTIÇÃO (ADR-0078 F2 — o split nunca aplicava). Base = preço do
        // grupo. Best-effort: falha não derruba o anúncio já criado; vira atacado_status='erro'.
        if (cfgGrupo.faixasAtacado.length > 0 && precoGrupo != null) {
          try {
            await conn.aplicarAtacado(ctx, itemIdP!, precoGrupo, cfgGrupo.faixasAtacado);
            atacadoPorParticao.push({ status: 'aplicado', erro: null });
            await admin.from('anuncios_externos')
              .update({ atacado_status: 'aplicado', atacado_erro: null })
              .eq('org_id', familia.org_id).eq('canal', 'mercado_livre')
              .eq('codigo_pai', familia.codigo_pai).eq('particao', p);
          } catch (e) {
            const m = e instanceof Error ? e.message : String(e);
            console.error(`atacado (split CREATE) falhou na partição ${p}:`, m);
            atacadoPorParticao.push({ status: 'erro', erro: m });
            await admin.from('anuncios_externos')
              .update({ atacado_status: 'erro', atacado_erro: m })
              .eq('org_id', familia.org_id).eq('canal', 'mercado_livre')
              .eq('codigo_pai', familia.codigo_pai).eq('particao', p);
          }
        } else {
          atacadoPorParticao.push({ status: null, erro: null });
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
        const desconto = pctGrupo != null ? {
          pct: pctGrupo,
          precoPorCodigo: Object.fromEntries(coresP.map((v) =>
            [v.codigo, v.preco_publicacao != null ? Number(v.preco_publicacao) : null])),
        } : null;
        const res = await conn.atualizarAnuncio(ctx, {
          itemExternoId,
          existentes: casadas.map((v) => ({ sku: v.codigo, estoque: v.estoque, cor: v.cor })),
          novas: novas.map((v) => ({
            sku: v.codigo, cor: v.cor, estoque: v.estoque,
            preco: v.preco_publicacao ?? precoGrupo, gtin: v.gtin, fotoId: v.ml_picture_id,
          })),
          capaFotoId: capaPictureId,
          capa2FotoId: capa2PictureId,
          capa3FotoId: capa3PictureId,
          categoriaId: familia.categoria_ml_id,
          marca,
          dimensoes: dimensoesDe(repUpd),
          desconto,
          precoFamilia: precoGrupo,
          // ADR-0078 F1: mesmo conector do update normal — o flag suprime desconto/precoFamilia.
          // Sem isso, família >100 cores publicaria preço mesmo com "somente estoque" marcado.
          somenteEstoque: job.somenteEstoque,
        });
        if (!res.ok) {
          const e = res.erro!;
          const err = new Error(e.mensagemOperador) as Error & { status?: number; retentavel?: boolean };
          err.status = e.status;
          err.retentavel = e.retentavel;
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
          const err = new Error(`ML não vinculou as cores novas ${novasSemVinculo.map((v) => v.codigo).join(', ')} na partição ${p} — confira no ML antes de republicar para não duplicar (400)`) as Error & { status?: number };
          err.status = 400;
          throw err;
        }
        // ADR-0078 F1: grava o preço confirmado por SKU desta partição (base do badge "preço
        // alterado"). Sem isso, família que migra ≤100→>100 fica com badge permanente. Em "só
        // estoque" confirma o preço vivo desta partição; chaveia pelos SKUs confirmados no ML.
        const confirmado = precoAConfirmar({
          somenteEstoque: !!job.somenteEstoque,
          precoVivo: res.valor!.precoVivo ?? null,
          precoEnviado: precoGrupo,
        });
        if (confirmado != null) {
          await admin.from('variacoes')
            .update({ preco_publicado_ml: confirmado })
            .eq('familia_id', job.familia_id)
            .in('codigo', Object.keys(res.valor!.variacoesExternas));
        }
        // Atacado (PxQ) por partição no UPDATE: com faixas → reaplica na base do grupo; sem
        // faixas mas já 'aplicado' nesta partição → limpa. Em "somente estoque" NÃO mexe (F1).
        if (!job.somenteEstoque) {
          const jaAplicado = linhaP?.atacado_status === 'aplicado';
          if (cfgGrupo.faixasAtacado.length > 0 || jaAplicado) {
            if (precoGrupo == null) {
              const m = 'Atacado sem preço-base: partição sem preço novo nem preço vivo conhecido';
              atacadoPorParticao.push({ status: 'erro', erro: m });
              await admin.from('anuncios_externos')
                .update({ atacado_status: 'erro', atacado_erro: m })
                .eq('org_id', familia.org_id).eq('canal', 'mercado_livre')
                .eq('codigo_pai', familia.codigo_pai).eq('particao', p);
            } else {
              try {
                await conn.aplicarAtacado(ctx, itemExternoId, precoGrupo, cfgGrupo.faixasAtacado);
                const st = cfgGrupo.faixasAtacado.length > 0 ? 'aplicado' as const : null;
                atacadoPorParticao.push({ status: st, erro: null });
                await admin.from('anuncios_externos')
                  .update({ atacado_status: st, atacado_erro: null })
                  .eq('org_id', familia.org_id).eq('canal', 'mercado_livre')
                  .eq('codigo_pai', familia.codigo_pai).eq('particao', p);
              } catch (e) {
                const m = e instanceof Error ? e.message : String(e);
                console.error(`atacado (split UPDATE) falhou na partição ${p}:`, m);
                atacadoPorParticao.push({ status: 'erro', erro: m });
                await admin.from('anuncios_externos')
                  .update({ atacado_status: 'erro', atacado_erro: m })
                  .eq('org_id', familia.org_id).eq('canal', 'mercado_livre')
                  .eq('codigo_pai', familia.codigo_pai).eq('particao', p);
              }
            }
          } else {
            atacadoPorParticao.push({ status: null, erro: null });
          }
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

    // Agregado do atacado (familias.atacado_status representa o pior caso entre as partições).
    if (!job.somenteEstoque && atacadoPorParticao.length > 0) {
      const agregado = agregarAtacadoStatus(atacadoPorParticao);
      await admin.from('familias').update(agregado).eq('id', job.familia_id);
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
    const tentativas = Number(req.headers.get('Upstash-Retried') ?? '0');
    const retentavelFoto = (err as { retentavel?: boolean }).retentavel === true;
    // 5xx/429 ou foto ainda propagando (item.pictures.unavailable): reusa o picture_id e retenta
    // via QStash (o retryDelay cobre a propagação de minutos, ADR-0033).
    if (decidirRetryTransitorio(err, tentativas) === 'retentar') {
      return new Response(msg, { status: 500, headers: corsHeaders });
    }
    // Esgotou os retries ou erro definitivo: persiste erro e reavalia o lote.
    await admin.from('familias').update({
      status: 'erro',
      erro_mensagem: retentavelFoto ? mensagemErroFotoRecuperavel(msg) : msg,
    }).eq('id', job.familia_id);
    await talvezFinalizarLote(admin, job.lote_id);
    return new Response(JSON.stringify({ erro: msg }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
