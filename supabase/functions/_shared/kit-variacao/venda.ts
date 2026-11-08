// ADR-0199 (Task 8): identidade de item vendido e aviso de kit zerado, para org com o módulo `kit_variacao`.
//
// A referência da baixa é `canal:pedido:SKU`. Se duas execuções resolverem SKUs diferentes para o mesmo item do
// pedido (catálogo ou GTIN tolerante, fallback `seller_custom_field`), nascem dois débitos. Por isso a primeira
// baixa grava (pedido, item ML, variação) → SKU em `kit_venda_identidade`, e baixa e estorno seguintes do mesmo item
// usam esse SKU. Sem identidade e com leitura incerta, o item só segue se for comprovadamente comum (vínculo local
// sem participante); ausência de vínculo + fallback não prova nada e o item fica para depois.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { ItemVendaBaixa } from '../estoque/baixa.ts';
import type { CategoriaNotificacao } from '../notificacoes/categorias.ts';
import { skusParticipantes } from './politica.ts';

const chave = (mlItemId: string, variationId: unknown) => `${mlItemId}:${variationId ?? ''}`;

export interface ItensKit {
  /** Seguros para baixar/estornar, já com o SKU da identidade quando ela existe. */
  certos: ItemVendaBaixa[];
  /** Sem identidade, leitura incerta e sem prova de que é comum: ficam para depois. */
  incertos: ItemVendaBaixa[];
  /** Resolução desta execução diferente da identidade gravada (a baixa segue pela identidade). */
  divergentes: Array<{ mlItemId: string; resolvido: string; identidade: string }>;
}

interface Ctx { orgId: string; canal: string; orderId: string | number }

async function lerIdentidades(admin: SupabaseClient, c: Ctx): Promise<Map<string, string>> {
  const { data, error } = await admin.from('kit_venda_identidade')
    .select('ml_item_id, variation_id, codigo')
    .eq('org_id', c.orgId).eq('canal', c.canal).eq('order_id', String(c.orderId));
  if (error) throw new Error(`kit_venda_identidade: ${error.message}`);
  return new Map((data ?? []).map((r) => [chave(r.ml_item_id as string, r.variation_id || null), r.codigo as string]));
}

/** Erro de leitura lança: quem chama trata o pedido inteiro como incerto. */
export async function classificarItensKit(
  admin: SupabaseClient, p: Ctx & { itens: ItemVendaBaixa[]; incerto: boolean },
): Promise<ItensKit> {
  const ident = await lerIdentidades(admin, p);
  const out: ItensKit = { certos: [], incertos: [], divergentes: [] };
  const aConferir: ItemVendaBaixa[] = [];
  for (const i of p.itens) {
    const id = i.ml_item_id ? ident.get(chave(i.ml_item_id, i.variation_id)) : undefined;
    if (id) {
      if (i.codigo && i.codigo !== id) out.divergentes.push({ mlItemId: i.ml_item_id!, resolvido: i.codigo, identidade: id });
      out.certos.push({ ...i, codigo: id });
    } else if (!p.incerto) {
      out.certos.push(i);
    } else {
      aConferir.push(i);
    }
  }
  if (aConferir.length > 0) {
    const comuns = await comunsComprovados(admin, p.orgId, aConferir);
    for (const i of aConferir) (comuns.has(i) ? out.certos : out.incertos).push(i);
  }
  return out;
}

/**
 * Comum comprovado: o item ML tem vínculo local (UP, cópia de catálogo, família ou catálogo da variação) e nem os
 * SKUs vinculados nem o código resolvido são participantes. Participante só existe em user product, então
 * família Legacy vinculada também prova. Sem vínculo, o código pode ter vindo do GTIN que falhou ou do fallback.
 */
async function comunsComprovados(admin: SupabaseClient, orgId: string, itens: ItemVendaBaixa[]): Promise<Set<ItemVendaBaixa>> {
  const ids = [...new Set(itens.map((i) => i.ml_item_id).filter((x): x is string => !!x))];
  const skusDoItem = new Map<string, string[]>();
  const somar = (id: string | null | undefined, skus: string[]) => {
    if (id) skusDoItem.set(id, [...(skusDoItem.get(id) ?? []), ...skus]);
  };
  if (ids.length > 0) {
    for (const coluna of ['item_externo_id', 'catalog_listing_id']) {
      const { data, error } = await admin.from('anuncios_externos_itens')
        .select('sku, item_externo_id, catalog_listing_id').eq('org_id', orgId).in(coluna, ids);
      if (error) throw new Error(`anuncios_externos_itens: ${error.message}`);
      for (const r of data ?? []) {
        somar((coluna === 'item_externo_id' ? r.item_externo_id : r.catalog_listing_id) as string | null, [r.sku as string]);
      }
    }
    const { data: fams, error: e3 } = await admin.from('familias')
      .select('ml_item_id, variacoes(codigo)').eq('org_id', orgId).in('ml_item_id', ids);
    if (e3) throw new Error(`familias: ${e3.message}`);
    for (const f of fams ?? []) {
      somar(f.ml_item_id as string, ((f.variacoes ?? []) as Array<{ codigo: string | null }>).flatMap((v) => (v.codigo ? [v.codigo] : [])));
    }
    const { data: vars, error: e4 } = await admin.from('variacoes')
      .select('codigo, catalog_listing_id').eq('org_id', orgId).in('catalog_listing_id', ids);
    if (e4) throw new Error(`variacoes: ${e4.message}`);
    for (const v of vars ?? []) somar(v.catalog_listing_id as string, v.codigo ? [v.codigo as string] : []);
  }
  const candidatos = new Set([...itens.flatMap((i) => (i.codigo ? [i.codigo] : [])), ...[...skusDoItem.values()].flat()]);
  const part = await skusParticipantes(admin, orgId, [...candidatos], true);
  return new Set(itens.filter((i) => {
    const vinculados = skusDoItem.get(i.ml_item_id ?? '');
    return !!vinculados && !vinculados.some((s) => part.has(s)) && !(i.codigo && part.has(i.codigo));
  }));
}

