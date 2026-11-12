// ADR-0200: worker QStash da saga de transferência de kit. Casca fina: liga as portas de saga.ts no
// Supabase e no ML. Um passo por invocação.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { enfileirarReposicao, enfileirarSaga, verificarAssinatura, type KitTransferenciaJob } from '../_shared/queue.ts';
import { dispararReposicao } from '../_shared/kit-variacao/reposicao.ts';
import { resolverConexaoEstrita } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import type { ConexaoCanal } from '../_shared/canais/conexao.ts';
import { humanizarErroML, MLApiError } from '../_shared/ml/erro-ml.ts';
import { notificarCategoria } from '../_shared/notificacoes/config.ts';
import { importarPedidosDoItem, lerItens, lerOferta, listarPendentes } from '../_shared/kit-variacao/ml-oferta.ts';
import { avancarSaga, PRAZO_PASSO_S, quarentenaDoEnv, type DepsSaga } from '../_shared/kit-variacao/saga.ts';
import { avisarKitsEncerrados } from '../_shared/kit-variacao/encerrar.ts';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { getConnector } from '../_shared/canais/registry.ts';
import { montarAnuncioCanonico } from '../_shared/anuncios/montar-canonico.ts';
import { familyNameDe, prepararPayloadUP } from '../_shared/user-products/publicar-familia-up.ts';
import { buscarItemPorSku, buscarItemUP, type FetchLike } from '../_shared/ml/buscar-item.ts';
import { lerSchemaAtributos } from '../_shared/categoria/schema.ts';
import { enfileirarSincronizacaoFiscal } from '../_shared/queue.ts';
import { talvezFinalizarLote } from '../_shared/lote/finalizar.ts';
import { alertarZeradosConfirmados } from '../sincronizar-estoque/processar.ts';
import { avisarFimTransferencia, comLinkDoKit } from '../_shared/kit-variacao/aviso-fim.ts';
import { revalidarGaleria } from '../_shared/kit-variacao/galeria-leitura.ts';
import { comGaleria, prepararGaleria, tratarRecusaDeFoto } from '../_shared/kit-variacao/galeria-criar.ts';
import { fotosDaColuna } from '../_shared/kit-variacao/galeria-coluna.ts';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

