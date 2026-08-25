// Pulse (ADR-0119): leituras direto via PostgREST (RLS resolve o escopo da org); ações
// (adicionar manual, coletar agora) via POST nas edge functions com o token da sessão.
import { supabase } from './supabase';
import { fetchAliquotas } from './queries';
import { estadoAtualOfertas, mercadoPulse } from './pulse-margem';

// As tabelas pulse_* são recentes e database.types.ts ainda não foi regenerado (mesmo padrão
// de cast pontual usado em queries.ts para ml_formato_publicacao); RLS continua protegendo a
// leitura pela organização normalmente.
function pulseFrom(
  tabela: 'pulse_produtos' | 'pulse_ofertas' | 'pulse_ofertas_atual' | 'pulse_vendedores' | 'pulse_alertas',
) {
  return supabase.from(tabela as never) as ReturnType<typeof supabase.from>;
}

export interface PulseProduto {
  id: string; catalog_product_id: string; codigo_pai: string | null; titulo: string | null; gtin: string | null;
  origem: 'auto' | 'manual'; status: 'ativo' | 'pausado' | 'arquivado';
  catalogo_status: string | null;
  ptw_status: string | null; ptw_preco_sugerido: number | null;
  /** `applicable_suggestion` do ML: se a referência de preço se aplica a este anúncio.
   *  `false` = a tela não afirma posição de preço. `null` = campo ausente na leitura. */
  ptw_aplicavel: boolean | null;
  ptw_custos: { comissao: number | null; frete: number | null } | null;
  ultimo_snapshot_em: string | null;
  /**
   * Preço VIVO da nossa oferta nesta ficha, lido do ML na última coleta. `null` quando não temos
   * oferta ativa na ficha — anúncio pausado, sem estoque ou sem vínculo de catálogo. Nunca cai
   * para o preço local: era exatamente isso que fazia a coluna mostrar um valor defasado
   * (Errata 4 do ADR-0119).
   */
  meu_preco: number | null;
  meu_preco_em: string | null;
  /** Situação do NOSSO anúncio no ML (`active`, `paused`, `closed`…). Não é `status`, que é a
   *  situação do produto dentro do radar. `null` = ainda não lida. */
  anuncio_status: string | null;
  anuncio_sub_status: string[] | null;
  anuncio_status_em: string | null;
  /** Estrutura da comissão do ML lida para o preço efetivo (Erratas 6 e 7). Muda por faixa de preço. */
  comissao_pct: number | null;
  comissao_fixa: number | null;
  /**
   * Preço em que a estrutura acima foi lida. Margem calculada em preço diferente deste é
   * estimativa, e a tela precisa dizer isso — antes da Errata 7 o rótulo ancorava em `meu_preco`,
   * que é outra coisa quando a comissão foi lida no preço base de um anúncio promovido.
   * `null` = linha anterior à Errata 7, tratada como estimativa.
   */
  comissao_preco: number | null;
  comissao_em: string | null;
}
export interface PulseOferta {
  item_id: string; seller_id: number; preco: number; tier: string | null;
  frete_gratis: boolean; loja_oficial: boolean; ativo: boolean; dia: string;
  /** `shipping.logistic_type === 'fulfillment'` de `/products/{id}/items`. */
  full_ml: boolean;
  /** URL do anúncio no ML quando a ficha a expõe; `null` quando não veio (a tela não linka). */
  permalink: string | null;
  /**
   * Visitas do anúncio nos últimos 30 dias (ADR-0120), medidas só no baseline diário.
   * `null` = ainda não medido — **nunca** zero, que seria uma afirmação sobre o concorrente.
   */
  visitas_30d: number | null;
  /** Instante em que `visitas_30d` foi lida; `null` nos snapshots legados ou ainda não medidos. */
  visitas_30d_em: string | null;
}
export interface PulseVendedor {
  seller_id: number; nickname: string | null; power_seller: string | null;
  nivel: string | null; transactions_total: number | null; dia: string;
  /** Sigla do estado de onde o vendedor envia. `null` quando o ML não expôs o endereço. */
  uf: string | null;
  /** Perfil público normalizado usado para auditoria futura da qualificação. */
  reputacao_detalhe: Record<string, unknown> | null;
  /** Instante da leitura do perfil; `null` nos snapshots legados. */
  perfil_coletado_em: string | null;
}
/** ADR-0133. `acao` = muda decisão de preço; `info` = movimento de mercado sem decisão. */
export type SeveridadeAlerta = 'acao' | 'info';
export type FiltroSeveridade = SeveridadeAlerta | 'todos';
export const ALERTAS_POR_PAGINA = 50;

