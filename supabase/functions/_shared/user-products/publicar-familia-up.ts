// ADR-0088 — publicação de UMA família multi-cor numa categoria User Products (item plano).
// Orquestra: grava a raiz lógica (partição 0) com skus_esperados ANTES da saga, monta as portas
// reais, roda `publicarGrupo` e mapeia o desfecho para a persistência (familias/variacoes/raiz).
//
// Chamado por publish-familia-ml quando `variacoes.length > 1` e o formato é User Products
// (cache hit) ou o ML rejeitou o payload `variations` (FORMATO_INCOMPATIVEL).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { AnuncioCanonico, ChannelConnector, ContextoCanal, FaixaAtacado } from '../canais/contrato.ts';
import { aplicarAtacadoPorItem } from './atacado-por-item.ts';
import type { ConexaoCanal } from '../canais/conexao.ts';
import { montarPayloadItem, type PayloadItem } from '../ml/publicar.ts';
import { publicarGrupo, type ResultadoSaga, type CodigoErroSaga } from './publicar-grupo.ts';
import { criarPortasSupabase } from './portas-supabase.ts';
import { enfileirarVinculacaoCatalogo } from '../queue.ts';
import { garantirChart, GENDER_VALUE, type ChartResolvido, type ChartSemGuia, type Genero } from '../ml/size-chart.ts';
import { lerSchemaAtributos } from '../categoria/schema.ts';
import { resolverCorValueId } from '../cor/value-id.ts';
import { gradeDaFamilia } from '../produto/tipos-produto-valores.ts';
import {
  adquirirExclusao, kitLigado, lerPoliticas, podeReativar, skusParticipantes, soltarExclusao,
} from '../kit-variacao/politica.ts';
import { lerOferta } from '../kit-variacao/ml-oferta.ts';

const CANAL = 'mercado_livre';

export interface PublicarFamiliaUPArgs {
  admin: SupabaseClient;
  conn: ChannelConnector;
  ctx: ContextoCanal;
  conexao: ConexaoCanal;
  familia: {
    id: string; user_id: string; org_id: string; codigo_pai: string;
    titulo_ml: string | null; nome_pai: string | null; descricao_ml: string | null;
    /** ADR-0166/0167. Ausente/null = família sem tamanho, comportamento intacto (INV-1). */
    genero?: Genero | null;
    /** ADR-0182 D2. null = família legada (inferência só Letras/Calçado). */
    grade_tamanho?: string | null;
    atacado?: unknown; [k: string]: unknown;
  };
  anuncio: AnuncioCanonico;
  categoriaId: string;
  /** Lido do schema da categoria (como criarAnuncio faz); undefined cai no fallback hard-coded. */
  aceitaEmptyGtin?: boolean;
  /** Injetável em teste; produção usa a saga real. */
  executarSaga?: (portas: ReturnType<typeof criarPortasSupabase>, entrada: { anuncioExternoId: string; skusEsperados: string[] }) => Promise<ResultadoSaga>;
  /** Injetável em teste; produção resolve o chart real (ADR-0167). */
  garantirChartFn?: typeof garantirChart;
  /** Injetável em teste; produção lê o schema real da categoria (dicionário de COLOR). */
  lerSchemaAtributosFn?: typeof lerSchemaAtributos;
  /** ADR-0200: leitura do UP para confirmar a publicação de SKU de kit com variação. */
  lerOfertaFn?: typeof lerOferta;
  /** ADR-0200: `sku_politica_kit.versao` de cada SKU de kit, capturada ao enfileirar (Publicar/Reenviar). */
  versoesKit?: Record<string, number>;
  now?: () => string;
}

export type ResultadoUP =
  | { estado: 'ativo'; itemExternoId: string; permalink: string | null }
  | { estado: 'compensacao_pendente' | 'publicando' | 'parcial' | 'pausado'; mensagem: string }
  | { estado: 'erro'; codigo?: CodigoErroSaga; mensagem: string };

// Comparador de cor estável (mesma base de ordenarCoresAlfabetica; empate → sku) para escolher
// o 1º item da partição de forma determinística entre execuções.
function ordenarPorCor<T extends { sku: string; cor: string | null }>(vs: T[]): T[] {
  return [...vs].sort((a, b) =>
    (a.cor ?? '').localeCompare(b.cor ?? '', 'pt-BR', { sensitivity: 'base', numeric: true })
    || a.sku.localeCompare(b.sku));
}

