// ADR-0166: listas fixas de Tamanho (roupa) e Numeração (calçado), e o produto cartesiano
// cor × tamanho que alimenta o botão "Gerar variações" do cadastro manual.
//
// São listas de PICK, nunca texto livre: o ML normaliza valor de atributo (o mesmo que já
// acontece com COLOR, onde `Rosa Claro` vira `Rosa-claro` na publicação), e texto livre aqui
// produziria uma linha de tabela de medidas por digitação divergente.
//
// NÃO confundir com `TAMANHOS_KIT` (src/lib/kit.ts), que é quantidade de unidades dentro de um
// Kit vinculado (2 a 6) e não tem relação nenhuma com tamanho de peça.
//
// R7 da revisão do Fable: as LISTAS vêm da fonte única do backend e são só reexportadas aqui.
// Antes elas só existiam no frontend — e por isso a edge não tinha como recusar um valor de
// tamanho fora da lista do tipo da org. Este arquivo guarda apenas o que é de UI.
import {
  TAMANHOS_ROUPA, NUMERACOES_CALCADO,
} from '../../supabase/functions/_shared/produto/tipos-produto-valores';
import { COMPRIMENTO_PE_CM } from '../../supabase/functions/_shared/ml/medidas-valores';

export { TAMANHOS_ROUPA, NUMERACOES_CALCADO };

export interface GrupoTamanho { grupo: string; valores: readonly string[] }

/** Grupos oferecidos ao operador, conforme os tipos habilitados na org.
 *  Lista vazia = nenhum grupo = o campo Tamanho não é renderizado (INV-1). */
export function opcoesDeTamanho(tipos: readonly string[]): GrupoTamanho[] {
  const grupos: GrupoTamanho[] = [];
  if (tipos.includes('roupa')) grupos.push({ grupo: 'Tamanho', valores: TAMANHOS_ROUPA });
  if (tipos.includes('calcado')) grupos.push({ grupo: 'Numeração', valores: NUMERACOES_CALCADO });
  return grupos;
}

/** Teto de linhas geradas de uma vez numa grade (`totalDaGrade`). `proximo_codigo_produto`
 *  reserva `variacoes.length + 1` códigos de oito dígitos (D-5 do ADR-0094) e o cartesiano
 *  estoura rápido; além disso o ML tem limite de variações por anúncio. Falha LOUD e acionável
 *  em vez de truncar em silêncio ou deixar o operador descobrir na edge. */
export const LIMITE_VARIACOES_GERADAS = 60;

/** `false` = a numeração cadastra normal, mas hoje NÃO tem guia de tamanhos possível no ML para
 *  esse gênero (pares de meio-número; 45/46 no feminino). Serve ao aviso inline do cadastro em
 *  grade — nunca bloqueia a seleção: o cadastro pode existir só para controle de estoque.
 *
 *  Sem gênero escolhido devolve `true`: não dá para afirmar impossibilidade antes de saber a
 *  tabela, e um aviso que some assim que o operador preenche o campo acima só assusta.
 *  Unissex reaproveita a tabela masculina (Spike 051 §13 — o ML não publica STANDARD "Sem
 *  gênero"), exatamente como `tabelaComprimentoPe` faz em `_shared/ml/size-chart.ts`. */
export function numeracaoPublicavel(
  numeracao: string,
  genero: 'masculino' | 'feminino' | 'unissex' | '',
): boolean {
  if (!genero) return true;
  if (!(NUMERACOES_CALCADO as readonly string[]).includes(numeracao)) return true;
  const tabela = genero === 'feminino' ? COMPRIMENTO_PE_CM.feminino : COMPRIMENTO_PE_CM.masculino;
  return numeracao in tabela;
}
