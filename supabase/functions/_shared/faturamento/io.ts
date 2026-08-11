// IO do módulo Faturamento (ADR-0037): chamadas à API do ML e persistência.
// Usa Deno/supabase-js; a lógica pura fica em venda.ts. Só `upsertVenda` tem teste de vitest
// (io.test.ts, com um fake do client) — é o caminho que grava estorno/liberação.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { mapearPedidoParaVenda, normGtin, extrairGeo, extrairReceiverNome, escolherCompradorNome, preservarDadosMP, type PedidoML, type VendaItemRow, type DadosPagamentoMP } from './venda.ts';
import { round2 } from '../dinheiro.ts';
import { MLApiError } from '../ml/erro-ml.ts';
import { fundirItensUP } from './catalogo-up.ts';
import { montarMapasCustoVigente, resolverCustoVigente, type LinhaCusto, type ItemParaCusto } from './custo-vigente.ts';

const API = 'https://api.mercadolibre.com';

/** Resolve user_id (criado_por) + org_id a partir do ml_user_id (vendedor no ML), via
 *  marketplace_connections (E7 — ml_credentials está congelada). null se desconhecido. */
export async function resolverIdentidade(
  admin: SupabaseClient, mlUserId: number | string,
): Promise<{ userId: string; orgId: string } | null> {
  const { data } = await admin.from('marketplace_connections')
    .select('criado_por, org_id').eq('canal', 'mercado_livre').eq('conta_externa_id', String(mlUserId)).maybeSingle();
  if (!data?.criado_por) return null;
  return { userId: data.criado_por as string, orgId: data.org_id as string };
}

/** Resolve org_id a partir do user_id local (criado_por da conexão ML). null se sem conexão. */
export async function resolverOrgPorUserId(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await admin.from('marketplace_connections')
    .select('org_id').eq('canal', 'mercado_livre').eq('criado_por', userId).maybeSingle();
  return (data?.org_id as string | undefined) ?? null;
}

export interface Catalogo {
  idsPubliai: Set<string>;
  codigoResolver: (itemId: string | null, varId: number | null) => string | null;
  eanResolver: (itemId: string | null, varId: number | null) => string | null;
  /** normGtin → {codigo, ean} do catálogo — casa vendas de catálogo por GTIN. */
  infoPorGtin: Map<string, { codigo: string | null; ean: string | null }>;
  /** ADR-0109 — custo vigente do item, para congelar na venda. null = não casou no catálogo. */
  custoVigenteResolver: (item: ItemParaCusto) => number | null;
}

/** Lê todas as páginas de uma query, evitando o teto padrão (~1000 linhas) do PostgREST —
 *  equivalente Deno de `buscarTodasPaginas` (src/lib/paginacao-supabase.ts). Sem isso, contas com
 *  mais de 1000 variações perdem produtos silenciosamente no casamento por GTIN/código. */
async function paginarTudo<T>(
  pagina: (de: number, ate: number) => PromiseLike<{ data: T[] | null }>,
  tamanho = 1000,
): Promise<T[]> {
  const todas: T[] = [];
  for (let de = 0; ; de += tamanho) {
    const { data } = await pagina(de, de + tamanho - 1);
    const lote = data ?? [];
    todas.push(...lote);
    if (lote.length < tamanho) break;
  }
  return todas;
}

/**
 * Resolvedores (código/EAN) por (ml_item_id, variation_id) + conjunto de ids do PubliAI.
 *
 * ESCOPO É A ORGANIZAÇÃO, não o usuário. O `userId` recebido é o `criado_por` da conexão do
 * canal, e filtrar o catálogo por ele deixava de fora todo produto cadastrado por OUTRO membro
 * da mesma org — o dado é org-scoped desde o E7/ADR-0027. Incidente 2026-08-11: o NIVEA da org
 * DSA foi cadastrado por um usuário e a conexão do ML pertence a outro; as vendas vinham com
 * `is_publiai = false` e SEM código, então 12 unidades venderam sem baixar estoque.
 * Só cai de volta para o `user_id` quando não há conexão para resolver a org.
 */
