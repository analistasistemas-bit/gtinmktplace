// Sonar (ADR-0120): garimpo on-demand por termo — par do Radar (que vigia o que já vendemos, o
// Sonar vasculha um nicho antes de cadastrar).
import { fmtBRL, fmtInt } from './formato';
import { supabase } from './supabase';

// --- Vendas estimadas via Apify (ADR-0122) ------------------------------------------------------
// Tipos espelhados de supabase/functions/_shared/pulse/sonar-vendas.ts (mesma regra do PainelSonar:
// sem import cross-runtime). `vendidos` é o "+N vendidos" da página: acumulado e arredondado (piso).

export interface ItemVendasSonar {
  titulo: string;
  preco: number | null;
  vendidos: number | null;
  link: string | null;
  imagem: string | null;
  vendedor: string | null;
  frete_gratis: boolean | null;
  loja_oficial: boolean | null;
  internacional: boolean | null;
  full: boolean | null;
  // --- Campos novos (T4/ADR-0125, espelho de sonar-vendas.ts) ---
  item_id: string | null;
  catalog_product_id: string | null;
  avaliacao_nota: number | null;
  avaliacao_qtd: number | null;
  posicao: number | null;
  patrocinado: boolean | null;
  selo: string | null;
  preco_anterior: number | null;
  desconto_pct: number | null;
  flex: boolean | null;
  /** Espelho de sonar-vendas.ts; opcional porque cache v4 pré-ADR-0127 não tem. */
  category_id?: string | null;
  /** ID numérico do vendedor no ML (campo Apify `vendedorID`, ADR-0142). */
  seller_id?: number | null;
}

/** Contagens DA AMOSTRA de anúncios (a UI rotula); só `total_anuncios` é o absoluto do nicho. */
export interface RaioXNicho {
  total_anuncios: number | null;
  ticket_medio: number | null;
  lojas_oficiais: number;
  full: number;
  frete_gratis: number;
  internacionais: number;
}

export interface PainelVendasSonar {
  configurado: true;
  termo: string;
  gerado_em: string;
  itens_analisados: number;
  itens_com_vendas: number;
  vendas_totais: number;
  valor_mercado: number;
  produto_destaque: ItemVendasSonar | null;
  palavras_chave_titulos: Array<{ termo: string; contagem: number }>;
  raio_x: RaioXNicho;
  /** Opcional: entrada v4 cacheada antes do ADR-0125 (D2, campo aditivo) não tem o índice. */
  por_anuncio?: Record<string, ItemVendasSonar>;
  /** Espelho de sonar-vendas.ts; opcional porque cache v4 pré-ADR-0127 não tem. */
  itens?: ItemVendasSonar[];
  /** Espelho de sonar-vendas.ts; opcional porque cache v4 pré-ADR-0127 não tem. */
  historico_gravado?: boolean;
}

/** `configurado: false` = APIFY_TOKEN ausente no backend — indisponível, não erro (ADR-0122 §5). */
export type RespostaVendasSonar = { configurado: false } | PainelVendasSonar;

/** POST /functions/v1/pulse-sonar-vendas { termo } → RespostaVendasSonar. */
export async function fetchVendasSonar(termo: string): Promise<RespostaVendasSonar> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sem sessão');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pulse-sonar-vendas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ termo }),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json?.erro ?? `Falha (${resp.status})`);
  return json as RespostaVendasSonar;
}

// --- Visitas por anúncio (ADR-0127/D3): espelho de pulse-sonar-visitas -------------------------

export interface VisitasAnuncio { total: number; por_dia: Array<{ data: string; total: number }> }

/** `conectado: false` = org sem conexão ML — indisponível, não erro (D16, único modo degradado).
 *  `por_item[id] = null` = falha de chamada; `total: 0` = ZERO MEDIDO (D8) — nunca confundir. */
export type RespostaVisitasSonar =
  | { conectado: false }
  | { conectado: true; por_item: Record<string, VisitasAnuncio | null> };

export async function fetchVisitasSonar(itemIds: string[]): Promise<RespostaVisitasSonar> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sem sessão');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pulse-sonar-visitas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ item_ids: itemIds.map((id) => id.trim()) }),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json?.erro ?? `Falha (${resp.status})`);
  return json as RespostaVisitasSonar;
}

