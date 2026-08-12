import { aplicarGuardsTitulo, normalizarSlots, validarSlotsAncorados, type DadosFonteTitulo } from './titulo-guards.ts';
import { montarTituloDetalhado } from './titulo-montar.ts';
import { ORDEM_LEITURA, type SlotTitulo, type TituloSlots } from './titulo-slots.ts';
import { ehCorIndefinida } from '../cor/indefinida.ts';

export type { DadosFonteTitulo };

/** Etapa do pipeline que alterou ou removeu o valor de um slot. */
export type EtapaTitulo = 'normalizacao' | 'guards' | 'ancoragem' | 'corte';

export interface DescarteTitulo {
  slot: SlotTitulo;
  etapa: EtapaTitulo;
  de: string;
  /** `''` significa descarte total; qualquer outro valor é reescrita. */
  para: string;
}

export interface TituloDiagnosticado {
  titulo: string;
  descartes: DescarteTitulo[];
}

function diff(antes: TituloSlots, depois: TituloSlots, etapa: EtapaTitulo): DescarteTitulo[] {
  const out: DescarteTitulo[] = [];
  for (const slot of ORDEM_LEITURA) {
    const de = antes[slot] ?? '';
    const para = depois[slot] ?? '';
    if (de !== para) out.push({ slot, etapa, de, para });
  }
  return out;
}

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
  return diagnosticarTitulo(slotsIa, fonte).titulo;
}

/**
 * O mesmo pipeline, devolvendo também o que cada etapa alterou ou removeu (ADR-0116).
 *
 * Existe porque ninguém sabia o que o pipeline descarta em produção. `validarSlotsAncorados`
 * derruba marca, sinônimo e marketing; `montarTitulo` corta slots inteiros ao estourar 60 chars —
 * tudo em silêncio. Sem esse registro, qualquer discussão sobre prioridade de termos ou sobre
 * endurecer um guard é opinião: não há como responder "quantos títulos isto afetaria?".
 *
 * É diagnóstico, não controle de fluxo: nenhuma decisão do pipeline depende do que sai daqui.
 * Registrar reescrita além de remoção é deliberado — `para: ''` é descarte total, `para` com
 * outro valor é reescrita, e distinguir os dois é justamente o que se quer medir.
 */
export function diagnosticarTitulo(slotsIa: TituloSlots, fonte: DadosFonteTitulo): TituloDiagnosticado {
  const slots = normalizarSlots(slotsIa);
  const garantidos = aplicarGuardsTitulo(slots, fonte);
  const validados = validarSlotsAncorados(garantidos, fonte);
  const descartes = [
    ...diff(slotsIa, slots, 'normalizacao'),
    ...diff(slots, garantidos, 'guards'),
    ...diff(garantidos, validados, 'ancoragem'),
  ];
  // `variacao` discrimina quando a família é mono-cor: a planilha separou as cores em PAI
  // distintos, então a cor é o que diferencia esta família das irmãs (ADR-0044).
  // Cor indefinida não discrimina nada — não faz sentido protegê-la do corte.
  const corUnica = fonte.cores.length === 1 ? fonte.cores[0] : null;
  const corDiscrimina = !!corUnica && !ehCorIndefinida(corUnica);
  // CRITICAL-2: sem cor nenhuma (cores.length === 0), aplicarGuardsTitulo deixa `variacao`
  // intocada — o que sobrou ali (tamanho, espessura) é o discriminador da família perante as
  // irmãs, mesma FUNÇÃO que a cor cumpre quando existe (ADR-0099: a regra é sobre função, não
  // sobre tipo). Sem esta proteção o corte de 60 chars podia derrubá-la como qualquer slot comum.
  const semCorMasComVariacao = fonte.cores.length === 0 && !!validados.variacao.trim();
  const montado = montarTituloDetalhado(validados, {
    variacaoDiscrimina: corDiscrimina || semCorMasComVariacao,
  });

  // O corte não reescreve slot nenhum — remove o slot inteiro. Por isso é comparado por
  // PRESENÇA, e não pelo diff de valores usado nas três etapas acima.
  const sobreviveu = new Set(montado.presentes);
  for (const slot of ORDEM_LEITURA) {
    const de = validados[slot]?.trim();
    if (de && !sobreviveu.has(slot)) descartes.push({ slot, etapa: 'corte', de, para: '' });
  }

  return { titulo: montado.titulo, descartes };
}
