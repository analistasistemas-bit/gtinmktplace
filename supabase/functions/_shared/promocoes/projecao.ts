// ADR-0170 — projeção do líquido de um anúncio numa promoção do ML. Puro: IO entra por parâmetro.
import { liquidoClassico } from '../preco/liquido.ts';
import { grossUp } from '../preco/sugerir.ts';
import type { Contagem, LinhaItem, Semaforo, Tarifa } from './tipos.ts';

/** Mesma regra de `src/lib/semaforo.ts` (amarrada por tests/lib/paridade-semaforo-promocoes.test.ts). */
export function semaforo(liquido: number | null, piso: number, custo: number | null): Semaforo {
  if (liquido == null) return 'indisponivel';
  if (liquido >= piso) return 'verde';
  if (custo != null && custo > 0 && liquido < custo) return 'vermelho';
  return 'amarelo';
}

const PESO: Record<Semaforo, number> = { indisponivel: 0, verde: 1, amarelo: 2, vermelho: 3 };

/** Pior cor entre as que têm líquido; `indisponivel` só quando nenhuma tem (ADR-0065, família-level). */
export function piorSemaforo(cores: Semaforo[]): Semaforo {
  return cores.reduce<Semaforo>((pior, s) => (PESO[s] > PESO[pior] ? s : pior), 'indisponivel');
}

/** Convidado = `candidate`; participando = `started` (no ar) ou `pending` (inscrito, campanha ainda não começou). */
export function ehParticipando(status: string): boolean {
  return status === 'started' || status === 'pending';
}

/** Participando: o preço escolhido/no ar (`price`). Convidado: o sugerido da faixa, senão o preço da promoção. */
export function precoAvaliado(it: { status: string; preco_sugerido: number | null; preco_promo: number | null }): number | null {
  if (ehParticipando(it.status)) return it.preco_promo ?? it.preco_sugerido ?? null;
  return it.preco_sugerido ?? it.preco_promo ?? null;
}

export function liquidoNoPreco(preco: number, t: Tarifa, aliquotaPct: number): number {
  return liquidoClassico(preco, t.comissao, t.frete, aliquotaPct);
}

/**
 * Menor preço da faixa [min, max] cujo líquido, conferido na tarifa DAQUELE preço, fica ≥ piso.
 * Ponto fixo: parte da tarifa do máximo e refaz o gross-up com a tarifa de cada candidato (a comissão
 * fixa e o frete mudam por faixa de preço) até parar de descer. Só guarda preço verificado; no pior
 * caso fica no máximo, que foi verificado primeiro.
 */
export async function ateQuantoDescer(
  a: { piso: number; aliquotaPct: number; min: number; max: number },
  tarifaEm: (preco: number) => Promise<Tarifa>,
): Promise<{ valor: number | null; motivo: 'qualquer' | 'nenhum' | null }> {
  let t = await tarifaEm(a.max);
  if (liquidoNoPreco(a.max, t, a.aliquotaPct) < a.piso) return { valor: null, motivo: 'nenhum' };
  let melhor = a.max;
  for (let i = 0; i < 6; i++) {
    const bruto = grossUp(a.piso, t.comissao.percentual, t.comissao.fixa, t.frete, a.aliquotaPct);
    const cand = Math.min(a.max, Math.max(a.min, bruto));
    if (cand >= melhor) break;
    t = await tarifaEm(cand);
    if (liquidoNoPreco(cand, t, a.aliquotaPct) >= a.piso) melhor = cand;
  }
  return melhor <= a.min ? { valor: null, motivo: 'qualquer' } : { valor: melhor, motivo: null };
}

/** Só convidado e participando contam — outro status do ML não é presumido. */
export function contar(linhas: Pick<LinhaItem, 'status' | 'pior_semaforo' | 'ml_pct'>[]): Contagem {
  const c: Contagem = { convidados: 0, convidados_verde: 0, participando: 0, verde: 0, amarelo: 0, vermelho: 0, indisponivel: 0, participando_vermelho: 0, ml_pct_max: null };
  for (const l of linhas) {
    const participa = ehParticipando(l.status);
    if (!participa && l.status !== 'candidate') continue;
    if (participa) c.participando++; else c.convidados++;
    c[l.pior_semaforo]++;
    if (participa && l.pior_semaforo === 'vermelho') c.participando_vermelho++;
    if (!participa && l.pior_semaforo === 'verde') c.convidados_verde++;
    if (l.ml_pct != null && l.ml_pct > 0) c.ml_pct_max = Math.max(c.ml_pct_max ?? 0, l.ml_pct);
  }
  return c;
}