/**
 * ADR-0200: identidade (o item é do UP gravado), estado `active` e quantidade do UP no ML que não passa do
 * saldo local relido sob a exclusão, por leitura do ML. Qualquer falha ou excesso devolve false.
 * Abaixo do local é o lado seguro (venda já baixada no ML, entrada pendente); a triagem diária reconcilia.
 */
async function confirmarNoMl(
  args: PublicarFamiliaUPArgs, rootId: string, codigos: string[],
  varPorSku: Map<string, AnuncioCanonico['variacoes'][number]>,
): Promise<boolean> {
  try {
    const { data, error } = await args.admin.from('anuncios_externos_itens')
      .select('sku, item_externo_id, user_product_id').eq('anuncio_externo_id', rootId).in('sku', codigos);
    if (error) throw new Error(error.message);
    const ler = args.lerOfertaFn ?? lerOferta;
    const token = await args.ctx.getToken();
    for (const codigo of codigos) {
      const f = (data ?? []).find((r) => r.sku === codigo);
      if (!f?.item_externo_id || !f.user_product_id) return false;
      const oferta = await ler(token, f.user_product_id as string, [f.item_externo_id as string]);
      const item = oferta.itens.find((i) => i.id === f.item_externo_id);
      const local = varPorSku.get(codigo)?.estoque;
      if (item?.status !== 'active' || local == null || oferta.quantidade > local) return false;
    }
    return true;
  } catch (e) {
    console.error('kit_publicacao_confirmacao_falhou', rootId, String(e));
    return false;
  }
}

/** family_name da partição 0: o ML agrupa por ele e o exibe ao comprador; recusa acima de 60 caracteres. */
export function familyNameDe(familia: { titulo_ml: string | null; nome_pai: string | null; codigo_pai: string }): string {
  return (familia.titulo_ml ?? familia.nome_pai ?? familia.codigo_pai).slice(0, 60).trimEnd();
}

/**
 * Payload plano por SKU de uma família User Products: guia de tamanhos da própria conta (ADR-0167), GENDER,
 * dicionário de COLOR e family_name. Usado pela publicação e pelo CREATE do kit com variação na saga (ADR-0200),
 * que passa a variação com o saldo inicial calculado por ela.
 */
