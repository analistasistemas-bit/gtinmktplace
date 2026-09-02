// Pulse (ADR-0119): leituras direto via PostgREST (RLS resolve o escopo da org); ações
// (adicionar manual, coletar agora) via POST nas edge functions com o token da sessão.
import { supabase } from './supabase';
import { fetchAliquotas } from './queries';
import {
  custoDaFamilia, estadoAtualOfertas, menorPrecoPorDia, mercadoPulse, ofertasAbaixoDaReferencia,
  type FamiliaComVariacoes,
} from './pulse-margem';

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
// Espelha `SeveridadeAlerta` de supabase/functions/_shared/pulse/tipos.ts — os dois runtimes não
// se importam (Deno vs. Vite), então o tipo vive nos dois lados. Manter em sincronia.
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
  const { data, error } = await supabase.from('pulse_produtos')
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
  const { data: atuaisData, error: atuaisErro } = await supabase.from('pulse_ofertas_atual')
    .select('item_id, seller_id, preco, tier, frete_gratis, loja_oficial, ativo, dia, permalink, visitas_30d, visitas_30d_em, full_ml')
    .eq('produto_id', produtoId);
  if (atuaisErro) throw atuaisErro;
  const ofertasAtuais = (atuaisData ?? []) as PulseOferta[];

  const { data: ofertasData, error: ofertasErro } = await supabase.from('pulse_ofertas')
    .select('item_id, seller_id, preco, tier, frete_gratis, loja_oficial, ativo, dia, permalink, visitas_30d, visitas_30d_em, full_ml')
    .eq('produto_id', produtoId)
    .order('dia', { ascending: false })
    .limit(400);
  if (ofertasErro) throw ofertasErro;
  const ofertas = (ofertasData ?? []) as PulseOferta[];

  const sellerIds = [...new Set(ofertasAtuais.map((o) => o.seller_id))];
  if (sellerIds.length === 0) return { ofertas, ofertasAtuais, vendedores: [] };

  const { data: vendedoresData, error: vendedoresErro } = await supabase.from('pulse_vendedores')
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
  /** Teto da faixa da disputa (ADR-0147). Já vinha de `resumirMercadoQualificado`, sem uso. */
  maiorRelevante: number | null;
  nOfertas: number;
  nOfertasRelevantes: number;
  /** Preços das ofertas relevantes. A coluna da disputa posiciona o nosso preço entre eles. */
  precosRelevantes: number[];
  /** Ofertas ATIVAS abaixo do menor relevante. Elas não entram na comparação (ADR-0130), mas o
   *  comprador as vê na mesma página do catálogo — a lista precisa dizer que existem. */
  abaixoDaReferencia: { contagem: number; menorPreco: number } | null;
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
    const { data, error } = await supabase.from('pulse_ofertas_atual')
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
    const abaixo = ofertasAbaixoDaReferencia(mercado);
    resumo.set(produtoId, {
      menorPreco: mercado.menor_relevante,
      menorObservado: mercado.menor_observado,
      menorRelevante: mercado.menor_relevante,
      maiorRelevante: mercado.maior_relevante,
      nOfertas: mercado.total_observadas,
      nOfertasRelevantes: mercado.total_relevantes,
      precosRelevantes: mercado.ofertas
        .filter((o) => o.qualificacao.status === 'relevante')
        .map((o) => o.preco),
      abaixoDaReferencia: abaixo ? { contagem: abaixo.contagem, menorPreco: abaixo.menorPreco } : null,
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
      const { data, error } = await supabase.from('pulse_vendedores')
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

/** Dias lidos e dias exibidos. Ler 30 e mostrar 7 não é desperdício: `pulse_ofertas` é histórico de
 *  MUDANÇAS, e `menorPrecoPorDia` só carrega para a frente o que está na janela. Uma oferta que
 *  mudou há 20 dias e nunca mais é o menor preço de hoje — cortar em 7 a apagaria, e o gráfico
 *  desenharia uma alta que não aconteceu (medido em 2026-08-29). */
const DIAS_HISTORICO_LIDOS = 30;
const DIAS_HISTORICO_EXIBIDOS = 7;

/**
 * Série do menor OBSERVADO por produto (todas as ofertas ativas — a mesma conta do gráfico do
 * detalhe), para o sparkline da lista. Não é o menor relevante: a qualificação por dia não existe
 * agregada, e chamar isto de "relevante" promoveria oferta desqualificada a referência (ADR-0130).
 * Série com menos de 2 pontos não é devolvida: reta de um ponto afirma estabilidade não medida.
 *
 * Dois limites conhecidos e aceitos: oferta que não muda há mais de 30 dias fica fora da semente do
 * carry-forward; e os `DIAS_HISTORICO_EXIBIDOS` são dias COM COLETA, não dias de calendário — num
 * produto esparso os 7 pontos podem cobrir os 30 dias lidos. Por isso o rótulo acessível diz
 * "dias com coleta", e não "últimos 7 dias".
 */
export async function fetchPulseHistoricoOfertas(
  produtoIds: string[],
  /** `resumo.menorObservado` por produto — ancora o último ponto na view, como o detalhe faz com
   *  `atuais` (a janela lida é de 30 dias; a view é a verdade do presente). */
  menorObservadoAtual: Map<string, number | null> = new Map(),
): Promise<Map<string, { dia: string; preco: number }[]>> {
  const series = new Map<string, { dia: string; preco: number }[]>();
  if (produtoIds.length === 0) return series;

  const desde = new Date(Date.now() - DIAS_HISTORICO_LIDOS * 86_400_000).toISOString().slice(0, 10);
  const PAGINA = 1000;
  // O tipo é a projeção real do `select` — declarar `PulseOferta` aqui seria afirmar colunas que
  // nem pedimos ao PostgREST.
  type LinhaHistorico = Pick<PulseOferta, 'item_id' | 'preco' | 'ativo' | 'dia'> & { produto_id: string };
  const porProduto = new Map<string, LinhaHistorico[]>();
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await supabase.from('pulse_ofertas')
      .select('produto_id, item_id, seller_id, preco, ativo, dia')
      .in('produto_id', produtoIds)
      .gte('dia', desde)
      // A tupla do ORDER BY tem de ser a chave única de `pulse_ofertas`
      // (`pulse_ofertas_prod_item_dia_uniq` = produto_id, item_id, dia). Cada `range()` é uma
      // requisição própria, com snapshot próprio: sob ordem ambígua, linhas empatadas podem
      // reordenar entre páginas e uma delas some. Sumir justo a linha do preço mais barato é a
      // alta-fantasma que esta função existe para não desenhar.
      .order('produto_id', { ascending: true })
      .order('item_id', { ascending: true })
      .order('dia', { ascending: true })
      .range(de, de + PAGINA - 1);
    if (error) throw error;
    const pagina = (data ?? []) as LinhaHistorico[];
    for (const linha of pagina) {
      const lista = porProduto.get(linha.produto_id) ?? [];
      lista.push(linha);
      porProduto.set(linha.produto_id, lista);
    }
    if (pagina.length < PAGINA) break;
  }

  for (const [produtoId, ofertas] of porProduto) {
    const serie = menorPrecoPorDia(ofertas).slice(-DIAS_HISTORICO_EXIBIDOS);
    const atual = menorObservadoAtual.get(produtoId);
    if (atual != null && serie.length) serie[serie.length - 1] = { ...serie[serie.length - 1], preco: atual };
    if (serie.length >= 2) series.set(produtoId, serie);
  }
  return series;
}

export async function pausarPulseProduto(id: string, pausar: boolean): Promise<void> {
  const { error } = await supabase.from('pulse_produtos')
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
  let q = supabase.from('pulse_alertas')
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
export { contarPulseAlertas } from './pulse-contagem';

/** Marca como lidos os alertas de um grupo. O escopo é o conjunto de ids RENDERIZADOS naquela
 *  linha — nada além (ADR-0133 Errata 4 D-3). Uma ida ao banco; grant é column-level em `lido`. */
export async function marcarAlertasLidosPorIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('pulse_alertas').update({ lido: true }).in('id', ids);
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
  let q = supabase.from('pulse_alertas').update({ lido: true })
    .eq('lido', false)
    .lte('criado_em', ateCriadoEm);
  if (severidade !== 'todos') q = q.eq('severidade', severidade);
  const { error } = await q;
  if (error) throw error;
}

export interface ContextoMargem { custo: number | null; aliquotaPct: number | null }

/** Famílias de um conjunto de `codigo_pai`, da mais recente para a mais antiga, paginadas.
 *  O PostgREST trunca em ~1000 linhas SEM avisar — mesmo motivo de `fetchPulseResumoOfertas`.
 *
 *  O desempate por `id` não é enfeite: um lote inteiro entra com o mesmo `criado_em` (default
 *  `now()`), e sem segundo critério a ordem entre linhas empatadas não é garantida — páginas de
 *  LIMIT/OFFSET podem repetir ou PULAR linha. Pular justo a família que tem as variações faria a
 *  coluna "Sobra hoje" mostrar `—` para um produto que tem custo cadastrado. */
async function fetchFamiliasPorCodigoPai(
  codigosPai: string[],
): Promise<Map<string, FamiliaComVariacoes[]>> {
  const porPai = new Map<string, FamiliaComVariacoes[]>();
  if (codigosPai.length === 0) return porPai;
  const PAGINA = 1000;
  // O `in(...)` vira querystring: a lista inteira do Radar (229 códigos hoje, e crescendo) numa
  // requisição só estoura o limite de URL e o servidor devolve erro opaco — não resultado parcial.
  // Blocos de 200, sequenciais, do mesmo jeito que `fetchPulseVendedoresResumo` já faz.
  const POR_LOTE = 200;
  for (let inicio = 0; inicio < codigosPai.length; inicio += POR_LOTE) {
    const bloco = codigosPai.slice(inicio, inicio + POR_LOTE);
    for (let de = 0; ; de += PAGINA) {
      const { data, error } = await supabase.from('familias')
        .select('codigo_pai, origem, variacoes(custo)')
        .in('codigo_pai', bloco)
        .order('criado_em', { ascending: false })
        .order('id', { ascending: false })
        .range(de, de + PAGINA - 1);
      if (error) throw error;
      const pagina = (data ?? []) as (FamiliaComVariacoes & { codigo_pai: string })[];
      for (const f of pagina) {
        const lista = porPai.get(f.codigo_pai) ?? [];
        lista.push(f);
        porPai.set(f.codigo_pai, lista);
      }
      if (pagina.length < PAGINA) break;
    }
  }
  return porPai;
}

/** Custo do produto + alíquota de imposto, para o simulador de margem e para a coluna "Sobra hoje".
 *  Regra LOUD (ADR-0055/0086): alíquota só entra confirmada — nunca o default 8/16 em silêncio. */
// Sem `precoAtual`: o preço de venda vigente é o da nossa oferta na ficha (`pulse_produtos.
// meu_preco`), não o das variações locais — derivá-lo daqui devolvia um valor defasado e o
// detalhe o preferia ao vivo, propagando o erro para a margem simulada (Errata 4 do ADR-0119).
export async function fetchContextoMargemEmLote(
  codigosPai: string[],
): Promise<Map<string, ContextoMargem>> {
  const contextos = new Map<string, ContextoMargem>();
  if (codigosPai.length === 0) return contextos;
  const [porPai, aliquotas] = await Promise.all([
    fetchFamiliasPorCodigoPai(codigosPai),
    fetchAliquotas(),
  ]);
  for (const codigoPai of codigosPai) {
    const { custo, origem } = custoDaFamilia(porPai.get(codigoPai) ?? []);
    const aliquotaPct = !aliquotas.confirmada || origem == null
      ? null
      : origem === 'importado' ? aliquotas.importado : aliquotas.nacional;
    contextos.set(codigoPai, { custo, aliquotaPct });
  }
  return contextos;
}

/** O caminho por produto é um CASO do lote, não um irmão dele — é isso que garante que a lista e o
 *  detalhe nunca discordem sobre o custo do mesmo produto (ADR-0119 Errata 12 D-3). */
export async function fetchContextoMargem(codigoPai: string): Promise<ContextoMargem> {
  const contextos = await fetchContextoMargemEmLote([codigoPai]);
  return contextos.get(codigoPai) ?? { custo: null, aliquotaPct: null };
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
