// Sonar (ADR-0120): garimpo on-demand por termo — par do Radar (que vigia o que já vendemos, o
// Sonar vasculha um nicho antes de cadastrar). Tipos espelhados de
// supabase/functions/_shared/pulse/sonar.ts (interface PainelSonar) — sem import cross-runtime
// entre Deno (edge) e o front.
import { supabase } from './supabase';

export interface ResultadoFichaSonar {
  category_id: string | null;
  ofertas: number;
  preco: { min: number; mediana: number; max: number } | null;
  frete_gratis_pct: number;
  visitas_30d: number | null;
  visitas_por_dia: Array<{ data: string; total: number }>;
  vendedores: Array<{ seller_id: number; uf: string | null; transacoes_total: number | null; loja_oficial: boolean }>;
  /** Opcional: cache v2 antigo (pré-ADR-0125) não tem o campo — cruzamento vira "sem dado". */
  item_ids?: string[];
}

export interface PainelSonar {
  termo: string;
  gerado_em: string;
  total_catalogo: number;
  fichas: Array<{ product_id: string; nome: string } & ResultadoFichaSonar>;
  agregado: {
    visitas_30d_total: number;
    visitas_por_dia: Array<{ data: string; total: number }>;
    ofertas_total: number;
    vendedores_distintos: number;
    frete_gratis_pct: number;
  };
  palavras_chave: Array<{ termo: string; contagem: number }>;
}

/** POST /functions/v1/pulse-sonar { termo } → PainelSonar. Mesmo padrão de auth/erro de postPulse
 *  em pulse.ts (não exportada de lá — duplicar aqui é mais barato que exportar cross-módulo). */
export async function fetchPainelSonar(termo: string): Promise<PainelSonar> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sem sessão');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pulse-sonar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ termo }),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json?.erro ?? `Falha (${resp.status})`);
  return json as PainelSonar;
}

/** Painel principal (KPIs, gráfico, tabela): só fichas com vendedor ativo. */
export function fichasAtivas(painel: PainelSonar): PainelSonar['fichas'] {
  return painel.fichas.filter((f) => f.ofertas > 0);
}

/** Seção colapsada à parte: ficha de catálogo existe mas ninguém vende agora — oportunidade,
 *  não "sem dado". Nunca conta nos KPIs (ADR-0120 §ruling 17/08). */
export function fichasSemVendedor(painel: PainelSonar): PainelSonar['fichas'] {
  return painel.fichas.filter((f) => f.ofertas === 0);
}

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
