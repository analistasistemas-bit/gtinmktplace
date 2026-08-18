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

// --- Progresso por etapas (pedido do Diego 17/08) ---------------------------------------------

export const ETAPAS_SONAR = [
  'Buscando fichas do catálogo',
  'Analisando concorrentes',
  'Medindo visitas',
  'Montando painel',
] as const;

const INTERVALO_ETAPA_MS = 2500;
const ULTIMA_ETAPA_TEMPORIZADA = ETAPAS_SONAR.length - 2; // trava na penúltima (índice 2) sem resposta

export type EtapaStatus = 'concluida' | 'ativa' | 'pendente';
export interface EtapaProgresso { label: string; status: EtapaStatus }

/**
 * Máquina pura do stepper: a edge responde numa chamada só, então o avanço das 3 primeiras
 * etapas é temporizado no cliente (uma a cada 2,5s) e trava na 3ª até a resposta chegar; a 4ª só
 * conclui quando `concluido` vira true. Sem barra de %: não prometemos números que não medimos.
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
