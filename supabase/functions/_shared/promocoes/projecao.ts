// ADR-0170 — projeção do líquido de um anúncio numa promoção do ML. Puro: IO entra por parâmetro.
import { liquidoClassico } from '../preco/liquido.ts';
import { grossUp } from '../preco/sugerir.ts';
import type { Contagem, LinhaItem, ProjecaoCor, Semaforo, Tarifa } from './tipos.ts';

/** Mesma regra de `src/lib/semaforo.ts` (amarrada por tests/lib/paridade-semaforo-promocoes.test.ts). */
export function semaforo(liquido: number | null, piso: number, custo: number | null): Semaforo {
  if (liquido == null) return 'indisponivel';
  // Prejuízo vence o piso: piso cadastrado abaixo do custo nunca pinta de verde uma venda no vermelho.
  if (custo != null && custo > 0 && liquido < custo) return 'vermelho';
  if (liquido >= piso) return 'verde';
  return 'amarelo';
}

const PESO: Record<Semaforo, number> = { indisponivel: 0, verde: 1, amarelo: 2, vermelho: 3 };

/** Pior cor entre as que têm líquido; `indisponivel` só quando nenhuma tem (ADR-0065, família-level). */
export function piorSemaforo(cores: Semaforo[]): Semaforo {
  return cores.reduce<Semaforo>((pior, s) => (PESO[s] > PESO[pior] ? s : pior), 'indisponivel');
}

/** Pior semáforo da linha; uma cor com kit a conferir (`kit_*`) trava a linha inteira em ⚪ — o verde
 *  das outras cores não pode levar um kit mal resolvido a adesão (ADR-0170, adendo de kit). */
export function semaforoDaLinha(projecao: Pick<ProjecaoCor, 'motivo'>[], cores: Semaforo[]): Semaforo {
  return projecao.some((c) => c.motivo?.startsWith('kit_')) ? 'indisponivel' : piorSemaforo(cores);
}

/** Convidado = `candidate`; participando = `started` (no ar) ou `pending` (inscrito, campanha ainda não começou). */
export function ehParticipando(status: string): boolean {
  return status === 'started' || status === 'pending';
}

/** Participando: o preço escolhido/no ar (`price`). Convidado: o sugerido da faixa, senão o preço da promoção. */
/** Abaixo disto o comprador perde o frete grátis (regra do Diego), em qualquer tipo de campanha. */
export const PRECO_MIN_PROMOCAO = 19;
export const MSG_PISO_PROMOCAO = 'Abaixo de R$ 19 o comprador perde o frete grátis';

export function precoAvaliado(it: {
  status: string; preco_sugerido: number | null; preco_promo: number | null; preco_min?: number | null; preco_max?: number | null;
}): number | null {
  if (ehParticipando(it.status)) return it.preco_promo ?? it.preco_sugerido ?? null;
  const p = it.preco_sugerido ?? it.preco_promo ?? null;
  if (p == null || p >= PRECO_MIN_PROMOCAO || it.preco_max == null) return p;
  // Sugerido abaixo do piso: com faixa que alcança R$ 19, vale o desconto menor (pedido do Diego, 07/11).
  const noPiso = Math.max(PRECO_MIN_PROMOCAO, it.preco_min ?? 0);
  return noPiso <= it.preco_max ? noPiso : p;
}

export function liquidoNoPreco(preco: number, t: Tarifa, aliquotaPct: number): number {
  return liquidoClassico(preco, t.comissao, t.frete, aliquotaPct);
}

/**
 * Menor preço da faixa [min, max] cujo líquido, conferido na tarifa DAQUELE preço, fica ≥ piso.
 * Ponto fixo: parte da tarifa do máximo e refaz o gross-up com a tarifa de cada candidato (a comissão
 * fixa e o frete mudam por faixa de preço) até parar de descer. Só guarda preço verificado; no pior
 * caso fica no máximo, que foi verificado primeiro. O alvo é max(piso, custo): nunca sugere preço
 * cujo líquido fique abaixo do custo, mesmo com piso cadastrado mais baixo.
 */
export async function ateQuantoDescer(
  entrada: { piso: number; custo: number; aliquotaPct: number; min: number; max: number },
  tarifaEm: (preco: number) => Promise<Tarifa>,
): Promise<{ valor: number | null; motivo: 'qualquer' | 'nenhum' | null }> {
  const a = { ...entrada, piso: Math.max(entrada.piso, entrada.custo) };
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

/** Só convidado e participando contam — outro status do ML não é presumido. Convidado abaixo do piso não aparece
 *  na Central, então não conta; sem preço avaliado conta (espelha `convidadoAbaixoDoPiso` do front). */
export function contar(linhas: Pick<LinhaItem, 'status' | 'pior_semaforo' | 'ml_pct' | 'preco_avaliado'>[]): Contagem {
  const c: Contagem = { convidados: 0, convidados_verde: 0, participando: 0, verde: 0, amarelo: 0, vermelho: 0, indisponivel: 0, participando_vermelho: 0, ml_pct_max: null,
    convidados_semaforo: { verde: 0, amarelo: 0, vermelho: 0, indisponivel: 0 } };
  for (const l of linhas) {
    const participa = ehParticipando(l.status);
    if (!participa && l.status !== 'candidate') continue;
    if (!participa && l.preco_avaliado != null && l.preco_avaliado < PRECO_MIN_PROMOCAO) continue;
    if (participa) c.participando++; else c.convidados++;
    c[l.pior_semaforo]++;
    if (participa && l.pior_semaforo === 'vermelho') c.participando_vermelho++;
    if (!participa && l.pior_semaforo === 'verde') c.convidados_verde++;
    if (!participa) c.convidados_semaforo[l.pior_semaforo]++;
    if (l.ml_pct != null && l.ml_pct > 0) c.ml_pct_max = Math.max(c.ml_pct_max ?? 0, l.ml_pct);
  }
  return c;
}
