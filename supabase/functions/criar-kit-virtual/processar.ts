// ADR-0154: publica um Kit Virtual no Mercado Livre (`POST /items/kits`) e registra o resultado
// em `kits_virtuais` + `kits_virtuais_componentes`.
//
// ORDEM DAS ESCRITAS (imposta pelo trigger `kits_virtuais_validar_componentes`, ver a migration
// 20260906140450): a validação de 2..6 componentes roda no `before insert or update` de
// `kits_virtuais` e só morde quando `status='publicado'`. Como a FK composta exige a linha do kit
// ANTES dos componentes, a única sequência que satisfaz as duas coisas é:
//
//   1. `kits_virtuais` nasce em `status='publicando'`  (trigger passa: status <> 'publicado')
//   2. `kits_virtuais_componentes` (2..6 linhas)        (FK satisfeita)
//   3. `POST /items/kits`
//   4. `kits_virtuais` -> `status='publicado'`          (trigger conta 2..6 e aprova)
//
// Inverter 2 e 4 faria o UPDATE do passo 4 estourar 23514 com o anúncio JÁ criado no ML.
//
// O conector nunca lança (ADR-0087): recusa do ML vira `status='erro'` + `erro_mensagem`
// humanizada e uma união discriminada `{ok:false}` — nunca uma exceção que suba pro HTTP.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { PayloadKitVirtual, RespostaKitML } from '../_shared/ml/kit-virtual.ts';

export interface ComponenteKitVirtual {
  userProductId: string;
  quantidade: number;
  /**
   * D-3: fração 0-1 (0.30 = 30%). Vem POR COMPONENTE porque é assim que o nó `bundle` do ML é
   * formado — e é exatamente por isso que a validação abaixo exige que todos sejam iguais antes
   * de qualquer chamada de rede. NÃO é a escala de `configuracoes.desconto_pct` (0-100).
   */
  descontoPct: number;
  /** Enriquecimento best-effort do catálogo local (D-12); nulos não impedem publicar. */
  itemExternoId: string | null;
  codigo: string | null;
  codigoPai: string | null;
}

export interface CriarKitVirtualInput {
  /** Idempotência (ADR-0096): gerada pelo front ao abrir o diálogo, uma por submissão. */
  chaveCadastro: string;
  titulo: string;
  descricao: string | null;
  fotoStoragePath: string | null;
  fotoMlPictureId: string | null;
  /** `null` = o diálogo não escolheu (caminho normal); derivado dos componentes antes de
   *  qualquer escrita — ver `resolverListingTypeKit`. Só vem preenchido explicitamente no
   *  fluxo de Refazer (reusa o listing_type_id do kit antigo). NUNCA um default fixo (bug real
   *  2026-09-06: `gold_pro` cego não bate com o listing type publicado dos componentes). */
  listingTypeId: string | null;
  componentes: ComponenteKitVirtual[];
}

export interface CriarKitVirtualDeps {
  admin: SupabaseClient;
  orgId: string;
  userId: string;
  /** URL assinada da foto no storage; `null` quando o path não resolve. */
  urlAssinadaFoto: (path: string) => Promise<string | null>;
  subirFoto: (sourceUrl: string) => Promise<string>;
  /** `GET /pictures/{id}` → `secure_url` (bug real 2026-09-06, ver `_shared/ml/fotos.ts`). */
  buscarSecureUrlFoto: (pictureId: string) => Promise<string>;
  /** `item_id → listing_type_id`, multiget do ML (bug real 2026-09-06, ver `_shared/ml/kit-virtual.ts`). */
  buscarListingTypeComponentes: (itemIds: string[]) => Promise<Map<string, string>>;
  criarKitML: (payload: PayloadKitVirtual) => Promise<RespostaKitML>;
  garantirDescricao: (itemId: string, texto: string) => Promise<void>;
}

export type MotivoCriarKitVirtual =
  | 'chave_invalida'
  | 'titulo_invalido'
  | 'componentes_invalidos'
  | 'componente_duplicado'
  | 'quantidade_invalida'
  | 'desconto_invalido'
  | 'desconto_divergente'
  | 'listing_type_divergente'
  | 'listing_type_indisponivel'
  | 'falha_listing_type'
  | 'foto_obrigatoria'
  | 'falha_leitura'
  | 'falha_criar_kit'
  | 'falha_componentes'
  | 'falha_foto'
  | 'ml_recusou'
  | 'falha_publicar';

