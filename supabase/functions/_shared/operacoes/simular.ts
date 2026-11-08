// Simulação de desconto (emenda ADR-0174, 2026-11-03): líquido EXATO num preço escolhido, antes de aderir.
// Puro: a projeção no preço (tarifa/frete daquele preço, mesmo caminho do sync e da trava) entra por parâmetro.
// Só leitura — nada é gravado no banco nem no ML.
import { emParalelo, MSG_ALIQUOTA } from '../promocoes/sincronizar.ts';
import { ehParticipando } from '../promocoes/projecao.ts';
import type { ProjecaoCor, Semaforo } from '../promocoes/tipos.ts';
import type { LinhaCentral } from './validar.ts';

/** ponytail: teto por chamada (CPU 2 s da edge, ADR-0173); simulação maior pede lotes retomáveis no servidor. */
export const MAX_SIMULAR = 50;
const CONCORRENCIA = 4;

export interface PedidoSimular { promocao_id: string; itens: { ml_item_id: string; preco: number }[] }
/** null = sem alíquota confirmada na org. */
export type ProjecaoExata = (l: LinhaCentral, preco: number) => Promise<{ projecao: ProjecaoCor[]; pior_semaforo: Semaforo } | null>;
export type ResultadoSimulacao =
  | { ml_item_id: string; status: 'simulado'; preco: number; projecao: ProjecaoCor[]; pior_semaforo: Semaforo }
  | { ml_item_id: string; status: 'ignorado'; motivo: string };

export function lerSimular(x: unknown): PedidoSimular | null {
  const b = x as Record<string, unknown> | null;
  if (!b || typeof b.promocao_id !== 'string' || !b.promocao_id || !Array.isArray(b.itens)) return null;
  if (b.itens.length === 0 || b.itens.length > MAX_SIMULAR) return null;
  const itens: PedidoSimular['itens'] = [];
  for (const i of b.itens as Record<string, unknown>[]) {
    if (!i || typeof i.ml_item_id !== 'string' || !i.ml_item_id) return null;
    if (typeof i.preco !== 'number' || !Number.isFinite(i.preco) || i.preco <= 0) return null;
    itens.push({ ml_item_id: i.ml_item_id, preco: i.preco });
  }
  return { promocao_id: b.promocao_id, itens };
}

export function simular(
  itens: PedidoSimular['itens'], central: Map<string, LinhaCentral>, projetar: ProjecaoExata,
): Promise<ResultadoSimulacao[]> {
  return emParalelo(itens, CONCORRENCIA, async ({ ml_item_id, preco }): Promise<ResultadoSimulacao> => {
    const ignorar = (motivo: string) => ({ ml_item_id, status: 'ignorado' as const, motivo });
    const l = central.get(ml_item_id);
    const participando = l != null && ehParticipando(l.status);
    if (!l || (l.status !== 'candidate' && !participando)) return ignorar('O anúncio não está como Convidado nem Participando nesta promoção');
    // Convidado sem faixa: o executor recusa a adesão (validar.ts). Participante nunca tem faixa (alterar preço:
    // o ML valida o preço) — simula mesmo assim.
    if ((!participando || l.convite_aberto) && (l.preco_min == null || l.preco_max == null)) return ignorar('O ML não informou a faixa de preço deste anúncio');
    try {
      const r = await projetar(l, preco);
      if (!r) return ignorar(MSG_ALIQUOTA);
      return { ml_item_id, status: 'simulado', preco, projecao: r.projecao, pior_semaforo: r.pior_semaforo };
    } catch (e) {
      console.warn('[operacoes] simulação indisponível', { ml_item_id, erro: e instanceof Error ? e.message : String(e) });
      return ignorar('Não foi possível calcular agora. Tente de novo.');
    }
  });
}
