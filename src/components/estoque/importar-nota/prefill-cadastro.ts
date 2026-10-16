// ADR-0181 D-5/D-10 — pré-preenchimento do cadastro de produto novo a partir do item da nota.
// Tudo aqui é SUGESTÃO: a origem binária nunca é pré-escolhida (só `origemSugerida`, com selo),
// o CSOSN do fornecedor nunca é copiado (`tributacaoIcms: ''`) e não existe estoque inicial — o
// saldo entra pela nota (D-4).
import {
  custoAquisicaoUnit, limparDescricaoFornecedor, origemSugerida,
} from '../../../../supabase/functions/_shared/nfe/regras.ts';
import type { ItemConciliado, NotaCompraLida } from '../../../../supabase/functions/_shared/nfe/tipos.ts';
import type { CadastroInicial } from '@/components/estoque/dialog-cadastro-produto';
import { UNIDADES_FISCAIS } from '@/lib/fiscal';

export function prefillCadastro(item: ItemConciliado, nota: NotaCompraLida, fator: number): CadastroInicial {
  const texto = limparDescricaoFornecedor(item.xProd);
  const custo = Math.round(custoAquisicaoUnit(item, fator) * 100) / 100;
  const origem = origemSugerida(item.orig);
  // Com fator ≠ 1 a unidade do estoque não é a da nota (CX de 12 → UN). Fora das fiscais: default UN.
  const ucom = item.uCom.trim().toUpperCase();
  const unidade = fator === 1 && (UNIDADES_FISCAIS as readonly string[]).includes(ucom) ? ucom : undefined;
  return {
    nomePai: texto,
    descricaoFiscal: texto,
    fornecedor: nota.emitenteNome,
    ...(unidade ? { unidade } : {}),
    // O validador recusa custo <= 0 — melhor vazio do que um prefill que trava o cadastro.
    ...(custo > 0 ? { custo } : {}),
    fiscal: {
      ...(item.ncm ? { ncm: item.ncm } : {}),
      ...(origem ? { origemNfe: origem.origemNfe } : {}),
      tributacaoIcms: '',
    },
    ...(origem ? { origemSugerida: origem.origem } : {}),
    sugestaoDaNota: true,
  };
}