export async function prepararPayloadUP(args: {
  admin: SupabaseClient; ctx: ContextoCanal; conexao: ConexaoCanal;
  familia: PublicarFamiliaUPArgs['familia']; anuncio: AnuncioCanonico; categoriaId: string;
  aceitaEmptyGtin?: boolean; garantirChartFn?: typeof garantirChart; lerSchemaAtributosFn?: typeof lerSchemaAtributos;
}): Promise<{ familyName: string; montar: (v: AnuncioCanonico['variacoes'][number]) => PayloadItem }> {
  const { admin, ctx, conexao, familia, anuncio, categoriaId } = args;
  const garantirChartFn = args.garantirChartFn ?? garantirChart;
  const lerSchemaAtributosFn = args.lerSchemaAtributosFn ?? lerSchemaAtributos;

  // ADR-0167: família com tamanho precisa da guia de medidas ANTES de montar qualquer payload —
  // resolvida uma vez por família (nunca por SKU: SIZE_GRID_ID é o mesmo chart para todas as
  // cores/tamanhos da família, só SIZE_GRID_ROW_ID muda por tamanho). Sem tamanho em nenhuma
  // variação (toda org sem tipo de produto habilitado, INV-1), chart fica null e nada muda.
  const tamanhos = [...new Set(
    anuncio.variacoes.map((v) => v.tamanho).filter((t): t is string => !!t?.trim()),
  )];
  let chart: ChartResolvido | ChartSemGuia | null = null;
  let atributosComGenero = anuncio.atributos;
  if (tamanhos.length > 0) {
    if (!familia.genero) {
      throw new Error(
        `Família ${familia.id}: variação com tamanho mas familias.genero ausente — o ML exige `
        + 'GENDER junto com o guia de tamanhos (ADR-0167 Decisão 6); nunca publica sem gênero.',
      );
    }
    // ADR-0182 D2: grade gravada vence; sem ela só Letras/Calçado são inferíveis (calça 34–46
    // nunca vira calçado). Sem grade não há como escolher tabela/domínio — falha antes do chart.
    const grade = gradeDaFamilia(familia.grade_tamanho ?? null, tamanhos);
    if (!grade) {
      throw new Error(
        `Família ${familia.id}: tamanhos ${tamanhos.join(', ')} sem grade de tamanho definida `
        + '(familias.grade_tamanho) — recadastre o produto escolhendo a grade antes de publicar.',
      );
    }
    chart = await garantirChartFn(admin, await ctx.getToken(), conexao.id, categoriaId, familia.genero, tamanhos, grade);
    const genderValue = GENDER_VALUE[familia.genero];
    // Achado do checkpoint Fable: GENDER é `required` no schema — a IA/Revisão pode já ter
    // preenchido `atributos_ml` com um GENDER (possivelmente divergente do `familias.genero`
    // estruturado). SIZE/SIZE_GRID_ID/SIZE_GRID_ROW_ID entram por SKU em montarPayloadItem — se a
    // IA também os tivesse posto em atributos_ml (nível família), duplicariam do mesmo jeito.
    // `familias.genero` (ADR-0166, escolhido pelo operador) é sempre a fonte de verdade aqui.
    // ADR-0182 D7: CLOTHING_LOT_SIZE também é por SKU — nunca herdado do nível família.
    const IDS_SUBSTITUIDOS = new Set(['GENDER', 'SIZE', 'SIZE_GRID_ID', 'SIZE_GRID_ROW_ID', 'CLOTHING_LOT_SIZE']);
    atributosComGenero = [
      ...anuncio.atributos.filter((a) => !a.id || !IDS_SUBSTITUIDOS.has(a.id)),
      { id: 'GENDER', value_id: genderValue.id },
    ];
  }

  // Dicionário de COLOR da categoria, lido UMA vez por família (schema cacheado no Redis por 30
  // dias). Incidente 2026-09-20 (grade de jaqueta): sem `value_id` a cor fica fora dos filtros de
  // busca do ML e o nome do cadastro é reescrito pela grafia do dicionário.
  // ANTES do upsert da raiz e com try/catch próprio (revisão Fable): `lerSchemaAtributos` trata
  // 4xx mas o `fetch` cru propaga DNS/timeout/reset — deixar estourar aqui abortaria a publicação
  // com `anuncios_externos` já em `publicando`. Sem dicionário publicamos como antes (só o nome),
  // mas nunca em silêncio: é exatamente o estado que gerou o incidente.
  let valoresCor: { id: string; nome: string }[] = [];
  try {
    valoresCor = (await lerSchemaAtributosFn(await ctx.getToken(), categoriaId))
      .find((a) => a.id === 'COLOR')?.valores ?? [];
  } catch (e) {
    valoresCor = [];
    console.warn(`[publicar-familia-up] schema de ${categoriaId} indisponível: ${e instanceof Error ? e.message : e}`);
  }
  if (valoresCor.length === 0) {
    console.warn(
      `[publicar-familia-up] categoria ${categoriaId} sem dicionário de COLOR — publicando as cores `
      + 'só pelo nome (sem value_id): elas não entram nos filtros de cor da busca do ML.',
    );
  }

  // family_name da partição: o ML agrupa numa mesma UPP todos os itens com o MESMO family_name
  // (ADR §4) — e também o EXIBE como título ao cliente final (achado real em produção 2026-07-22:
  // um sufixo de desambiguação de partição aparecia na tela do comprador). Este worker
  // (publish-familia-ml) só publica a partição 0 e NUNCA compete por UPP com outra partição da
  // mesma família aqui (isso só existiria no split, publicar-split-ml, que ainda não integra a
  // saga UP — Fase 2) — então nenhum sufixo é necessário. O ML também rejeita family_name > 60
  // chars ("Family Name length is over of 60 character", achado real em produção); trunca por
  // segurança mesmo sem sufixo, já que o título pode já vir no limite.
  const familyName = familyNameDe(familia);
  const familiaInput = { titulo_ml: familyName, descricao_ml: anuncio.descricao, categoria_ml_id: categoriaId, atributos_ml: atributosComGenero };
  const montar = (v: AnuncioCanonico['variacoes'][number]): PayloadItem => {
    // Achado real de produção (2026-09-19, sandália): item.attributes[SIZE] tem que bater com o
    // RÓTULO da linha do chart ("37 BR"), não com `v.tamanho` cru ("37") — /items/validate real
    // devolveu invalid.fashion_grid.size.values com o valor cru. `montarPayloadItem` recebe os
    // dois: sizeLabel (o que vai no payload) e tamanho (só usado pro guard "sem grid resolvido").
    const grid = chart && 'chartId' in chart ? chart : null;
    const linha = v.tamanho ? grid?.linhaPorTamanho.get(v.tamanho) ?? null : null;
    return montarPayloadItem(
      familiaInput,
      [{
        codigo: v.sku, cor: v.cor, estoque: v.estoque, preco_publicacao: v.preco, gtin: v.gtin, ml_picture_id: v.fotoId,
        tamanho: v.tamanho ?? null, sizeLabel: linha?.sizeLabel ?? null,
        sizeGridId: grid?.chartId ?? null, sizeGridRowId: linha?.rowId ?? null,
        tamanhoSemGuia: v.tamanho && chart && 'semGuia' in chart ? chart.semGuia : null,
        corValueId: resolverCorValueId(v.cor, valoresCor),
      }],
      anuncio.capaFotoId, anuncio.capa2FotoId, anuncio.capa3FotoId,
      anuncio.listingTypeId, anuncio.dimensoes, args.aceitaEmptyGtin, 'plano', anuncio.galeriaFotoIds,
    );
  };

  return { familyName, montar };
}

