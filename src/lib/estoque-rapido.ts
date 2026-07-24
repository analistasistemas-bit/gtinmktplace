import { familiaPublicavel, casadaNoMl } from './publicavel';
import type { Familia, FamiliaStatus, LoteStatus, Variacao } from './tipos-dominio';

// familiaPublicavel só reprova cor nova INCOMPLETA (sem foto/cor/preço) — uma cor nova
// COMPLETA passa em familiaPublicavel().ok mesmo nunca tendo ido ao ML. Publicá-la
// criaria uma variação nova de verdade, o que o atalho de 1-clique nunca pode fazer
// (ADR-0089: "todas as cores já casadas com o ML"). Por isso, além de familiaPublicavel,
// exigimos que NENHUMA variação incluída seja nova — só cores já casadas (ou dormentes/
// excluídas) entram.
function temCorNovaIncluida(f: Familia): boolean {
  return f.variacoes.some((v) => !v.excluidaDaPublicacao && !casadaNoMl(v));
}

// ADR-0089: famílias elegíveis pro atalho de 1-clique de "Atualização rápida de
// estoque". Reaproveita o critério que já libera o "Selecionar todos" manual da Revisão
// (familiaPublicavel) e adiciona o guard acima contra cor nova completa. CREATE nunca
// entra, mesmo tecnicamente pronto — atalho é só para reposição de estoque de anúncio
// já publicado, nunca para criar conteúdo novo no ML.
export function familiasElegiveisEstoqueRapido(familias: Familia[]): Familia[] {
  return familias.filter(
    (f) => f.operacao === 'UPDATE' && familiaPublicavel(f).ok && !temCorNovaIncluida(f),
  );
}

// ADR-0089 (achado da revisão code-review-fable5 v1): decide se o gate de 1-clique
// aparece em Progresso.tsx. Extraída como função pura porque a primeira versão dessa
// condição (exigir 100% das famílias 'pronto') tinha um bug real — escondia o gate
// sempre que qualquer família do lote estivesse em 'erro', mesmo com dezenas de
// famílias UPDATE já elegíveis. "Terminou de processar" espelha a mesma condição do
// trigger de banco que move o lote pra 'revisao' (nenhuma família pendente/
// processando) — não exige zero erros.
export function deveExibirGateEstoqueRapido(params: {
  loteStatus: LoteStatus;
  familias: { status: FamiliaStatus }[];
  elegiveis: Familia[];
}): boolean {
  const aindaProcessando = params.familias.some(
    (f) => f.status === 'pendente' || f.status === 'processando',
  );
  return (
    (params.loteStatus === 'revisao' || params.loteStatus === 'processando') &&
    !aindaProcessando &&
    params.elegiveis.length > 0
  );
}

export interface VariacaoZerada {
  familiaId: string;
  codigoPai: string;
  titulo: string;
  codigo: string;
  cor: string;
}

export interface FamiliaTotalmenteZerada {
  familiaId: string;
  codigoPai: string;
  titulo: string;
}

export interface RelatorioZerados {
  variacoes: VariacaoZerada[];
  familias: FamiliaTotalmenteZerada[];
}

// Zerou NESTA rodada = tinha estoque > 0 antes e virou 0 agora. Cor nova
// (estoqueAnterior null) nunca conta: nunca teve estoque "antes" de fato.
function zerouNestaRodada(v: Variacao): boolean {
  return v.estoqueAnterior != null && v.estoqueAnterior > 0 && v.estoque === 0;
}

// ADR-0089: relatório pós-publicação (rápida ou manual) — variações que zeraram nesta
// rodada + famílias em que TODAS as variações incluídas ficaram com estoque 0 (anúncio
// sem nada vendável). Puramente informativo: não pausa nada automaticamente no ML.
export function calcularZerados(familias: Familia[]): RelatorioZerados {
  const variacoes: VariacaoZerada[] = [];
  const familiasZeradas: FamiliaTotalmenteZerada[] = [];
  // Só UPDATE: o relatório é sobre reposição de estoque; CREATE não é "estoque que
  // zerou numa reposição" (N3).
  for (const f of familias.filter((f) => f.operacao === 'UPDATE')) {
    const incluidas = f.variacoes.filter((v) => !v.excluidaDaPublicacao);
    for (const v of incluidas) {
      if (zerouNestaRodada(v)) {
        variacoes.push({ familiaId: f.id, codigoPai: f.codigoPai, titulo: f.titulo, codigo: v.codigo, cor: v.cor });
      }
    }
    if (incluidas.length > 0 && incluidas.every((v) => v.estoque === 0)) {
      familiasZeradas.push({ familiaId: f.id, codigoPai: f.codigoPai, titulo: f.titulo });
    }
  }
  return { variacoes, familias: familiasZeradas };
}
