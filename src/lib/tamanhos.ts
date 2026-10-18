// ADR-0166: listas fixas de Tamanho (roupa) e Numeração (calçado), o teto de linhas geradas
// numa grade e o aviso de numeração sem guia de tamanhos no ML — consumidos pela tela dedicada
// de cadastro em grade (`dialog-cadastro-grade.tsx`). O produto cartesiano cor × tamanho em si
// mora em `src/lib/cadastro-grade.ts` (`totalDaGrade`/`reconciliarGrade`); o botão "Gerar
// variações" do cadastro manual que costumava viver aqui foi removido (amendment do ADR-0166).
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
  TAMANHOS_ROUPA, TAMANHOS_INFANTIL, TAMANHOS_CALCA, NUMERACOES_CALCADO, classificarFamilia,
  tipoDaGrade, tamanhosDoTipo, tamanhosDaGrade, gradeDaFamilia, generosDaGrade,
  GRADES_DO_TIPO, GRADES_VALIDAS, GENEROS_ADULTO, GENEROS_INFANTIL, GENEROS_VALIDOS,
  numeracaoPublicavel as numeracaoPublicavelNoMl,
  type GradeTamanho, type Genero,
} from '../../supabase/functions/_shared/produto/tipos-produto-valores';

// Ruling R1 (2026-09-24): a regra "é grade", o tipo inferido e a publicabilidade da numeração
// vivem em `_shared` — a edge `adicionar-variacoes-familia` e o dialog decidem com a MESMA função.
export {
  TAMANHOS_ROUPA, TAMANHOS_INFANTIL, TAMANHOS_CALCA, NUMERACOES_CALCADO, classificarFamilia,
  tipoDaGrade, tamanhosDoTipo, tamanhosDaGrade, gradeDaFamilia, generosDaGrade,
  GRADES_DO_TIPO, GRADES_VALIDAS, GENEROS_ADULTO, GENEROS_INFANTIL, GENEROS_VALIDOS,
};
export type { GradeTamanho, Genero };

// ADR-0182: rótulos de UI das grades e dos gêneros (o backend só conhece os ids).
export const ROTULO_GRADE: Record<GradeTamanho, string> = {
  letras: 'Letras (P–GGG)', infantil: 'Infantil (2–16)', calca: 'Calça (34–48)', calcado: 'Numeração',
};
export const ROTULO_GENERO: Record<Genero, string> = {
  masculino: 'Masculino', feminino: 'Feminino', unissex: 'Unissex',
  meninos: 'Meninos', meninas: 'Meninas', sem_genero_infantil: 'Sem gênero infantil',
};

export interface GrupoTamanho { grupo: string; valores: readonly string[] }

/** Grupo oferecido ao operador para a grade da família. `null` = nenhum grupo = o campo
 *  Tamanho não é renderizado (INV-1). Calçado chama-se "Numeração"; as demais, "Tamanho". */
export function opcoesDeTamanho(grade: GradeTamanho | null): GrupoTamanho[] {
  if (!grade) return [];
  return [{ grupo: grade === 'calcado' ? 'Numeração' : 'Tamanho', valores: tamanhosDaGrade(grade) }];
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
 *  O resto da regra é o de `_shared/produto/tipos-produto-valores.ts` (fonte única). */
export function numeracaoPublicavel(
  numeracao: string,
  genero: Genero | '',
): boolean {
  return !genero || numeracaoPublicavelNoMl(numeracao, genero);
}
