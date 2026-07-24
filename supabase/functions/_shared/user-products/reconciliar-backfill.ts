// ADR-0088 — Reconciliador de BACKFILL (seção "Reconciliador de backfill, idempotente, só leitura
// remota — GET"): importa itens PLANOS pré-existentes (publicados via ADR-0084/0087, item plano
// numa categoria que exige family_name) pro modelo novo (N itens técnicos, ADR-0088) — famílias
// com `ml_item_id` já preenchido mas SEM nenhuma linha filha ainda em `anuncios_externos_itens`.
//
// Distinto do reconciliador de CONVERGÊNCIA (reconciliar-convergencia.ts): este é só-leitura
// remota (nenhum POST/PUT no ML) — só muta o próprio banco local. Idempotente por natureza: uma
// família que já ganhou filho (nesta rodada ou numa anterior) sai do escopo de "sem filho" via
// `listarFamiliasSemFilho` (implementada com NOT EXISTS no servidor, revisão Codex) e não é
// revisitada — 2ª execução sobre a mesma família → `upsertRaizEFilho` não insere de novo.

export interface FamiliaSemFilho {
  id: string;
  userId: string;
  codigoPai: string;
  orgId: string;
  mlItemId: string;
}

export interface ItemBackfillPorta {
  status: string | null;
  familyId: string | null;
  familyName: string | null;
  userProductId: string | null;
  permalink: string | null;
  sku: string | null;
  temVariacoes: boolean;
  sellerId: string | null;
}

export interface PortasBackfill {
  listarFamiliasSemFilho(): Promise<FamiliaSemFilho[]>;
  buscarItem(itemId: string): Promise<ItemBackfillPorta | null>;
  /** Upsert atômico (RPC, 1 transação) da raiz (partição 0, `skus_esperados=[sku]`) + linha
   *  filha. Retorna true SÓ se o filho foi genuinamente inserido agora (false numa reexecução
   *  idempotente OU numa corrida entre 2 execuções concorrentes — só uma insere de fato). */
  upsertRaizEFilho(
    familia: FamiliaSemFilho,
    item: { sku: string; status: 'ativo' | 'pausado'; familyId: string; userProductId: string; permalink: string | null },
  ): Promise<boolean>;
}

export interface ResultadoBackfill {
  inseridos: number;
  ignorados: number;
}

export async function reconciliarBackfill(portas: PortasBackfill, sellerEsperado: string): Promise<ResultadoBackfill> {
  const familias = await portas.listarFamiliasSemFilho();
  let inseridos = 0;
  let ignorados = 0;

  for (const familia of familias) {
    try {
      const item = await portas.buscarItem(familia.mlItemId);
      // GET falhou (404/erro de rede) → ignora esta família NESTA rodada; a próxima execução do
      // reconciliador tenta de novo (ela continua "sem filho" até um backfill bem-sucedido).
      if (!item) { ignorados++; continue; }
      // Item Legacy (tem variations reais) → não é candidato UP, fora de escopo deste reconciliador.
      if (item.temVariacoes) { ignorados++; continue; }
      // Sem family_name → não é item plano UP (ou é um item plano de outra natureza) — não importa.
      if (!item.familyName) { ignorados++; continue; }
      // Sem SKU (seller_custom_field) → não dá pra ancorar em (anuncio_externo_id, sku) — pula.
      if (!item.sku) { ignorados++; continue; }
      // Revisão Codex: family_name sozinho não prova UP de forma inequívoca — exige também
      // family_id e user_product_id (campos que só existem em item genuinamente User Products).
      if (!item.familyId || !item.userProductId) { ignorados++; continue; }
      // Revisão Codex (operação de import, fail-closed): o GET é público — sem confirmar o
      // seller, um ml_item_id local corrompido/antigo importaria item de OUTRO vendedor.
      if (item.sellerId == null || item.sellerId !== sellerEsperado) { ignorados++; continue; }
      // Revisão Codex: nunca default silencioso pra status remoto desconhecido (closed,
      // under_review, ou qualquer valor futuro) — só aceita os 2 valores conhecidos, explícitos.
      const status = item.status === 'active' ? 'ativo' : item.status === 'paused' ? 'pausado' : null;
      if (!status) { ignorados++; continue; }

      const inserido = await portas.upsertRaizEFilho(familia, {
        sku: item.sku, status, familyId: item.familyId, userProductId: item.userProductId, permalink: item.permalink,
      });
      if (inserido) inseridos++; else ignorados++;
    } catch (e) {
      // Best-effort entre famílias: uma falha de upsert (constraint, timeout) não pode derrubar
      // o backfill das demais famílias do lote administrativo.
      console.error(`reconciliarBackfill: falhou para família ${familia.id} (org ${familia.orgId}, codigo_pai ${familia.codigoPai}, ml_item_id ${familia.mlItemId}):`, e);
      ignorados++;
    }
  }

  return { inseridos, ignorados };
}