/** Lista da tabela: amostra completa quando o painel é novo; cache v4 antigo cai para
 *  por_anuncio (perde só item sem item_id, que também não teria visitas/snapshot). */
export function itensDaAmostra(vendas: PainelVendasSonar): ItemVendasSonar[] {
  return vendas.itens ?? Object.values(vendas.por_anuncio ?? {});
}

/**
 * D9 (medido 19/08): /visits/time_window OMITE dias sem visita e devolve pontos FORA DE ORDEM
 * (7 pontos numa janela de 30 dias). Ordena e preenche com 0 os dias ausentes — senão o
 * sparkline comprime 30 dias em 7 e mente sobre o período. O 0 preenchido é legítimo (janela
 * fechada), diferente de "sem dado" (D8).
 * REFUTADO (não tentar de novo): nº de pontos devolvidos NÃO é proxy de idade do anúncio.
 */
export function normalizarSerieVisitas(
  porDia: Array<{ data: string; total: number }>,
  dias = 30,
  hoje = new Date(),
): Array<{ data: string; total: number }> {
  const mapa = new Map(porDia.map((p) => [p.data, p.total]));
  // "Hoje" no fuso do operador (America/Sao_Paulo, mesmo padrão de faturamento/io.ts), não no
  // fuso do processo nem em UTC puro: perto da virada do dia BRT (ex.: 23h), misturar acessores
  // locais com toISOString (UTC) desliza a janela inteira um dia para frente — bug medido pelo
  // revisor. Âncora em Date.UTC é só uma linha do tempo neutra para a aritmética de dias (24h
  // fixas, sem DST — BR não tem horário de verão desde 2019), não representa fuso nenhum.
  const [ano, mes, dia] = hoje.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).split('-').map(Number);
  const ancoraMs = Date.UTC(ano, mes - 1, dia);
  const serie: Array<{ data: string; total: number }> = [];
  for (let i = dias - 1; i >= 0; i--) {
    const data = new Date(ancoraMs - i * 86_400_000).toISOString().slice(0, 10);
    serie.push({ data, total: mapa.get(data) ?? 0 });
  }
  return serie;
}

// --- Progresso por etapas (pedido do Diego 17/08) ---------------------------------------------

export const ETAPAS_SONAR = [
  'Buscando anúncios do nicho',
  'Analisando vendas e concorrência',
  'Medindo visitas',
  'Montando painel',
] as const;

const INTERVALO_ETAPA_MS = 2500;
const ULTIMA_ETAPA_TEMPORIZADA = ETAPAS_SONAR.length - 2; // trava na penúltima sem resposta

export type EtapaStatus = 'concluida' | 'ativa' | 'pendente';
export interface EtapaProgresso { label: string; status: EtapaStatus }

/**
 * Máquina pura do stepper: as duas edges respondem numa chamada cada, então o avanço das
 * primeiras etapas é temporizado no cliente (uma a cada 2,5s) e trava na penúltima até TUDO
 * chegar; a última só conclui quando `concluido` vira true. Desde 18/08 `concluido` exige painel
 * E vendas resolvidos: a tela de resultado abre completa de uma vez, em vez de estrear com
 * esqueleto no bloco de vendas e um veredito que troca na frente do operador.
 * Sem barra de %: não prometemos números que não medimos.
 */
export function passosProgresso(elapsedMs: number, concluido: boolean): EtapaProgresso[] {
  const etapaAtiva = Math.min(Math.floor(elapsedMs / INTERVALO_ETAPA_MS), ULTIMA_ETAPA_TEMPORIZADA);
  return ETAPAS_SONAR.map((label, i) => {
    if (concluido) return { label, status: 'concluida' as const };
    if (i < etapaAtiva) return { label, status: 'concluida' as const };
    if (i === etapaAtiva) return { label, status: 'ativa' as const };
    return { label, status: 'pendente' as const };
  });
}

// --- Link do anúncio (ADR-0127/D15) -------------------------------------------------------------

