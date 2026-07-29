// E6b (ADR-0094): seleção e aplicação da baixa de estoque de uma venda paga.
// A venda é sagrada — nada aqui pode derrubar o sync-venda; o chamador envolve em try/catch.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export interface ItemVendaBaixa { codigo: string | null; quantity: number }
export interface BaixaSelecionada { codigo: string; quantity: number }

/** Filtra itens sem SKU ou sem quantidade e agrega o mesmo SKU repetido no pedido. */
export function selecionarBaixas(itens: ItemVendaBaixa[]): BaixaSelecionada[] {
  const porCodigo = new Map<string, number>();
  for (const i of itens) {
    if (!i.codigo || i.quantity <= 0) continue;
    porCodigo.set(i.codigo, (porCodigo.get(i.codigo) ?? 0) + i.quantity);
  }
  return [...porCodigo].map(([codigo, quantity]) => ({ codigo, quantity }));
}

/** Referência de idempotência da baixa. Canal-agnóstica por construção. */
export function refBaixa(canal: string, orderId: string | number, codigo: string): string {
  return `${canal}:${orderId}:${codigo}`;
}

/** Movimento aplicado cujo push ao QStash ainda não foi confirmado (outbox no ledger). */
export interface MovimentoPendente {
  id: string;
  codigoPai: string;
  /** Intenção gravada no movimento. NUNCA fornecida pelo chamador. */
  canalOrigem: string | null;
}

export interface ResultadoBaixaVenda {
  /** Movimentos com push ainda não entregue ao QStash (outbox no ledger). */
  pendentesDePush: MovimentoPendente[];
  /** SKUs cuja venda excedeu o saldo (D-8) — o operador precisa saber. */
  semSaldo: Array<{ codigo: string; pedido: number }>;
  /** RPCs que erraram. Nunca vazio em silêncio: o chamador notifica. */
  falhas: Array<{ codigo: string; mensagem: string }>;
}

export async function registrarBaixaVenda(
  admin: SupabaseClient,
  p: { orgId: string; canal: string; orderId: string | number; itens: ItemVendaBaixa[] },
): Promise<ResultadoBaixaVenda> {
  const baixas = selecionarBaixas(p.itens);
  if (baixas.length === 0) return { pendentesDePush: [], semSaldo: [], falhas: [] };

  const semSaldo: Array<{ codigo: string; pedido: number }> = [];
  const falhas: Array<{ codigo: string; mensagem: string }> = [];

  for (const b of baixas) {
    const ref = refBaixa(p.canal, p.orderId, b.codigo);
    // supabase-js NÃO lança em erro de rpc — ignorar `error` faria a baixa sumir em
    // silêncio. Caminho que alimenta saldo falha LOUD (regra da casa, ADR-0055).
    const { data, error } = await admin.rpc('baixar_estoque', {
      p_org: p.orgId, p_codigo: b.codigo, p_qtd: b.quantity, p_canal: p.canal, p_ref: ref,
    });
    if (error) {
      console.error('baixar_estoque_falhou', { orderId: p.orderId, codigo: b.codigo, erro: error.message });
      falhas.push({ codigo: b.codigo, mensagem: error.message });
      continue;
    }
    const r = data as {
      aplicado: boolean; motivo: string; codigo_pai?: string;
      estoque_anterior?: number; quantidade_pedida?: number;
    };
    if (!r.aplicado) continue;
    // "Vendeu sem saldo": o pedido foi maior que o saldo que existia antes da baixa.
    if (r.estoque_anterior !== undefined && r.estoque_anterior < b.quantity) {
      semSaldo.push({ codigo: b.codigo, pedido: b.quantity });
    }
  }

  // O que enfileirar NÃO vem do que esta execução aplicou, e sim do OUTBOX: todo
  // movimento com push ainda não entregue. É o que fecha o buraco em que a RPC
  // commita e o enfileiramento falha — no retry, `aplicado` seria false e o push
  // se perderia para sempre. Aqui ele é reencontrado.
  return { pendentesDePush: await lerPushPendente(admin, p.orgId), semSaldo, falhas };
}

/**
 * Estorna, para um pedido cancelado, tudo que foi de fato baixado dele.
 * A checagem "houve baixa?" vive DENTRO da RPC (com advisory lock e FOR UPDATE no
 * movimento de venda) — fazer o check aqui e o estorno lá seria check-then-act não
 * atômico, e a quantidade do snapshot do pedido cancelado pode divergir da baixada.
 * Quando não há baixa, a RPC grava o tombstone que impede a baixa posterior.
 */
