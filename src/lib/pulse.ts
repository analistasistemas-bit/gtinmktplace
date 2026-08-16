// Pulse (ADR-0119): leituras direto via PostgREST (RLS resolve o escopo da org); ações
// (adicionar manual, coletar agora) via POST nas edge functions com o token da sessão.
import { supabase } from './supabase';
import { fetchAliquotas } from './queries';
import { estadoAtualOfertas } from './pulse-margem';

// As tabelas pulse_* são recentes e database.types.ts ainda não foi regenerado (mesmo padrão
// de cast pontual usado em queries.ts para ml_formato_publicacao); RLS continua protegendo a
// leitura pela organização normalmente.
function pulseFrom(tabela: 'pulse_produtos' | 'pulse_ofertas' | 'pulse_vendedores') {
  return supabase.from(tabela as never) as ReturnType<typeof supabase.from>;
}

export interface PulseProduto {
  id: string; catalog_product_id: string; codigo_pai: string | null; titulo: string | null;
  origem: 'auto' | 'manual'; status: 'ativo' | 'pausado' | 'arquivado';
  ptw_status: string | null; ptw_preco_sugerido: number | null;
  ptw_custos: { comissao: number | null; frete: number | null } | null;
  ultimo_snapshot_em: string | null;
}
export interface PulseOferta {
  item_id: string; seller_id: number; preco: number; tier: string | null;
  frete_gratis: boolean; loja_oficial: boolean; ativo: boolean; dia: string;
}
export interface PulseVendedor {
  seller_id: number; nickname: string | null; power_seller: string | null;
  nivel: string | null; transactions_total: number | null; dia: string;
}

export async function fetchPulseProdutos(): Promise<PulseProduto[]> {
  const { data, error } = await pulseFrom('pulse_produtos')
    .select(
      'id, catalog_product_id, codigo_pai, titulo, origem, status, ptw_status, ptw_preco_sugerido, ptw_custos, ultimo_snapshot_em',
    )
    .neq('status', 'arquivado')
    .order('atualizado_em', { ascending: false });
  if (error) throw error;
  return (data ?? []) as PulseProduto[];
}

export async function fetchPulseDetalhe(
  produtoId: string,
): Promise<{ ofertas: PulseOferta[]; vendedores: PulseVendedor[] }> {
  const { data: ofertasData, error: ofertasErro } = await pulseFrom('pulse_ofertas')
    .select('item_id, seller_id, preco, tier, frete_gratis, loja_oficial, ativo, dia')
    .eq('produto_id', produtoId)
    .order('dia', { ascending: false })
    .limit(400);
  if (ofertasErro) throw ofertasErro;
  const ofertas = (ofertasData ?? []) as PulseOferta[];

  const sellerIds = [...new Set(ofertas.map((o) => o.seller_id))];
  if (sellerIds.length === 0) return { ofertas, vendedores: [] };

  const { data: vendedoresData, error: vendedoresErro } = await pulseFrom('pulse_vendedores')
    .select('seller_id, nickname, power_seller, nivel, transactions_total, dia')
    .in('seller_id', sellerIds)
    .order('dia', { ascending: true });
  if (vendedoresErro) throw vendedoresErro;
  return { ofertas, vendedores: (vendedoresData ?? []) as PulseVendedor[] };
}

export interface PulseResumoOfertas { menorPreco: number | null; nOfertas: number }

/**
 * Estado atual (menor preço + nº de ofertas ativas) por produto, para a lista do radar.
 * `pulse_ofertas` só grava linha quando algo muda (ADR-0119 §2) — não dá pra filtrar por
 * dia recente, precisa da história inteira de cada item pra achar sua última linha.
 * ponytail: sem paginação/prune aqui — segue a decisão do plano (v1 não perde dado por não
 * tê-lo); o job de agregação/prune de 90 dias é follow-up em TASKS.md.
 */
export async function fetchPulseResumoOfertas(produtoIds: string[]): Promise<Map<string, PulseResumoOfertas>> {
  const resumo = new Map<string, PulseResumoOfertas>();
  if (produtoIds.length === 0) return resumo;
  const { data, error } = await pulseFrom('pulse_ofertas')
    .select('produto_id, item_id, seller_id, preco, tier, frete_gratis, loja_oficial, ativo, dia')
    .in('produto_id', produtoIds)
    .order('dia', { ascending: false });
  if (error) throw error;

  const porProduto = new Map<string, PulseOferta[]>();
  for (const row of (data ?? []) as (PulseOferta & { produto_id: string })[]) {
    const lista = porProduto.get(row.produto_id) ?? [];
    lista.push(row);
    porProduto.set(row.produto_id, lista);
  }
  for (const [produtoId, ofertas] of porProduto) {
    const atuais = estadoAtualOfertas(ofertas);
    resumo.set(produtoId, { menorPreco: atuais[0]?.preco ?? null, nOfertas: atuais.length });
  }
  return resumo;
}

export async function pausarPulseProduto(id: string, pausar: boolean): Promise<void> {
  const { error } = await pulseFrom('pulse_produtos')
    .update({ status: pausar ? 'pausado' : 'ativo' })
    .eq('id', id);
  if (error) throw error;
}

/** Custo do produto + alíquota de imposto + preço de publicação atual, para o simulador de
 *  margem. Regra LOUD (ADR-0055/0086): alíquota só entra confirmada — nunca o default 8/16
 *  em silêncio. */
export async function fetchContextoMargem(
  codigoPai: string,
): Promise<{ custo: number | null; aliquotaPct: number | null; precoAtual: number | null }> {
  const { data: familias, error } = await supabase
    .from('familias')
    .select('origem, variacoes(custo, preco_publicacao, preco_publicado_ml)')
    .eq('codigo_pai', codigoPai)
    .order('criado_em', { ascending: false })
    .limit(5);
  if (error) throw error;
  // Família mais recente COM variações — uma família recém-criada (ainda sem variações
  // gravadas) não pode se passar pela fonte de custo (regra LOUD: cai em null, não em 0).
  const familia = (familias ?? []).find((f) => (f.variacoes ?? []).length > 0);
  if (!familia) return { custo: null, aliquotaPct: null, precoAtual: null };

  const variacoes = (familia.variacoes ?? []) as
    { custo: number | null; preco_publicacao: number | null; preco_publicado_ml: number | null }[];
  const custos = variacoes.map((v) => v.custo).filter((c): c is number => c != null);
  const custo = custos.length > 0 ? Math.max(...custos) : null;
  const precoAtual = variacoes.map((v) => v.preco_publicado_ml ?? v.preco_publicacao).find((p) => p != null) ?? null;

  const aliquotas = await fetchAliquotas();
  const aliquotaPct = !aliquotas.confirmada
    ? null
    : familia.origem === 'importado' ? aliquotas.importado : aliquotas.nacional;

  return { custo, aliquotaPct, precoAtual };
}

async function postPulse<T>(fn: string, body: unknown): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sem sessão');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json?.erro ?? `Falha (${resp.status})`);
  return json as T;
}

export async function adicionarPulseManual(entrada: string): Promise<void> {
  await postPulse('pulse-adicionar', { entrada });
}

export async function coletarPulseAgora(): Promise<{ produtos: number; alertas: number }> {
  return postPulse('pulse-coletar', {});
}
