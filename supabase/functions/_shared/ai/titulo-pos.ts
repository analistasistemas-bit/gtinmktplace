import { aplicarGuardsTitulo, normalizarSlots, validarSlotsAncorados, type DadosFonteTitulo } from './titulo-guards.ts';
import { montarTitulo } from './titulo-montar.ts';
import { type TituloSlots } from './titulo-slots.ts';

export type { DadosFonteTitulo };

/**
 * Todo o pós-processamento do título, num lugar só (ADR-0099).
 *
 * Antes disto, os três call sites (process-familia, regenerar-copy-familia, titulo-particao)
 * compunham os guards à mão e por isso divergiam: regenerar perdia garantirQuantidadeTitulo e
 * a partição perdia largura E quantidade — em silêncio. Mesmo defeito que posProcessarDescricao
 * já corrigiu do lado da descrição.
 *
 * A ORDEM É PARTE DA CORREÇÃO:
 *   1. normalizarSlots        — higieniza e canonicaliza
 *   2. aplicarGuardsTitulo    — crava o que a fonte garante
 *   3. validarSlotsAncorados  — derruba o que não tem respaldo
 *   4. montarTitulo           — ÚNICA montagem, ao final
 *
 * A montagem acontecer uma vez só, depois de todos os guards, é o ponto central do desenho.
 * Um guard que injetasse depois da montagem devolveria o sistema ao bug original: injeção e
 * corte disputando a mesma ponta do texto, com perda silenciosa do dado recém-injetado.
 *
 * Pode lançar TituloInviavelError — ver titulo-montar.ts. O call site DEVE traduzi-lo em
 * mensagem acionável ao operador.
 */
export function posProcessarTitulo(slotsIa: TituloSlots, fonte: DadosFonteTitulo): string {
  const slots = normalizarSlots(slotsIa);
  const garantidos = aplicarGuardsTitulo(slots, fonte);
  const validados = validarSlotsAncorados(garantidos, fonte);
  // `variacao` discrimina quando a família é mono-cor: a planilha separou as cores em PAI
  // distintos, então a cor é o que diferencia esta família das irmãs (ADR-0044).
  return montarTitulo(validados, { variacaoDiscrimina: fonte.cores.length === 1 });
}
