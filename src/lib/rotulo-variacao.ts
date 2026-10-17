// ADR-0166 amendment 2026-09-24c: rótulo ÚNICO da variação nas telas do Estoque. Antes cada tela
// fazia `cor ?? nome` por conta própria e nenhuma mostrava o tamanho — numa grade, cinco SKUs
// "Preto" indistinguíveis na hora de dar entrada. Sem tamanho o resultado é idêntico ao antigo.
import { TAMANHOS_ROUPA, TAMANHOS_INFANTIL, TAMANHOS_CALCA, NUMERACOES_CALCADO } from '@/lib/tamanhos';
import { compararCor } from '@/lib/cor';

type Identificavel = {
  cor: string | null;
  nome: string | null;
  tamanho?: string | null;
  /** Lido só por `compararCor` como desempate sem cor — opcional porque nem todo chamador
   *  (ex.: testes de rótulo/ordenação) tem código de SKU em mãos. */
  codigo?: string;
};

export function rotuloVariacao(v: { cor: string | null; nome: string | null; tamanho?: string | null }): string | null {
  const base = v.cor ?? v.nome;
  const tamanho = v.tamanho?.trim();
  if (!tamanho) return base;
  return base ? `${base} · ${tamanho}` : tamanho;
}

// ADR-0182: Letras, Infantil, números adultos isolados (33..48, sem repetir os que Calça e
// Calçado compartilham) em ordem numérica, e por último os pares de meio-número.
const ehPar = (t: string) => t.includes('/');
const ORDEM_TAMANHO: readonly string[] = [
  ...TAMANHOS_ROUPA,
  ...TAMANHOS_INFANTIL,
  ...[...new Set([...TAMANHOS_CALCA, ...NUMERACOES_CALCADO.filter((t) => !ehPar(t))])]
    .sort((a, b) => Number(a) - Number(b)),
  ...NUMERACOES_CALCADO.filter(ehPar),
];

function indiceTamanho(t: string | null | undefined): number {
  const i = t ? ORDEM_TAMANHO.indexOf(t) : -1;
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

/** Cor (mesma regra de `compararCor`) e, dentro da cor, tamanho na ordem canônica. Sem tamanho
 *  em nenhuma linha, devolve a lista intacta — a ordem por cor já vem de `fetchVariacoesProduto`. */
export function ordenarVariacoesGrade<T extends Identificavel>(vs: T[]): T[] {
  if (!vs.some((v) => v.tamanho?.trim())) return vs;
  return [...vs].sort((a, b) =>
    compararCor({ cor: a.cor, codigo: a.codigo ?? '' }, { cor: b.cor, codigo: b.codigo ?? '' })
    || indiceTamanho(a.tamanho) - indiceTamanho(b.tamanho));
}