export async function carregarCatalogo(admin: SupabaseClient, userId: string): Promise<Catalogo> {
  const orgId = await resolverOrgPorUserId(admin, userId);
  // Coluna+valor em variável, e não um helper genérico envolvendo o builder: o genérico faz o
  // supabase-js estourar a inferência (`TS2589: type instantiation excessively deep`).
  const colEscopo = orgId ? 'org_id' : 'user_id';
  const valEscopo = orgId ?? userId;

  const familias = await paginarTudo<{ id: string; ml_item_id: string | null; codigo_pai: string | null }>(
    (de, ate) => admin.from('familias')
      .select('id, ml_item_id, codigo_pai').eq(colEscopo, valEscopo)
      .not('ml_item_id', 'is', null).range(de, ate),
  );
  const famPorId = new Map<string, { mlItemId: string; codigoPai: string | null }>();
  const idsPubliai = new Set<string>();
  for (const f of familias) {
    famPorId.set(f.id as string, { mlItemId: f.ml_item_id as string, codigoPai: f.codigo_pai as string | null });
    idsPubliai.add(f.ml_item_id as string);
  }
  const variacoes = await paginarTudo<{ familia_id: string; codigo: string | null; gtin: string | null; ml_variation_id: string | null; custo: unknown; atualizado_em: unknown }>(
    (de, ate) => admin.from('variacoes')
      // custo/atualizado_em: insumo do congelamento (ADR-0109) — atualizado_em é o tie-break
      // entre variações duplicadas por re-ingest (ADR-0108).
      .select('familia_id, codigo, gtin, ml_variation_id, custo, atualizado_em')
      .eq(colEscopo, valEscopo).range(de, ate),
  );
  // Linhas de custo montadas ANTES do filtro de família publicada abaixo: uma variação de família
  // ainda não publicada não tem ml_item_id, mas seu código/GTIN continuam válidos para casar a
  // venda — descartá-la aqui divergiria do frontend, que não filtra por publicação.
  const linhasCusto: LinhaCusto[] = variacoes.map((v) => ({
    custo: v.custo, atualizado_em: v.atualizado_em,
    ml_variation_id: v.ml_variation_id,
    ml_item_id: famPorId.get(v.familia_id as string)?.mlItemId ?? null,
    gtin: v.gtin, codigo: v.codigo,
  }));
  const mapasCusto = montarMapasCustoVigente(linhasCusto);
  // chave "itemId:varId" → valor da variação; fallback "itemId" → primeiro valor da família.
  const codPorVar = new Map<string, string>(), codPorItem = new Map<string, string>();
  const eanPorVar = new Map<string, string>(), eanPorItem = new Map<string, string>();
  const infoPorGtin = new Map<string, { codigo: string | null; ean: string | null }>();
  const eanPorCodigo = new Map<string, string>(); // codigo (=sku do filho UP) → gtin, p/ fundirItensUP
  for (const v of variacoes) {
    const fam = famPorId.get(v.familia_id as string);
    if (!fam) continue;
    const cod = v.codigo as string | null, ean = v.gtin as string | null;
    if (cod && v.ml_variation_id != null) codPorVar.set(`${fam.mlItemId}:${v.ml_variation_id}`, cod);
    if (cod && !codPorItem.has(fam.mlItemId)) codPorItem.set(fam.mlItemId, cod);
    if (ean && v.ml_variation_id != null) eanPorVar.set(`${fam.mlItemId}:${v.ml_variation_id}`, ean);
    if (ean && !eanPorItem.has(fam.mlItemId)) eanPorItem.set(fam.mlItemId, ean);
    if (ean && !infoPorGtin.has(normGtin(ean))) infoPorGtin.set(normGtin(ean), { codigo: cod, ean });
    if (cod && ean) eanPorCodigo.set(cod, ean);
  }
  for (const [, fam] of famPorId) {
    if (fam.codigoPai && !codPorItem.has(fam.mlItemId)) codPorItem.set(fam.mlItemId, fam.codigoPai);
  }

  // ADR-0088 §2: itens filhos User Products (cores 2..N, 1 item ML por SKU) — sem essa fusão, a
  // venda de uma cor 2..N não é reconhecida como PubliAI (fica de fora de idsPubliai/codPorItem).
  // Escopo por org_id direto (não pelo user_id da raiz anuncios_externos, que a saga UP não seta).
  if (orgId) {
    const itensUP = await paginarTudo<{ item_externo_id: string | null; sku: string }>(
      (de, ate) => admin.from('anuncios_externos_itens')
        .select('item_externo_id, sku').eq('org_id', orgId).not('item_externo_id', 'is', null).range(de, ate),
    );
    fundirItensUP(
      { idsPubliai, codPorItem, eanPorItem, infoPorGtin },
      itensUP.map((i) => ({ itemExternoId: i.item_externo_id as string, sku: i.sku, gtin: eanPorCodigo.get(i.sku) ?? null })),
    );
  }

  const mk = (porVar: Map<string, string>, porItem: Map<string, string>) =>
    (itemId: string | null, varId: number | null): string | null => {
      if (!itemId) return null;
      if (varId != null) { const x = porVar.get(`${itemId}:${varId}`); if (x) return x; }
      return porItem.get(itemId) ?? null;
    };
  return {
    idsPubliai, codigoResolver: mk(codPorVar, codPorItem), eanResolver: mk(eanPorVar, eanPorItem), infoPorGtin,
    custoVigenteResolver: (item: ItemParaCusto) => resolverCustoVigente(mapasCusto, item),
  };
}

