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
}

export interface ProdutoEntrada {
  nomePai: string;
  descricaoPai?: string | null;
  unidade?: string | null;
  fornecedor?: string | null;
  origem: 'nacional' | 'importado';
  /** ADR-0166: gênero da peça. Ausente/null = não informado. O ML exige que o gênero do anúncio
   *  bata com o da tabela de medidas, então valor inválido FALHA em vez de virar default. */
  genero?: 'masculino' | 'feminino' | 'unissex' | null;
  // Idempotência da submissão: o mesmo uuid reenviado devolve o cadastro original em vez de
  // criar um segundo produto. Só troca quando o diálogo fecha ou após sucesso confirmado —
  // nunca a cada tentativa (ver dialog-cadastro-produto.tsx).
  chaveCadastro: string;
  variacoes: VariacaoEntrada[];
  fiscal?: FiscalEntrada;
}
