// Busca, filtro e ordenação da tela Estoque. Função pura de propósito: é a única parte da tela
// que decide o que o operador vê, e precisa ser testável sem render.
import type { ProdutoEstoqueResumo } from '@/lib/produtos-saldo';

export type FiltroEstoque = 'todos' | 'sem-estoque' | 'nao-publicado' | 'fiscal-pendente';
export type OrdemEstoque = 'nome' | 'saldo-asc' | 'recente';

export interface OpcoesFiltro {
  termo: string;
  filtro: FiltroEstoque;
  ordem: OrdemEstoque;
  /** `undefined` = query de canais não carregou/falhou. NUNCA tratar como "sem canal": isso
   *  classificaria o catálogo inteiro como não publicado. */
  canaisPorProduto: Map<string, string[]> | undefined;
}

const normalizar = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/**
 * Publicado = tem `ml_item_id` (fonte canônica, a mesma de `fetchPublicados`) OU aparece no
 * espelho `anuncios_externos` com algum canal. O espelho sozinho não serve: seu upsert falha
 * apenas com console.error (`_shared/anuncios/espelhar.ts:117`) sem desfazer a publicação, então
 * produto publicado de verdade pode não ter linha lá.
 */
function publicadoNoMlPorIdCanonico(p: ProdutoEstoqueResumo): boolean {
  return p.mlItemId != null;
}

export function produtoPublicado(p: ProdutoEstoqueResumo, canais: Map<string, string[]> | undefined): boolean {
  if (publicadoNoMlPorIdCanonico(p)) return true;
  if (canais === undefined) return true; // Dados incompletos: assume publicado (safe default para não esconder catálogo inteiro)
  return (canais.get(p.codigoPai)?.length ?? 0) > 0;
}

/**
 * Canais para o badge da listagem: o espelho `anuncios_externos`, mais 'mercado_livre' se o
 * produto tiver `ml_item_id` e o espelho não tiver essa linha — mesmo furo que `produtoPublicado`
 * trata (upsert best-effort do espelho, ver `_shared/anuncios/espelhar.ts:117`).
 */
export function canaisEfetivos(p: ProdutoEstoqueResumo, canais: Map<string, string[]> | undefined): string[] {
  const lista = canais?.get(p.codigoPai) ?? [];
  if (publicadoNoMlPorIdCanonico(p) && !lista.includes('mercado_livre')) return [...lista, 'mercado_livre'];
  return lista;
}

function casaTermo(p: ProdutoEstoqueResumo, termo: string): boolean {
  const alvos = [p.nomePai, p.codigoPai, p.fornecedor ?? '', ...p.gtins, ...p.codigos, ...p.cores, ...p.nomes];
  return alvos.some((a) => normalizar(a).includes(termo));
}

export function filtrarProdutos(produtos: ProdutoEstoqueResumo[], opts: OpcoesFiltro): ProdutoEstoqueResumo[] {
  const termo = normalizar(opts.termo.trim());

  const lista = produtos.filter((p) => {
    if (termo && !casaTermo(p, termo)) return false;
    // <= 0, não === 0: saldo negativo é sintoma de bug de ledger e precisa ser ENCONTRÁVEL.
    if (opts.filtro === 'sem-estoque') return p.saldoTotal <= 0;
    if (opts.filtro === 'nao-publicado') return !produtoPublicado(p, opts.canaisPorProduto);
    if (opts.filtro === 'fiscal-pendente') return p.fiscalPendente === true;
    return true;
  });

  const ordenada = [...lista];
  if (opts.ordem === 'saldo-asc') ordenada.sort((a, b) => a.saldoTotal - b.saldoTotal);
  else if (opts.ordem === 'recente') ordenada.sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
  else ordenada.sort((a, b) => a.nomePai.localeCompare(b.nomePai, 'pt-BR'));
  return ordenada;
}
