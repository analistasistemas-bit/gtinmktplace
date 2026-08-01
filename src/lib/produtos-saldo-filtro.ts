// Busca, filtro e ordenação da tela Estoque. Função pura de propósito: é a única parte da tela
// que decide o que o operador vê, e precisa ser testável sem render.
import type { ProdutoComSaldo } from '@/lib/produtos-saldo';

export type FiltroEstoque = 'todos' | 'sem-estoque' | 'nao-publicado';
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
export function produtoPublicado(p: ProdutoComSaldo, canais: Map<string, string[]> | undefined): boolean {
  if (p.mlItemId != null) return true;
  if (canais === undefined) return true; // Dados incompletos: assume publicado (safe default para não esconder catálogo inteiro)
  return (canais.get(p.codigoPai)?.length ?? 0) > 0;
}

function casaTermo(p: ProdutoComSaldo, termo: string): boolean {
  const alvos = [p.nomePai, p.codigoPai, p.fornecedor ?? ''];
  for (const v of p.variacoes) alvos.push(v.codigo, v.gtin ?? '', v.cor ?? '', v.nome ?? '');
  return alvos.some((a) => normalizar(a).includes(termo));
}

export function filtrarProdutos(produtos: ProdutoComSaldo[], opts: OpcoesFiltro): ProdutoComSaldo[] {
  const termo = normalizar(opts.termo.trim());

  const lista = produtos.filter((p) => {
    if (termo && !casaTermo(p, termo)) return false;
    // <= 0, não === 0: saldo negativo é sintoma de bug de ledger e precisa ser ENCONTRÁVEL.
    if (opts.filtro === 'sem-estoque') return p.saldoTotal <= 0;
    if (opts.filtro === 'nao-publicado') return !produtoPublicado(p, opts.canaisPorProduto);
    return true;
  });

  const ordenada = [...lista];
  if (opts.ordem === 'saldo-asc') ordenada.sort((a, b) => a.saldoTotal - b.saldoTotal);
  else if (opts.ordem === 'recente') ordenada.sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
  else ordenada.sort((a, b) => a.nomePai.localeCompare(b.nomePai, 'pt-BR'));
  return ordenada;
}
