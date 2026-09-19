// ADR-0166: tipo de produto habilitado por organizacao (roupa / calcado), COMBINAVEL.
// Espelha o formato de src/lib/modulos.ts, mas e um conceito separado e por isso vive em arquivo
// e em card proprios: modulo e funcionalidade PAGA que liga uma tela (ADR-0047 / ADR-0155);
// tipo de produto nao e cobrado e muda a ESTRUTURA do cadastro (o SKU vira cor x tamanho).
//
// R7 da revisao do Fable: os IDS NAO SAO REDIGITADOS aqui — vem da fonte unica
// `supabase/functions/_shared/produto/tipos-produto-valores.ts` (modulo folha sem imports, que o
// Vite resolve; mesmo precedente de src/lib/custos.ts). Este arquivo so acrescenta rotulo e
// descricao, que sao de UI e nao existem no backend.
//
// INVARIANTE: org sem nenhum tipo marcado opera exatamente como hoje (so Cor como eixo).
import {
  TIPOS_PRODUTO_VALIDOS, type TipoProduto,
} from '../../supabase/functions/_shared/produto/tipos-produto-valores';

export type TipoProdutoId = TipoProduto;

export interface TipoProdutoUI {
  id: TipoProdutoId;
  nome: string;
  descricao: string;
}

// Um rotulo por id da fonte unica. Se alguem acrescentar um tipo la e esquecer aqui, o
// TypeScript acusa (Record com chave exaustiva), em vez de a tela simplesmente nao mostrar.
const ROTULOS: Record<TipoProdutoId, Omit<TipoProdutoUI, 'id'>> = {
  roupa: {
    nome: 'Roupa',
    descricao: 'O cadastro ganha Tamanho (P, M, G, GG, Tamanho Único) como segundo eixo, além da cor.',
  },
  calcado: {
    nome: 'Calçado',
    descricao: 'O cadastro ganha Numeração como segundo eixo, além da cor.',
  },
};

export const TIPOS_PRODUTO: TipoProdutoUI[] = TIPOS_PRODUTO_VALIDOS.map(
  (id) => ({ id, ...ROTULOS[id] }),
);