const ML_HOST_RE = /(^|\.)mercadolivre\.com\.br$/;

/**
 * Decide o href da coluna de ações. O `link` cru da Apify às vezes vem malformado — medido em
 * 19/08: domínio duplicado no path (`www.mercadolivre.com.br/produto.mercadolivre.com.br/MLB-…`),
 * que leva a uma página de erro no ML. Nesse caso (e em link nulo/vazio/não-ML) monta a URL
 * canônica a partir do item_id; sem item_id utilizável, `null` — nunca URL inventada (regra LOUD).
 */
export function linkDoAnuncio(link: string | null, itemId: string): string | null {
  const canonico = (() => {
    const m = /^MLB(\d+)$/.exec(itemId);
    return m ? `https://produto.mercadolivre.com.br/MLB-${m[1]}` : null;
  })();

  if (!link) return canonico;
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return canonico;
  }
  const ehHttp = url.protocol === 'http:' || url.protocol === 'https:';
  const domDuplicadoNoPath = url.pathname.includes('mercadolivre.com.br');
  if (ehHttp && ML_HOST_RE.test(url.hostname) && !domDuplicadoNoPath) return link;
  return canonico;
}

// --- Cruzamento com o catálogo da própria org (ADR-0127 Errata 2) -------------------------------

export interface VariacaoPropria {
  codigo: string;
  nome: string | null;
  preco: number;
}

export interface CruzamentoEan {
  /** Variações da própria org com este GTIN. Vazio = produto novo para a operação. */
  minhas: VariacaoPropria[];
  /** Produto já monitorado no Radar, pela mesma ficha de catálogo. */
  no_radar: { id: string; titulo: string | null; status: string } | null;
}

/**
 * Responde "eu já vendo isto?" e "já está no meu Radar?" sem tocar no ML: duas leituras locais
 * sob RLS. É a informação de maior sinal da consulta por EAN e a mais barata — o escopo da org
 * sai da RLS, nunca de filtro por `user_id` (a conexão pode ser de outro membro).
 *
 * `productIds` é lista, não id único (ADR-0136): o produto pode estar no Radar sob QUALQUER ficha
 * de catálogo, não só uma. `.limit(1)` é obrigatório porque `.in()` pode casar 2+ linhas e
 * `maybeSingle()` sozinho erraria (uma linha só é esperada por `.eq`, não por `.in`).
 *
 * ADR-0140 D-3: desde que a consulta por EAN passou a nascer da BUSCA (e não do lookup oficial de
 * catálogo), os ids vêm do que a amostra trouxer — e a maioria dos anúncios da busca não é de
 * catálogo (medido 28/08: 7 de 20). Lista vazia é o caso normal, não erro: pula a consulta ao
 * Radar em vez de mandar `.in(...)` com array vazio ao PostgREST. Quem chama precisa tratar
 * `no_radar: null` como "não sei", nunca como "não está no Radar".
 */
export async function fetchCruzamentoEan(ean: string, productIds: string[]): Promise<CruzamentoEan> {
  const [variacoes, radar] = await Promise.all([
    supabase.from('variacoes').select('codigo,nome,preco').eq('gtin', ean).order('codigo'),
    productIds.length > 0
      ? supabase.from('pulse_produtos').select('id,titulo,status')
        .in('catalog_product_id', productIds).limit(1).maybeSingle()
      : Promise.resolve({ data: null, error: null, status: 200 }),
  ]);
  if (variacoes.error) throw variacoes.error;
  // `maybeSingle` devolve error quando a linha não existe em algumas versões do client — ausência
  // não é falha aqui, mas erro de verdade (RLS, rede) não pode virar "não tenho no Radar".
  if (radar.error && radar.status !== 406) throw radar.error;
  return {
    minhas: variacoes.data ?? [],
    no_radar: radar.data ?? null,
  };
}

// --- Simulador de margem ------------------------------------------------------------------------

/**
 * Margem do simulador do Sonar: diferente de `margemEstimada` (pulse-margem.ts), que divide pelo
 * PREÇO — aqui o brief pede margem sobre o CUSTO (markup), formato que faz sentido pra decidir
 * "vale cadastrar este produto" antes de ele existir no catálogo. "recebe" mostrado é bruto
 * (preço − comissão − frete); o imposto só entra no líquido, separado, para não confundir os dois.
 */