export interface PulseAlerta {
  id: string; produto_id: string | null;
  tipo: 'preco_caiu' | 'novo_concorrente' | 'concorrente_saiu';
  payload: Record<string, unknown>; lido: boolean; criado_em: string;
  severidade: SeveridadeAlerta;
  pulse_produtos: { titulo: string | null; codigo_pai: string | null; catalog_product_id: string } | null;
}

export async function fetchPulseProdutos(): Promise<PulseProduto[]> {
  // `meu_preco` vem do próprio radar: o coletor lê a nossa oferta na ficha, na mesma resposta das
  // concorrentes. A versão anterior derivava esse número das variações locais, que só são escritas
  // quando o app publica — preço alterado fora do app ficava congelado no banco (Errata 4).
  const { data, error } = await pulseFrom('pulse_produtos')
    .select(
      'id, catalog_product_id, codigo_pai, titulo, gtin, origem, status, catalogo_status, ptw_status, ptw_preco_sugerido, ptw_aplicavel, ptw_custos, ultimo_snapshot_em, meu_preco, meu_preco_em, anuncio_status, anuncio_sub_status, anuncio_status_em, comissao_pct, comissao_fixa, comissao_preco, comissao_em',
    )
    .neq('status', 'arquivado')
    .order('atualizado_em', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as PulseProduto[]).map((p) => ({
    ...p,
    meu_preco: p.meu_preco != null ? Number(p.meu_preco) : null,
    // `Number()` aqui é cinto de segurança barato, não correção de um defeito conhecido: medido em
    // 2026-08-17 contra a produção, o PostgREST serializa `numeric` como NÚMERO JSON, não como
    // string. (O comentário anterior afirmava o contrário — a confusão vem do `node-postgres`, que
    // devolve `numeric` como string; o PostgREST, que é o que usamos, não.) Mantido porque a coluna
    // alimenta conta de margem e o custo de um `Number()` é zero.
    comissao_pct: p.comissao_pct != null ? Number(p.comissao_pct) : null,
    comissao_fixa: p.comissao_fixa != null ? Number(p.comissao_fixa) : null,
    comissao_preco: p.comissao_preco != null ? Number(p.comissao_preco) : null,
  }));
}

export async function fetchPulseDetalhe(
  produtoId: string,
): Promise<{ ofertas: PulseOferta[]; ofertasAtuais: PulseOferta[]; vendedores: PulseVendedor[] }> {
  // Estado atual vem da VIEW (última linha por item, sem truncamento); o histórico bruto
  // (limit 400, linhas mais recentes) alimenta só a lista "menor preço por dia".
  const { data: atuaisData, error: atuaisErro } = await pulseFrom('pulse_ofertas_atual')
    .select('item_id, seller_id, preco, tier, frete_gratis, loja_oficial, ativo, dia, permalink, visitas_30d, visitas_30d_em, full_ml')
    .eq('produto_id', produtoId);
  if (atuaisErro) throw atuaisErro;
  const ofertasAtuais = (atuaisData ?? []) as PulseOferta[];

  const { data: ofertasData, error: ofertasErro } = await pulseFrom('pulse_ofertas')
    .select('item_id, seller_id, preco, tier, frete_gratis, loja_oficial, ativo, dia, permalink, visitas_30d, visitas_30d_em, full_ml')
    .eq('produto_id', produtoId)
    .order('dia', { ascending: false })
    .limit(400);
  if (ofertasErro) throw ofertasErro;
  const ofertas = (ofertasData ?? []) as PulseOferta[];

  const sellerIds = [...new Set(ofertasAtuais.map((o) => o.seller_id))];
  if (sellerIds.length === 0) return { ofertas, ofertasAtuais, vendedores: [] };

  const { data: vendedoresData, error: vendedoresErro } = await pulseFrom('pulse_vendedores')
    .select('seller_id, nickname, power_seller, nivel, transactions_total, dia, uf, reputacao_detalhe, perfil_coletado_em')
    .in('seller_id', sellerIds)
    .order('dia', { ascending: true });
  if (vendedoresErro) throw vendedoresErro;
  return { ofertas, ofertasAtuais, vendedores: (vendedoresData ?? []) as PulseVendedor[] };
}

export interface PulseResumoOfertas {
  /** Alias legado consumido pelos KPIs, posição e filtros: sempre a referência qualificada. */
  menorPreco: number | null;
  menorObservado: number | null;
  menorRelevante: number | null;
  nOfertas: number;
  nOfertasRelevantes: number;
}

/**
 * Estado atual observado e qualificado por produto, para a lista do radar.
 * Lê a view `pulse_ofertas_atual` (última linha por item): 1 linha por oferta, nunca o
 * histórico bruto — o PostgREST trunca respostas em ~1000 linhas em silêncio.
 */
