// ADR-0088 — adapter REAL das portas da saga `publicarGrupo` sobre Supabase + API do ML.
// A saga é pura (recebe `PortasSaga`); este módulo fecha sobre um admin client (service_role),
// a conexão do ML (token+seller) e os dados da partição (categoria, family_name, payload por SKU).
//
// import type (erased em runtime) → sem carregar o cliente jsr; vitest importa sem tocar Deno.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { PortasSaga, FilhoRow, StatusFilho, ConfirmacaoRemota } from './publicar-grupo.ts';
import type { PortasAdocao } from './adotar-familia-migrada.ts';
import { buscarItemPorSku, buscarItemUP, buscarItemBackfill, type FetchLike } from '../ml/buscar-item.ts';
import { criarItemML } from '../ml/criar-item.ts';
import { atualizarStatusML } from '../ml/atualizar-item.ts';
import type { PayloadItem } from '../ml/publicar.ts';

export interface PortasSupabaseDeps {
  admin: SupabaseClient;
  /** Token do ML resolvido lazy (= ctx.getToken da conexão da org). */
  getToken(): Promise<string>;
  sellerId: string;          // conexao.contaExternaId — seller esperado na confirmação/busca
  orgId: string;             // herdado pelo filho (NOT NULL na tabela)
  categoriaId: string;
  familyName: string;        // family_name EXATO da partição (com o identificador de partição)
  desdeMs: number;           // janela de recência da busca por SKU (date_created >= isto)
  /** Monta o payload plano (1 variação) de um SKU — o caller fecha sobre montarPayloadItem(...,'plano'). */
  montarPayloadPlano(sku: string): PayloadItem;
  /** Injetável em teste; produção usa o fetch global. */
  fetchLike?: FetchLike;
}

const ITENS = 'anuncios_externos_itens';
const RAIZ = 'anuncios_externos';

function mapearFilho(row: Record<string, unknown>): FilhoRow {
  return {
    sku: row.sku as string,
    status: row.status as StatusFilho,
    retirado: (row.retirado as boolean) ?? false,
    itemExternoId: (row.item_externo_id as string | null) ?? null,
  };
}

