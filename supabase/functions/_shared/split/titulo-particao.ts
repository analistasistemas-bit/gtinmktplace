// Título por partição (ADR-0048). Cada anúncio de um produto split precisa de um título DISTINTO
// e legítimo (o ML baixa títulos idênticos do mesmo produto como duplicado → forbidden). A
// partição 0 reusa o título existente da família (o caller não chama esta função); partições >0
// tentam a IA (só as cores daquela partição) e, se ela falhar/colidir, caem num determinístico
// que crava uma cor da partição no título-base — garantindo ≤60 chars, distinto entre partições.

import { garantirCorTitulo, garantirMetragemTitulo, garantirTipoProdutoTitulo, garantirTipoFioTitulo, removerMarketingNaoGrounded } from '../ai/titulo.ts';
// gerarCopy é importado dinamicamente dentro de gerarTituloParticao: a cadeia do copywriter
// (cliente OpenRouter, specifiers npm:/jsr:) só carrega no runtime Deno. Mantê-la fora do topo
// deixa o fallback determinístico (e seu teste vitest) importável sem puxar esse grafo.

export interface CorParticaoTitulo {
  codigo: string;
  cor: string | null;
  preco: number;
}

export interface OpcoesTituloParticao {
  nome: string; // familia.nome_pai (fonte de verdade do produto)
  descricao_detalhado: string; // familia.descricao_pai
  unidade?: string | null;
  cores: CorParticaoTitulo[]; // só as cores DESTA partição
  tituloBase: string; // título da partição 0 (familia.titulo_ml) — referência de unicidade
  particao: number; // índice (>0) desta partição
  modelo?: string; // ADR-0071 — resolvido pelo caller (publicar-split-ml)
}

/**
 * Fallback determinístico e puro: crava no título-base uma cor representativa da partição
 * (a 1ª alfabética). `garantirCorTitulo` (nCores=1) força o discriminador no 1º segmento e
 * apara o texto-base se preciso — então o clamp de 60 nunca descarta o discriminador, e como
 * as partições têm conjuntos de cor disjuntos os títulos saem distintos entre si e do base.
 */
export function tituloParticaoDeterministico(
  tituloBase: string,
  cores: Array<{ cor: string | null }>,
  particao: number,
): string {
  const corRep = cores
    .map((c) => c.cor?.trim())
    .filter((c): c is string => !!c)
    .sort((a, b) => a.localeCompare(b, 'pt'))[0];
  // ponytail: ordinal só entra quando a partição não tem nenhuma cor nomeada (improvável
  // num produto com >100 cores); ainda assim garante título não-vazio e distinto.
  const discriminador = corRep ?? `OPCAO ${particao + 1}`;
  return garantirCorTitulo(tituloBase, discriminador, 1);
}

export async function gerarTituloParticao(opts: OpcoesTituloParticao): Promise<string> {
  try {
    const { gerarCopy } = await import('../ai/copywriter.ts');
    const out = await gerarCopy({
      nome: opts.nome,
      descricao_detalhado: opts.descricao_detalhado,
      unidade: opts.unidade ?? null,
      variacoes: opts.cores.map((c) => ({ codigo: c.codigo, cor: c.cor, preco: c.preco })),
    }, opts.modelo);
    const titulo = garantirMetragemTitulo(
      garantirTipoFioTitulo(garantirTipoProdutoTitulo(removerMarketingNaoGrounded(out.titulo, opts.nome, opts.descricao_detalhado ?? ''), out.tipo_produto_busca), opts.nome),
      opts.nome,
    ); // ≤60, metragem preservada, tipo de produto garantido (ADR-0054), sinônimo de tipo de fio corrigido (ADR-0070), sem marketing não-grounded (lote #28)
    // Se a IA repetir o título-base, não serve (ML bloqueia idênticos) → cai no determinístico.
    if (titulo.trim() && titulo.trim() !== opts.tituloBase.trim()) return titulo;
  } catch (e) {
    console.warn(`gerarTituloParticao IA falhou (partição ${opts.particao}):`, (e as Error).message);
  }
  return tituloParticaoDeterministico(opts.tituloBase, opts.cores, opts.particao);
}