export async function fetchPulseResumoOfertas(produtoIds: string[]): Promise<Map<string, PulseResumoOfertas>> {
  const resumo = new Map<string, PulseResumoOfertas>();
  if (produtoIds.length === 0) return resumo;

  // O PostgREST trunca em ~1000 linhas SEM avisar: 40 produtos × 30 ofertas já estoura, e os
  // últimos produtos ficariam com "menor preço" errado sem sinal nenhum na tela. Paginamos até
  // esvaziar em vez de confiar num teto.
  const PAGINA = 1000;
  const linhas: (PulseOferta & { produto_id: string })[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await pulseFrom('pulse_ofertas_atual')
      .select('produto_id, item_id, seller_id, preco, tier, frete_gratis, loja_oficial, ativo, dia, permalink, visitas_30d, visitas_30d_em, full_ml')
      .in('produto_id', produtoIds)
      .order('produto_id', { ascending: true })
      .order('item_id', { ascending: true })
      .range(de, de + PAGINA - 1);
    if (error) throw error;
    const pagina = (data ?? []) as (PulseOferta & { produto_id: string })[];
    linhas.push(...pagina);
    if (pagina.length < PAGINA) break;
  }
  const sellerIds = [...new Set(linhas.map((linha) => linha.seller_id))];
  const vendedores = await fetchPulseVendedoresResumo(sellerIds);
  const porProduto = new Map<string, PulseOferta[]>();
  for (const row of linhas) {
    const lista = porProduto.get(row.produto_id) ?? [];
    lista.push(row);
    porProduto.set(row.produto_id, lista);
  }
  for (const [produtoId, ofertas] of porProduto) {
    const atuais = estadoAtualOfertas(ofertas);
    const mercado = mercadoPulse(atuais, vendedores);
    resumo.set(produtoId, {
      menorPreco: mercado.menor_relevante,
      menorObservado: mercado.menor_observado,
      menorRelevante: mercado.menor_relevante,
      nOfertas: mercado.total_observadas,
      nOfertasRelevantes: mercado.total_relevantes,
    });
  }
  return resumo;
}

async function fetchPulseVendedoresResumo(sellerIds: number[]): Promise<PulseVendedor[]> {
  const vendedores: PulseVendedor[] = [];
  const POR_LOTE = 100;
  const PAGINA = 1000;
  for (let inicio = 0; inicio < sellerIds.length; inicio += POR_LOTE) {
    const lote = sellerIds.slice(inicio, inicio + POR_LOTE);
    for (let de = 0; ; de += PAGINA) {
      const { data, error } = await pulseFrom('pulse_vendedores')
        .select('seller_id, nickname, power_seller, nivel, transactions_total, dia, uf, reputacao_detalhe, perfil_coletado_em')
        .in('seller_id', lote)
        .order('seller_id', { ascending: true })
        .order('perfil_coletado_em', { ascending: false, nullsFirst: false })
        .order('dia', { ascending: false })
        .range(de, de + PAGINA - 1);
      if (error) throw error;
      const pagina = (data ?? []) as PulseVendedor[];
      vendedores.push(...pagina);
      if (pagina.length < PAGINA) break;
    }
  }
  return vendedores;
}

export async function pausarPulseProduto(id: string, pausar: boolean): Promise<void> {
  const { error } = await pulseFrom('pulse_produtos')
    .update({ status: pausar ? 'pausado' : 'ativo' })
    .eq('id', id);
  if (error) throw error;
}

/** Uma página de alertas NÃO LIDOS do filtro. A aba é a caixa de não lidos, não o arquivo
 *  histórico (ADR-0133). Sem teto fixo: o teto é o tamanho da página. */
export async function fetchPulseAlertas(
  { severidade, pagina }: { severidade: FiltroSeveridade; pagina: number },
): Promise<PulseAlerta[]> {
  const de = pagina * ALERTAS_POR_PAGINA;
  // `order('id')` como desempate: o coletor grava vários alertas do mesmo produto num único
  // insert, e `criado_em` (default now()) empata entre eles. Sem desempate determinístico o
  // Postgres não garante ordem estável entre páginas de LIMIT/OFFSET com chave repetida — página
  // 2 podia repetir ou pular linha da página 1.
  //
  // Isso resolve a ordem dentro de um mesmo snapshot, e SÓ isso. Escrita concorrente continua
  // deslocando a janela: um alerta novo entre a leitura da página 1 e da 2 empurra tudo para
  // baixo, e marcar um como lido encolhe o conjunto filtrado. Risco aceito — o alerta deslocado
  // aparece no próximo refetch, e a alternativa (cursor por criado_em+id) não paga o custo com
  // ~12 alertas de ação por dia.
  let q = pulseFrom('pulse_alertas')
    .select('id, produto_id, tipo, severidade, payload, lido, criado_em, pulse_produtos(titulo, codigo_pai, catalog_product_id)')
    .eq('lido', false)
    .order('criado_em', { ascending: false })
    .order('id', { ascending: false })
    .range(de, de + ALERTAS_POR_PAGINA - 1);
  if (severidade !== 'todos') q = q.eq('severidade', severidade);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as PulseAlerta[];
}

