// ADR-0181 D-5/D-10 — pré-preenchimento do cadastro de produto novo a partir do item da nota.
// Tudo aqui é SUGESTÃO com selo + "Conferi" obrigatório: o CSOSN do fornecedor nunca é copiado
// (só 500 / padrão da empresa / vazio, por `icms-entrada.ts`) e não existe estoque inicial — o
// saldo entra pela nota (D-4).
import {
  custoAquisicaoUnit, limparDescricaoFornecedor, origemSugerida, quantidadeEmEstoque,
} from '../../../../supabase/functions/_shared/nfe/regras.ts';
import { classificarIcmsEntrada, csosnSaidaSugerido } from '../../../../supabase/functions/_shared/nfe/icms-entrada.ts';
import type { ItemConciliado, NotaCompraLida } from '../../../../supabase/functions/_shared/nfe/tipos.ts';
import type { AvisosFiscaisNota, CadastroInicial } from '@/components/estoque/dialog-cadastro-produto';
import { UNIDADES_FISCAIS } from '@/lib/fiscal';

const EMBALAGENS = new Set(['CX', 'PCT', 'KIT', 'SC']);

const ORIGENS_COM_FCI = [3, 5, 8];

export function prefillCadastro(
  item: ItemConciliado, nota: NotaCompraLida, fator: number,
  ctx: { csosnPadrao: string | null; ufEmpresa: string | null },
): CadastroInicial {
  const texto = limparDescricaoFornecedor(item.xProd);
  const custo = Math.round(custoAquisicaoUnit(item, fator) * 100) / 100;
  const origem = origemSugerida(item.orig);
  const classe = classificarIcmsEntrada(item);
  const csosn = csosnSaidaSugerido(classe, ctx.csosnPadrao);
  const avisosNota: AvisosFiscaisNota = {
    classe,
    codigoFornecedor: item.csosn ?? item.cstIcms,
    interestadual: !!nota.emitenteUf && !!ctx.ufEmpresa && nota.emitenteUf !== ctx.ufEmpresa.trim().toUpperCase(),
    semPadrao: classe === 'sem_st' && csosn === null,
  };
  // Só unidade de item avulso. Embalagem (CX/PCT/KIT/SC) costuma virar fator > 1 depois do cadastro — e a
  // unidade gravada não acompanha o fator —, então fica no default UN. Fator ≠ 1 idem (CX de 12 → UN).
  const ucom = item.uCom.trim().toUpperCase();
  const avulsa = (UNIDADES_FISCAIS as readonly string[]).includes(ucom) && !EMBALAGENS.has(ucom);
  const unidade = fator === 1 && avulsa ? ucom : undefined;
  // Emenda 2026-10-17: Q e fator para a aba "Quantidade da nota" (sugestão, nunca estoque — D-4).
  const fatorOk = Number.isInteger(fator) && fator >= 1;
  const q = fatorOk ? quantidadeEmEstoque(item.qCom, fator) : null;
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
      tributacaoIcms: csosn ?? '',
      ...(item.cest ? { cest: item.cest } : {}),
      ...(origem && ORIGENS_COM_FCI.includes(origem.origemNfe) && item.nFci ? { fci: item.nFci } : {}),
    },
    avisosNota,
    ...(origem ? { origemSugerida: origem.origem } : {}),
    sugestaoDaNota: true,
    refNota: `nfe:${nota.chave}:${item.nItem}`,
    ...(fatorOk ? { fatorNota: fator } : {}),
    ...(q?.ok ? { quantidadeNota: q.quantidade } : {}),
  };
}
