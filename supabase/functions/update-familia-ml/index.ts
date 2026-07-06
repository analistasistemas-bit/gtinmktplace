import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura, enfileirarVinculacaoCatalogo } from '../_shared/queue.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getConnector } from '../_shared/canais/registry.ts';
import { pctEfetivo } from '../_shared/preco/desconto.ts';
import type { FaixaAtacado } from '../_shared/ml/atacado.ts';
import { espelharAnuncioExterno } from '../_shared/anuncios/espelhar.ts';

interface Job { familia_id: string; lote_id: string; }

// Idêntico ao publish-familia-ml: reavalia o status do lote quando o worker some da fila.
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
  try { job = JSON.parse(body); }
  catch { return new Response('Body inválido', { status: 400, headers: corsHeaders }); }

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

  // Idempotência: só processa o claim ativo ('publicando'). Re-entrega do QStash após
  // o lote já ter sido finalizado (status 'publicado'/'erro') é ignorada sem reprocessar.
  if (familia.status !== 'publicando') {
    return new Response(JSON.stringify({ skip: true, status: familia.status }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Caches de foto efêmeros subidos NESTE attempt: se a publicação falhar, são limpos
  // no catch para o retry re-subir (upload de foto não anexado a um item expira no ML
  // → "Picture id ... does not exist" no retry). Declarados fora do try p/ visibilidade no catch.
  let capa2SubidaAgora = false;
  let capa3SubidaAgora = false;

  try {
    if (!familia.ml_item_id) throw new Error('Família UPDATE sem ml_item_id herdado (400)');

    // Cores incluídas: casadas (têm ml_variation_id) repõem estoque; novas (sem
    // ml_variation_id) são criadas como variação. Excluídas ficam de fora.
    const { data: variacoes } = await admin.from('variacoes')
      .select('codigo, cor, estoque, preco_publicacao, gtin, imagem_path, ml_picture_id, ml_variation_id, peso_gramas, altura_cm, largura_cm, comprimento_cm')
      .eq('familia_id', job.familia_id)
      .eq('excluida_da_publicacao', false);
    if (!variacoes || variacoes.length === 0) throw new Error('Nenhuma cor incluída para atualizar (400)');

    let desconto: { pct: number; precoPorCodigo: Record<string, number | null> } | null = null;
    if (familia.exibir_com_desconto) {
      const { data: cfg } = await admin.from('configuracoes')
        .select('desconto_pct').eq('user_id', familia.user_id).maybeSingle();
      const global = cfg?.desconto_pct != null ? Number(cfg.desconto_pct) : 15;
      const fam = familia.desconto_pct != null ? Number(familia.desconto_pct) : null;
      const precoPorCodigo: Record<string, number | null> = {};
      for (const v of variacoes) precoPorCodigo[v.codigo] = v.preco_publicacao != null ? Number(v.preco_publicacao) : null;
      desconto = { pct: pctEfetivo(fam, global), precoPorCodigo };
    }

    const casadas = variacoes.filter((v) => v.ml_variation_id);
    const novas = variacoes.filter((v) => !v.ml_variation_id);

    const BUCKET = 'imagens';
    const TTL_SIGNED = 60 * 60 * 2;
    const signed = async (path: string): Promise<string> => {
      const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, TTL_SIGNED);
      if (error || !data) throw new Error(`Signed URL falhou para ${path}`);
      return data.signedUrl;
    };

    // Sobe a foto das cores novas (idempotente via ml_picture_id).
    const novasComFoto: Array<typeof novas[number] & { ml_picture_id: string | null }> = [];
    for (const v of novas) {
      let picId = v.ml_picture_id as string | null;
      if (!picId && v.imagem_path) {
        picId = await conn.subirFoto(ctx, await signed(v.imagem_path));
        await admin.from('variacoes').update({ ml_picture_id: picId }).eq('familia_id', job.familia_id).eq('codigo', v.codigo);
      }
      novasComFoto.push({ ...v, ml_picture_id: picId });
    }

    let capa2Pic = (familia.capa2_ml_picture_id as string | null) ?? null;
    if (!capa2Pic && familia.capa2_storage_path) {
      capa2Pic = await conn.subirFoto(ctx, await signed(familia.capa2_storage_path as string));
      await admin.from('familias').update({ capa2_ml_picture_id: capa2Pic }).eq('id', job.familia_id);
      capa2SubidaAgora = true;
    }

    let capa3Pic = (familia.capa3_ml_picture_id as string | null) ?? null;
    if (!capa3Pic && familia.capa3_storage_path) {
      capa3Pic = await conn.subirFoto(ctx, await signed(familia.capa3_storage_path as string));
      await admin.from('familias').update({ capa3_ml_picture_id: capa3Pic }).eq('id', job.familia_id);
      capa3SubidaAgora = true;
    }

    // Preço de publicação da família (todas as cores incluídas compartilham o mesmo).
    // Propagado a TODAS as variações existentes (adendo ADR-0016): o ML exige preço
    // único entre variações e o operador quer que a alteração de preço alcance a
    // família já publicada. Idempotente quando o preço não mudou.
    const precoFamiliaRaw = variacoes.find((v) => v.preco_publicacao != null)?.preco_publicacao;
    const precoFamilia = precoFamiliaRaw != null ? Number(precoFamiliaRaw) : null;
    // ADR-0016 (adendo 2026-06-05): sincroniza só o BRAND no UPDATE a partir do fornecedor,
    // preservando os demais atributos. Sem fornecedor → não envia (não sobrescreve com "Avil").
    // ADR-0018: também sincroniza dimensões/peso (SELLER_PACKAGE_*) da variação representativa
    // (principal, ou 1ª) — inválido → omite (ML mantém o que tiver). Corrige frete pós-publicação.
    const marca = (familia.fornecedor as string | null)?.trim() || null;
    const repUpd = variacoes.find((v) => v.codigo === familia.variacao_principal_codigo) ?? variacoes[0];
    const dimensoesUpd = repUpd ? {
      altura_cm: repUpd.altura_cm != null ? Number(repUpd.altura_cm) : null,
      largura_cm: repUpd.largura_cm != null ? Number(repUpd.largura_cm) : null,
      comprimento_cm: repUpd.comprimento_cm != null ? Number(repUpd.comprimento_cm) : null,
      peso_gramas: repUpd.peso_gramas != null ? Number(repUpd.peso_gramas) : null,
    } : null;

    // O conector encapsula o GET estado → montar variações/novas → PUT → refetch → casar
    // (reenviar TODAS as variações: o ML deleta as omitidas; comuns capa2/capa3 aplicadas a
    // todas; foto da cor nova também em item.pictures). Não lança: erro vira ResultadoCanal.
    const res = await conn.atualizarAnuncio(ctx, {
      itemExternoId: familia.ml_item_id,
      existentes: casadas.map((v) => ({ sku: v.codigo, estoque: v.estoque, cor: v.cor })),
      novas: novasComFoto.map((v) => ({
        sku: v.codigo, cor: v.cor, estoque: v.estoque,
        preco: v.preco_publicacao, gtin: v.gtin, fotoId: v.ml_picture_id,
      })),
      capaFotoId: (familia.capa_ml_picture_id as string | null) ?? null,
      capa2FotoId: capa2Pic,
      capa3FotoId: capa3Pic,
      categoriaId: familia.categoria_ml_id as string | null,
      marca,
      dimensoes: dimensoesUpd,
      desconto: desconto ?? null,
      precoFamilia,
    });
    if (!res.ok) {
      const e = res.erro!;
      const err = new Error(e.mensagemOperador);
      // Repassa o HTTP status p/ o catch: 5xx/429 → retenta; senão erro + limpeza dos caches.
      (err as { status?: number }).status = e.status;
      throw err;
    }

    // Casa o ml_variation_id das cores novas (idempotente). variacoesExternas: sku → id externo.
    const persistidas = new Set<string>();
    for (const [codigo, variationId] of Object.entries(res.valor!.variacoesExternas)) {
      if (novasComFoto.some((v) => v.codigo === codigo)) {
        await admin.from('variacoes').update({ ml_variation_id: variationId })
          .eq('familia_id', job.familia_id).eq('codigo', codigo);
        persistidas.add(codigo);
      }
    }
    // Se ainda assim alguma cor nova não tem vínculo, NÃO marca publicado (evita duplicar
    // no próximo UPDATE). Falha explícita para o operador conferir antes de republicar.
    const novasSemVinculo = novasComFoto.filter((v) => !persistidas.has(v.codigo));
    if (novasSemVinculo.length > 0) {
      throw new Error(`ML não vinculou as cores novas ${novasSemVinculo.map((v) => v.codigo).join(', ')} (sem seller_custom_field). Elas podem ter sido criadas no anúncio — confira no ML antes de republicar para não duplicar (400)`);
    }

    // Sincroniza a descrição do anúncio (ADR-0016 adendo 2026-06-07): cor nova (seção de cores
    // muda) ou descrição corrigida/regenerada (texto muda). Reposição pura → não reenvia. O
    // conector resolve contra a descrição ao vivo e devolve a nova a persistir (ou null).
    if (familia.descricao_ml) {
      const cores = [...new Set(variacoes.map((v) => v.cor).filter((c): c is string => !!c))];
      const nova = await conn.sincronizarDescricao(ctx, familia.ml_item_id, familia.descricao_ml as string, cores);
      if (nova) {
        await admin.from('familias').update({ descricao_ml: nova }).eq('id', job.familia_id);
      }
    }

    await admin.from('familias').update({
      status: 'publicado',
      publicado_em: new Date().toISOString(),
    }).eq('id', job.familia_id);

    // Atacado (PxQ): sincroniza com o preço atual. Com faixas → reaplica; sem faixas mas já
    // aplicado antes → limpa (envia só a base). Best-effort, não derruba o update.
    // Base do PxQ = precoFamilia (cores incluídas compartilham o mesmo preço, ADR-0041).
    try {
      const faixasAtacado = Array.isArray(familia.atacado) ? (familia.atacado as FaixaAtacado[]) : [];
      if (precoFamilia != null && (faixasAtacado.length > 0 || familia.atacado_status === 'aplicado')) {
        try {
          await conn.aplicarAtacado(ctx, familia.ml_item_id, precoFamilia, faixasAtacado);
          await admin.from('familias')
            .update({ atacado_status: faixasAtacado.length > 0 ? 'aplicado' : null, atacado_erro: null })
            .eq('id', job.familia_id);
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);
          console.error(`atacado (update) falhou para ${familia.ml_item_id}:`, m);
          await admin.from('familias').update({ atacado_status: 'erro', atacado_erro: m }).eq('id', job.familia_id);
        }
      }
    } catch (e) {
      console.error('atacado (bloco update) falhou inesperadamente:', e instanceof Error ? e.message : String(e));
    }

    // Catálogo (ADR-0021): reconcilia o vínculo das cores de forma DEFERIDA (mesmo motivo do
    // CREATE: a elegibilidade de cor nova leva minutos). Enfileira o job com delay/retry;
    // variações já vinculadas são puladas (idempotente). Best-effort.
    try {
      await enfileirarVinculacaoCatalogo(job.familia_id);
    } catch (e) {
      console.error(`enfileirar catálogo (update) falhou para ${familia.ml_item_id}:`, e);
    }

    // E2 (ADR-0025): espelha o estado atualizado em anuncios_externos (best-effort).
    const { data: varsEspelho } = await admin.from('variacoes')
      .select('codigo, ml_variation_id, catalog_product_id, catalog_listing_id, catalog_status')
      .eq('familia_id', job.familia_id);
    await espelharAnuncioExterno(admin, {
      user_id: familia.user_id,
      org_id: familia.org_id,
      codigo_pai: familia.codigo_pai,
      ml_item_id: familia.ml_item_id,
      ml_permalink: familia.ml_permalink ?? null,
      publicado_em: new Date().toISOString(),
    }, varsEspelho ?? []);

    await talvezFinalizarLote(admin, job.lote_id);
    return new Response(JSON.stringify({ ml_item_id: familia.ml_item_id, atualizado: true, novas: novasComFoto.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = (err as { status?: number }).status;
    // 5xx/429: transitório — mantém 'publicando' e relança para o QStash retentar.
    if (status && (status >= 500 || status === 429)) {
      return new Response(msg, { status: 500, headers: corsHeaders });
    }
    await admin.from('familias').update({ status: 'erro', erro_mensagem: msg }).eq('id', job.familia_id);
    // Limpa os caches de foto efêmeros para o próximo retry re-subir fresco: as cores
    // novas ainda não anexadas (ml_variation_id null) e as capas subidas neste attempt.
    // Sem isto, o id de upload expirado reaparece no retry → "Picture id ... does not exist".
    await admin.from('variacoes').update({ ml_picture_id: null })
      .eq('familia_id', job.familia_id).is('ml_variation_id', null);
    const limparCapas: Record<string, null> = {};
    if (capa2SubidaAgora) limparCapas.capa2_ml_picture_id = null;
    if (capa3SubidaAgora) limparCapas.capa3_ml_picture_id = null;
    if (Object.keys(limparCapas).length > 0) {
      await admin.from('familias').update(limparCapas).eq('id', job.familia_id);
    }
    await talvezFinalizarLote(admin, job.lote_id);
    return new Response(JSON.stringify({ erro: msg }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
