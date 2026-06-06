import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { getValidAccessToken } from '../_shared/ml/token.ts';
import { buscarItemML, atualizarItemML } from '../_shared/ml/atualizar-item.ts';
import { atualizarSecaoCores, garantirDescricaoML } from '../_shared/ml/criar-item.ts';
import { montarVariacoesUpdate, montarVariacaoNova } from '../_shared/ml/atualizar.ts';
import { subirFotoML } from '../_shared/ml/fotos.ts';
import { pctEfetivo } from '../_shared/preco/desconto.ts';

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

  // Idempotência: só processa o claim ativo ('publicando'). Re-entrega do QStash após
  // o lote já ter sido finalizado (status 'publicado'/'erro') é ignorada sem reprocessar.
  if (familia.status !== 'publicando') {
    return new Response(JSON.stringify({ skip: true, status: familia.status }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    if (!familia.ml_item_id) throw new Error('Família UPDATE sem ml_item_id herdado (400)');

    // Cores incluídas: casadas (têm ml_variation_id) repõem estoque; novas (sem
    // ml_variation_id) são criadas como variação. Excluídas ficam de fora.
    const { data: variacoes } = await admin.from('variacoes')
      .select('codigo, cor, estoque, preco_publicacao, gtin, imagem_path, ml_picture_id, ml_variation_id')
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

    const token = await getValidAccessToken(familia.user_id);

    const BUCKET = 'imagens';
    const TTL_SIGNED = 60 * 60 * 2;
    async function signed(path: string): Promise<string> {
      const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, TTL_SIGNED);
      if (error || !data) throw new Error(`Signed URL falhou para ${path}`);
      return data.signedUrl;
    }

    // Sobe a foto das cores novas (idempotente via ml_picture_id).
    const novasComFoto: Array<typeof novas[number] & { ml_picture_id: string | null }> = [];
    for (const v of novas) {
      let picId = v.ml_picture_id as string | null;
      if (!picId && v.imagem_path) {
        picId = await subirFotoML(token, await signed(v.imagem_path));
        await admin.from('variacoes').update({ ml_picture_id: picId }).eq('familia_id', job.familia_id).eq('codigo', v.codigo);
      }
      novasComFoto.push({ ...v, ml_picture_id: picId });
    }

    let capa2Pic = (familia.capa2_ml_picture_id as string | null) ?? null;
    if (!capa2Pic && familia.capa2_storage_path) {
      capa2Pic = await subirFotoML(token, await signed(familia.capa2_storage_path as string));
      await admin.from('familias').update({ capa2_ml_picture_id: capa2Pic }).eq('id', job.familia_id);
    }

    // GET estado real → reenviar todas as variações (ML deleta as omitidas).
    const atual = await buscarItemML(token, familia.ml_item_id);
    const desejados = casadas.map((v) => ({ codigo: v.codigo, estoque: v.estoque }));
    const capaPic = (familia.capa_ml_picture_id as string | null) ?? null;
    // 2a foto nas cores existentes: parte das fotos ATUAIS do item (IDs válidos, lidos do GET —
    // o ML re-hospeda as fotos, então os IDs de upload cacheados não batem com os do item) e
    // insere a capa2 como 2a foto. Sem capa2 → só estoque (comportamento preservado).
    const incluidas = new Set(casadas.map((c) => c.codigo));
    const picsPorCodigo: Record<string, string[]> = {};
    if (capa2Pic) {
      for (const a of atual.variations) {
        const codigo = a.seller_custom_field ?? '';
        if (!incluidas.has(codigo)) continue;
        const atuaisPics = a.picture_ids ?? [];
        picsPorCodigo[codigo] = atuaisPics.includes(capa2Pic)
          ? atuaisPics
          : [atuaisPics[0], capa2Pic, ...atuaisPics.slice(1)].filter((x): x is string => !!x);
      }
    }
    const existentes = montarVariacoesUpdate(atual.variations, desejados, capa2Pic ? picsPorCodigo : undefined, desconto ?? undefined);

    const novasPut = novasComFoto.map((v) => montarVariacaoNova(
      { codigo: v.codigo, cor: v.cor, estoque: v.estoque, preco_publicacao: v.preco_publicacao, gtin: v.gtin, ml_picture_id: v.ml_picture_id },
      capaPic,
      capa2Pic,
      familia.categoria_ml_id as string | null,
      desconto ? { pct: desconto.pct } : null,
    ));

    // ADR-0016 (adendo 2026-06-05): sincroniza só o BRAND no UPDATE a partir do fornecedor,
    // preservando os demais atributos. Sem fornecedor → não envia (não sobrescreve com "Avil").
    const marca = (familia.fornecedor as string | null)?.trim();
    const atributosItem = marca ? [{ id: 'BRAND', value_name: marca }] : [];
    // Ao criar variação nova, a foto dela precisa estar também no item.pictures
    // (regra do ML: item.pictures.invalid.missing_ids). Reenvia o item.pictures =
    // fotos atuais + as fotos das variações novas (dedup). Inclui capa2 quando presente.
    const novasPicIds = novasPut.flatMap((v) => v.picture_ids);
    const precisaPictures = novasPut.length > 0 || !!capa2Pic;
    const pictures = precisaPictures
      ? [...new Set([...atual.pictures, ...(capa2Pic ? [capa2Pic] : []), ...novasPicIds])]
      : undefined;
    const resultado = await atualizarItemML(token, familia.ml_item_id, [...existentes, ...novasPut], atributosItem, pictures);

    // Casa o ml_variation_id das novas. O PUT nem sempre ecoa seller_custom_field nas
    // variações criadas; o GET ecoa de forma confiável — então relemos o item para casar.
    let varsParaCasar = resultado.variations;
    if (novasComFoto.length > 0) {
      const refetch = await buscarItemML(token, familia.ml_item_id);
      varsParaCasar = refetch.variations;
    }
    const persistidas = new Set<string>();
    for (const mv of varsParaCasar) {
      const codigo = mv.seller_custom_field;
      if (codigo && novasComFoto.some((v) => v.codigo === codigo)) {
        await admin.from('variacoes').update({ ml_variation_id: String(mv.id) })
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

    // Reescreve a seção "CORES DISPONÍVEIS" da descrição herdada (ADR-0016, sem IA)
    // para refletir as cores incluídas neste UPDATE. Falha explícita: se
    // garantirDescricaoML falhar, o worker falha e o operador reprocessa de 'erro'.
    // Idempotência: o guard (novaDescricao !== familia.descricao_ml) garante que
    // num retry onde a descrição já foi persistida a chamada ao ML não é reenviada.
    // PUT /description é idempotente no ML — seguro de repetir em retry.
    if (familia.descricao_ml) {
      const cores = [...new Set(variacoes.map((v) => v.cor).filter((c): c is string => !!c))];
      const novaDescricao = atualizarSecaoCores(familia.descricao_ml as string, cores);
      if (novaDescricao !== familia.descricao_ml) {
        await garantirDescricaoML(token, familia.ml_item_id, novaDescricao);
        await admin.from('familias').update({ descricao_ml: novaDescricao }).eq('id', job.familia_id);
      }
    }

    await admin.from('familias').update({
      status: 'publicado',
      publicado_em: new Date().toISOString(),
    }).eq('id', job.familia_id);

    await talvezFinalizarLote(admin, job.lote_id);
    return new Response(JSON.stringify({ ml_item_id: familia.ml_item_id, atualizado: true, novas: novasPut.length }), {
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
    await talvezFinalizarLote(admin, job.lote_id);
    return new Response(JSON.stringify({ erro: msg }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
