// Pulse (ADR-0119): filtros da lista do radar. Puro, sem I/O — os KPIs do topo são atalhos para
// estes mesmos filtros, então a contagem exibida e a lista filtrada precisam sair da MESMA regra.
// Duplicar a condição no card e na lista é como um KPI passa a mostrar 12 e a lista devolver 9.
import type { PulseProduto } from './pulse';
import { posicaoVsMercado } from './pulse-formato';

/** Recorte ativado ao clicar num KPI. `null` = sem recorte. */
export type FocoPulse = 'mais_caro' | 'menor_preco' | 'sem_vinculo';

/** Situação do produto NO RADAR (pausar/reativar pelo menu da linha), não o status do anúncio no ML. */
export type StatusRadar = 'todos' | 'ativo' | 'pausado';

export interface FiltrosPulse {
  busca: string;
  status: StatusRadar;
  foco: FocoPulse | null;
}

export const FILTROS_VAZIOS: FiltrosPulse = { busca: '', status: 'todos', foco: null };

export function temFiltroAtivo(f: FiltrosPulse): boolean {
  return f.busca.trim() !== '' || f.status !== 'todos' || f.foco !== null;
}

function casaBusca(p: PulseProduto, termo: string): boolean {
  const t = termo.trim().toLowerCase();
  if (!t) return true;
  return (p.titulo ?? '').toLowerCase().includes(t)
    || (p.gtin ?? '').includes(t)
    || (p.codigo_pai ?? '').includes(t);
}

function casaFoco(p: PulseProduto, foco: FocoPulse, menorConcorrente: number | null): boolean {
  if (foco === 'sem_vinculo') return !!p.catalogo_status && p.catalogo_status !== 'vinculado';
  const pos = posicaoVsMercado(p.meu_preco, menorConcorrente);
  if (!pos) return false; // sem comparação não entra em recorte de posição — nem como "barato"
  // Mesmo limiar de "Empatado" da coluna Sua posição: diferença abaixo de 0,5% não é vantagem
  // nem problema, e contá-la encheria os dois recortes com produtos praticamente no mesmo preço.
  return foco === 'mais_caro' ? pos.deltaPct > 0.5 : pos.deltaPct < -0.5;
}

export function filtrarProdutos(
  produtos: PulseProduto[],
  filtros: FiltrosPulse,
  menorConcorrenteDe: (p: PulseProduto) => number | null,
): PulseProduto[] {
  return produtos.filter((p) => {
    if (!casaBusca(p, filtros.busca)) return false;
    if (filtros.status !== 'todos' && p.status !== filtros.status) return false;
    if (filtros.foco && !casaFoco(p, filtros.foco, menorConcorrenteDe(p))) return false;
    return true;
  });
}

export interface ContagensPulse {
  total: number;
  maisCaro: number;
  menorPreco: number;
  semVinculo: number;
  /** Quantos têm preço nosso E menor concorrente — a base de comparação dos dois recortes. */
  comparaveis: number;
}

/**
 * Contagens dos KPIs. Derivadas de `casaFoco`, a mesma função que filtra — é isso que garante que
 * clicar num card de "12" devolva 12 linhas.
 */
export function contarPulse(
  produtos: PulseProduto[],
  menorConcorrenteDe: (p: PulseProduto) => number | null,
): ContagensPulse {
  let maisCaro = 0, menorPreco = 0, semVinculo = 0, comparaveis = 0;
  for (const p of produtos) {
    const menor = menorConcorrenteDe(p);
    if (casaFoco(p, 'sem_vinculo', menor)) semVinculo++;
    if (posicaoVsMercado(p.meu_preco, menor)) comparaveis++;
    if (casaFoco(p, 'mais_caro', menor)) maisCaro++;
    if (casaFoco(p, 'menor_preco', menor)) menorPreco++;
  }
  return { total: produtos.length, maisCaro, menorPreco, semVinculo, comparaveis };
}