export type ResultadoCriarKitVirtual =
  | {
    ok: true;
    kitId: string;
    mlItemId: string;
    mlUserProductId: string | null;
    mlPermalink: string | null;
    /** `true` = reenvio da mesma `chave_cadastro`; NENHUM POST foi feito nesta chamada. */
    jaExistia: boolean;
  }
  | { ok: false; motivo: MotivoCriarKitVirtual; mensagem?: string; kitId?: string };

interface LinhaKit {
  id: string;
  status: string;
  ml_item_id: string | null;
  ml_user_product_id: string | null;
  ml_permalink: string | null;
  foto_storage_path: string | null;
  foto_ml_picture_id: string | null;
  listing_type_id: string;
}

const COLUNAS_KIT = 'id, status, ml_item_id, ml_user_product_id, ml_permalink, foto_storage_path, foto_ml_picture_id, listing_type_id';

/** Recusas que não custam rede. Rodam ANTES de qualquer escrita ou chamada ao ML. */
export function validarKitVirtual(input: CriarKitVirtualInput): MotivoCriarKitVirtual | null {
  if (typeof input.chaveCadastro !== 'string' || !input.chaveCadastro.trim()) return 'chave_invalida';
  if (typeof input.titulo !== 'string' || !input.titulo.trim()) return 'titulo_invalido';

  const comps = input.componentes;
  if (!Array.isArray(comps) || comps.length < 2 || comps.length > 6) return 'componentes_invalidos';
  if (comps.some((c) => typeof c.userProductId !== 'string' || !c.userProductId)) return 'componentes_invalidos';
  if (new Set(comps.map((c) => c.userProductId)).size !== comps.length) return 'componente_duplicado';
  if (comps.some((c) => !Number.isInteger(c.quantidade) || c.quantidade < 1 || c.quantidade > 10)) {
    return 'quantidade_invalida';
  }
  if (comps.some((c) => typeof c.descontoPct !== 'number' || !Number.isFinite(c.descontoPct)
    || c.descontoPct < 0 || c.descontoPct >= 1)) {
    return 'desconto_invalido';
  }
  // D-3: o ML exige desconto IDÊNTICO em todos os componentes. Recusar aqui (e não deixar o ML
  // recusar) mantém a divergência visível como erro de composição, não como "o ML não aceitou".
  if (new Set(comps.map((c) => c.descontoPct)).size !== 1) return 'desconto_divergente';

  return null;
}

export type ResolverListingTypeResultado =
  | { listingTypeId: string }
  | { erro: 'listing_type_divergente' | 'listing_type_indisponivel' };

/**
 * Deriva o `listing_type_id` do kit a partir dos componentes reais — bug real 2026-09-06: um
 * default fixo (`gold_pro`) não bate com o listing type publicado dos componentes e o ML recusa
 * o kit inteiro (`listing_type_mismatch`). `listingTypeIdExplicito` vem do request (fluxo de
 * Refazer, D-8) e tem precedência — pura, sem rede. `listingTypesPorItem` já veio resolvida
 * (multiget `_shared/ml/kit-virtual.ts:buscarListingTypeItensML`) para os componentes que têm
 * `itemExternoId` (D-12: enriquecimento local best-effort, pode faltar em alguns).
 */
export function resolverListingTypeKit(
  componentes: ComponenteKitVirtual[],
  listingTypeIdExplicito: string | null,
  listingTypesPorItem: Map<string, string>,
): ResolverListingTypeResultado {
  if (listingTypeIdExplicito) return { listingTypeId: listingTypeIdExplicito };

  const encontrados = new Set<string>();
  for (const c of componentes) {
    if (!c.itemExternoId) continue;
    const lt = listingTypesPorItem.get(c.itemExternoId);
    if (lt) encontrados.add(lt);
  }
  if (encontrados.size > 1) return { erro: 'listing_type_divergente' };
  if (encontrados.size === 0) return { erro: 'listing_type_indisponivel' };
  return { listingTypeId: [...encontrados][0] };
}