/** Contagem VERDADEIRA de não lidos do filtro — separada da página. O rótulo antigo usava o
 *  tamanho da lista, que era o teto de leitura: dizia "20" com 145 não lidos (ADR-0133 D-7). */
export async function contarPulseAlertas(severidade: FiltroSeveridade): Promise<number> {
  let q = pulseFrom('pulse_alertas')
    .select('id', { count: 'exact', head: true })
    .eq('lido', false);
  if (severidade !== 'todos') q = q.eq('severidade', severidade);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

/** Marca o alerta como lido — grant é column-level só em `lido` (não pode ir mais nada no update). */
export async function marcarAlertaLido(id: string): Promise<void> {
  const { error } = await pulseFrom('pulse_alertas').update({ lido: true }).eq('id', id);
  if (error) throw error;
}

/** Marca como lidos os não lidos do filtro ativo, até `ateCriadoEm` inclusive. O escopo só admite
 *  colunas locais de `pulse_alertas`: o update do PostgREST não filtra por coluna de recurso
 *  embutido, então um escopo por título de produto ou apagaria o que o operador não viu, ou
 *  mentiria no número (ADR-0133 D-9). Grant é column-level em `lido` — nada mais pode ir no update.
 *
 *  `ateCriadoEm` é o teto, e existe porque contar e marcar são duas idas ao banco: o coletor roda
 *  em cron e pode inserir alertas entre a contagem que o operador leu e o clique. Sem teto, esses
 *  alertas novos casariam `lido = false` e sumiriam sem nunca terem existido para o operador. Passe
 *  o `criado_em` do alerta mais NOVO já carregado na tela — a lista vem em ordem decrescente, então
 *  é o primeiro item.
 *
 *  O invariante é "nada MAIS NOVO do que o operador viu", não "nada que o operador não viu": o
 *  `.lte` só exclui o que for mais novo que a primeira linha da lista. Tudo o que for mais antigo é
 *  marcado, inclusive as páginas que ninguém rolou — e é exatamente isso que o rótulo promete, já
 *  que o botão anuncia a contagem verdadeira do filtro (ADR-0133 D-7 e Errata 2). */
export async function marcarAlertasLidos(
  severidade: FiltroSeveridade, ateCriadoEm: string,
): Promise<void> {
  let q = pulseFrom('pulse_alertas').update({ lido: true })
    .eq('lido', false)
    .lte('criado_em', ateCriadoEm);
  if (severidade !== 'todos') q = q.eq('severidade', severidade);
  const { error } = await q;
  if (error) throw error;
}

/** Custo do produto + alíquota de imposto, para o simulador de margem. Regra LOUD
 *  (ADR-0055/0086): alíquota só entra confirmada — nunca o default 8/16 em silêncio. */
// Sem `precoAtual`: o preço de venda vigente é o da nossa oferta na ficha (`pulse_produtos.
// meu_preco`), não o das variações locais — derivá-lo daqui devolvia um valor defasado e o
// detalhe o preferia ao vivo, propagando o erro para a margem simulada (Errata 4 do ADR-0119).
export async function fetchContextoMargem(
  codigoPai: string,
): Promise<{ custo: number | null; aliquotaPct: number | null }> {
  const { data: familias, error } = await supabase
    .from('familias')
    .select('origem, variacoes(custo)')
    .eq('codigo_pai', codigoPai)
    .order('criado_em', { ascending: false })
    .limit(5);
  if (error) throw error;
  // Família mais recente COM variações — uma família recém-criada (ainda sem variações
  // gravadas) não pode se passar pela fonte de custo (regra LOUD: cai em null, não em 0).
  const familia = (familias ?? []).find((f) => (f.variacoes ?? []).length > 0);
  if (!familia) return { custo: null, aliquotaPct: null };

  const variacoes = (familia.variacoes ?? []) as { custo: number | null }[];
  const custos = variacoes.map((v) => v.custo).filter((c): c is number => c != null);
  const custo = custos.length > 0 ? Math.max(...custos) : null;

  const aliquotas = await fetchAliquotas();
  const aliquotaPct = !aliquotas.confirmada
    ? null
    : familia.origem === 'importado' ? aliquotas.importado : aliquotas.nacional;

  return { custo, aliquotaPct };
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
