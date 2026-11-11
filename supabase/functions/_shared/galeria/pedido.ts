// Pedido de geração da galeria (ADR-0201, Task 8): identidade por imagem e regra de vaga, iguais às de
// `galeria_reservar_pedido` (migration 20261110171517). Puro (exceto `precoDoMes`, que recebe o client): roda na edge e no vitest.
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

export interface LinhaVaga { roteiro_id: string; cor: string; missao: number; geracao: number; status: string; origem: string; erro?: string | null }
export interface Planejada { cor: string; missao: Missao; geracao: number }
export type MotivoBloqueio = 'teto' | 'sem_vista' | 'em_andamento';

const ABERTOS = new Set(['pendente', 'submetendo', 'gerando']);
const TETO = 3;
/** Ocupa vaga (teto e numeração): fora de `falhou`, ou reportada inválida pelo cliente (paga ao provedor; revisão geral). */
const ocupaVaga = (l: LinhaVaga) => l.status !== 'falhou' || l.erro === 'imagem_invalida';

/**
 * Regra de vaga da (cor, missão), igual à da RPC (sem a vista): geração aberta em qualquer roteiro → `em_andamento`;
 * 3 gerações `gerador` que ocupam vaga deste roteiro, exibidas ou não → `teto`. Usada também pelo "Gerar de novo".
 */
export function bloqueioDaVaga(
  linhas: LinhaVaga[], roteiroId: string, cor: string, missao: number, usaGerador: boolean,
): 'em_andamento' | 'teto' | null {
  const vaga = linhas.filter((l) => l.cor === cor && l.missao === missao);
  if (vaga.some((l) => ABERTOS.has(l.status))) return 'em_andamento';
  const validas = vaga.filter((l) => l.roteiro_id === roteiroId && ocupaVaga(l) && l.origem === 'gerador');
  return usaGerador && validas.length >= TETO ? 'teto' : null;
}

/** Competência pelo relógio de Fortaleza (UTC−3, sem horário de verão), como `platform_imagem_competencia`. */
const mesAtual = () => `${new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 7)}-01`;

/**
 * Preço por imagem do mês (`platform_resolve_terms` → `image_unit_cents`); sem condição comercial → 0 e `termosId`
 * nulo (pedido não elegível). Fonte única de `galeria-gerar` (congela no pedido) e `galeria-imagens` (mostra na tela).
 */
export async function precoDoMes(
  admin: { rpc: (nome: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> },
  orgId: string,
): Promise<{ unitCents: number; termosId: string | null }> {
  const { data, error } = await admin.rpc('platform_resolve_terms', { p_org_id: orgId, p_on: mesAtual() });
  if (error) throw new Error(error.message);
  const termos = data as { id?: string | null; image_unit_cents?: number | null } | null;
  const termosId = termos?.id ?? null;
  return { termosId, unitCents: termosId ? Number(termos?.image_unit_cents ?? 0) : 0 };
}

/**
 * Mesma regra de vaga da RPC: geração aberta na (cor, missão) do anúncio, de qualquer roteiro → `em_andamento`;
 * teto 3 conta toda geração `gerador` que ocupa vaga deste roteiro (R8.2); nova `geracao` = maior que ocupa vaga + 1.
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
      const motivo: MotivoBloqueio | null = !(vistasPorCor[cor] ?? []).includes(m.vista) ? 'sem_vista'
        : bloqueioDaVaga(linhas, roteiroId, cor, missao, m.usaGerador);
      if (motivo) { bloqueadas.push({ cor, missao, motivo }); continue; }
      const doRoteiro = linhas.filter((l) => l.cor === cor && l.missao === missao && l.roteiro_id === roteiroId && ocupaVaga(l));
      const geracao = Math.max(0, ...doRoteiro.map((l) => l.geracao)) + 1;
      (m.usaGerador ? novas : recortes).push({ cor, missao, geracao });
    }
  }
  return { novas, recortes, bloqueadas };
}
