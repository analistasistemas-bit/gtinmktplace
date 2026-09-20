// Spec 2026-09-19 (cadastro em grade) §2. Funções PURAS: toda a decisão de qual combinação entra
// ou sai da grade mora aqui, fora do componente, para ser testada sem montar React.
//
// Substitui `gerarCombinacoes`/`contarCombinacoes` (src/lib/tamanhos.ts): na grade, ao contrário
// do cadastro normal, cor E tamanho são obrigatórios — uma linha sem um dos eixos não existe.

import { parseNumeroPtBr } from '@/lib/formato';

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

/** Ordem canônica do eixo tamanho. Vem por PARÂMETRO porque `src/lib` não importa de
 *  `src/components` — os tamanhos vêm de `opcoesDeTamanho`, que depende do tipo habilitado na
 *  org. O campo `cores` permanece na assinatura por compatibilidade; `ordenarEixos` ordena cores
 *  alfabeticamente (pt-BR), não por `CORES_POPULARES`. */
export interface OrdemCanonica { cores: readonly string[]; tamanhos: readonly string[] }

function porOrdem(valores: ReadonlySet<string>, canonica: readonly string[]): string[] {
  // Duas passadas, não um `sort` com `indexOf`: o que NÃO está na lista canônica precisa manter a
  // ordem de inserção do `Set` (é a ordem em que o operador digitou a cor personalizada), e um
  // comparador com `-1` para ausentes embaralharia justamente esse grupo.
  const naLista = canonica.filter((v) => valores.has(v));
  const fora = [...valores].filter((v) => !canonica.includes(v));
  return [...naLista, ...fora];
}

/** Ordena os dois eixos da grade. Cores: A→Z (pt-BR), independente de clique ou lista popular.
 *  Tamanhos: ordem canônica (`ordemCanonica.tamanhos`) — P/M/G e numeração de calçado. Corrige
 *  bug latente em tamanhos: `[...tamanhos]` preserva ordem de clique (G antes de P). Aplicada
 *  ANTES de `reconciliarGrade`, fixa a ordem de `linhas` e dos códigos de SKU. */
export function ordenarEixos(
  cores: ReadonlySet<string>,
  tamanhos: ReadonlySet<string>,
  ordemCanonica: OrdemCanonica,
): { cores: string[]; tamanhos: string[] } {
  return {
    cores: [...cores].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    tamanhos: porOrdem(tamanhos, ordemCanonica.tamanhos),
  };
}

export interface TotaisGrade {
  /** Unidades de estoque por cor. Toda cor do eixo aparece, inclusive com 0. */
  porCor: Record<string, number>;
  porTamanho: Record<string, number>;
  geral: number;
  /** SKUs com GTIN em branco. Alimenta o resumo do topo — é o que trava a publicação depois. */
  semGtin: number;
}

/** Totais da matriz. SEMPRE unidades de estoque, qualquer que seja o modo de edição ativo na
 *  tela: não existe "total de preço". Os eixos vêm por parâmetro (e não derivados de
 *  `resolvidas`) para que uma cor/tamanho cujas células foram todas removidas na mão ainda
 *  apareça com 0 — a matriz continua exibindo a linha/coluna. */
export function totaisDaGrade(
  resolvidas: readonly LinhaResolvida[],
  cores: readonly string[],
  tamanhos: readonly string[],
): TotaisGrade {
  const porCor: Record<string, number> = {};
  const porTamanho: Record<string, number> = {};
  for (const c of cores) porCor[c] = 0;
  for (const t of tamanhos) porTamanho[t] = 0;

  let geral = 0;
  let semGtin = 0;
  for (const r of resolvidas) {
    // `|| 0` cobre os DOIS retornos não-numéricos de `parseNumeroPtBr`: `null` (vazio) e `NaN`
    // (texto inválido) — ambos são falsy. Um NaN escapando aqui transforma o rodapé inteiro em
    // "NaN unidades" por causa de UMA célula.
    const unidades = parseNumeroPtBr(r.estoqueInicial) || 0;
    if (r.cor in porCor) porCor[r.cor]! += unidades;
    if (r.tamanho in porTamanho) porTamanho[r.tamanho]! += unidades;
    geral += unidades;
    if (r.gtin.trim() === '') semGtin += 1;
  }
  return { porCor, porTamanho, geral, semGtin };
}

export type CampoMassa = 'estoqueInicial' | 'gtin' | CampoHerdavel;

export type EscopoMassa =
  | { tipo: 'todos' }
  | { tipo: 'cor'; valor: string }
  | { tipo: 'tamanho'; valor: string };

export interface OpcoesMassa {
  campo: CampoMassa;
  escopo: EscopoMassa;
  /** `null` em campo herdável = REMOVE o override (volta a herdar). `null` em estoque/GTIN =
   *  limpa para `''` (não existe "herdar estoque"). Nunca significa "gerar valor". */
  valor: string | null;
}

function noEscopo(linha: LinhaGrade, escopo: EscopoMassa): boolean {
  if (escopo.tipo === 'todos') return true;
  if (escopo.tipo === 'cor') return linha.cor === escopo.valor;
  return linha.tamanho === escopo.valor;
}

/** Preenchimento em massa. É um `map` e NADA MAIS: não filtra, não concatena, não ordena. A
 *  contagem e a ordem de `linhas` são o casamento posicional com `resolvidas` — mexer nelas aqui
 *  reintroduz o desalinho do bug f4a6df68 por um caminho que nenhum teste de UI pegaria.
 *
 *  NUNCA gera GTIN: o único valor escrito é o que veio em `opts.valor`. */
export function aplicarEmMassa(
  linhas: readonly LinhaGrade[],
  opts: OpcoesMassa,
): LinhaGrade[] {
  const herdavel = (CAMPOS_HERDAVEIS as readonly string[]).includes(opts.campo);
  return linhas.map((linha) => {
    if (!noEscopo(linha, opts.escopo)) return linha;
    if (!herdavel) {
      // Estoque e GTIN moram na linha crua; `null` aqui é "limpar", não "voltar a herdar".
      return { ...linha, [opts.campo]: opts.valor ?? '' };
    }
    const campo = opts.campo as CampoHerdavel;
    if (opts.valor === null) {
      // Remover a CHAVE, não gravar undefined: `resolverLinha` decide por `campo in overrides`.
      const { [campo]: _removido, ...resto } = linha.overrides;
      return { ...linha, overrides: resto };
    }
    return { ...linha, overrides: { ...linha.overrides, [campo]: opts.valor } };
  });
}