/**
 * Grava a identidade dos itens que vão ser baixados (a primeira vence, PK) e devolve os itens com o SKU vencedor:
 * duas execuções concorrentes com resoluções diferentes acabam baixando o mesmo SKU. Erro lança.
 */
export async function gravarIdentidades(
  admin: SupabaseClient, p: Ctx & { itens: ItemVendaBaixa[] },
): Promise<ItemVendaBaixa[]> {
  const linhas = p.itens.filter((i) => i.ml_item_id && i.codigo && i.quantity > 0).map((i) => ({
    org_id: p.orgId, canal: p.canal, order_id: String(p.orderId), ml_item_id: i.ml_item_id!,
    variation_id: i.variation_id != null ? String(i.variation_id) : '', codigo: i.codigo!,
  }));
  if (linhas.length === 0) return p.itens;
  const { error } = await admin.from('kit_venda_identidade')
    .upsert(linhas, { onConflict: 'org_id,canal,order_id,ml_item_id,variation_id', ignoreDuplicates: true });
  if (error) throw new Error(`kit_venda_identidade: ${error.message}`);
  const ident = await lerIdentidades(admin, p);
  return p.itens.map((i) => {
    const id = i.ml_item_id ? ident.get(chave(i.ml_item_id, i.variation_id)) : undefined;
    return id && i.codigo ? { ...i, codigo: id } : i;
  });
}

export interface DepsAvisoKit {
  /** `notificarCategoria` com `chave`: idempotente (in-app por chave, Telegram reservado por chat). */
  notificar: (
    admin: SupabaseClient, orgId: string, categoria: CategoriaNotificacao, texto: string, opcoes: { chave: string },
  ) => Promise<unknown>;
}

/**
 * Avisa cada kit em modo manual que zerou por venda. O evento é o próprio movimento do ledger (`estoque_resultante
 * = 0` vindo de saldo > 0), durável. `kit_aviso_enviado_em` só é gravado DEPOIS do envio; envio com chave por
 * movimento, então repetir não duplica. Falha no envio deixa o movimento para a próxima varredura (sync-venda,
 * importação da saga ou reconciliação diária), sem janela de tempo.
 *
 * Modo manual (spec, Reposição): só "Vender só em kit" com reposição automática repõe sozinho. Erro de leitura lança;
 * erro de envio de um movimento não impede os demais. Devolve quantos foram enviados.
 */
export async function avisarKitsZerados(admin: SupabaseClient, deps: DepsAvisoKit, orgId: string): Promise<number> {
  const { data: skus, error } = await admin.from('kit_variacao_skus')
    .select('codigo, kits_variacao(reposicao_auto, so_em_kit)').eq('org_id', orgId);
  if (error) throw new Error(`kit_variacao_skus: ${error.message}`);
  const manuais = (skus ?? []).filter((r) => {
    const k = (r as { kits_variacao?: unknown }).kits_variacao;
    const kit = (Array.isArray(k) ? k[0] : k) as { reposicao_auto?: boolean; so_em_kit?: boolean } | null;
    return !!kit && !(kit.so_em_kit === true && kit.reposicao_auto === true);
  }).map((r) => r.codigo as string);
  if (manuais.length === 0) return 0;

  const { data: movs, error: e2 } = await admin.from('estoque_movimentos')
    .select('id, codigo, referencia_externa')
    .eq('org_id', orgId).eq('motivo', 'venda').eq('estoque_resultante', 0).gt('estoque_anterior', 0)
    .is('kit_aviso_enviado_em', null)
    .in('codigo', manuais);
  if (e2) throw new Error(`estoque_movimentos: ${e2.message}`);
  let n = 0;
  for (const m of movs ?? []) {
    const pedido = String(m.referencia_externa ?? '').split(':')[1] ?? '';
    try {
      await deps.notificar(
        admin, orgId, 'estoque',
        `🧩 Kit sem saldo: ${m.codigo}${pedido ? ` (pedido ${pedido})` : ''}\n\n`
        + 'Este kit não repõe sozinho (reposição automática desligada ou individual ativo). '
        + 'Para voltar a vender, use Montar mais.',
        { chave: `kit_zerado:${m.id}` },
      );
    } catch (e) {
      console.error('kit_aviso_zerado_envio_falhou', orgId, m.id, String(e));
      continue;
    }
    const { error: e3 } = await admin.from('estoque_movimentos')
      .update({ kit_aviso_enviado_em: new Date().toISOString() }).eq('id', m.id as string);
    // Sem a marca, a próxima varredura reenvia com a mesma chave: não duplica.
    if (e3) console.error('kit_aviso_zerado_marcar_falhou', orgId, m.id, e3.message);
    n++;
  }
  return n;
}

/** Varredura diária (reconciliar-estoque): todas as orgs com o módulo, sem depender de venda nova. Erro por org só loga. */
export async function avisarKitsZeradosDasOrgs(admin: SupabaseClient, deps: DepsAvisoKit): Promise<number> {
  const { data, error } = await admin.from('organizations').select('id').contains('modulos_habilitados', ['kit_variacao']);
  if (error) throw new Error(`organizations: ${error.message}`);
  let n = 0;
  for (const o of data ?? []) {
    try {
      n += await avisarKitsZerados(admin, deps, o.id as string);
    } catch (e) {
      console.error('kit_aviso_zerado_org_falhou', o.id, String(e));
    }
  }
  return n;
}
