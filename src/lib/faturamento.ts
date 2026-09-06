import { supabase } from './supabase';
import type { Janela } from './metricas';
import { labelStatusEnvio } from './ml-status';
import { ehFaturavel } from './resumo-vendas';
import { buscarTodasPaginas } from './paginacao-supabase';
import { round2 } from './formato';
import type { CanalAtivo } from './canal-ativo';
import { comCustoCongelado, type CustoCongeladoRow, type OrigemVenda, type Venda } from '../../supabase/functions/_shared/platform-admin/sales-types';
export { comCustoCongelado, type CustoCongeladoRow, type OrigemVenda, type Venda, type VendaItem } from '../../supabase/functions/_shared/platform-admin/sales-types';

/** Lê as vendas do período direto da tabela (RLS por user). Inclui os itens.
 *  Pagina (`.range`) para não truncar em ~1000 linhas (teto padrão do PostgREST).
 *  `atualizadoDesde`: marca d'água do poll incremental (ADR-0082) — quando presente, filtra
 *  `atualizado_em >= atualizadoDesde` em vez de trazer a janela inteira. `.gte` (não `.gt`):
 *  reprocessar a linha na própria marca d'água é idempotente (merge substitui por id). */
export async function buscarVendas(janela: Janela, origem: OrigemVenda = 'todos', canal: CanalAtivo = 'todos', atualizadoDesde?: string): Promise<Venda[]> {
  const vendas = await buscarTodasPaginas<Venda>((de, ate) => {
    let q = supabase
      .from('ml_vendas')
      .select('id, order_id, pack_id, status, status_detail, date_closed, date_created, comprador_nick, comprador_nome, comprador_id, uf, cidade, total_amount, paid_amount, sale_fee_total, frete_vendedor, liquido, estorno, money_release_date, sacado_em, sacado_por, atualizado_em, currency, shipping_id, shipping_status, shipping_substatus, shipping_logistic, tracking_number, is_publiai, tem_devolucao, kit_item_id, itens:ml_vendas_itens(id, ml_item_id, variation_id, titulo, codigo, cor, ean, quantity, unit_price, sale_fee, is_publiai), custos:venda_item_custo(ml_item_id, variation_id, custo_unitario)')
      .gte('date_closed', janela.desde)
      .lte('date_closed', janela.ate)
      .order('date_closed', { ascending: false })
      .range(de, ate);
    if (origem === 'publiai') q = q.eq('is_publiai', true);
    if (origem === 'fora') q = q.eq('is_publiai', false);
    if (canal !== 'todos') q = q.eq('canal', canal);
    if (atualizadoDesde) q = q.gte('atualizado_em', atualizadoDesde);
    return q as unknown as PromiseLike<{ data: Venda[] | null; error: { message: string } | null }>;
  });
  // 'canal' ainda não está no select (coluna só existe em produção após a migration da Task 4);
  // fallback para 'mercado_livre' preserva o comportamento atual até a Task 9 ligar o filtro real.
  // `custos` sai do objeto: é insumo do embed, já consumido por `comCustoCongelado`. Sem isto ele
  // viajaria para os consumidores como campo não declarado em `Venda`.
  return vendas.map((v) => {
    const { custos: _custos, ...resto } = v as Venda & { custos?: CustoCongeladoRow[] | null };
    return { ...resto, canal: v.canal ?? 'mercado_livre', itens: comCustoCongelado(v) };
  });
}

/** Folga da marca d'água. `atualizado_em = now()` no Postgres é o timestamp do INÍCIO da
 *  transação: uma escrita que começou antes mas commitou depois tem timestamp MENOR que outra
 *  já visível. Sem folga, o delta pularia essa linha para sempre (ela some do Faturamento até
 *  a troca de período) — inaceitável em dado financeiro. Reler os últimos 60s custa algumas
 *  linhas por tick e fecha a janela: o backfill grava centenas de vendas em transações
 *  concorrentes dentro do mesmo segundo. */
const FOLGA_MARCA_MS = 60_000;

/** Marca d'água do poll incremental: maior `atualizado_em` do conjunto, recuado em
 *  {@link FOLGA_MARCA_MS}. Aritmética sobre o timestamp DO SERVIDOR — não lê o relógio local,
 *  então clock skew do cliente não interfere. */
export function marcaDagua(vendas: Venda[]): string | null {
  let max: string | null = null;
  for (const v of vendas) if (max === null || v.atualizado_em > max) max = v.atualizado_em;
  if (max === null) return null;
  const ms = Date.parse(max);
  return Number.isNaN(ms) ? max : new Date(ms - FOLGA_MARCA_MS).toISOString();
}

