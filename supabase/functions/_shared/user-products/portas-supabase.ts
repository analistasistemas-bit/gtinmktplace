// ADR-0088 — adapter REAL das portas da saga `publicarGrupo` sobre Supabase + API do ML.
// A saga é pura (recebe `PortasSaga`); este módulo fecha sobre um admin client (service_role),
// a conexão do ML (token+seller) e os dados da partição (categoria, family_name, payload por SKU).
//
// import type (erased em runtime) → sem carregar o cliente jsr; vitest importa sem tocar Deno.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { PortasSaga, FilhoRow, StatusFilho, ConfirmacaoRemota } from './publicar-grupo.ts';
import { buscarItemPorSku, buscarItemUP, type FetchLike } from '../ml/buscar-item.ts';
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
