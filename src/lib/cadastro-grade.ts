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

/** Os 6 campos que o cabeçalho preenche uma vez e a linha herda. GTIN e Estoque ficam de fora
 *  de propósito: não existe "GTIN único" nem "estoque único" numa grade. */
export const CAMPOS_HERDAVEIS = [
  'preco', 'custo', 'pesoGramas', 'alturaCm', 'larguraCm', 'comprimentoCm',
] as const;

export type CampoHerdavel = typeof CAMPOS_HERDAVEIS[number];
export type CamposHerdaveis = Record<CampoHerdavel, string>;

export interface LinhaGrade {
  /** Identidade estável da linha (mesma razão de `LinhaVariacao.clientId`: `key` por índice +
   *  input de arquivo faz a foto escolhida "andar" para outra linha ao remover uma). */
  clientId: string;
  /** Travados depois de gerados: editá-los desalinharia a chave que a reconciliação usa. */
  cor: string;
  tamanho: string;
  gtin: string;
  estoqueInicial: string;
  /** SÓ o que o operador de fato destravou e editou. Nunca uma cópia do valor herdado. */
  overrides: Partial<CamposHerdaveis>;
  /** `undefined` = herda a foto da cor. `File`/`null` = a linha tem foto própria (inclusive a
   *  decisão explícita de "esta linha não tem foto"). */
  foto?: File | null;
}

export interface LinhaResolvida extends CamposHerdaveis {
  clientId: string; cor: string; tamanho: string; gtin: string; estoqueInicial: string;
  foto: File | null;
}

export function novaLinhaGrade(cor: string, tamanho: string): LinhaGrade {
  return { clientId: crypto.randomUUID(), cor, tamanho, gtin: '', estoqueInicial: '', overrides: {} };
}

/** Valor efetivo de cada campo da linha. Usada por TODO consumidor (montar payload, gate de
 *  salvar, resolução da foto para o upload) — se algum deles resolver por conta própria, a
 *  herança diverge entre o que a tela mostra e o que é gravado. */
export function resolverLinha(
  cabecalho: CamposHerdaveis,
  fotoPorCor: Readonly<Record<string, File | null>>,
  linha: LinhaGrade,
): LinhaResolvida {
  const campos = {} as CamposHerdaveis;
  for (const campo of CAMPOS_HERDAVEIS) {
    // `in`, não `??`: override de string vazia é decisão do operador, não "ainda não mexi".
    campos[campo] = campo in linha.overrides ? linha.overrides[campo]! : cabecalho[campo];
  }
  return {
    ...campos,
    clientId: linha.clientId,
    cor: linha.cor,
    tamanho: linha.tamanho,
    gtin: linha.gtin,
    estoqueInicial: linha.estoqueInicial,
    foto: 'foto' in linha ? linha.foto ?? null : fotoPorCor[linha.cor] ?? null,
  };
}
