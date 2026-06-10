import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura, enfileirarVinculacaoCatalogo } from '../_shared/queue.ts';
import { getValidAccessToken } from '../_shared/ml/token.ts';
import { buscarItemML, atualizarItemML } from '../_shared/ml/atualizar-item.ts';
import { buscarDescricaoML, garantirDescricaoML, resolverDescricaoUpdate } from '../_shared/ml/criar-item.ts';
import { montarVariacoesUpdate, montarVariacaoNova } from '../_shared/ml/atualizar.ts';
import { montarAtributosPacote } from '../_shared/ml/pacote.ts';
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

    let capa3Pic = (familia.capa3_ml_picture_id as string | null) ?? null;
    if (!capa3Pic && familia.capa3_storage_path) {
      capa3Pic = await subirFotoML(token, await signed(familia.capa3_storage_path as string));
      await admin.from('familias').update({ capa3_ml_picture_id: capa3Pic }).eq('id', job.familia_id);
    }

    // GET estado real → reenviar todas as variações (ML deleta as omitidas).
    const atual = await buscarItemML(token, familia.ml_item_id);
    const desejados = casadas.map((v) => ({ codigo: v.codigo, estoque: v.estoque }));
    const capaPic = (familia.capa_ml_picture_id as string | null) ?? null;
    // Fotos comuns (capa2, capa3) nas cores existentes: parte das fotos ATUAIS do item
    // (IDs válidos, lidos do GET — o ML re-hospeda as fotos, então os IDs de upload
    // cacheados não batem com os do item) e insere as comuns logo após a líder (capa3
    // sempre após a capa2). Idempotente: reaplicar reordena para o mesmo resultado.
    // Sem fotos comuns → só estoque (comportamento preservado).
    const comuns = [capa2Pic, capa3Pic].filter((x): x is string => !!x);
    const incluidas = new Set(casadas.map((c) => c.codigo));
    const picsPorCodigo: Record<string, string[]> = {};
    if (comuns.length > 0) {
      for (const a of atual.variations) {
        const codigo = a.seller_custom_field ?? '';
        if (!incluidas.has(codigo)) continue;
        const atuaisPics = a.picture_ids ?? [];
        picsPorCodigo[codigo] = [...new Set(
          [atuaisPics[0], ...comuns, ...atuaisPics.slice(1)].filter((x): x is string => !!x),
        )];
      }
    }
    const existentes = montarVariacoesUpdate(atual.variations, desejados, comuns.length > 0 ? picsPorCodigo : undefined, desconto ?? undefined);

    const novasPut = novasComFoto.map((v) => montarVariacaoNova(
      { codigo: v.codigo, cor: v.cor, estoque: v.estoque, preco_publicacao: v.preco_publicacao, gtin: v.gtin, ml_picture_id: v.ml_picture_id },
      capaPic,
      capa2Pic,
      capa3Pic,
      familia.categoria_ml_id as string | null,
      desconto ? { pct: desconto.pct } : null,
    ));

    // ADR-0016 (adendo 2026-06-05): sincroniza só o BRAND no UPDATE a partir do fornecedor,
    // preservando os demais atributos. Sem fornecedor → não envia (não sobrescreve com "Avil").
    // ADR-0018: também sincroniza dimensões/peso (SELLER_PACKAGE_*) da variação representativa
    // (principal, ou 1ª) — inválido → omite (ML mantém o que tiver). Corrige frete pós-publicação.
    const marca = (familia.fornecedor as string | null)?.trim();
    const repUpd = variacoes.find((v) => v.codigo === familia.variacao_principal_codigo) ?? variacoes[0];
    const dimensoesUpd = repUpd ? {
      altura_cm: repUpd.altura_cm != null ? Number(repUpd.altura_cm) : null,
      largura_cm: repUpd.largura_cm != null ? Number(repUpd.largura_cm) : null,
      comprimento_cm: repUpd.comprimento_cm != null ? Number(repUpd.comprimento_cm) : null,
      peso_gramas: repUpd.peso_gramas != null ? Number(repUpd.peso_gramas) : null,
    } : null;
    const atributosItem = [
      ...(marca ? [{ id: 'BRAND', value_name: marca }] : []),
      ...(dimensoesUpd ? montarAtributosPacote(dimensoesUpd) : []),
    ];
    // Ao criar variação nova, a foto dela precisa estar também no item.pictures
    // (regra do ML: item.pictures.invalid.missing_ids). Reenvia o item.pictures =
    // fotos atuais + comuns (capa2/capa3) + fotos das variações novas (dedup).
    const novasPicIds = novasPut.flatMap((v) => v.picture_ids);
    const precisaPictures = novasPut.length > 0 || comuns.length > 0;
    const pictures = precisaPictures
      ? [...new Set([...atual.pictures, ...comuns, ...novasPicIds])]
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

    // Sincroniza a descrição do anúncio (ADR-0016 adendo 2026-06-07). Compara a descrição
    // DESEJADA (cores atualizadas + sanitizada como o ML guarda) contra a que está AO VIVO
    // no item, e só reenvia se diferir. Cobre dois casos: cor nova (seção de cores muda) e
    // descrição corrigida/regenerada pelo operador (texto muda) — este último não chegava ao
    // ML antes. Reposição pura de estoque → iguais → não reenvia (sem IA, sem token, e o GET
    // de descrição é grátis). PUT /description é idempotente no ML — seguro em retry.
    if (familia.descricao_ml) {
      const cores = [...new Set(variacoes.map((v) => v.cor).filter((c): c is string => !!c))];
      const liveDesc = await buscarDescricaoML(token, familia.ml_item_id);
      const r = resolverDescricaoUpdate(familia.descricao_ml as string, cores, liveDesc);
      if (r?.precisaPush) {
        await garantirDescricaoML(token, familia.ml_item_id, r.novaDescricao);
        if (r.novaDescricao !== familia.descricao_ml) {
          await admin.from('familias').update({ descricao_ml: r.novaDescricao }).eq('id', job.familia_id);
        }
      }
    }

    await admin.from('familias').update({
      status: 'publicado',
      publicado_em: new Date().toISOString(),
    }).eq('id', job.familia_id);

    // Catálogo (ADR-0021): reconcilia o vínculo das cores de forma DEFERIDA (mesmo motivo do
    // CREATE: a elegibilidade de cor nova leva minutos). Enfileira o job com delay/retry;
    // variações já vinculadas são puladas (idempotente). Best-effort.
    try {
      await enfileirarVinculacaoCatalogo(job.familia_id);
    } catch (e) {
      console.error(`enfileirar catálogo (update) falhou para ${familia.ml_item_id}:`, e);
    }

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
