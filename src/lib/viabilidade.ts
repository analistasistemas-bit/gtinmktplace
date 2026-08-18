import { supabase } from './supabase';
import { calcularSemaforo, type Semaforo } from './semaforo';

// Espelha _shared/analise/tipos.ts (Deno não é importável no browser).
export interface ComissaoTipo { saleFeeAmount: number; percentual: number; fixa: number }
export interface Mercado {
  menor: number | null; maior: number | null;
  vendedores: number; freteGratis: number; full: number;
}
// Espelha _shared/canais/contrato.ts.
export interface DimensoesPacote {
  altura_cm: number | null; largura_cm: number | null;
  comprimento_cm: number | null; peso_gramas: number | null;
}
export interface ItemAnalisado {
  gtin: string; nome: string; unidade: string | null;
  minimo: number | null; custo: number | null;
  origem: 'nacional' | 'importado';
  existeNoML: boolean; mercado?: Mercado;
  classico?: ComissaoTipo; premium?: ComissaoTipo;
  frete?: number; dimensoesEncontradas?: boolean; erro?: boolean;
  /** short_description da ficha de catálogo; insumo p/ pré-preencher o cadastro (spike 037, V-1b). */
  descricaoCatalogo?: string | null;
  /**
   * Heurística por (org_id, gtin) em `variacoes` — usada só p/ trocar "Cadastrar" por
   * "Dar entrada" na Viabilidade. NÃO substitui o guard: o 409 de `cadastrar-produto` por
   * `codigo_pai` continua autoritativo (spike 037 §3.5).
   */
  jaCadastrado?: boolean;
  /** category_id ML da oferta de catálogo (quando existeNoML). */
  categoriaMlId?: string | null;
}
export interface RespostaAnalise {
  itens: ItemAnalisado[]; ignorados: number;
  /** false = conta ML da org sem Mercado Envios (me2) — frete sai 0 em todos os itens. */
  me2Habilitado?: boolean | null;
}

const PRECO_MIN_ACIMA_ABISMO = 12.55; // ADR-0023

function round2(n: number): number { return Math.round(n * 100) / 100; }
function arredondar5Cima(n: number): number { return Math.ceil(n * 20) / 20; }

/** Líquido se você igualar o menor preço do mercado: menor − comissão total − imposto (ADR-0055) − frete do vendedor. */
export function liquidoNoMercado(menor: number | null, saleFeeAmount: number, imposto = 0, frete = 0): number | null {
  if (menor == null) return null;
  return round2(menor - saleFeeAmount - imposto - frete);
}

/**
 * Preço de etiqueta necessário para receber `minimo` líquido (gross-up, ADR-0023).
 * Acima do abismo a tarifa fixa zera, então usa só o percentual; o imposto (ADR-0055)
 * incide sobre o preço, então entra no denominador. O frete do vendedor entra no numerador.
 */
export function etiquetaParaMinimo(minimo: number | null, percentual: number, aliquotaPct = 0, frete = 0): number | null {
  if (minimo == null) return null;
  const denom = 1 - percentual / 100 - aliquotaPct / 100;
  const num = minimo + frete;
  if (denom <= 0) return Math.max(PRECO_MIN_ACIMA_ABISMO, arredondar5Cima(num));
  return Math.max(PRECO_MIN_ACIMA_ABISMO, arredondar5Cima(num / denom));
}

/** Semáforo de viabilidade ao igualar o menor preço do mercado. */
export function semaforoTipo(
  menor: number | null,
  saleFeeAmount: number,
  minimo: number | null,
  custo: number | null,
  imposto = 0,
  frete = 0,
): Semaforo {
  if (minimo == null) return 'indisponivel';
  return calcularSemaforo(liquidoNoMercado(menor, saleFeeAmount, imposto, frete), minimo, custo);
}

async function lerArquivoBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function postAnalise(body: unknown): Promise<RespostaAnalise> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Não autenticado');
  const r = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analisar-viabilidade`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data?.erro) throw new Error(data?.erro ?? 'Falha ao analisar');
  return data as RespostaAnalise;
}

/** Analisa uma planilha (.xlsx). */
export async function analisarPlanilha(file: File): Promise<RespostaAnalise> {
  return postAnalise({ modo: 'planilha', arquivoBase64: await lerArquivoBase64(file) });
}

/** Analisa GTINs colados (um por linha). */
export async function analisarGtins(gtins: string[]): Promise<RespostaAnalise> {
  const itens = gtins.map((g) => g.trim()).filter(Boolean).map((gtin) => ({ gtin }));
  return postAnalise({ modo: 'gtins', itens });
}

/** Recalcula um item com dimensões informadas manualmente (produto sem cadastro prévio). */
export async function analisarComDimensoes(gtin: string, dimensoes: DimensoesPacote): Promise<ItemAnalisado> {
  const { itens } = await postAnalise({ modo: 'gtins', itens: [{ gtin, dimensoes }] });
  if (!itens[0]) throw new Error('Falha ao recalcular o frete');
  return itens[0];
}
