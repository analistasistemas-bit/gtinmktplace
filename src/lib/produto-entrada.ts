// Espelho do contrato de entrada da edge `cadastrar-produto`. A definição canônica (com a
// validação) vive em `supabase/functions/_shared/produto/validar.ts`, que roda em Deno e não
// entra no build do Vite. Manter os dois em sincronia: o campo novo que aparecer lá precisa
// aparecer aqui, senão a tela simplesmente não consegue enviá-lo.
//
// `origem` é obrigatória de propósito — define a alíquota de imposto (ADR-0055) e a edge
// recusa a chamada sem ela em vez de assumir 'nacional'.
//
// Os códigos (do PAI e das variações) são gerados pela edge — não existem campos de código
// aqui. `chaveCadastro` é a chave de idempotência da submissão (ver dialog-cadastro-produto.tsx).

export interface VariacaoEntrada {
  nome?: string | null;
  /** ADR-0166: tamanho (roupa) ou numeração (calçado). Ausente/null = variação sem esse eixo,
   *  que é o caso de toda org sem tipo de produto habilitado. */
  tamanho?: string | null;
  gtin?: string | null;
  preco: number;
  custo?: number | null;
  estoqueInicial?: number | null;
  /** ADR-0181 (emenda 2026-10-17): peças da nota sugeridas para o SKU — só com origemNota + refNota. */
  quantidadeNota?: number | null;
  pesoGramas?: number | null;
  alturaCm?: number | null;
  larguraCm?: number | null;
  comprimentoCm?: number | null;
}

// ADR-0135: só enviado quando a org tem o módulo fiscal habilitado — espelho de
// FiscalEntrada em supabase/functions/_shared/produto/validar.ts.
export interface FiscalEntrada {
  ncm: string;
  cest?: string | null;
  origemNfe: number;
  fci?: string | null;
  exTipi?: string | null;
  tributacaoIcms: string;
  /** ADR-0181 D-5: texto da nota de venda (≤ 120 após trim). Ausente/null/vazio = nome do produto. */
  descricaoFiscal?: string | null;
}

import type { Genero, GradeTamanho } from '@/lib/tamanhos';

export interface ProdutoEntrada {
  nomePai: string;
  descricaoPai?: string | null;
  unidade?: string | null;
  fornecedor?: string | null;
  origem: 'nacional' | 'importado';
  /** ADR-0166: gênero da peça. Ausente/null = não informado. O ML exige que o gênero do anúncio
   *  bata com o da tabela de medidas, então valor inválido FALHA em vez de virar default. */
  genero?: Genero | null;
  /** ADR-0182: grade escolhida (Letras/Infantil/Calça/Calçado). Ausente/null = legado. */
  gradeTamanho?: GradeTamanho | null;
  // Idempotência da submissão: o mesmo uuid reenviado devolve o cadastro original em vez de
  // criar um segundo produto. Só troca quando o diálogo fecha ou após sucesso confirmado —
  // nunca a cada tentativa (ver dialog-cadastro-produto.tsx).
  chaveCadastro: string;
  variacoes: VariacaoEntrada[];
  fiscal?: FiscalEntrada;
  /** ADR-0181 D-4: cadastro a partir da nota de compra — nunca leva estoque inicial (o saldo
   *  entra pela nota; a edge recusa `estoqueInicial > 0` junto com esta flag). */
  origemNota?: boolean;
  /** ADR-0181: `nfe:{chave}:{nItem}` — só com `origemNota`; a edge grava na família e a importação retoma por ela. */
  refNota?: string;
  /** ADR-0181 (emenda 2026-10-17): fator do item usado no cadastro (inteiro ≥ 1); vai junto de `quantidadeNota`. */
  fatorNota?: number;
}