export function criarPortasSupabase(deps: PortasSupabaseDeps): PortasSaga {
  const { admin, getToken, sellerId, orgId, categoriaId, familyName, desdeMs, montarPayloadPlano } = deps;
  const fetchLike: FetchLike = deps.fetchLike
    ?? ((url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<FetchLike>);

  const atualizarFilho = async (anuncioExternoId: string, sku: string, patch: Record<string, unknown>) => {
    const { error } = await admin.from(ITENS).update(patch)
      .eq('anuncio_externo_id', anuncioExternoId).eq('sku', sku);
    if (error) throw new Error(`${ITENS} update (${sku}): ${error.message}`);
  };

  return {
    async listar(anuncioExternoId) {
      const { data, error } = await admin.from(ITENS).select('*').eq('anuncio_externo_id', anuncioExternoId);
      if (error) throw new Error(`${ITENS} select: ${error.message}`);
      return (data ?? []).map(mapearFilho);
    },

    async reservar(anuncioExternoId, skus) {
      // insert-if-absent: nunca clobber IDs/status de linhas já persistidas (idempotência de retry).
      const rows = skus.map((sku) => ({ anuncio_externo_id: anuncioExternoId, org_id: orgId, sku, status: 'pendente' }));
      const { error } = await admin.from(ITENS)
        .upsert(rows, { onConflict: 'anuncio_externo_id,sku', ignoreDuplicates: true });
      if (error) throw new Error(`${ITENS} reservar: ${error.message}`);
    },

    salvarStatus: (id, sku, status) => atualizarFilho(id, sku, { status }),
    salvarCriado: (id, sku, itemExternoId) => atualizarFilho(id, sku, { item_externo_id: itemExternoId, status: 'criado' }),
    salvarConfirmacao: (id, sku, dados) => atualizarFilho(id, sku, {
      family_id: dados.familyId,
      user_product_id: dados.userProductId ?? null,
      permalink: dados.permalink ?? null,
    }),

    async salvarEstadoDesejado(anuncioExternoId, estado) {
      const { error } = await admin.from(RAIZ).update({ estado_desejado: estado }).eq('id', anuncioExternoId);
      if (error) throw new Error(`${RAIZ} estado_desejado: ${error.message}`);
    },

    buscarPorSku: (sku) => getToken().then((accessToken) =>
      buscarItemPorSku(fetchLike, { accessToken, sellerId, categoriaId, familyName, desdeMs }, sku)),

    async criarPlano(sku) {
      const r = await criarItemML(await getToken(), montarPayloadPlano(sku));
      return { itemExternoId: r.id, permalink: r.permalink };
    },

    async confirmar(itemExternoId): Promise<ConfirmacaoRemota> {
      const item = await buscarItemUP(fetchLike, { accessToken: await getToken() }, itemExternoId);
      // ok=false = estado remoto inesperado: GET falhou, sem family_id, ou item de outro seller.
      if (!item || !item.familyId || (item.sellerId != null && item.sellerId !== sellerId)) {
        return { ok: false };
      }
      return { ok: true, familyId: item.familyId, userProductId: item.userProductId, permalink: item.permalink };
    },

    async mudarStatus(itemExternoId, status) {
      await atualizarStatusML(await getToken(), itemExternoId, status === 'ativo' ? 'active' : 'paused');
    },
  };
}

// ── ADR-0104 — portas da ADOÇÃO de família migrada pelo ML para User Products ─────────────────
// Só leitura remota (busca por SKU + GET) e UMA escrita local transacional (RPC). Nenhum POST/PUT
// no Mercado Livre: o contrato `PortasAdocao` deliberadamente não expõe criar/ativar/pausar/repor.

export interface PortasAdocaoDeps {
  admin: SupabaseClient;
  getToken(): Promise<string>;
  sellerId: string;
  orgId: string;
  userId: string;
  familiaId: string;
  codigoPai: string;
  categoriaId: string;
  /** family_name observado no GET ao vivo do item migrado (critério da busca por SKU). */
  familyName: string;
  /** ADR-0105: `familias.ml_item_id` que a migração dissolveu — a RPC re-aponta TODAS as famílias
   *  do mesmo `codigo_pai` que apontavam para ele (há uma família por lote). Uma família do mesmo
   *  pai apontando para outro anúncio (split, ADR-0048) fica intocada. */
  mlItemIdAntigo: string;
  fetchLike?: FetchLike;
}

/** Escrita local da adoção — idêntica nos dois caminhos (busca por SKU, ADR-0104; casamento por
 *  cor, ADR-0105). Só muda como os filhos foram descobertos. */
function adotarViaRpc(
  admin: SupabaseClient,
  ctx: { orgId: string; userId: string; familiaId: string; codigoPai: string; mlItemIdAntigo: string },
): PortasAdocao['adotar'] {
  return async ({ filhos, familyName, mlItemId }) => {
    const { error } = await admin.rpc('adotar_familia_migrada_up', {
      p_org_id: ctx.orgId,
      p_user_id: ctx.userId,
      p_familia_id: ctx.familiaId,
      p_codigo_pai: ctx.codigoPai,
      p_family_name: familyName,
      p_ml_item_id: mlItemId,
      p_ml_item_id_antigo: ctx.mlItemIdAntigo,
      p_filhos: filhos.map((f) => ({
        sku: f.sku,
        item_externo_id: f.itemExternoId,
        family_id: f.familyId,
        user_product_id: f.userProductId,
        permalink: f.permalink,
        status: f.status,
      })),
    });
    if (error) throw new Error(`adotar_familia_migrada_up (${ctx.codigoPai}): ${error.message}`);
  };
}

export function criarPortasAdocao(deps: PortasAdocaoDeps): PortasAdocao {
  const { admin, getToken, sellerId, orgId, userId, familiaId, codigoPai, categoriaId, familyName } = deps;
  const fetchLike: FetchLike = deps.fetchLike
    ?? ((url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<FetchLike>);

  return {
    // `desdeMs: 0` — SEM janela de recência, ao contrário da saga de criação. Lá a janela existe
    // para não adotar um item ANTIGO ao criar um NOVO; aqui os itens antigos são exatamente o
    // alvo (a família foi publicada há muito tempo e o ML a migrou depois). A identidade já está
    // presa por sku + family_name exato + categoria + seller.
    buscarPorSku: (sku) => getToken().then((accessToken) =>
      buscarItemPorSku(fetchLike, { accessToken, sellerId, categoriaId, familyName, desdeMs: 0 }, sku)),

    confirmar: async (itemExternoId) =>
      buscarItemBackfill(fetchLike, { accessToken: await getToken() }, itemExternoId),

    adotar: adotarViaRpc(admin, { orgId, userId, familiaId, codigoPai, mlItemIdAntigo: deps.mlItemIdAntigo }),
  };
}

// ── ADR-0105 — portas do RE-VÍNCULO de família DISSOLVIDA (item Legacy fechado, irmãos sem SKU) ──
// A adoção (`adotarFamiliaMigrada`) é a mesma, com as mesmas validações e a mesma regra
// tudo-ou-nada: o que muda é só de onde sai o item de cada SKU. Aqui não há busca remota por SKU —
// os irmãos não têm `seller_custom_field` —, e sim o mapa já resolvido por COR na descoberta.

export interface PortasRevinculoDeps {
  admin: SupabaseClient;
  getToken(): Promise<string>;
  orgId: string;
  userId: string;
  familiaId: string;
  codigoPai: string;
  mlItemIdAntigo: string;
  /** sku → id do item irmão, resolvido por COLOR.value_name (ADR-0105 §2). */
  itemPorSku: Map<string, string>;
  fetchLike?: FetchLike;
}

export function criarPortasRevinculo(deps: PortasRevinculoDeps): PortasAdocao {
  const { admin, getToken, orgId, userId, familiaId, codigoPai, mlItemIdAntigo, itemPorSku } = deps;
  const fetchLike: FetchLike = deps.fetchLike
    ?? ((url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<FetchLike>);

  return {
    // Resolução local: 'nenhum' quando a cor daquele SKU não achou irmão (ou achou mais de um) —
    // e a regra tudo-ou-nada do chamador aborta o re-vínculo inteiro, como deve.
    buscarPorSku: (sku) => {
      const itemExternoId = itemPorSku.get(sku);
      return Promise.resolve(itemExternoId ? { tipo: 'um' as const, itemExternoId } : { tipo: 'nenhum' as const });
    },

    // Revalidação remota INTACTA (ADR-0104): seller, variations vazio, family_id, user_product_id
    // e status remoto conhecido. O mapa por cor decide QUEM confirmar, nunca dispensa a confirmação.
    confirmar: async (itemExternoId) =>
      buscarItemBackfill(fetchLike, { accessToken: await getToken() }, itemExternoId),

    adotar: adotarViaRpc(admin, { orgId, userId, familiaId, codigoPai, mlItemIdAntigo }),
  };
}