/** GET /orders/{id}. Lança MLApiError(status) em erro (caller classifica via classificarErroML). */
export async function buscarPedido(token: string, orderId: string): Promise<PedidoML> {
  const resp = await fetch(`${API}/orders/${orderId}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new MLApiError(resp.status, `ML /orders/${orderId} ${resp.status}`);
  return await resp.json() as PedidoML;
}

/** Custo de frete pago pelo vendedor via /shipments/{id}/costs. null em erro/ausente. */
export async function buscarFreteVendedor(token: string, shippingId: number | string | null): Promise<number | null> {
  if (shippingId == null) return null;
  try {
    const resp = await fetch(`${API}/shipments/${shippingId}/costs`, {
      headers: { Authorization: `Bearer ${token}`, 'x-format-new': 'true' },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const senders = Array.isArray(data?.senders) ? data.senders : [];
    const soma = senders.reduce((acc: number, s: { cost?: number }) => acc + Number(s?.cost ?? 0), 0);
    return round2(soma);
  } catch {
    return null;
  }
}

/** Status do envio + geografia (cidade/UF do receiver_address) via /shipments/{id}. null em erro. */
export async function buscarShipment(token: string, shippingId: number | string | null): Promise<{
  status: string | null; substatus: string | null; tracking: string | null; logistic: string | null;
  cidade: string | null; uf: string | null; receiverNome: string | null;
} | null> {
  if (shippingId == null) return null;
  try {
    const resp = await fetch(`${API}/shipments/${shippingId}`, {
      headers: { Authorization: `Bearer ${token}`, 'x-format-new': 'true' },
    });
    if (!resp.ok) return null;
    const s = await resp.json();
    const geo = extrairGeo(s);
    return {
      status: s?.status ?? null,
      substatus: s?.substatus ?? null,
      tracking: s?.tracking_number ?? null,
      logistic: s?.logistic?.type ?? s?.logistic_type ?? null,
      cidade: geo.cidade,
      uf: geo.uf,
      receiverNome: extrairReceiverNome(s),
    };
  } catch {
    return null;
  }
}

/** Varre /orders/search do vendedor no período. Retorna pedidos completos. */
export async function buscarPedidosPeriodo(
  token: string,
  intervalo: { desde: string; ate: string },
): Promise<PedidoML[]> {
  const headers = { Authorization: `Bearer ${token}` };
  const meResp = await fetch(`${API}/users/me`, { headers });
  if (!meResp.ok) throw new Error(`ML /users/me ${meResp.status}`);
  const seller = (await meResp.json())?.id;
  if (!seller) throw new Error('ML: seller id ausente');

  const pedidos: PedidoML[] = [];
  const limit = 50;
  let offset = 0;
  while (offset < 5000) {
    const params = new URLSearchParams({
      seller: String(seller),
      'order.date_created.from': intervalo.desde,
      'order.date_created.to': intervalo.ate,
      sort: 'date_desc',
      offset: String(offset),
      limit: String(limit),
    });
    const resp = await fetch(`${API}/orders/search?${params}`, { headers });
    if (!resp.ok) {
      if (offset === 0) throw new Error(`ML /orders ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      break;
    }
    const data = await resp.json();
    const results: PedidoML[] = Array.isArray(data?.results) ? data.results : [];
    pedidos.push(...results);
    const total = Number(data?.paging?.total ?? pedidos.length);
    offset += limit;
    if (results.length === 0 || offset >= total) break;
  }
  return pedidos;
}

