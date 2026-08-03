// Título por partição (ADR-0048). Cada anúncio de um produto split precisa de um título DISTINTO
// e legítimo (o ML baixa títulos idênticos do mesmo produto como duplicado → forbidden). A
// partição 0 reusa o título existente da família (o caller não chama esta função); partições >0
// tentam a IA (só as cores daquela partição) e, se ela falhar/colidir, caem num determinístico
// que crava uma cor da partição no título-base — garantindo ≤60 chars, distinto entre partições.

import { posProcessarTitulo } from '../ai/titulo-pos.ts';
import { ehCorIndefinida } from '../cor/indefinida.ts';
// gerarCopy é importado dinamicamente dentro de gerarTituloParticao: a cadeia do copywriter
// (cliente OpenRouter, specifiers npm:/jsr:) só carrega no runtime Deno. Mantê-la fora do topo
// deixa o fallback determinístico (e seu teste vitest) importável sem puxar esse grafo.

const TITULO_MAX = 60;

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
  modelo?: string; // ADR-0074 — resolvido pelo caller (publicar-split-ml)
  /** familias.fornecedor — só para o mapa de marcas corrigir a grafia (ADR-0099). */
  fornecedor?: string | null;
}

/**
 * Fallback determinístico e puro. Opera sobre o título-base JÁ MONTADO (familias.titulo_ml da
 * partição 0), não sobre slots — não há como decompor uma string pronta em slots sem adivinhar.
 * Por isso continua em string, mas respeitando as invariantes do ADR-0099: sem pipe, e derrubando
 * PALAVRA INTEIRA do base, nunca cortando token no meio. O discriminador nunca é derrubado.
 */
export function tituloParticaoDeterministico(
  tituloBase: string,
  cores: Array<{ cor: string | null }>,
  particao: number,
): string {
  const corRep = cores
    .map((c) => c.cor?.trim())
    // 'Outra' (veredito do Vision) nunca vira discriminador — incidente do lote #31. E como o
    // sort é alfabético, sem este filtro 'Outra' ainda GANHARIA de Preto/Rosa/Verde/Vermelho.
    .filter((c): c is string => !!c && !ehCorIndefinida(c))
    .sort((a, b) => a.localeCompare(b, 'pt'))[0];
  // ponytail: ordinal só entra quando a partição não tem nenhuma cor nomeada (improvável
  // num produto com >100 cores); ainda assim garante título não-vazio e distinto.
  const discriminador = corRep ?? `Opcao ${particao + 1}`;

  // tituloBase pode ser familias.titulo_ml de uma família publicada antes do ADR-0099 (pipe
  // como separador legado) — remove o caractere antes de tokenizar para que a invariante
  // "sem pipe" valha também para o fallback determinístico, não só para o caminho de IA
  // (normalizarSlots já limpa `|` desse lado).
  const palavras = tituloBase.replace(/\|/g, ' ').trim().split(/\s+/).filter(Boolean);
  while (palavras.length > 1 && `${palavras.join(' ')} ${discriminador}`.length > TITULO_MAX) {
    palavras.pop();
  }
  const titulo = `${palavras.join(' ')} ${discriminador}`.trim();
  // Caso degenerado: tituloBase de uma única palavra longa + discriminador ainda estoura 60 —
  // o while acima nunca reduz abaixo de 1 palavra (para não devolver só o discriminador, que
  // colidiria entre partições). Corte de segurança por caractere, só aqui, só nesse resto.
  return titulo.length > TITULO_MAX ? titulo.slice(0, TITULO_MAX).trim() : titulo;
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
    // TituloInviavelError (slots obrigatórios não cabem em 60) cai no catch abaixo como qualquer
    // outra falha de IA — este caller já é resiliente por desenho (fallback determinístico), ao
    // contrário de process-familia/regenerar-copy-familia, que são terminais e precisam traduzir
    // o erro para o operador.
    const titulo = posProcessarTitulo(out.titulo_slots, {
      nomePai: opts.nome,
      descricaoPai: opts.descricao_detalhado ?? '',
      tipoProdutoBusca: out.tipo_produto_busca,
      // DadosFonteTitulo.cores é documentado como "cores REAIS (sem 'Outra' nem placeholder)" —
      // defesa em profundidade além da trava interna do guard (ehCorIndefinida).
      cores: [...new Set(opts.cores.map((c) => c.cor).filter((c): c is string => !!c && !ehCorIndefinida(c)))],
      fornecedor: opts.fornecedor ?? null,
    });
    // Se a IA repetir o título-base, não serve (ML bloqueia idênticos) → cai no determinístico.
    if (titulo.trim() && titulo.trim() !== opts.tituloBase.trim()) return titulo;
  } catch (e) {
    console.warn(`gerarTituloParticao IA falhou (partição ${opts.particao}):`, (e as Error).message);
  }
  return tituloParticaoDeterministico(opts.tituloBase, opts.cores, opts.particao);
}
