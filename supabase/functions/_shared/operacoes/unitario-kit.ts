// Aderir a promoção com kit vinculado (ADR-0151): mostra o anúncio avulso da base com o MESMO desconto % do kit —
// preço cheio vivo no ML, preço na promoção e a conta exata (tarifa/frete/imposto dele). Só leitura. Puro: o banco e o
// ML entram por parâmetro (fiação em deps.ts).
import type { ProjecaoCor, Semaforo } from '../promocoes/tipos.ts';

export interface PedidoUnitario { itens: { ml_item_id: string; preco: number; preco_original: number }[] }
export interface BaseDoKit { item_id: string; unidades: number }
export interface DepsUnitario {
  /** Anúncio avulso da base de um kit vinculado; null = não é kit, ou a base não tem um anúncio único. */
  baseDoKit(kitItemId: string): Promise<BaseDoKit | null>;
  /** `price` vivo do /items/bulk (o preço "de"; ADR-0196). Ausente = sem leitura. */
  precoNormal(itemId: string): Promise<number | null>;
  /** Mesma projeção exata da simulação (criarProjecaoExata). null = sem alíquota confirmada. */
  projetar(itemId: string, preco: number): Promise<{ projecao: ProjecaoCor[]; pior_semaforo: Semaforo } | null>;
}
export interface UnitarioKit {
  ml_item_id: string; base_item_id: string; unidades: number;
  preco_cheio: number; preco: number; projecao: ProjecaoCor[]; pior_semaforo: Semaforo;
}

/** ponytail: 1 item por chamada na tela; teto baixo porque cada um faz 2–3 leituras no ML. */
export const MAX_UNITARIO = 10;

export function lerUnitario(x: unknown): PedidoUnitario | null {
  const b = x as Record<string, unknown> | null;
  if (!b || !Array.isArray(b.itens) || b.itens.length === 0 || b.itens.length > MAX_UNITARIO) return null;
  const pos = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
  const itens: PedidoUnitario['itens'] = [];
  for (const i of b.itens as Record<string, unknown>[]) {
    if (!i || typeof i.ml_item_id !== 'string' || !i.ml_item_id || !pos(i.preco) || !pos(i.preco_original)) return null;
    itens.push({ ml_item_id: i.ml_item_id, preco: i.preco, preco_original: i.preco_original });
  }
  return { itens };
}

/** Preço do avulso com o desconto % do kit, em centavos inteiros. Kit sem desconto → o cheio. */
export const precoComDescontoDoKit = (cheio: number, precoKit: number, originalKit: number): number =>
  precoKit >= originalKit ? cheio : Math.round(cheio * (precoKit / originalKit) * 100) / 100;

/** Só os kits com base resolvida e lida; item que não é kit ou sem leitura some da resposta (a tela não mostra o bloco). */
export async function unitariosDosKits(p: PedidoUnitario, d: DepsUnitario): Promise<UnitarioKit[]> {
  const out: UnitarioKit[] = [];
  for (const it of p.itens) {
    try {
      const base = await d.baseDoKit(it.ml_item_id);
      if (!base) continue;
      const cheio = await d.precoNormal(base.item_id);
      if (cheio == null || cheio <= 0) continue;
      const preco = precoComDescontoDoKit(cheio, it.preco, it.preco_original);
      const r = await d.projetar(base.item_id, preco);
      if (!r) continue;
      out.push({ ml_item_id: it.ml_item_id, base_item_id: base.item_id, unidades: base.unidades, preco_cheio: cheio, preco, ...r });
    } catch (e) {
      console.warn('[operacoes] unitário do kit indisponível', { ml_item_id: it.ml_item_id, erro: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