/** Upsert de uma venda + substituição dos itens. Idempotente por (user_id, order_id). */
export async function upsertVenda(
  admin: SupabaseClient,
  userId: string,
  orgId: string | null,
  pedido: PedidoML,
  opts: { freteVendedor?: number | null;
          idsPubliai: Set<string>; codigoResolver: (i: string | null, v: number | null) => string | null;
          eanResolver?: (i: string | null, v: number | null) => string | null;
          shipment?: { status: string | null; substatus: string | null; tracking: string | null; logistic: string | null; cidade: string | null; uf: string | null; receiverNome: string | null } | null;
          infoPorGtin?: Map<string, { codigo: string | null; ean: string | null }>;
          gtinPorItem?: Map<string, string>;
          liquidoPorPayment?: Map<string, DadosPagamentoMP>;
          /** ADR-0109 — custo vigente do item, congelado na venda. OBRIGATÓRIO de propósito: são
           *  4 callers (sync-venda, sync-devolucao, backfill-faturamento, reconciliar-faturamento)
           *  e o TS quebra a build de quem esquecer, em vez de a venda nascer sem custo. */
          custoVigenteResolver: (item: ItemParaCusto) => number | null },
): Promise<{ vendaId: string; novaPaga: boolean; itens: VendaItemRow[]; compradorNome: string | null }> {
  const { venda, itens } = mapearPedidoParaVenda(pedido, {
    idsPubliai: opts.idsPubliai, codigoResolver: opts.codigoResolver, eanResolver: opts.eanResolver,
    infoPorGtin: opts.infoPorGtin, gtinPorItem: opts.gtinPorItem, liquidoPorPayment: opts.liquidoPorPayment,
    freteVendedor: opts.freteVendedor,
  });
  // Estado anterior (para detectar "nova venda paga" e não realertar, não perder um comprador_nome
  // real já capturado — o ML é inconsistente e às vezes some com o buyer — e não apagar
  // estorno/liberação já gravados quando a leitura do MP falha ou não acha o pagamento).
  const { data: anterior } = await admin.from('ml_vendas')
    .select('id, status, comprador_nome, estorno, money_release_date').eq('user_id', userId).eq('order_id', venda.order_id).maybeSingle();

  const row = {
    user_id: userId,
    org_id: orgId,
    ...venda,
    ...preservarDadosMP(venda, anterior ?? null),
    comprador_nome: escolherCompradorNome(venda.comprador_nome, anterior?.comprador_nome ?? null, opts.shipment?.receiverNome ?? null),
    raw: pedido as unknown as Record<string, unknown>,
    shipping_status: opts.shipment?.status ?? null,
    shipping_substatus: opts.shipment?.substatus ?? null,
    tracking_number: opts.shipment?.tracking ?? null,
    shipping_logistic: opts.shipment?.logistic ?? null,
    cidade: opts.shipment?.cidade ?? null,
    uf: opts.shipment?.uf ?? null,
    atualizado_em: new Date().toISOString(),
  };
  const { data: up, error } = await admin.from('ml_vendas')
    .upsert(row, { onConflict: 'user_id,order_id' }).select('id').single();
  if (error) throw new Error(`upsert ml_vendas: ${error.message}`);
  const vendaId = up!.id as string;

  // O webhook de pedido pode chegar sem uma mensagem nova. Atualiza sempre o snapshot: se uma
  // tentativa anterior falhou depois do upsert da venda, o retry ainda precisa refazê-lo.
  const packId = pedido.pack_id ?? pedido.id;
  const { error: mensagensError } = await admin.from('ml_mensagens')
    .update({ order_status: venda.status })
    .eq('user_id', userId)
    .or(`order_id.eq.${venda.order_id},pack_id.eq.${packId}`);
  if (mensagensError) throw new Error(`atualizar status das mensagens: ${mensagensError.message}`);

  // Substitui os itens. Idempotente: unique (venda_id, ml_item_id, variation_id) impede
  // duplicata quando dois syncs do mesmo pedido correm concorrentes (ver plans/012).
  await admin.from('ml_vendas_itens').delete().eq('venda_id', vendaId);
  if (itens.length > 0) {
    const { error: itensErr } = await admin.from('ml_vendas_itens').upsert(
      itens.map((i: VendaItemRow) => ({ user_id: userId, org_id: orgId, venda_id: vendaId, ...i })),
      { onConflict: 'venda_id,ml_item_id,variation_id' },
    );
    if (itensErr) throw new Error(`upsert ml_vendas_itens: ${itensErr.message}`);
  }

  // ADR-0109 — congela o custo do produto no instante da venda. Fica FORA do delete/upsert acima
  // de propósito: `venda_item_custo` é outra tabela justamente para o DELETE dos itens não a
  // alcançar. `ignoreDuplicates` (ON CONFLICT DO NOTHING) é o insert-once — o primeiro sync grava,
  // os seguintes não tocam no valor; o trigger no banco garante o resto.
  const custosCongelar = itens
    .map((i: VendaItemRow) => ({
      i,
      custo: opts.custoVigenteResolver({
        variation_id: i.variation_id, ml_item_id: i.ml_item_id, ean: i.ean, codigo: i.codigo,
      }),
    }))
    .filter((x): x is { i: VendaItemRow; custo: number } => x.custo != null && x.custo > 0)
    .map(({ i, custo }) => ({
      user_id: userId, org_id: orgId, venda_id: vendaId,
      ml_item_id: i.ml_item_id, variation_id: i.variation_id, codigo: i.codigo,
      custo_unitario: custo, fonte: 'sync',
    }));
  if (custosCongelar.length > 0) {
    const { error: custoErr } = await admin.from('venda_item_custo').upsert(
      custosCongelar,
      { onConflict: 'venda_id,ml_item_id,variation_id', ignoreDuplicates: true },
    );
    // LOUD: caminho financeiro. Falhar aqui é melhor que a venda ficar sem custo em silêncio.
    if (custoErr) throw new Error(`congelar custo da venda: ${custoErr.message}`);
  }

  const eraPaga = anterior?.status === 'paid';
  const novaPaga = venda.status === 'paid' && !eraPaga;
  return { vendaId, novaPaga, itens, compradorNome: row.comprador_nome };
}
