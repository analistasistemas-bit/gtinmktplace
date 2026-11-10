// Pedido de geração da galeria (ADR-0201, Task 8): identidade por imagem e regra de vaga, iguais às de
// `galeria_reservar_pedido` (migration 20261109093335). Puro: roda na edge e no vitest.
import { createHash } from 'node:crypto';
import { missoesDisponiveis, type Missao, type Vista } from './regras.ts';

/** UUID v5 (RFC 4122) com o id do pedido como namespace = `extensions.uuid_generate_v5(pedido, cor:missao:geracao)`. */
export function idDerivado(pedidoId: string, cor: string, missao: number, geracao: number): string {
  const ns = Uint8Array.from(pedidoId.replace(/-/g, '').match(/../g)!.map((h) => parseInt(h, 16)));
  const nome = new TextEncoder().encode(`${cor}:${missao}:${geracao}`);
  const b = createHash('sha1').update(ns).update(nome).digest().subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export interface LinhaVaga { roteiro_id: string; cor: string; missao: number; geracao: number; status: string; origem: string }
export interface Planejada { cor: string; missao: Missao; geracao: number }
export type MotivoBloqueio = 'teto' | 'sem_vista' | 'em_andamento';

const ABERTOS = new Set(['pendente', 'submetendo', 'gerando']);
const TETO = 3;

/**
 * Mesma regra de vaga da RPC: geração aberta na (cor, missão) do anúncio, de qualquer roteiro → `em_andamento`;
 * teto 3 conta toda geração `gerador` fora de `falhou` deste roteiro (R8.2); nova `geracao` = maior não falha + 1.
 * A vista exigida pela missão precisa de referência da cor (R3.2) — recorte também (vem da foto real).
 * `linhas` = imagens do anúncio nas cores pedidas (qualquer roteiro).
 */
export function planejarGeracoes({ roteiroId, cores, missoes, moda, vistasPorCor, linhas }: {
  roteiroId: string; cores: string[]; missoes: Missao[]; moda: boolean;
  vistasPorCor: Record<string, Vista[]>; linhas: LinhaVaga[];
}): { novas: Planejada[]; recortes: Planejada[]; bloqueadas: Array<{ cor: string; missao: Missao; motivo: MotivoBloqueio }> } {
  const info = new Map(missoesDisponiveis(moda, ['frente', 'costas', 'lateral']).map((m) => [m.missao, m]));
  const novas: Planejada[] = [];
  const recortes: Planejada[] = [];
  const bloqueadas: Array<{ cor: string; missao: Missao; motivo: MotivoBloqueio }> = [];
  for (const cor of cores) {
    for (const missao of missoes) {
      const m = info.get(missao)!;
      const vaga = linhas.filter((l) => l.cor === cor && l.missao === missao);
      const doRoteiro = vaga.filter((l) => l.roteiro_id === roteiroId && l.status !== 'falhou');
      const motivo: MotivoBloqueio | null = !(vistasPorCor[cor] ?? []).includes(m.vista) ? 'sem_vista'
        : vaga.some((l) => ABERTOS.has(l.status)) ? 'em_andamento'
        : m.usaGerador && doRoteiro.filter((l) => l.origem === 'gerador').length >= TETO ? 'teto'
        : null;
      if (motivo) { bloqueadas.push({ cor, missao, motivo }); continue; }
      const geracao = Math.max(0, ...doRoteiro.map((l) => l.geracao)) + 1;
      (m.usaGerador ? novas : recortes).push({ cor, missao, geracao });
    }
  }
  return { novas, recortes, bloqueadas };
}