export async function estornarVendaCancelada(
  admin: SupabaseClient,
  p: { orgId: string; canal: string; orderId: string | number; itens: ItemVendaBaixa[] },
): Promise<{ pendentesDePush: MovimentoPendente[]; falhas: Array<{ codigo: string; mensagem: string }> }> {
  const falhas: Array<{ codigo: string; mensagem: string }> = [];
  for (const b of selecionarBaixas(p.itens)) {
    const { error } = await admin.rpc('estornar_estoque', {
      p_org: p.orgId, p_canal: p.canal,
      p_ref_venda: refBaixa(p.canal, p.orderId, b.codigo),
      p_codigo: b.codigo,
    });
    if (error) {
      console.error('estornar_estoque_falhou', { orderId: p.orderId, codigo: b.codigo, erro: error.message });
      falhas.push({ codigo: b.codigo, mensagem: error.message });
    }
    // O que enfileirar vem do outbox, não do retorno — mesma razão da baixa.
  }
  return { pendentesDePush: await lerPushPendente(admin, p.orgId), falhas };
}

/** Movimentos aplicados cujo push ao QStash ainda não foi confirmado (outbox no ledger). */
export async function lerPushPendente(
  admin: SupabaseClient, orgId: string, limite = 200,
): Promise<MovimentoPendente[]> {
  const { data, error } = await admin.from('estoque_movimentos')
    .select('id, codigo_pai, push_canal_origem')
    .eq('org_id', orgId)
    .is('push_enfileirado_em', null)
    .neq('codigo_pai', '')
    .order('criado_em', { ascending: true })
    .limit(limite);
  if (error) {
    console.error('ler_push_pendente_falhou', error.message);
    return [];
  }
  return (data ?? []).map((m) => ({
    id: m.id as string,
    codigoPai: m.codigo_pai as string,
    canalOrigem: (m.push_canal_origem as string | null) ?? null,
  }));
}

export interface ResultadoDespacho { marcados: number; falhas: number }

/**
 * Enfileira o push de cada pendente e SÓ ENTÃO marca o outbox como entregue.
 *
 * O agrupamento é por `(codigoPai, canalOrigem)` — nunca só por produto. Movimentos
 * do mesmo produto podem ter políticas de propagação OPOSTAS: uma venda no ML exclui
 * o ML do push (ele já se decrementou), enquanto uma entrada precisa alcançar o ML.
 * Agrupar só por produto faria um despacho de venda drenar e marcar como entregue a
 * entrada, deixando o ML defasado com o saldo errado.
 *
 * A ordem enqueue → marca importa: marcar antes reintroduziria a perda que o outbox
 * existe para evitar. Marcar depois pode, no pior caso, enfileirar duas vezes — e push
 * absoluto é idempotente, então duplicar é inofensivo.
 */
export async function despacharPushPendente(
  admin: SupabaseClient,
  orgId: string,
  pendentes: MovimentoPendente[],
  enfileirar: (job: { org_id: string; codigo_pai: string; canal_origem: string | null }, orgId: string) => Promise<string>,
): Promise<ResultadoDespacho> {
  let marcados = 0;
  let falhas = 0;

  const grupos = new Map<string, { codigoPai: string; canalOrigem: string | null; ids: string[] }>();
  for (const p of pendentes) {
    const chave = JSON.stringify([p.codigoPai, p.canalOrigem]);
    if (!grupos.has(chave)) {
      grupos.set(chave, { codigoPai: p.codigoPai, canalOrigem: p.canalOrigem, ids: [] });
    }
    grupos.get(chave)!.ids.push(p.id);
  }

  for (const g of grupos.values()) {
    try {
      await enfileirar(
        { org_id: orgId, codigo_pai: g.codigoPai, canal_origem: g.canalOrigem }, orgId,
      );
      // supabase-js devolve o erro como valor, não lança. Ignorar aqui faria a função
      // aparentar sucesso e reenviar o mesmo push para sempre.
      const { error } = await admin.from('estoque_movimentos')
        .update({ push_enfileirado_em: new Date().toISOString() })
        .in('id', g.ids);
      if (error) {
        // Enqueue aceito mas marca falhou: o movimento CONTINUA pendente. Sinalizar a
        // falha é o que impede o chamador de reler e re-enfileirar o mesmo grupo em laço.
        falhas++;
        console.error('marcar_push_entregue_falhou', { orgId, codigoPai: g.codigoPai, erro: error.message });
      } else {
        marcados += g.ids.length;
      }
    } catch (e) {
      // Fica no outbox. A próxima execução do sync ou a reconciliação diária pega.
      falhas++;
      console.error('despachar_push_falhou', { orgId, codigoPai: g.codigoPai, erro: String(e) });
    }
  }
  return { marcados, falhas };
}