function deps(orgId: string, transferenciaId: string): DepsSaga {
  const admin = adminClient();
  // Toda chamada ao ML desta invocação morre no prazo do passo, antes de o lease do claim vencer.
  const prazo = AbortSignal.timeout(PRAZO_PASSO_S * 1000);
  const f: typeof fetch = (url, init) =>
    fetch(url, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, prazo]) : prazo });

  let conexao: Promise<{ token: string; seller: string; cx: ConexaoCanal }> | null = null;
  // Só resolve token quando um passo lê o ML; falha lança e a saga reagenda.
  const ml = () => conexao ??= (async () => {
    const cx = await resolverConexaoEstrita(admin, orgId, 'mercado_livre');
    if (!cx?.contaExternaId) throw new Error('org sem conexão com o Mercado Livre');
    return { token: await getValidAccessTokenConexao(cx), seller: cx.contaExternaId, cx };
  })();
  const fetchLike: FetchLike = (url, init) => f(url, init) as unknown as ReturnType<FetchLike>;
  const ctxCanal = { getToken: async () => (await ml()).token };
  const conn = getConnector('mercado_livre');

  // PUT parcial no item. Erro HTTP carrega `status` (4xx = recusa); rede e prazo lançam sem status (incerto).
  const putItem = async (itemId: string, corpo: Record<string, unknown>) => {
    const resp = await f(`https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${(await ml()).token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    });
    if (!resp.ok) throw new MLApiError(resp.status, humanizarErroML(resp.status, await resp.json().catch(() => ({}))));
  };

  const exigir = <T>(r: { data: T; error: { message: string } | null }, onde: string): T => {
    if (r.error) throw new Error(`${onde}: ${r.error.message}`);
    return r.data;
  };
  const base = (id: string, token: string) => ({ p_org: orgId, p_transferencia: id, p_token: token });

  return {
    repo: {
      async reivindicar(id, token, prazoS) {
        return exigir(await admin.rpc('kit_reivindicar_execucao',
          { p_org: orgId, p_transferencia: id, p_token: token, p_prazo_s: prazoS }), 'claim') === true;
      },
      async carregar(id) {
        const transferencia = exigir(await admin.from('kit_transferencias')
          .select('id, org_id, tipo, passo, estado, versao_politica, passo_em, alerta, alerta_desde, alerta_enviado')
          .eq('id', id).eq('org_id', orgId).single(), 'ler transferência');
        const alvos = exigir(await admin.from('kit_transferencia_alvos').select('*')
          .eq('transferencia_id', id).eq('org_id', orgId).order('up_id'), 'ler alvos');
        return { transferencia, alvos } as Awaited<ReturnType<DepsSaga['repo']['carregar']>>;
      },
      async salvarTransferencia(id, token, patch) {
        exigir(await admin.rpc('kit_saga_salvar_transferencia', {
          ...base(id, token), p_passo: patch.passo ?? null, p_alerta: patch.alerta ?? null, p_travar: patch.travar ?? false,
          p_alerta_desde: patch.alertaDesde ?? null, p_limpar_alerta_desde: patch.limparAlertaDesde ?? false,
          p_alerta_enviado: patch.alertaEnviado ?? null,
        }), 'gravar transferência');
      },
      async salvarAlvo(id, token, upId, patch) {
        exigir(await admin.rpc('kit_saga_salvar_alvo', { ...base(id, token), p_up: upId, p_patch: patch }), 'gravar alvo');
      },
      async finalizar(id, token, estado, alerta, pausas) {
        exigir(await admin.rpc('kit_saga_finalizar', {
          ...base(id, token), p_estado: estado, p_alerta: alerta, p_pausas: pausas ?? [],
        }), 'finalizar');
      },
      async ledger(id, token, op) {
        return exigir(await admin.rpc('kit_saga_ledger', { ...base(id, token), p_op: op }), `ledger ${op}`) as
          { ok: boolean; motivo?: string };
      },
      async podeReativar(id, token, codigo) {
        return exigir(await admin.rpc('kit_saga_pode_reativar', { ...base(id, token), p_codigo: codigo }), 'política') === true;
      },
      async liberar(id, token) {
        const { error } = await admin.from('kit_transferencias').update({ execucao_token: null, execucao_ate: null })
          .eq('id', id).eq('execucao_token', token);
        // Sem soltar, o prazo do claim vence sozinho.
        if (error) console.warn(`kit-transferencia: liberar claim: ${error.message}`);
      },
      async versaoPolitica(codigos) {
        const linhas = exigir(await admin.from('sku_politica_kit').select('versao')
          .eq('org_id', orgId).in('codigo', codigos), 'ler política') ?? [];
        return linhas.reduce((soma, p) => soma + p.versao, 0);
      },
      async guardados(codigos) {
        const linhas = exigir(await admin.from('sku_politica_kit').select('codigo')
          .eq('org_id', orgId).in('codigo', codigos).eq('estado', 'guardado'), 'ler estados') ?? [];
        return new Set(linhas.map((p) => p.codigo as string));
      },
      async conferirSaldo(id, token, codigo) {
        return exigir(await admin.rpc('kit_saga_conferir_saldo', { ...base(id, token), p_codigo: codigo }), 'conferir saldo') as
          { saldo: number; marca: number | null; pendente: number; ordem: number };
      },
      registrarItem: (codigo, itemId, upId) => registrarItemKit(admin, orgId, codigo, itemId, upId, {
        lerItem: async (id) => buscarItemUP(fetchLike, { accessToken: (await ml()).token }, id),
        garantirDescricao: (id, texto) => conn.garantirDescricao(ctxCanal, id, texto),
      }),
    },
    ml: {
      lerOferta: async (upId, esperados) => lerOferta((await ml()).token, upId, esperados, f),
      lerItens: async (upId, ids) => lerItens((await ml()).token, upId, ids, f),
      listarPendentes: async () => { const c = await ml(); return listarPendentes(c.token, c.seller, f); },
      importarPedidos: async (itemIds, desde, idsPasso1, antesDeBaixar) => {
        const c = await ml();
        return importarPedidosDoItem(admin, orgId, itemIds,
          { token: c.token, seller: c.seller, desde, idsPasso1, fetch: f, signal: prazo, antesDeBaixar });
      },
      putQuantidade: (itemId, quantidade) => putItem(itemId, { available_quantity: quantidade }),
      putStatus: (itemId, status) => putItem(itemId, { status }),
      async prepararItem(codigo, quantidade) {
        const { familia, variacao, listingTypeId } = await kitDoSku(admin, orgId, codigo);
        const { token, cx } = await ml();
        const categoriaId = familia.categoria_ml_id as string;
        let aceitaEmptyGtin: boolean | undefined;
        try {
          const schema = await lerSchemaAtributos(token, categoriaId);
          if (schema.length) aceitaEmptyGtin = schema.some((a) => a.id === 'EMPTY_GTIN_REASON');
        } catch { /* fallback do montarPayloadItem, como em publish-familia-ml */ }
        // Sobe a foto da combinação (ou reusa o picture_id) e resolve a guia de tamanhos da própria conta.
        const anuncio = await montarAnuncioCanonico(admin, conn, ctxCanal, familia as never, [variacao as never], listingTypeId);
        const { montar } = await prepararPayloadUP({
          admin, ctx: ctxCanal, conexao: cx, familia: familia as never, anuncio, categoriaId, aceitaEmptyGtin,
        });
        // ADR-0200 (adendo 12/11): galeria das peças. Relida no ML agora (moderação entre o cadastro e o CREATE); o que não
        // confere sai e o item nasce só com a foto do kit. Nunca trava a criação.
        const preparada = await prepararGaleria(fotosDaColuna(variacao.galeria_ml_fotos) ?? [], (fs) => revalidarGaleria(token, fs, f));
        if (preparada.aviso) {
          await notificarCategoria(admin, orgId, 'estoque', `Kit ${codigo}: ${preparada.aviso}`, { chave: `kit_galeria:${codigo}:reduzida` })
            .catch((e: unknown) => console.warn('kit_galeria_aviso_falhou', String(e)));
        }
        const payload = comGaleria(montar({ ...anuncio.variacoes[0], estoque: quantidade }), preparada.fotos);
        return async () => {
          const resp = await f('https://api.mercadolibre.com/items', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const corpo = await resp.json().catch(() => ({}));
          if (!resp.ok) {
            // Recusa de foto da galeria: zera a lista deste SKU e sobe o 4xx; a saga recria só com a foto do kit.
            await tratarRecusaDeFoto({ status: resp.status, corpo, galeriaUsada: preparada.fotos.length > 0 }, {
              zerar: async () => {
                const { error } = await admin.from('variacoes').update({ galeria_ml_fotos: [] })
                  .eq('id', variacao.id as string).eq('org_id', orgId);
                if (error) throw new Error(error.message);
              },
              avisar: async (texto) => { await notificarCategoria(admin, orgId, 'estoque', `Kit ${codigo}: ${texto}`, { chave: `kit_galeria:${codigo}:recusada` }); },
            });
            throw new MLApiError(resp.status, humanizarErroML(resp.status, corpo));
          }
          // Sem o UP lido, lança sem status: a saga trata como incerto e a retomada adota pela busca.
          const item = await buscarItemUP(fetchLike, { accessToken: token }, corpo.id);
          if (!item?.userProductId) throw new Error(`item ${corpo.id} criado, user_product_id ainda não lido`);
          return { itemId: corpo.id as string, upId: item.userProductId };
        };
      },
      async buscarItemCriado(codigo) {
        const { familia } = await kitDoSku(admin, orgId, codigo);
        const { token, seller } = await ml();
        const b = await buscarItemPorSku(fetchLike, {
          accessToken: token, sellerId: seller, categoriaId: familia.categoria_ml_id as string,
          familyName: familyNameDe(familia as never), desdeMs: 0,
        }, codigo);
        if (b.tipo === 'nenhum') return { tipo: 'nenhum' };
        if (b.tipo !== 'um') return { tipo: 'ambiguo' };
        const item = await buscarItemUP(fetchLike, { accessToken: token }, b.itemExternoId);
        if (!item?.userProductId) throw new Error(`item ${b.itemExternoId} sem user_product_id na leitura`);
        return { tipo: 'um', itemId: b.itemExternoId, upId: item.userProductId };
      },
    },
    enfileirar: (id, delayS) => enfileirarSaga(id, orgId, delayS),
    // Todo alerta da saga (travada, bloqueada, abortada) leva o kit e o link do Gerenciar kit no PubliAI.
    alertar: async (texto, chave) => {
      const { data } = await admin.from('kit_transferencias').select('kit_id, kits_variacao(codigo_pai_kit)')
        .eq('id', transferenciaId).eq('org_id', orgId).maybeSingle();
      const k = (data as { kits_variacao?: { codigo_pai_kit?: string } | null } | null)?.kits_variacao;
      await notificarCategoria(admin, orgId, 'estoque',
        comLinkDoKit(texto, Deno.env.get('APP_URL'), { id: (data?.kit_id as string | null) ?? null, codigoPai: k?.codigo_pai_kit }),
        chave ? { chave } : undefined);
    },
    avisarZerados: (codigos) => alertarZeradosConfirmados(admin, notificarCategoria, orgId, codigos),
    agora: () => new Date(),
    quarentenaS: quarentenaDoEnv(Deno.env.get('KIT_QUARENTENA_S')),
    novoToken: () => crypto.randomUUID(),
    encerramento: {
      async finalizar(id, token) {
        exigir(await admin.rpc('kit_encerrar_finalizar', base(id, token)), 'encerrar kit');
      },
      avisar: async (texto, chave) => { await notificarCategoria(admin, orgId, 'estoque', texto, { chave }); },
      // Depois do commit; a varredura diária repete o que faltar (marca `encerrado_avisado_em`).
      avisarConcluidos: async () => { await avisarKitsEncerrados(admin, notificarCategoria, orgId); },
    },
  };
}

/** Família canônica do kit (a mais recente do PAI do kit) e a variação do SKU nela. */
async function kitDoSku(admin: SupabaseClient, orgId: string, codigo: string) {
  const ler = async <T>(q: PromiseLike<{ data: T; error: { message: string } | null }>, onde: string): Promise<NonNullable<T>> => {
    const { data, error } = await q;
    if (error || data == null) throw new Error(`${onde}: ${error?.message ?? 'não encontrado'}`);
    return data;
  };
  const sku = await ler(admin.from('kit_variacao_skus').select('kit_id').eq('org_id', orgId).eq('codigo', codigo).single(), 'SKU de kit');
  const kit = await ler(admin.from('kits_variacao').select('id, codigo_pai_kit, listing_type_id').eq('id', sku.kit_id).single(), 'kit');
  const familia = await ler(admin.from('familias').select('*').eq('org_id', orgId).eq('codigo_pai', kit.codigo_pai_kit)
    .order('criado_em', { ascending: false }).order('id', { ascending: false }).limit(1).single(), 'família do kit') as Record<string, unknown>;
  const variacao = await ler(admin.from('variacoes').select('*').eq('familia_id', familia.id as string).eq('codigo', codigo).single(),
    'variação do kit') as Record<string, unknown>;
  const skus = await ler(admin.from('kit_variacao_skus').select('codigo').eq('kit_id', kit.id), 'SKUs do kit');
  return {
    kitId: kit.id as string, listingTypeId: kit.listing_type_id as string, familia, variacao,
    skus: skus.map((x) => x.codigo as string),
  };
}

/**
 * ADR-0200 (Task 10): vínculo local do item que a saga criou ou adotou. Idempotente: a retomada repete.
 * Grava a raiz e o filho (a venda acha o SKU por `anuncios_externos_itens`), publica a família do kit e
 * dispara descrição, fiscal por SKU e o fechamento do lote. `family_id` diferente dos irmãos recusa: o
 * seletor do ML não juntaria os itens.
 */
async function registrarItemKit(
  admin: SupabaseClient, orgId: string, codigo: string, itemId: string, upId: string,
  ml: {
    lerItem(id: string): Promise<{ familyId?: string; permalink?: string } | null>;
    garantirDescricao(id: string, texto: string): Promise<void>;
  },
): Promise<{ ok: boolean; motivo?: string }> {
  const { familia, variacao, skus } = await kitDoSku(admin, orgId, codigo);
  const item = await ml.lerItem(itemId);
  if (!item?.familyId) throw new Error(`item ${itemId} sem family_id na leitura`);
  const exigir = (r: { error: { message: string } | null }, onde: string) => {
    if (r.error) throw new Error(`${onde}: ${r.error.message}`);
  };

  const raiz = await admin.from('anuncios_externos').upsert({
    user_id: familia.user_id, org_id: orgId, canal: 'mercado_livre', codigo_pai: familia.codigo_pai, particao: 0,
    status: 'publicado', titulo: familyNameDe(familia as never), item_externo_id: null, skus_esperados: skus,
    estado_desejado: null, erro_mensagem: null,
  }, { onConflict: 'org_id,canal,codigo_pai,particao' }).select('id').single();
  exigir(raiz, 'raiz do kit');
  const rootId = (raiz.data as { id: string }).id;

  const irmaos = await admin.from('anuncios_externos_itens').select('sku, family_id')
    .eq('anuncio_externo_id', rootId).neq('sku', codigo).not('family_id', 'is', null);
  exigir(irmaos, 'filhos do kit');
  const outra = (irmaos.data ?? []).find((x) => x.family_id !== item.familyId);
  if (outra) return { ok: false, motivo: `family_id ${item.familyId} diferente do de ${outra.sku} (${outra.family_id})` };

  exigir(await admin.from('anuncios_externos_itens').upsert({
    anuncio_externo_id: rootId, org_id: orgId, sku: codigo, item_externo_id: itemId, user_product_id: upId,
    family_id: item.familyId, permalink: item.permalink ?? null, status: 'ativo',
  }, { onConflict: 'anuncio_externo_id,sku' }), 'filho do kit');

  if (!familia.ml_item_id) {
    exigir(await admin.from('familias').update({
      ml_item_id: itemId, ml_permalink: item.permalink ?? null, status: 'publicado',
      publicado_em: new Date().toISOString(), erro_mensagem: null,
    }).eq('id', familia.id as string), 'família do kit');
  }
  exigir(await admin.from('variacoes').update({
    ml_variation_id: null, preco_publicado_ml: variacao.preco_publicacao == null ? null : Number(variacao.preco_publicacao),
  }).eq('id', variacao.id as string), 'variação do kit');

  // Best-effort, como na publicação UP: o item já existe; o operador vê a falta no anúncio.
  if (familia.descricao_ml) {
    await ml.garantirDescricao(itemId, familia.descricao_ml as string)
      .catch((e) => console.error('kit_descricao_falhou', itemId, String(e)));
  }
  await enfileirarSincronizacaoFiscal(familia.id as string).catch((e) => console.error('kit_fiscal_falhou', familia.id, String(e)));
  await talvezFinalizarLote(admin, familia.lote_id as string);
  return { ok: true };
}

/** Fim da saga de criação: kit `publicado`, ou `erro` com família em erro quando nada foi criado. Best-effort. */
async function fecharCriacao(admin: SupabaseClient, orgId: string, transferenciaId: string, acao: string): Promise<void> {
  if (!['concluida', 'travada', 'abortada'].includes(acao)) return;
  try {
    const { data: t } = await admin.from('kit_transferencias').select('kit_id, tipo, alerta').eq('id', transferenciaId).single();
    const { data: criar } = await admin.from('kit_transferencia_alvos').select('codigo')
      .eq('transferencia_id', transferenciaId).eq('criar', true);
    if (!t?.kit_id || !criar?.length) return;
    const ok = acao === 'concluida';
    await admin.from('kits_variacao').update({ status: ok ? 'publicado' : 'erro' }).eq('id', t.kit_id).eq('status', 'publicando');
    if (ok) return;
    const { data: kit } = await admin.from('kits_variacao').select('codigo_pai_kit').eq('id', t.kit_id).single();
    const { data: fams } = await admin.from('familias').select('id, lote_id').eq('org_id', orgId)
      .eq('codigo_pai', kit?.codigo_pai_kit ?? '').is('ml_item_id', null);
    for (const fam of fams ?? []) {
      await admin.from('familias').update({ status: 'erro', erro_mensagem: `Kit com variação: ${t.alerta ?? acao}` }).eq('id', fam.id);
      await talvezFinalizarLote(admin, fam.lote_id as string);
    }
  } catch (e) {
    console.error('kit_fechar_criacao_falhou', transferenciaId, String(e));
  }
}

/**
 * Task 14: fim de transferência (entrada, ajuste, estorno, cancelamento, montagem, volta a Guardado) dispara a rodada
 * de reposição dos kits que usam os SKUs, agrupada por kit na fila. Todos os kits, não só os automáticos: a rodada
 * também desfaz a pausa da automação de kit desligado. Best-effort: a reconciliação diária repete.
 */
async function reporDepois(admin: SupabaseClient, orgId: string, transferenciaId: string, acao: string): Promise<void> {
  if (acao !== 'concluida' && acao !== 'abortada') return;
  try {
    const { data, error } = await admin.from('kit_transferencia_alvos').select('codigo')
      .eq('transferencia_id', transferenciaId).eq('org_id', orgId);
    if (error) throw new Error(error.message);
    await dispararReposicao(admin, orgId, [...new Set((data ?? []).map((a) => a.codigo as string))],
      (kitId) => enfileirarReposicao(orgId, kitId), { soAutomaticos: false });
  } catch (e) {
    console.error('kit_reposicao_disparo_falhou', transferenciaId, String(e));
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) return new Response('Invalid signature', { status: 401, headers: corsHeaders });

  let job: KitTransferenciaJob;
  try {
    job = JSON.parse(body);
  } catch {
    return new Response('Body inválido', { status: 400, headers: corsHeaders });
  }
  if (!job?.transferencia_id || !job.org_id) return new Response('Body inválido', { status: 400, headers: corsHeaders });

  try {
    const r = await avancarSaga(deps(job.org_id, job.transferencia_id), job.transferencia_id);
    await fecharCriacao(adminClient(), job.org_id, job.transferencia_id, r.acao);
    await reporDepois(adminClient(), job.org_id, job.transferencia_id, r.acao);
    // Aviso de fim com chave: falha só loga e fica sem marca para a varredura diária; a saga já terminou.
    if (r.acao === 'concluida') {
      await avisarFimTransferencia(adminClient(), notificarCategoria, job.org_id, job.transferencia_id)
        .catch((e) => console.error('kit_aviso_fim_falhou', job.transferencia_id, String(e)));
    }
    // Ocupada: outra invocação tem o claim, ou a anterior morreu e o prazo ainda não venceu. O QStash
    // repete; se a outra estava viva, a repetição só executa um passo já idempotente.
    return json(r.acao === 'ocupada' ? 409 : 200, r);
  } catch (e) {
    console.error(`kit-transferencia ${job.transferencia_id}: ${(e as Error).message}`);
    return json(500, { erro: (e as Error).message });
  }
});