export function montarPayloadKitVirtual(
  input: CriarKitVirtualInput,
  pictureId: string,
  secureUrl: string,
  listingTypeId: string,
): PayloadKitVirtual {
  return {
    family_name: input.titulo,
    channels: ['marketplace'],
    thumbnail: { id: pictureId, secure_url: secureUrl },
    currency_id: 'BRL',
    listing_type_id: listingTypeId,
    official_store_id: null,
    bundle: {
      type: 'kit',
      // O PRIMEIRO componente é o principal (categoria/domain_id do kit saem dele): a ordem do
      // input é preservada de propósito, nunca reordenada.
      components: input.componentes.map((c) => ({
        type: 'user_product' as const,
        user_product_id: c.userProductId,
        quantity: c.quantidade,
        // `price` deliberadamente AUSENTE do payload (D-3): com automatic_price o ML recusa os
        // dois juntos e o app nunca reprecifica um kit.
        automatic_price: { discount: c.descontoPct },
      })),
    },
  };
}

/**
 * Reivindica a linha do kit de forma ATÔMICA pela unique `(org_id, chave_cadastro)`.
 *
 * Insert-primeiro (e não select-primeiro): duas chamadas simultâneas com a mesma chave só
 * podem produzir UM insert; a perdedora cai no 23505 e relê a linha da vencedora. Um
 * `select` antes do `insert` deixaria a janela aberta e criaria dois kits no ML.
 *
 * A linha pode JÁ existir sem ter passado por aqui: D-5 manda subir a foto no upload do
 * diálogo, então o fluxo de foto cria/preenche `foto_ml_picture_id` antes do publicar.
 */
async function reivindicarKit(
  deps: CriarKitVirtualDeps, input: CriarKitVirtualInput, listingTypeId: string,
): Promise<{ kit: LinhaKit } | { erro: MotivoCriarKitVirtual; mensagem?: string }> {
  const { admin, orgId, userId } = deps;
  const desconto = input.componentes[0].descontoPct;

  const { data: criado, error } = await admin.from('kits_virtuais').insert({
    org_id: orgId,
    chave_cadastro: input.chaveCadastro,
    titulo: input.titulo,
    descricao: input.descricao,
    desconto_pct: desconto,
    foto_storage_path: input.fotoStoragePath,
    foto_ml_picture_id: input.fotoMlPictureId,
    listing_type_id: listingTypeId,
    status: 'publicando',
    criado_por: userId,
  }).select(COLUNAS_KIT).single();

  if (!error && criado) return { kit: criado as LinhaKit };
  if (!error) return { erro: 'falha_criar_kit' };
  if ((error as { code?: string }).code !== '23505') {
    return { erro: 'falha_criar_kit', mensagem: error.message };
  }

  const { data: existente, error: erroLeitura } = await admin.from('kits_virtuais')
    .select(COLUNAS_KIT)
    .eq('org_id', orgId).eq('chave_cadastro', input.chaveCadastro).maybeSingle();
  if (erroLeitura) return { erro: 'falha_leitura', mensagem: erroLeitura.message };
  if (!existente) return { erro: 'falha_criar_kit', mensagem: 'chave em uso, mas o kit não foi encontrado' };

  const kit = existente as LinhaKit;
  // Já publicado/encerrado: devolvido como está, sem tocar em ML nem em componentes.
  if (kit.ml_item_id) return { kit };

  // Linha órfã (`publicando` de uma tentativa que morreu, `erro` de um CREATE recusado, ou o
  // placeholder criado pelo upload da foto): reaproveitada. Os campos do diálogo são
  // reescritos — este payload é a intenção mais recente do operador —, mas as colunas de foto
  // só recebem valor quando ainda estão vazias: o picture_id já propagado no ML (D-5/ADR-0033)
  // é o ativo mais caro da linha e nunca é sobrescrito por um payload que veio sem ele.
  const { data: atualizado, error: erroUpdate } = await admin.from('kits_virtuais').update({
    titulo: input.titulo,
    descricao: input.descricao,
    desconto_pct: desconto,
    foto_storage_path: kit.foto_storage_path ?? input.fotoStoragePath,
    foto_ml_picture_id: kit.foto_ml_picture_id ?? input.fotoMlPictureId,
    listing_type_id: listingTypeId,
    status: 'publicando',
    erro_mensagem: null,
  }).eq('id', kit.id).eq('org_id', orgId).select(COLUNAS_KIT).single();
  if (erroUpdate || !atualizado) return { erro: 'falha_criar_kit', mensagem: erroUpdate?.message };
  return { kit: atualizado as LinhaKit };
}

async function marcarErro(
  deps: CriarKitVirtualDeps, kitId: string, mensagem: string,
): Promise<void> {
  const { error } = await deps.admin.from('kits_virtuais')
    .update({ status: 'erro', erro_mensagem: mensagem })
    .eq('id', kitId).eq('org_id', deps.orgId);
  if (error) console.error('criar_kit_virtual_marcar_erro_falhou', { kitId, erro: error.message });
}