/** Mescla o delta no conjunto atual: substitui por id, insere novas, reordena por date_closed desc.
 *  Delta vazio devolve a MESMA referência (evita re-render). Vendas nunca são deletadas do DB,
 *  então merge-only é seguro. */
export function mesclarVendas(atuais: Venda[], delta: Venda[]): Venda[] {
  if (delta.length === 0) return atuais;
  const porId = new Map(atuais.map((v) => [v.id, v]));
  for (const v of delta) porId.set(v.id, v);
  return [...porId.values()].sort((a, b) => (b.date_closed ?? '').localeCompare(a.date_closed ?? ''));
}

/**
 * Dispara o backfill (botão "Sincronizar") para o próprio usuário.
 *
 * `dias` default 7 (era 30 até 2026-08-03), igual ao schedule horário do QStash. Medido em
 * 2026-07-27 na conta Avil (~600 pedidos/30d): ≈47s fixos + ~2,7s por dia de janela, contra o
 * limite de ~150s da edge function. Com 90 seriam ~294s — nunca coube; 30 fechava em ~129s.
 *
 * Os 129s deixaram de caber: o custo FIXO cresce sozinho, porque não depende de `dias` —
 * `buscarPerguntasSeller` e `buscarClaimsSeller` releem o histórico INTEIRO do vendedor a cada
 * execução (sem filtro de data, teto de 2000 cada), e cada claim custa mais 1 GET de return. Um
 * claim fechado há meses continua sendo relido para sempre. (O passo de mensagens NÃO é o
 * ofensor: `listarPacksDeVendas` tem `limite = 200` — é caro, mas constante.) No schedule (`dias:7`, todas
 * as orgs): mediana 70s em 27/07 → 81s em 03/08, ~+1,6s/dia, com 5 falhas esporádicas no período
 * — 4 timeouts (546/504) e um 520, todas salvas pelo retry do QStash. Reduzir a janela só compra
 * tempo — o teto volta.
 * Correção de raiz: guarda de orçamento + retomabilidade no backfill, como em
 * `reconciliar-faturamento` (ver `backfill-faturamento/index.ts:8-12`).
 */
export async function sincronizarFaturamento(dias = 7): Promise<{ sincronizados: number }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sem sessão');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/backfill-faturamento`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ dias }),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(json?.erro ?? `Falha (${resp.status})`);
  if (json == null) throw new Error('Resposta inválida do servidor');
  return json as { sincronizados: number };
}

export async function registrarSaque(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { data, error } = await supabase.rpc('registrar_saque_ml_vendas', { p_ids: ids });
  if (error) throw new Error(error.message);
  return data ?? 0;
}

export async function desfazerSaque(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { data, error } = await supabase.rpc('desfazer_saque_ml_vendas', { p_ids: ids });
  if (error) throw new Error(error.message);
  return data ?? 0;
}

/** KPIs agregados das vendas exibidas. */
export interface KpisVendas {
  faturamento: number; pedidos: number; unidades: number; liquido: number; ticket: number;
  /** Quantidade de pedidos por status de envio (Pronto p/ envio, Enviado, Entregue, …). */
  porStatusEnvio: Record<string, number>;
}

export function calcularKpis(vendas: Venda[]): KpisVendas {
  // KPIs monetários refletem o "Vendas brutas" do ML: contam vendas faturáveis — pagas E
  // reembolsadas (paid/partially_refunded/refunded), pelo valor bruto, igual à tela de Métricas
  // do ML (ADR-0038). Cancelados aparecem na lista com o status, mas não inflam o faturamento.
  // A quebra por status de envio conta TODOS os pedidos exibidos (operacional, indep. de pgto).
  let faturamento = 0, liquido = 0, unidades = 0, pedidos = 0;
  const porStatusEnvio: Record<string, number> = {};
  for (const v of vendas) {
    const st = labelStatusEnvio(v.shipping_status, v.shipping_substatus).label;
    porStatusEnvio[st] = (porStatusEnvio[st] ?? 0) + 1;
    if (!ehFaturavel(v.status)) continue;
    faturamento += v.total_amount;
    liquido += v.liquido ?? 0;
    for (const i of v.itens) unidades += i.quantity;
    pedidos += 1;
  }
  return {
    porStatusEnvio,
    faturamento: round2(faturamento),
    liquido: round2(liquido),
    unidades,
    pedidos,
    ticket: pedidos > 0 ? round2(faturamento / pedidos) : 0,
  };
}