/** Recusa definitiva da política do kit: vira `erro` com a mensagem, nunca `compensacao_pendente`. */
class RecusaKit extends Error {}

export async function publicarFamiliaUP(args: PublicarFamiliaUPArgs): Promise<ResultadoUP> {
  const { admin, conn, ctx, conexao, familia, anuncio, categoriaId } = args;
  const executarSaga = args.executarSaga ?? publicarGrupo;
  const now = args.now ?? (() => new Date().toISOString());

  const { familyName, montar } = await prepararPayloadUP({
    admin, ctx, conexao, familia, anuncio, categoriaId, aceitaEmptyGtin: args.aceitaEmptyGtin,
    garantirChartFn: args.garantirChartFn, lerSchemaAtributosFn: args.lerSchemaAtributosFn,
  });
  const skus = anuncio.variacoes.map((v) => v.sku);

  // 1. Grava a raiz lógica ANTES da saga (ADR §4): status=publicando, titulo=family_name,
  //    item_externo_id=null e skus_esperados já com o conjunto exato.
  const { data: raiz, error: raizErr } = await admin.from('anuncios_externos')
    .upsert({
      user_id: familia.user_id, org_id: familia.org_id, canal: CANAL, codigo_pai: familia.codigo_pai, particao: 0,
      status: 'publicando', titulo: familyName, item_externo_id: null,
      skus_esperados: skus, estado_desejado: null, erro_mensagem: null,
    }, { onConflict: 'org_id,canal,codigo_pai,particao' })
    .select('id, criado_em').maybeSingle();
  if (raizErr || !raiz) throw new Error(`anuncios_externos upsert (raiz UP): ${raizErr?.message ?? 'sem id'}`);
  const rootId = (raiz as { id: string }).id;

  // 2. Portas reais. Payload plano por SKU (`prepararPayloadUP`).
  const varPorSku = new Map(anuncio.variacoes.map((v) => [v.sku, v]));

  // ADR-0200: SKU de kit com variação. Só CREATE de item novo segue por aqui, com a exclusão do SKU
  // (dono = raiz, estável no retry) mantida até a confirmação no ML. Item que já existe ou que a busca
  // adotaria é da saga do kit (Gerenciar kit): recusa, exceto a retomada da própria publicação (a
  // exclusão já era deste dono antes da tentativa). Sob a exclusão: versão da política igual à capturada
  // ao enfileirar, `podeReativar` e saldo relido da variação canônica. A política é conferida de novo
  // antes de cada CREATE e antes de começar a ativar, fora do try da ativação do `publicarGrupo`.
  const participantes = await skusParticipantes(admin, familia.org_id, skus, kitLigado(familia));
  const codigosKit = [...participantes];
  const ehKit = participantes.size > 0;
  let validarPolitica = async () => {};
  let retomada = new Set<string>();
  let criouParticipante = false;
  const recusar = async (mensagem: string, soltar: boolean): Promise<ResultadoUP> => {
    if (soltar) await soltarExclusao(admin, familia.org_id, rootId);
    await admin.from('familias').update({ status: 'erro', erro_mensagem: mensagem }).eq('id', familia.id);
    return { estado: 'erro', mensagem };
  };
  if (ehKit) {
    const versoes = args.versoesKit;
    if (!versoes) {
      return recusar(`${codigosKit.join(', ')}: SKU em kit com variação numa publicação enfileirada sem a versão da `
        + 'política. Publique de novo.', false);
    }
    const { data: minhas, error: errMinhas } = await admin.from('kit_exclusoes').select('codigo')
      .eq('org_id', familia.org_id).eq('dono_id', rootId);
    if (errMinhas) throw new Error(`kit_exclusoes: ${errMinhas.message}`);
    retomada = new Set((minhas ?? []).map((m) => m.codigo as string));
    const ex = await adquirirExclusao(admin, familia.org_id, codigosKit, 'publicacao', rootId);
    if (!ex.ok) {
      throw new Error(`${ex.codigo ?? ex.motivo} está em transferência de kit com variação; a publicação tenta de novo depois.`);
    }
    validarPolitica = async () => {
      const vigente = await lerPoliticas(admin, familia.org_id, codigosKit);
      for (const codigo of codigosKit) {
        const p = vigente.get(codigo) ?? null;
        if ((p?.versao ?? 0) !== versoes[codigo]) {
          throw new RecusaKit(`${codigo}: a política do kit com variação mudou desde que a publicação foi enfileirada. `
            + 'Publique de novo.');
        }
        const d = podeReativar({ politica: p, origem: 'automatico' });
        if (!d.pode) throw new RecusaKit(`${codigo}: ${d.motivo} A publicação não ativa este SKU.`);
      }
    };
    try {
      await validarPolitica();
      const { data: filhos, error: errFilhos } = await admin.from('anuncios_externos_itens')
        .select('sku, item_externo_id').eq('anuncio_externo_id', rootId).in('sku', codigosKit);
      if (errFilhos) throw new Error(`anuncios_externos_itens: ${errFilhos.message}`);
      const existentes = (filhos ?? []).filter((f) => f.item_externo_id && !retomada.has(f.sku as string));
      if (existentes.length > 0) {
        throw new RecusaKit(`${existentes.map((f) => f.sku).join(', ')}: SKU em kit com variação já tem anúncio no `
          + 'Mercado Livre. Use Gerenciar kit.');
      }
      // Variação canônica da org (família mais recente, desempate pelo id), a mesma que a saga e o ledger usam,
      // resolvida no servidor (`DISTINCT ON`): o embed ordenado do PostgREST não ordena as linhas de `variacoes`.
      // Vale para o payload e para a confirmação (`varPorSku`).
      const { data, error } = await admin.rpc('kit_saldo_canonico', { p_org: familia.org_id, p_codigos: codigosKit });
      if (error) throw new Error(`kit_saldo_canonico (saldo sob exclusão): ${error.message}`);
      const saldo = (data ?? null) as Record<string, unknown> | null;
      if (!saldo || typeof saldo !== 'object' || Array.isArray(saldo)) throw new Error('kit_saldo_canonico: resposta inesperada');
      for (const codigo of codigosKit) {
        const estoque = saldo[codigo];
        if (typeof estoque !== 'number') throw new RecusaKit(`${codigo}: SKU de kit com variação sem variação canônica.`);
        const v = varPorSku.get(codigo);
        if (v) varPorSku.set(codigo, { ...v, estoque });
      }
    } catch (e) {
      // Nada desta tentativa foi ao ML: solta, a menos que uma tentativa anterior tenha criado o item.
      if (e instanceof RecusaKit) return recusar(e.message, retomada.size === 0);
      if (retomada.size === 0) await soltarExclusao(admin, familia.org_id, rootId);
      throw e;
    }
  }

  const montarPayloadPlano = (sku: string) => montar(varPorSku.get(sku)!);

  const criadoEm = (raiz as { criado_em?: string }).criado_em;
  const desdeMs = criadoEm ? Date.parse(criadoEm) - 60 * 60 * 1000 : Date.now() - 24 * 60 * 60 * 1000;

  const portas = criarPortasSupabase({
    admin, getToken: ctx.getToken, sellerId: conexao.contaExternaId ?? '',
    orgId: familia.org_id, categoriaId, familyName, desdeMs, montarPayloadPlano,
  });
  if (ehKit) {
    const { criarPlano, buscarPorSku, salvarEstadoDesejado } = portas;
    portas.buscarPorSku = async (sku) => {
      const b = await buscarPorSku(sku);
      if (b.tipo === 'um' && participantes.has(sku) && !retomada.has(sku)) {
        throw new RecusaKit(`${sku}: SKU em kit com variação já tem anúncio no Mercado Livre. Use Gerenciar kit.`);
      }
      return b;
    };
    portas.criarPlano = async (sku) => {
      await validarPolitica();
      const r = await criarPlano(sku);
      if (participantes.has(sku)) criouParticipante = true;
      return r;
    };
    // Antes do primeiro `active`, fora do try da ativação: recusa nunca vira `compensacao_pendente`.
    portas.salvarEstadoDesejado = async (id, estado) => {
      if (estado === 'ativando') await validarPolitica();
      return salvarEstadoDesejado(id, estado);
    };
  }

  // 3. Roda a saga "tudo ou pausa".
  let resultado: ResultadoSaga;
  try {
    resultado = await executarSaga(portas, { anuncioExternoId: rootId, skusEsperados: skus });
  } catch (e) {
    // Recusa da política: definitiva. Solta só se nenhum item de kit foi criado (nem agora, nem antes).
    if (e instanceof RecusaKit) return recusar(e.message, !criouParticipante && retomada.size === 0);
    throw e;
  }
  // A exclusão só sai com o resultado confirmado no ML. Saga que lança, estado diferente de `ativo` ou
  // leitura divergente mantêm a linha em `kit_exclusoes`: o Reenviar (mesmo dono) retoma e solta ao
  // confirmar, e a reconciliação diária alerta exclusão de publicação parada.
  let confirmado = true;
  if (ehKit) {
    confirmado = resultado.estado === 'ativo' && await confirmarNoMl(args, rootId, codigosKit, varPorSku);
    if (confirmado) await soltarExclusao(admin, familia.org_id, rootId);
    else console.error('kit_publicacao_exclusao_mantida', familia.org_id, rootId, resultado.estado);
  }
  if (resultado.estado === 'ativo' && !confirmado) {
    // Não vira `publicado` (o Reenviar some e o worker cairia em `ja_publicado`): pausa os itens de kit,
    // grava erro e deixa a exclusão com este dono para a retomada.
    const { data: itensKit } = await admin.from('anuncios_externos_itens').select('item_externo_id')
      .eq('anuncio_externo_id', rootId).in('sku', codigosKit);
    for (const i of itensKit ?? []) {
      if (i.item_externo_id) await portas.mudarStatus(i.item_externo_id as string, 'pausado').catch(() => {});
    }
    return recusar('Kit com variação: o Mercado Livre não confirmou item ativo e quantidade dentro do saldo. '
      + 'Os itens do kit ficaram pausados e reservados para esta publicação. Use Reenviar.', false);
  }

  // 4. Só `ativo` libera publicado; qualquer outro estado NÃO é publicação concluída.
  if (resultado.estado === 'ativo') {
    // Lê os filhos direto (FilhoRow da saga não carrega permalink): precisamos de sku+id+permalink.
    const { data: filhosRaw } = await admin.from('anuncios_externos_itens')
      .select('sku, item_externo_id, permalink').eq('anuncio_externo_id', rootId);
    const filhos = (filhosRaw ?? []) as Array<{ sku: string; item_externo_id: string | null; permalink: string | null }>;
    const idPorSku = new Map(filhos.map((f) => [f.sku, f.item_externo_id]));
    const permalinkPorSku = new Map(filhos.map((f) => [f.sku, f.permalink]));
    const primeiroSku = ordenarPorCor(anuncio.variacoes)[0]?.sku;
    const primeiroItemId = (primeiroSku ? idPorSku.get(primeiroSku) : null) ?? filhos.find((f) => f.item_externo_id)?.item_externo_id ?? null;
    if (!primeiroItemId) throw new Error('UP ativo sem item_externo_id nos filhos — inconsistência');
    const primeiroPermalink = (primeiroSku ? permalinkPorSku.get(primeiroSku) : null) ?? null;

    // §5: familias.ml_item_id = 1º item da partição 0 (compat com leitores single-value).
    await admin.from('familias').update({
      ml_item_id: primeiroItemId, ml_permalink: primeiroPermalink,
      status: 'publicado', publicado_em: now(),
    }).eq('id', familia.id);

    // Raiz publicada (item_externo_id fica null: os ids granulares vivem nos filhos, ADR §4/§5).
    await admin.from('anuncios_externos').update({
      status: 'publicado', permalink: primeiroPermalink, publicado_em: now(), erro_mensagem: null,
    }).eq('id', rootId);

    // variacoes.ml_variation_id = null em UP: cada item É a variação, não há sub-recurso
    // `variations` (ADR "Implementação prevista"). preco_publicado_ml = preço enviado (badge ADR-0078).
    for (const v of anuncio.variacoes) {
      await admin.from('variacoes')
        .update({ ml_variation_id: null, ...(v.preco != null ? { preco_publicado_ml: Number(v.preco) } : {}) })
        .eq('familia_id', familia.id).eq('codigo', v.sku);
    }

    // Descrição (recurso separado) em cada item — best-effort, não derruba a publicação já feita.
    if (conn.capabilities.descricaoSeparada && familia.descricao_ml) {
      for (const f of filhos) {
        if (!f.item_externo_id) continue;
        try { await conn.garantirDescricao(ctx, f.item_externo_id, familia.descricao_ml); }
        catch (e) { console.error(`descrição UP falhou (${f.item_externo_id}):`, e); }
      }
    }

    // Atacado (PxQ): cada item é um anúncio ML separado → aplica em TODOS os filhos (nunca só o 1º,
    // senão as cores 2..N ficam sem PxQ). Best-effort. ADR-0196: a base é o preço do próprio item; a de
    // outra cor deixaria a mais barata com faixa igual ou acima do preço. Sem preço, não aplica em nenhum.
    const faixas = Array.isArray(familia.atacado) ? (familia.atacado as FaixaAtacado[]) : [];
    if (conn.capabilities.atacado && faixas.length > 0) {
      const itens = filhos.filter((f) => f.item_externo_id && varPorSku.has(f.sku)).map((f) => {
        const preco = varPorSku.get(f.sku)!.preco;
        return { id: f.item_externo_id!, preco: preco == null ? null : Number(preco) };
      });
      const erro = await aplicarAtacadoPorItem(conn, ctx, itens, faixas);
      await admin.from('familias').update(erro
        ? { atacado_status: 'erro', atacado_erro: erro }
        : { atacado_status: 'aplicado', atacado_erro: null }).eq('id', familia.id);
    }

    // Vinculação ao catálogo (ADR-0021/0088 F2): deferida via QStash, espelhando o Legacy
    // (publish-familia-ml/processar.ts). Best-effort — a família já está publicada; falha aqui
    // não derruba o desfecho ativo. O worker vincular-catalogo detecta o caminho UP pelos filhos.
    try {
      await enfileirarVinculacaoCatalogo(familia.id);
    } catch (e) {
      console.error(`enfileirar catálogo UP falhou (${familia.id}):`, e);
    }

    return { estado: 'ativo', itemExternoId: primeiroItemId, permalink: primeiroPermalink };
  }

  // Não-ativo: família NÃO vira publicado. Mensagem específica por desfecho para o operador.
  if (resultado.estado === 'erro') {
    const msg = resultado.codigo === 'familia_up_desagrupada'
      ? 'Publicação bloqueada: o Mercado Livre agrupou as cores em famílias diferentes (family_id divergente). Intervenção manual necessária.'
      : resultado.codigo === 'busca_ambigua'
        ? 'Publicação bloqueada: busca por SKU ambígua/truncada ao adotar item existente. Intervenção manual necessária.'
        : resultado.codigo === 'estado_remoto_inesperado'
          ? 'Publicação bloqueada: estado remoto inesperado ao confirmar um item (deletado/404/outro vendedor). Intervenção manual necessária.'
          : 'Publicação bloqueada por erro na saga User Products.';
    await admin.from('familias').update({ status: 'erro', erro_mensagem: msg }).eq('id', familia.id);
    return { estado: 'erro', codigo: resultado.codigo, mensagem: msg };
  }

  // compensacao_pendente / publicando / parcial / pausado: publicação parcial — "Reenviar" retoma
  // (a própria saga reaproveita os itens já criados). Conta cores ativas para a mensagem.
  const filhos = await portas.listar(rootId).catch(() => []);
  const ativas = filhos.filter((f) => !f.retirado && f.status === 'ativo').length;
  const msg = `Publicação parcial: ${ativas} de ${skus.length} cores ativas. Reenvie para concluir.`;
  await admin.from('familias').update({ status: 'erro', erro_mensagem: msg }).eq('id', familia.id);
  return { estado: resultado.estado, mensagem: msg };
}