export async function criarKitVirtual(
  deps: CriarKitVirtualDeps, input: CriarKitVirtualInput,
): Promise<ResultadoCriarKitVirtual> {
  const invalido = validarKitVirtual(input);
  if (invalido) return { ok: false, motivo: invalido };

  const { admin, orgId } = deps;

  // ── 0. listing_type_id ANTES de qualquer escrita — a linha do kit já nasce com ele ────
  // (reivindicarKit) e um default cego (`gold_pro`) é exatamente o bug real 2026-09-06. Roda
  // mesmo num reenvio idempotente que vai bater em `kit.ml_item_id` daqui a pouco (custo: 1
  // multiget extra num resend — aceitável; NÃO mover pra depois, é o que garante que a linha já
  // nasça com o listing_type_id certo).
  let listingTypeId: string;
  if (input.listingTypeId) {
    listingTypeId = input.listingTypeId;
  } else {
    const itemIds = [...new Set(
      input.componentes.map((c) => c.itemExternoId).filter((id): id is string => !!id),
    )];
    let listingTypesPorItem: Map<string, string>;
    try {
      listingTypesPorItem = itemIds.length
        ? await deps.buscarListingTypeComponentes(itemIds)
        : new Map<string, string>();
    } catch (e) {
      // Falha de LEITURA (rede/timeout/5xx do ML) é diferente de "nenhum componente resolveu":
      // não pode virar `listing_type_indisponivel` (400, "os dados não bateram") — é transiente,
      // 502, igual `falha_foto`.
      const msg = `Falha ao consultar o listing type dos componentes no Mercado Livre: ${e instanceof Error ? e.message : String(e)}`;
      return { ok: false, motivo: 'falha_listing_type', mensagem: msg };
    }
    const resolvido = resolverListingTypeKit(input.componentes, null, listingTypesPorItem);
    if ('erro' in resolvido) {
      const mensagem = resolvido.erro === 'listing_type_divergente'
        ? 'Os componentes têm listing type (Clássico/Premium) diferentes entre si — o Mercado Livre não aceita um kit misto.'
        : 'Não foi possível determinar o listing type (Clássico/Premium) dos componentes.';
      return { ok: false, motivo: resolvido.erro, mensagem };
    }
    listingTypeId = resolvido.listingTypeId;
  }

  // ── 1. Linha do kit (idempotência atômica) ────────────────────────────────────────────
  const reivindicado = await reivindicarKit(deps, input, listingTypeId);
  if ('erro' in reivindicado) return { ok: false, motivo: reivindicado.erro, mensagem: reivindicado.mensagem };
  const kit = reivindicado.kit;

  // Reenvio da mesma chave num kit que já foi ao ML: devolve a MESMA linha, sem segundo POST.
  if (kit.ml_item_id) {
    return {
      ok: true,
      kitId: kit.id,
      mlItemId: kit.ml_item_id,
      mlUserProductId: kit.ml_user_product_id,
      mlPermalink: kit.ml_permalink,
      jaExistia: true,
    };
  }

  // ── 2. Componentes ANTES do status='publicado' (ver cabeçalho) ────────────────────────
  // Delete-then-insert: no caminho novo é no-op; no reaproveitamento de linha órfã é o que
  // impede o 23505 da unique (kit_id, user_product_id). Seguro porque o kit não está publicado.
  const { error: erroDelete } = await admin.from('kits_virtuais_componentes')
    .delete().eq('kit_id', kit.id).eq('org_id', orgId);
  if (erroDelete) return { ok: false, motivo: 'falha_componentes', mensagem: erroDelete.message, kitId: kit.id };

  // Todos os objetos com o MESMO conjunto de chaves — o INSERT em lote do PostgREST une as
  // chaves das linhas e ignora o DEFAULT das colunas ausentes em alguma delas (ADR-0129).
  const { error: erroComp } = await admin.from('kits_virtuais_componentes').insert(
    input.componentes.map((c, i) => ({
      kit_id: kit.id,
      org_id: orgId,
      ordem: i,
      user_product_id: c.userProductId,
      item_externo_id: c.itemExternoId,
      quantidade: c.quantidade,
      codigo: c.codigo,
      codigo_pai: c.codigoPai,
    })),
  );
  if (erroComp) return { ok: false, motivo: 'falha_componentes', mensagem: erroComp.message, kitId: kit.id };

  // ── 3. Foto (D-5): o caminho normal é o picture_id JÁ existir ─────────────────────────
  // Subir aqui é o último recurso — a propagação da foto no ML é assíncrona (ADR-0033) e um
  // picture_id recém-criado costuma ser recusado no POST por alguns minutos.
  let pictureId = kit.foto_ml_picture_id;
  if (!pictureId) {
    const path = kit.foto_storage_path ?? input.fotoStoragePath;
    if (!path) {
      await marcarErro(deps, kit.id, 'O kit precisa de uma foto própria antes de publicar.');
      return { ok: false, motivo: 'foto_obrigatoria', kitId: kit.id };
    }
    try {
      const url = await deps.urlAssinadaFoto(path);
      if (!url) throw new Error('não foi possível gerar a URL da foto');
      pictureId = await deps.subirFoto(url);
    } catch (e) {
      const msg = `Falha ao enviar a foto do kit ao Mercado Livre: ${e instanceof Error ? e.message : String(e)}`;
      await marcarErro(deps, kit.id, msg);
      return { ok: false, motivo: 'falha_foto', mensagem: msg, kitId: kit.id };
    }
    await admin.from('kits_virtuais').update({ foto_ml_picture_id: pictureId })
      .eq('id', kit.id).eq('org_id', orgId);
  }

  // `thumbnail.secure_url` (bug real 2026-09-06): buscado SEMPRE aqui, nunca reaproveitado do
  // retorno do upload — o caminho normal (D-5) é o picture_id já ter sido salvo minutos antes,
  // sem nenhum upload nesta chamada.
  let secureUrl: string;
  try {
    secureUrl = await deps.buscarSecureUrlFoto(pictureId);
  } catch (e) {
    const msg = `Falha ao obter a URL da foto no Mercado Livre: ${e instanceof Error ? e.message : String(e)}`;
    await marcarErro(deps, kit.id, msg);
    return { ok: false, motivo: 'falha_foto', mensagem: msg, kitId: kit.id };
  }

  // ── 4. CREATE no ML ───────────────────────────────────────────────────────────────────
  let resposta: RespostaKitML;
  try {
    resposta = await deps.criarKitML(montarPayloadKitVirtual(input, pictureId, secureUrl, listingTypeId));
  } catch (e) {
    // `criarKitVirtualML` já humaniza a recusa do ML (`humanizarErroML`).
    const msg = e instanceof Error ? e.message : String(e);
    await marcarErro(deps, kit.id, msg);
    return { ok: false, motivo: 'ml_recusou', mensagem: msg, kitId: kit.id };
  }

  // ── 5. Descrição (recurso separado no ML, nunca vai no POST) ──────────────────────────
  // Best-effort DEPOIS do CREATE: o anúncio já existe, e derrubar a publicação por causa da
  // descrição deixaria um kit vivo no ML com a linha local em `erro`. Fica logado.
  if (input.descricao) {
    try {
      await deps.garantirDescricao(resposta.id, input.descricao);
    } catch (e) {
      console.error('criar_kit_virtual_descricao_falhou', { kitId: kit.id, itemId: resposta.id, erro: String(e) });
    }
  }

  // ── 6. status='publicado' POR ÚLTIMO (o trigger conta os componentes aqui) ────────────
  const { error: erroPublicar } = await admin.from('kits_virtuais').update({
    status: 'publicado',
    ml_item_id: resposta.id,
    ml_user_product_id: resposta.userProductId,
    ml_permalink: resposta.permalink,
    publicado_em: new Date().toISOString(),
    erro_mensagem: null,
  }).eq('id', kit.id).eq('org_id', orgId);
  if (erroPublicar) {
    // O kit EXISTE no ML: não some com o id, senão vira anúncio órfão sem rastro local.
    console.error('criar_kit_virtual_publicar_falhou', { kitId: kit.id, itemId: resposta.id, erro: erroPublicar.message });
    await admin.from('kits_virtuais')
      .update({ ml_item_id: resposta.id, ml_permalink: resposta.permalink, erro_mensagem: erroPublicar.message })
      .eq('id', kit.id).eq('org_id', orgId);
    return { ok: false, motivo: 'falha_publicar', mensagem: erroPublicar.message, kitId: kit.id };
  }

  return {
    ok: true,
    kitId: kit.id,
    mlItemId: resposta.id,
    mlUserProductId: resposta.userProductId,
    mlPermalink: resposta.permalink,
    jaExistia: false,
  };
}