export function margemSimulada({ precoAlvo, custo, aliquotaPct, tarifa }: {
  precoAlvo: number; custo: number; aliquotaPct: number;
  tarifa: { comissao: number; frete: number };
}): { recebe: number; imposto: number; liquido: number; margemPct: number } {
  const recebe = precoAlvo - tarifa.comissao - tarifa.frete;
  const imposto = (aliquotaPct / 100) * precoAlvo;
  const liquido = recebe - imposto - custo;
  const margemPct = custo > 0 ? (liquido / custo) * 100 : 0;
  return { recebe, imposto, liquido, margemPct };
}

// --- Análise PubliAI seções 2/3/7 (ADR-0142): espelho de relatorio-secoes-237.ts + nicho-vendedor.ts

type CampoComEstado<T extends 'valor', V> =
  | ({ estado: T } & V)
  | { estado: 'sem_dado'; mensagem: string };

export type FaturamentoNichoSonar = CampoComEstado<'valor', {
  faturamento_mes: number;
  vendedores_com_estimativa: number;
  vendedores_distintos: number;
  rotulo: string;
}>;

export type VolumeNichoSonar = CampoComEstado<'valor', {
  vendas_mes_mediana: number;
  vendedores_com_estimativa: number;
  rotulo: string;
}>;

export type CoberturaEstimativaSonar = {
  com_estimativa: number;
  vendedores_distintos: number;
  proporcao: number | null;
  anuncios_na_amostra: number;
  anuncios_cobertos: number;
  proporcao_anuncios: number | null;
  rotulo: string;
};

export type VendedoresSemEstimativaSonar = {
  contagem: number;
  rotulo: string;
};

export type ConcentracaoPorVendedorSonar = {
  elegiveis: number;
  vendedores_distintos: number;
  top1: number;
  corte: number;
  dominante: boolean;
  rotulo: string;
} | null;

export type ParecerTamanhoNichoSonar = { parecer: string };

export type Secoes237Sonar = {
  '2.6': FaturamentoNichoSonar;
  '2.9': ParecerTamanhoNichoSonar;
  '3.2': VolumeNichoSonar;
  '3.3': CoberturaEstimativaSonar;
  '3.4': VendedoresSemEstimativaSonar;
  limitacao_3_2: string;
  '7.4': ConcentracaoPorVendedorSonar;
};

export type MetaSecoes237Sonar = {
  vendedores_distintos: number;
  sem_seller_id: number;
  serie_linhas: number;
  anuncios_na_amostra: number;
};

export type RespostaSecoes237Sonar = {
  secoes237: Secoes237Sonar;
  meta: MetaSecoes237Sonar;
};

/** POST /functions/v1/pulse-analise-secoes237 { itens } → RespostaSecoes237Sonar. */
export async function fetchSecoes237Sonar(itens: ItemVendasSonar[]): Promise<RespostaSecoes237Sonar> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sem sessão');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pulse-analise-secoes237`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ itens }),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json?.erro ?? `Falha (${resp.status})`);
  return json as RespostaSecoes237Sonar;
}

/** Faturamento 2.6 — R$/mês ou mensagem de indisponibilidade (nunca zero inventado). */
export function formatarFaturamentoSecoes237(f: FaturamentoNichoSonar): string {
  if (f.estado === 'sem_dado') return f.mensagem;
  return fmtBRL(f.faturamento_mes);
}

/** Mediana 3.2 — unidades/mês por vendedor (loja inteira), não R$. */
export function formatarMedianaVendasMesSecoes237(v: VolumeNichoSonar): string {
  if (v.estado === 'sem_dado') return v.mensagem;
  return `${fmtInt(Math.round(v.vendas_mes_mediana))} un./mês`;
}

/** Proporção 3.3 — percentual inteiro ou traço quando indeterminado. */
export function formatarProporcaoCobertura(proporcao: number | null): string {
  if (proporcao == null) return '—';
  return `${Math.round(proporcao * 100)}%`;
}
