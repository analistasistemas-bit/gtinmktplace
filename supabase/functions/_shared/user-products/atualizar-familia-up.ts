// ADR-0088 Fase 2 — UPDATE de uma família User Products (N itens filhos, um por cor). Orquestra a
// mini-saga de composição (atualizar-composicao.ts): monta as portas reais (Supabase + API do ML),
// roda a saga e mapeia o desfecho para a persistência (familias/raiz). Chamado por
// update-familia-ml/processar.ts quando a família tem linhas em `anuncios_externos_itens`.
//
// UPDATE UP é 100% GET-ao-vivo (não usa o cache de formato, ADR §"UPDATE permanece 100% GET"):
// a detecção de UP é a existência das linhas filhas; o family_id/status vêm por GET.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { ChannelConnector, ContextoCanal, FaixaAtacado } from '../canais/contrato.ts';
import type { ConexaoCanal } from '../canais/conexao.ts';
import { montarPayloadItem } from '../ml/publicar.ts';
import { buscarItemPorSku, buscarItemUP, type FetchLike } from '../ml/buscar-item.ts';
import { criarItemML, atualizarSecaoCores } from '../ml/criar-item.ts';
import { atualizarStatusML, atualizarItemPlanoML } from '../ml/atualizar-item.ts';
import { lerSchemaAtributos } from '../categoria/schema.ts';
import { enfileirarVinculacaoCatalogo } from '../queue.ts';
import { decidirRetryTransitorio } from '../publicacao/retry.ts';
import { ehCorIndefinida } from '../cor/indefinida.ts';
import { notificarCategoria } from '../notificacoes/config.ts';
import {
  atualizarComposicao, type PortasComposicao, type FilhoComp, type ConfirmacaoComp, type ResultadoComposicao,
} from './atualizar-composicao.ts';

const ITENS = 'anuncios_externos_itens';
const RAIZ = 'anuncios_externos';

export interface VariacaoUP {
  codigo: string; cor: string | null; estoque: number;
  preco_publicacao: number | string | null; gtin: string | null;
  imagem_path: string | null; ml_picture_id: string | null;
  altura_cm?: number | string | null; largura_cm?: number | string | null;
  comprimento_cm?: number | string | null; peso_gramas?: number | string | null;
}

export interface RaizUP { id: string; titulo: string | null; criado_em?: string | null }

export interface AtualizarFamiliaUPArgs {
  admin: SupabaseClient;
  conn: ChannelConnector;
  ctx: ContextoCanal;
  conexao: ConexaoCanal;
  familia: {
    id: string; org_id: string; codigo_pai: string;
    categoria_ml_id: string | null; descricao_ml: string | null; atributos_ml?: unknown;
    capa_ml_picture_id: string | null; capa2_ml_picture_id: string | null; capa3_ml_picture_id: string | null;
    atacado?: unknown; atacado_status?: string | null;
  };
  raiz: RaizUP;
  variacoes: VariacaoUP[];
  somenteEstoque: boolean;
  /** Nº de tentativas do QStash (orçamento de retry do desfecho `incompleto`, Fix 4b). */
  tentativas: number;
  /** Reconciliador de convergência: converge pro `skus_esperados` JÁ GRAVADO na raiz (o snapshot
   *  da mudança de composição interrompida) em vez de `variacoes.map(codigo)` — o UPDATE comum
   *  nunca precisa disso (variacoes já É o desejado atual). Sem override, comportamento intacto. */
  skusDesejadosOverride?: string[];
  /** Injetável em teste; produção usa a saga real. */
  executarSaga?: (portas: PortasComposicao, entrada: Parameters<typeof atualizarComposicao>[1]) => Promise<ResultadoComposicao>;
  now?: () => string;
}

export type ResultadoAtualizarUP =
  | { estado: 'ok'; adicionadas: number }
  | { estado: 'retry'; mensagem: string }
  | { estado: 'erro'; mensagem: string };

