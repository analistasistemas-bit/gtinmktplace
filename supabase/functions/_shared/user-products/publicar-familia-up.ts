// ADR-0088 — publicação de UMA família multi-cor numa categoria User Products (item plano).
// Orquestra: grava a raiz lógica (partição 0) com skus_esperados ANTES da saga, monta as portas
// reais, roda `publicarGrupo` e mapeia o desfecho para a persistência (familias/variacoes/raiz).
//
// Chamado por publish-familia-ml quando `variacoes.length > 1` e o formato é User Products
// (cache hit) ou o ML rejeitou o payload `variations` (FORMATO_INCOMPATIVEL).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { AnuncioCanonico, ChannelConnector, ContextoCanal, FaixaAtacado } from '../canais/contrato.ts';
import type { ConexaoCanal } from '../canais/conexao.ts';
import { montarPayloadItem } from '../ml/publicar.ts';
import { publicarGrupo, type ResultadoSaga, type CodigoErroSaga } from './publicar-grupo.ts';
import { criarPortasSupabase } from './portas-supabase.ts';

const CANAL = 'mercado_livre';

export interface PublicarFamiliaUPArgs {
  admin: SupabaseClient;
  conn: ChannelConnector;
  ctx: ContextoCanal;
  conexao: ConexaoCanal;
  familia: {
    id: string; user_id: string; org_id: string; codigo_pai: string;
    titulo_ml: string | null; nome_pai: string | null; descricao_ml: string | null;
    atacado?: unknown; [k: string]: unknown;
  };
  anuncio: AnuncioCanonico;
  categoriaId: string;
  /** Lido do schema da categoria (como criarAnuncio faz); undefined cai no fallback hard-coded. */
  aceitaEmptyGtin?: boolean;
  /** Injetável em teste; produção usa a saga real. */
  executarSaga?: (portas: ReturnType<typeof criarPortasSupabase>, entrada: { anuncioExternoId: string; skusEsperados: string[] }) => Promise<ResultadoSaga>;
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

export async function publicarFamiliaUP(args: PublicarFamiliaUPArgs): Promise<ResultadoUP> {
  const { admin, conn, ctx, conexao, familia, anuncio, categoriaId } = args;
  const executarSaga = args.executarSaga ?? publicarGrupo;
  const now = args.now ?? (() => new Date().toISOString());

  // family_name da partição: o ML agrupa numa mesma UPP todos os itens com o MESMO family_name
  // (ADR §4) — e também o EXIBE como título ao cliente final (achado real em produção 2026-07-22:
  // um sufixo de desambiguação de partição aparecia na tela do comprador). Este worker
  // (publish-familia-ml) só publica a partição 0 e NUNCA compete por UPP com outra partição da
  // mesma família aqui (isso só existiria no split, publicar-split-ml, que ainda não integra a
  // saga UP — Fase 2) — então nenhum sufixo é necessário. O ML também rejeita family_name > 60
  // chars ("Family Name length is over of 60 character", achado real em produção); trunca por
  // segurança mesmo sem sufixo, já que o título pode já vir no limite.
  const LIMITE_FAMILY_NAME = 60;
  const baseTitulo = familia.titulo_ml ?? familia.nome_pai ?? familia.codigo_pai;
  const familyName = baseTitulo.slice(0, LIMITE_FAMILY_NAME).trimEnd();
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

  // 2. Portas reais. Payload plano por SKU: mesma montarPayloadItem que o conector usa, com o
  //    titulo_ml substituído pelo family_name da partição (vira family_name no payload plano).
  const familiaInput = { titulo_ml: familyName, descricao_ml: anuncio.descricao, categoria_ml_id: categoriaId, atributos_ml: anuncio.atributos };
  const varPorSku = new Map(anuncio.variacoes.map((v) => [v.sku, v]));
  const montarPayloadPlano = (sku: string) => {
    const v = varPorSku.get(sku)!;
    return montarPayloadItem(
      familiaInput,
      [{ codigo: v.sku, cor: v.cor, estoque: v.estoque, preco_publicacao: v.preco, gtin: v.gtin, ml_picture_id: v.fotoId }],
      anuncio.capaFotoId, anuncio.capa2FotoId, anuncio.capa3FotoId,
      anuncio.listingTypeId, anuncio.desconto, anuncio.dimensoes, args.aceitaEmptyGtin, 'plano',
    );
  };

  const criadoEm = (raiz as { criado_em?: string }).criado_em;
  const desdeMs = criadoEm ? Date.parse(criadoEm) - 60 * 60 * 1000 : Date.now() - 24 * 60 * 60 * 1000;

  const portas = criarPortasSupabase({
    admin, getToken: ctx.getToken, sellerId: conexao.contaExternaId ?? '',
    orgId: familia.org_id, categoriaId, familyName, desdeMs, montarPayloadPlano,
  });

  // 3. Roda a saga "tudo ou pausa".
  const resultado = await executarSaga(portas, { anuncioExternoId: rootId, skusEsperados: skus });

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
    // senão as cores 2..N ficam sem PxQ). Best-effort; base = preço uniforme da família.
    const faixas = Array.isArray(familia.atacado) ? (familia.atacado as FaixaAtacado[]) : [];
    if (conn.capabilities.atacado && faixas.length > 0) {
      const base = anuncio.variacoes.find((v) => v.preco != null)?.preco;
      if (base != null) {
        let ok = true;
        for (const f of filhos) {
          if (!f.item_externo_id) continue;
          try { await conn.aplicarAtacado(ctx, f.item_externo_id, Number(base), faixas); }
          catch (e) { ok = false; console.error(`atacado UP falhou (${f.item_externo_id}):`, e); }
        }
        await admin.from('familias').update(ok
          ? { atacado_status: 'aplicado', atacado_erro: null }
          : { atacado_status: 'erro', atacado_erro: 'Falha ao aplicar atacado em uma ou mais cores' }).eq('id', familia.id);
      }
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
