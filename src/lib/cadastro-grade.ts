// Spec 2026-09-19 (cadastro em grade) §2. Funções PURAS: toda a decisão de qual combinação entra
// ou sai da grade mora aqui, fora do componente, para ser testada sem montar React.
//
// Substitui `gerarCombinacoes`/`contarCombinacoes` (src/lib/tamanhos.ts): na grade, ao contrário
// do cadastro normal, cor E tamanho são obrigatórios — uma linha sem um dos eixos não existe.

/** Chave canônica de uma célula. `\u0000` porque nem cor nem tamanho podem contê-lo: um
 *  separador visível ("|") colidiria com uma cor personalizada digitada com ele. */
export function chaveGrade(cor: string, tamanho: string): string {
  return `${cor}\u0000${tamanho}`;
}

export interface Combinacao { cor: string; tamanho: string }

export interface Reconciliacao {
  /** Combinações a ACRESCENTAR às linhas atuais (nunca as que já existem). */
  novas: Combinacao[];
  /** Chaves das linhas atuais que saíram da seleção e devem ser removidas. */
  remover: string[];
  /** `removidas` já podado: exclusão cujo eixo foi desmarcado deixa de valer. */
  removidas: Set<string>;
  /** Ordem canônica (cor externa, tamanho interno) da grade válida — o dialog ordena por ela
   *  para a lista não embaralhar conforme o operador marca e desmarca. */
  ordem: string[];
  /** Cartesiano menos as exclusões manuais ainda válidas. */
  total: number;
}

/** Exclusões manuais cujos DOIS eixos continuam marcados. Desmarcar um eixo inteiro já é a ação
 *  de "não quero esse eixo"; remarcar é "quero de novo, por completo" — manter a exclusão de
 *  célula viva através desse ciclo não seria continuidade da mesma decisão. */
function podar(
  cores: readonly string[], tamanhos: readonly string[], removidas: ReadonlySet<string>,
): Set<string> {
  const validas = new Set<string>();
  for (const cor of cores) {
    for (const tamanho of tamanhos) {
      const k = chaveGrade(cor, tamanho);
      if (removidas.has(k)) validas.add(k);
    }
  }
  return validas;
}

export function totalDaGrade(
  cores: readonly string[], tamanhos: readonly string[], removidas: ReadonlySet<string>,
): number {
  if (cores.length === 0 || tamanhos.length === 0) return 0;
  return cores.length * tamanhos.length - podar(cores, tamanhos, removidas).size;
}

export function reconciliarGrade(
  cores: readonly string[],
  tamanhos: readonly string[],
  removidas: ReadonlySet<string>,
  linhasAtuais: readonly { cor: string; tamanho: string }[],
): Reconciliacao {
  const podadas = podar(cores, tamanhos, removidas);
  const ordem: string[] = [];
  const novas: Combinacao[] = [];
  const existentes = new Set(linhasAtuais.map((l) => chaveGrade(l.cor, l.tamanho)));
  const validas = new Set<string>();

  for (const cor of cores) {
    for (const tamanho of tamanhos) {
      const k = chaveGrade(cor, tamanho);
      if (podadas.has(k)) continue;
      ordem.push(k);
      validas.add(k);
      if (!existentes.has(k)) novas.push({ cor, tamanho });
    }
  }

  const remover = linhasAtuais
    .map((l) => chaveGrade(l.cor, l.tamanho))
    .filter((k) => !validas.has(k));

  return { novas, remover, removidas: podadas, ordem, total: ordem.length };
}