const num = (v: number | string | null | undefined): number | null =>
  v == null ? null : Number(v);

export async function atualizarFamiliaUP(args: AtualizarFamiliaUPArgs): Promise<ResultadoAtualizarUP> {
  const { admin, conn, ctx, conexao, familia, raiz, variacoes, somenteEstoque } = args;
  const executarSaga = args.executarSaga ?? atualizarComposicao;
  const now = args.now ?? (() => new Date().toISOString());
  const rootId = raiz.id;
  const familyName = raiz.titulo ?? '';
  // Fix 1: se a composição chegou a ligar mudando_composicao, qualquer exceção posterior (rede/
  // Supabase/etc.) precisa limpar a flag antes de propagar — senão o gate do caso 0 da agregação
  // esconde o erro pra sempre (família presa em `publicando`).
  let composicaoIniciada = false;

  const skusDesejados = args.skusDesejadosOverride ?? variacoes.map((v) => v.codigo);
  const estoquePorSku: Record<string, number> = {};
  for (const v of variacoes) estoquePorSku[v.codigo] = v.estoque;
  const precoRaw = variacoes.find((v) => v.preco_publicacao != null)?.preco_publicacao;
  const precoFamilia = precoRaw != null ? Number(precoRaw) : null;

  // family_id esperado: das cores vivas (não-retiradas) já confirmadas — valida a cor nova.
  const { data: filhosRaw } = await admin.from(ITENS)
    .select('sku, status, retirado, item_externo_id, family_id').eq('anuncio_externo_id', rootId);
  const filhos = (filhosRaw ?? []) as Array<Record<string, unknown>>;
  const familyIdEsperado = (filhos.find((f) => !f.retirado && f.family_id != null)?.family_id as string | null) ?? null;
  const jaAtivos = new Set(filhos.filter((f) => !f.retirado && f.status === 'ativo' && f.item_externo_id).map((f) => f.sku as string));
  const adicionadas = skusDesejados.filter((sku) => !jaAtivos.has(sku)).length;

  // aceitaEmptyGtin: lido do schema da categoria (como o CREATE/publish faz) p/ a cor nova.
  let aceitaEmptyGtin: boolean | undefined;
  if (familia.categoria_ml_id) {
    try {
      const schema = await lerSchemaAtributos(await ctx.getToken(), familia.categoria_ml_id);
      if (schema.length) aceitaEmptyGtin = schema.some((s) => s.id === 'EMPTY_GTIN_REASON');
    } catch { /* fallback hard-coded do montarPayloadItem */ }
  }

  const criadoEm = raiz.criado_em ?? null;
  const desdeMs = criadoEm ? Date.parse(criadoEm) - 60 * 60 * 1000 : Date.now() - 24 * 60 * 60 * 1000;
  const fetchLike: FetchLike = (url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<FetchLike>;

  const BUCKET = 'imagens';
  const signed = async (path: string): Promise<string> => {
    const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 2);
    if (error || !data) throw new Error(`Signed URL falhou para ${path}`);
    return data.signedUrl;
  };

  const varPorSku = new Map(variacoes.map((v) => [v.codigo, v]));
  const familiaInput = {
    titulo_ml: familyName, descricao_ml: familia.descricao_ml,
    categoria_ml_id: familia.categoria_ml_id, atributos_ml: familia.atributos_ml,
  };
  // criarPlano: mesma disciplina de foto do caminho Legacy `novas` — sobe a foto da cor nova
  // (idempotente via ml_picture_id), depois monta o payload plano com o family_name da partição.
  const criarPlano = async (sku: string): Promise<{ itemExternoId: string; permalink: string }> => {
    const v = varPorSku.get(sku)!;
    let picId = v.ml_picture_id;
    if (!picId && v.imagem_path) {
      picId = await conn.subirFoto(ctx, await signed(v.imagem_path));
      await admin.from('variacoes').update({ ml_picture_id: picId }).eq('familia_id', familia.id).eq('codigo', sku);
    }
    const dimensoes = {
      altura_cm: num(v.altura_cm), largura_cm: num(v.largura_cm),
      comprimento_cm: num(v.comprimento_cm), peso_gramas: num(v.peso_gramas),
    };
    const payload = montarPayloadItem(
      familiaInput as never,
      [{ codigo: v.codigo, cor: v.cor, estoque: v.estoque, preco_publicacao: num(v.preco_publicacao), gtin: v.gtin, ml_picture_id: picId }] as never,
      familia.capa_ml_picture_id, familia.capa2_ml_picture_id, familia.capa3_ml_picture_id,
      undefined, null, dimensoes, aceitaEmptyGtin, 'plano',
    );
    const r = await criarItemML(await ctx.getToken(), payload);
    return { itemExternoId: r.id, permalink: r.permalink };
  };

  const atualizarLinha = async (sku: string, patch: Record<string, unknown>) => {
    const { error } = await admin.from(ITENS).update(patch).eq('anuncio_externo_id', rootId).eq('sku', sku);
    if (error) throw new Error(`${ITENS} update (${sku}): ${error.message}`);
  };

  const portas: PortasComposicao = {
    async listar() {
      const { data, error } = await admin.from(ITENS)
        .select('sku, status, retirado, item_externo_id, family_id').eq('anuncio_externo_id', rootId);
      if (error) throw new Error(`${ITENS} select: ${error.message}`);
      return (data ?? []).map((r: Record<string, unknown>): FilhoComp => ({
        sku: r.sku as string, status: r.status as FilhoComp['status'],
        retirado: (r.retirado as boolean) ?? false,
        itemExternoId: (r.item_externo_id as string | null) ?? null,
        familyId: (r.family_id as string | null) ?? null,
      }));
    },
    async iniciarComposicao(skusEsperados) {
      composicaoIniciada = true;
      // mudando_composicao_familia_id (revisão Codex): referência durável à família QUE INICIOU
      // este episódio — a raiz não tem FK direta pra uma família específica (múltiplas linhas de
      // `familias` compartilham o mesmo codigo_pai, 1 por lote). Sem isto, o reconciliador de
      // convergência teria que ADIVINHAR a família por recência, podendo escolher a errada.
      const { error } = await admin.from(RAIZ)
        .update({ skus_esperados: skusEsperados, mudando_composicao: true, mudando_composicao_familia_id: familia.id })
        .eq('id', rootId);
      if (error) throw new Error(`${RAIZ} iniciarComposicao: ${error.message}`);
    },
    async limparComposicao() {
      // reconciliacao_tentativas é por-EPISÓDIO de mudando_composicao=true (achado durante o
      // design do reconciliador de convergência): sem zerar aqui, uma família que já gastou
      // rodadas numa composição anterior (sucesso ou esgotamento) começaria a PRÓXIMA mudança de
      // composição já com o contador antigo, esgotando o orçamento mais rápido que deveria.
      const { error } = await admin.from(RAIZ)
        .update({ mudando_composicao: false, reconciliacao_tentativas: 0, mudando_composicao_familia_id: null }).eq('id', rootId);
      if (error) throw new Error(`${RAIZ} limparComposicao: ${error.message}`);
    },
    async reservar(sku) {
      const { error } = await admin.from(ITENS).upsert(
        [{ anuncio_externo_id: rootId, org_id: familia.org_id, sku, status: 'pendente' }],
        { onConflict: 'anuncio_externo_id,sku', ignoreDuplicates: true },
      );
      if (error) throw new Error(`${ITENS} reservar (${sku}): ${error.message}`);
    },
    salvarStatus: (sku, status) => atualizarLinha(sku, { status }),
    salvarCriado: (sku, itemExternoId) => atualizarLinha(sku, { item_externo_id: itemExternoId, status: 'criado' }),
    salvarConfirmacao: (sku, dados) => atualizarLinha(sku, {
      family_id: dados.familyId, user_product_id: dados.userProductId ?? null, permalink: dados.permalink ?? null,
    }),
    marcarAtivo: (sku) => atualizarLinha(sku, { status: 'ativo', retirado: false }),
    marcarRetirado: (sku) => atualizarLinha(sku, { status: 'pausado', retirado: true }),
    buscarPorSku: (sku) => ctx.getToken().then((accessToken) =>
      buscarItemPorSku(fetchLike, {
        accessToken, sellerId: conexao.contaExternaId ?? '',
        categoriaId: familia.categoria_ml_id ?? '', familyName, desdeMs,
      }, sku)),
    criarPlano,
    async confirmar(itemExternoId): Promise<ConfirmacaoComp> {
      const item = await buscarItemUP(fetchLike, { accessToken: await ctx.getToken() }, itemExternoId);
      const sellerEsperado = conexao.contaExternaId ?? '';
      // GET falhou (404/erro/null) → transiente (ok:false, retentável).
      if (!item) return { ok: false, status: null };
      // GET SUCEDEU mas é o item ERRADO (outro vendedor) → estado remoto inesperado, TERMINAL (Fix 4a).
      if (item.sellerId != null && item.sellerId !== sellerEsperado) {
        return { ok: false, status: item.status, inesperado: true };
      }
      // family_id ainda não computado pelo ML (lag conhecido de UP) → transiente, retoma no retry.
      if (!item.familyId) return { ok: false, status: item.status };
      return { ok: true, status: item.status, familyId: item.familyId, userProductId: item.userProductId, permalink: item.permalink };
    },
    ativar: (itemExternoId) => ctx.getToken().then((t) => atualizarStatusML(t, itemExternoId, 'active')),
    pausar: (itemExternoId) => ctx.getToken().then((t) => atualizarStatusML(t, itemExternoId, 'paused')),
    repor: (itemExternoId, patch) => ctx.getToken().then((t) => atualizarItemPlanoML(t, itemExternoId, patch)),
  };

  // ── efeitos pós-composição (Fix 5) ──────────────────────────────────────────────────────────
  const efeitosPosComposicao = async (criadas: string[], houveMudanca: boolean): Promise<void> => {
    // Catálogo (ADR-0021/0088 F2): só quando entrou cor GENUINAMENTE nova. Readd preserva
    // catalog_product_id/catalog_listing_id (marcarRetirado não os limpa; carregarFilhosCatalogoUP
    // filtra retirado=false, reincluindo no readd) e o worker é idempotente — logo readd não precisa
    // de novo opt-in. Best-effort.
    if (criadas.length > 0) {
      try { await enfileirarVinculacaoCatalogo(familia.id); }
      catch (e) { console.error(`enfileirar catálogo UP (update) falhou (${familia.id}):`, e); }
    }
    if (!houveMudanca) return; // sem_mudanca (reposição pura) → nada de descrição/atacado.

    const alertarFalhaLoud = async (msg: string): Promise<void> => {
      try { await notificarCategoria(admin, familia.org_id, 'integracao', msg); }
      catch (e) { console.error(`notificar falha (família ${familia.codigo_pai}) falhou:`, e); }
    };

    // Itens finais ativos (cada cor UP é um anúncio ML separado → efeitos POR item). Erro de
    // consulta NÃO pode virar "sucesso silencioso" — sem saber quais itens estão realmente ativos
    // não há como aplicar descrição/atacado com segurança; alerta LOUD e pula esta rodada por
    // completo (nada é persistido como se tivesse sincronizado).
    const { data: finaisRaw, error: finaisErr } = await admin.from(ITENS)
      .select('sku, item_externo_id, retirado, status').eq('anuncio_externo_id', rootId);
    if (finaisErr) {
      console.error(`efeitosPosComposicao: itens finais falhou (${rootId}):`, finaisErr.message);
      await alertarFalhaLoud(`Família ${familia.codigo_pai}: consulta dos itens ativos falhou após mudança de composição — descrição/atacado NÃO sincronizados nesta rodada (${finaisErr.message}).`);
      return;
    }
    const finais = ((finaisRaw ?? []) as Array<Record<string, unknown>>)
      .filter((f) => !f.retirado && f.status === 'ativo' && f.item_externo_id)
      .map((f) => f.item_externo_id as string);
    // `concluido` só é retornado quando TODA cor desejada está confirmada `ativo` (senão a saga
    // devolve `incompleto`/`erro`) — logo finais=[] aqui só é alcançável com skusDesejados=[], ou
    // seja, a família ficaria sem nenhuma cor. Suportado pela SAGA (não é um estado que ela proíbe),
    // mas o chamador real (update-familia-ml/processar.ts) hoje rejeita `variacoes.length === 0`
    // ANTES de chegar aqui (400 "Nenhuma cor incluída") — então esse ramo é inalcançável no caminho
    // atual, e é mantido como defesa caso essa validação do chamador mude no futuro. Caso legítimo
    // (família esvaziada), não anomalia: sem item ativo não há descrição/atacado pra sincronizar.
    if (finais.length === 0) {
      console.info(`efeitosPosComposicao: família ${familia.codigo_pai} sem itens ativos (todas as cores removidas) — descrição/atacado pulados.`);
      return;
    }

    // Descrição (recurso separado): a lista de cores mudou → recalcula a seção "CORES DISPONÍVEIS"
    // UMA VEZ (função pura, sem I/O) — é o mesmo texto lógico pros N itens, não há N listas
    // possíveis. Push é INCONDICIONAL pra todo item ativo (revisão Codex: um guard "só empurra se
    // o texto local mudou" impediria reparar um push anterior que falhou — na 2ª tentativa o texto
    // local já bateria com o novo e NENHUM item receberia o reenvio, nem o que ficou desatualizado).
    // A comparação só decide se vale a pena REESCREVER `familias.descricao_ml` (evita write redundante).
    // `descricao_ml` é o estado DESEJADO (não "confirmado-sincronizado"): persiste mesmo se 1 push
    // remoto falhar — manter a string antiga faria a próxima rodada reverter cores que já deram
    // certo nos outros itens.
    //
    // Estado durável (revisão Opus+Codex, 2 rodadas): notificação sozinha (texto livre, não
    // consultável) não satisfaz "nunca mascarar falha em silêncio" — espelha EXATAMENTE
    // `atacado_status`/`atacado_erro` (mesmo bloco, abaixo): agregado por-família (não por-item,
    // como o atacado), limpo no sucesso, gravado na falha. `notificarCategoria` continua rodando
    // TAMBÉM (alerta ativo — Telegram/in-app); a coluna é o estado reconciliável/consultável que
    // sobrevive a uma notificação nunca lida. Best-effort quanto a DERRUBAR a publicação já
    // concluída (mesmo espírito do bloco de catálogo/atacado) — nunca best-effort quanto a marcar.
    // ponytail: sem lock contra 2 composições concorrentes na mesma família — a saga inteira já
    // aceita last-writer-wins nesse cenário raro (operador-driven); o Reconciliador de convergência
    // (mudando_composicao/estado_desejado) NÃO cobre conteúdo de descrição — só esta coluna cobre.
    if (conn.capabilities.descricaoSeparada && familia.descricao_ml) {
      const cores = [...new Set(
        variacoes.map((v) => v.cor).filter((c): c is string => !ehCorIndefinida(c)),
      )];
      const novaDescricao = atualizarSecaoCores(familia.descricao_ml, cores);

      let todosOk = true;
      const falhas: string[] = [];
      for (const id of finais) {
        try { await conn.garantirDescricao(ctx, id, novaDescricao); }
        catch (e) {
          todosOk = false;
          falhas.push(id);
          console.error(`descrição UP (update) falhou (${id}):`, e);
        }
      }
      // Erro ao persistir o texto DESEJADO também conta pro estado agregado — se o push deu certo
      // em todos os N itens mas o texto-fonte não gravou, a próxima composição recalcularia a
      // seção de cores em cima do texto ANTIGO (a família ficaria "ok" mas com base errada).
      let persistErro: string | null = null;
      if (novaDescricao !== familia.descricao_ml) {
        const { error } = await admin.from('familias').update({ descricao_ml: novaDescricao }).eq('id', familia.id);
        if (error) {
          persistErro = error.message;
          console.error(`descrição UP (update): persistir familias.descricao_ml falhou (${familia.id}):`, error.message);
        }
      }
      const ok = todosOk && !persistErro;
      const partes = [
        !todosOk ? `não sincronizou em: ${falhas.join(', ')}` : null,
        persistErro ? `falha ao persistir o texto (${persistErro})` : null,
      ].filter((p): p is string => !!p);
      const { error: statusErr } = await admin.from('familias')
        .update({ descricao_status: ok ? null : 'erro', descricao_erro: ok ? null : partes.join('; ') })
        .eq('id', familia.id);
      if (!ok) {
        await alertarFalhaLoud(`Descrição da família ${familia.codigo_pai}: ${partes.join('; ')}. A lista de cores publicada pode estar desatualizada.`);
      }
      // Revisão (Codex, 3ª rodada): a própria gravação do estado durável falhando em silêncio
      // reintroduziria o problema um nível abaixo. Diferente do resto de efeitosPosComposicao
      // (best-effort, "não derruba o desfecho ok"), ESTA gravação é o estado LOUD que a revisão
      // toda existe pra garantir — se ela falhar, propaga (o worker aplica o orçamento de retry
      // já existente via QStash; o push em si é idempotente, retry é seguro).
      if (statusErr) {
        throw new Error(`descrição UP (update): persistir descricao_status falhou (${familia.id}): ${statusErr.message}`);
      }
    }

    // Atacado/PxQ: espelha a condição EXATA do Legacy (processar.ts) — reaplica com faixas
    // configuradas OU limpa (envia faixas vazias) quando já estava aplicado e as faixas somem;
    // atualiza atacado_status/atacado_erro (o caminho UP anterior nunca tocava esses campos).
    if (!somenteEstoque && conn.capabilities.atacado) {
      const faixas = Array.isArray(familia.atacado) ? (familia.atacado as FaixaAtacado[]) : [];
      const jaAplicado = familia.atacado_status === 'aplicado';
      const aplicandoFaixas = faixas.length > 0;
      if (aplicandoFaixas || jaAplicado) {
        if (aplicandoFaixas && precoFamilia == null) {
          const m = 'Atacado sem preço-base: sem preço novo nem preço vivo conhecido';
          await admin.from('familias').update({ atacado_status: 'erro', atacado_erro: m }).eq('id', familia.id);
        } else {
          let ok = true;
          for (const id of finais) {
            try { await conn.aplicarAtacado(ctx, id, precoFamilia ?? 0, faixas); }
            catch (e) { ok = false; console.error(`atacado UP (update) falhou (${id}):`, e); }
          }
          await admin.from('familias')
            .update(ok ? { atacado_status: aplicandoFaixas ? 'aplicado' : null, atacado_erro: null }
              : { atacado_status: 'erro', atacado_erro: 'Falha ao aplicar atacado em uma ou mais cores' })
            .eq('id', familia.id);
        }
      }
    }
  };

  let resultado: ResultadoComposicao;
  try {
    resultado = await executarSaga(portas, {
      skusDesejados, estoquePorSku, precoFamilia, somenteEstoque, familyIdEsperado,
    });
  } catch (e) {
    // Fix 1: exceção não tratada com a composição já iniciada — limpa a flag (best-effort, nunca
    // falha por causa disso) ANTES de re-propagar. Deliberadamente NÃO marca filhos `erro`: um erro
    // transitório é retentável (o worker aplica o orçamento) e marcar `erro` bloquearia o próprio
    // retry que resolveria (Fix 2 recusa reativar filho terminal). Re-lança para o worker decidir.
    if (composicaoIniciada) {
      // Best-effort real: Supabase resolve com {error} em vez de rejeitar a Promise em muitas
      // falhas — checar e logar o error é o que torna essa tentativa de limpeza observável (revisão
      // v3). Não há como GARANTIR a limpeza sem um outbox/transação; isso pelo menos não a esconde.
      const { error: errLimpar } = await admin.from(RAIZ)
        .update({ mudando_composicao: false, reconciliacao_tentativas: 0, mudando_composicao_familia_id: null }).eq('id', rootId)
        .then((r: { error: { message: string } | null }) => r, (err: unknown) => ({ error: { message: String(err) } }));
      if (errLimpar) console.error(`limpar mudando_composicao (catch) falhou (${rootId}):`, errLimpar.message);
    }
    throw e;
  }

  if (resultado.tipo === 'sem_mudanca' || resultado.tipo === 'concluido') {
    const criadas = resultado.tipo === 'concluido' ? resultado.criadas : [];
    // Fix 5: efeitos que o UPDATE Legacy já faz — best-effort, não derrubam o desfecho ok.
    await efeitosPosComposicao(criadas, resultado.tipo === 'concluido');
    await admin.from('familias').update({ status: 'publicado', publicado_em: now() }).eq('id', familia.id);
    return { estado: 'ok', adicionadas };
  }
  if (resultado.tipo === 'incompleto') {
    // Fix 4b: transiente por confirmação-por-GET não fechada. Enquanto houver orçamento de retry,
    // persiste (flag fica ligada, família 'publicando') e a próxima execução retoma. Esgotado o
    // orçamento, converte para erro terminal VISÍVEL (senão retentaria pra sempre um 404/deletado)
    // — e limpa a flag, senão o gate do caso 0 esconderia o erro pra sempre.
    if (decidirRetryTransitorio({ retentavel: true }, args.tentativas) === 'retentar') {
      return { estado: 'retry', mensagem: 'Mudança de composição em andamento — retomando.' };
    }
    const { error: errLimpar } = await admin.from(RAIZ)
      .update({ mudando_composicao: false, reconciliacao_tentativas: 0, mudando_composicao_familia_id: null }).eq('id', rootId)
      .then((r: { error: { message: string } | null }) => r, (err: unknown) => ({ error: { message: String(err) } }));
    if (errLimpar) console.error(`limpar mudando_composicao (incompleto esgotado) falhou (${rootId}):`, errLimpar.message);
    const m = 'UPDATE não convergiu: a confirmação por GET não fechou após várias tentativas (item deletado, outro vendedor ou 404 persistente). Intervenção manual necessária.';
    await admin.from('familias').update({ status: 'erro', erro_mensagem: m }).eq('id', familia.id);
    return { estado: 'erro', mensagem: m };
  }
  // erro terminal (family_id divergente, busca ambígua, item errado, filho em estado terminal).
  const msg = resultado.codigo === 'familia_up_desagrupada'
    ? 'UPDATE bloqueado: o Mercado Livre agrupou a cor nova numa família diferente (family_id divergente). Intervenção manual necessária.'
    : resultado.codigo === 'busca_ambigua'
      ? 'UPDATE bloqueado: busca por SKU ambígua/truncada ao adotar item existente. Intervenção manual necessária.'
      : resultado.codigo === 'estado_remoto_inesperado'
        ? 'UPDATE bloqueado: estado remoto inesperado ao confirmar um item (deletado/404/outro vendedor). Intervenção manual necessária.'
        : `UPDATE bloqueado: a cor ${resultado.sku} está em estado '${resultado.status}', que exige intervenção manual (erro/compensação pendente/remoção pendente/pausada administrativamente) antes de adicionar/repor. Resolva essa cor no ML e tente de novo.`;
  await admin.from('familias').update({ status: 'erro', erro_mensagem: msg }).eq('id', familia.id);
  return { estado: 'erro', mensagem: msg };
}
