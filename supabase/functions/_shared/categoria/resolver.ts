import { detectarTipoAviamento, type TipoAviamento } from './detectar.ts';
import { categoriaParaTipo, rotuloParaTipo, tipoParaCategoria } from './atributos.ts';
import type { CategoriaCandidata } from '../ml/domain-discovery.ts';

// Resolução de categoria em camadas (ADR-0026 / E3). Primeira que vencer manda:
// override → preditor (domain_discovery) → desempate LLM (ambíguo) → manual.
// 'generico' (ADR-0058): só candidato genérico ("Outros") disponível — aplicado como
// fallback visível (badge de aviso no front + busca sempre disponível pra trocar), não
// mais um bloqueio. Distinto de 'manual' (verdadeiro impasse, nenhum candidato serve).
export type OrigemCategoria = 'regex' | 'preditor' | 'ia' | 'manual' | 'generico';

export interface InputCategoria {
  nome: string;
  descricao?: string;
  /** Substantivo do tipo de produto, grounded pelo copywriter (ADR-0054). Alimenta uma 2ª
   * busca ao preditor quando o nome bruto é ruído de SKU (ex.: "EUROROMA 4/6 CORES 600G"). */
  tipoProdutoBusca?: string;
}

export interface ResultadoCategoria {
  categoriaId: string | null;   // null → 'outro' (operador escolhe na Revisão)
  categoriaNome: string | null; // rótulo humano p/ a Revisão
  tipo: TipoAviamento;
  origem: OrigemCategoria;
}

export interface DepsResolver {
  preditor: (nome: string) => Promise<CategoriaCandidata[]>;
  /**
   * 3 estados (ADR-0054): string = category_id escolhido; null = abstenção DELIBERADA
   * ("nenhum candidato serve" — resolver trava em manual); undefined = falha TÉCNICA
   * (resolver cai no topo específico, comportamento resiliente de sempre).
   */
  llm?: (input: InputCategoria, candidatos: CategoriaCandidata[]) => Promise<string | null | undefined>;
}

// Nomes de categoria genéricos/catch-all que o Mercado Livre usa como bucket residual (ex.:
// "Outros" — validado via API real: MLB1371, MLB190440, MLB270264 são literalmente "Outros"
// em domínios distintos). Nunca vencem um candidato específico (ADR-0054, lote #50); sem
// nenhum específico, viram fallback visível em vez de bloqueio (ADR-0058).
const TERMOS_GENERICOS = ['outro', 'outros', 'outra', 'outras', 'diverso', 'diversos', 'diversa', 'diversas', 'geral', 'general', 'otro', 'otros'];

function ehCategoriaGenerica(nomeCategoria: string): boolean {
  const n = normalizarTexto(nomeCategoria);
  return TERMOS_GENERICOS.some((t) => n.includes(t));
}

/** Une candidatos de 2 buscas (bruta + limpa), dedup por categoriaId, bruta-primeiro (preserva
 * os casos que já classificam corretamente com o nome cru — regressão dos lotes 42-49). */
function mesclarCandidatos(a: CategoriaCandidata[], b: CategoriaCandidata[]): CategoriaCandidata[] {
  const vistos = new Set<string>();
  const out: CategoriaCandidata[] = [];
  for (const c of [...a, ...b]) {
    if (vistos.has(c.categoriaId)) continue;
    vistos.add(c.categoriaId);
    out.push(c);
  }
  return out;
}

// Pistas fortes de vertical: termos inequívocos no título (ferramenta elétrica)
// que o preditor do ML às vezes rankeia mal. Conservador: só corrige quando há
// um candidato compatível na lista do preditor — nunca injeta categoria fixa.
const PISTAS_FORTES: Array<{ termos: RegExp; candidato: RegExp }> = [
  {
    termos: /\b(furadeira|furadeiras|parafusadeira|parafusadeiras|martelete|marteletes)\b/,
    candidato: /\b(furadeira|furadeiras|parafusadeira|parafusadeiras|martelete|marteletes|drill|drills)\b/,
  },
];

function normalizarTexto(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ' ');
}

type VeredictoPista =
  | { tipo: 'escolhido'; candidato: CategoriaCandidata }
  | { tipo: 'sem-candidato' }
  | null;

// Avalia pistas fortes no título:
// - sem pista → null (segue fluxo normal do preditor/LLM);
// - pista + candidato compatível → 'escolhido' (corrige top-1 incompatível);
// - pista + nenhum candidato compatível → 'sem-candidato' (não confiar no topo).
function avaliarPistaForte(input: InputCategoria, candidatos: CategoriaCandidata[]): VeredictoPista {
  const texto = normalizarTexto(`${input.nome} ${input.descricao ?? ''}`);
  for (const pista of PISTAS_FORTES) {
    if (!pista.termos.test(texto)) continue;
    const escolhido = candidatos.find((c) =>
      pista.candidato.test(normalizarTexto(`${c.domainId} ${c.domainName} ${c.categoriaNome}`))
    );
    return escolhido ? { tipo: 'escolhido', candidato: escolhido } : { tipo: 'sem-candidato' };
  }
  return null;
}

/** Função pura (deps injetadas). Resiliente: preditor que lança vira [] → fallback manual. */
export async function resolverCategoria(input: InputCategoria, deps: DepsResolver): Promise<ResultadoCategoria> {
  // 1. Override determinístico por vertical (zero regressão nos aviamentos).
  const { tipo } = detectarTipoAviamento(input.nome);
  const catOverride = categoriaParaTipo(tipo);
  if (catOverride) {
    return { categoriaId: catOverride, categoriaNome: rotuloParaTipo(tipo), tipo, origem: 'regex' };
  }

  // 2. Preditor nativo do ML — busca pelo nome bruto SEMPRE; busca pela query limpa
  // (tipo_produto_busca, ADR-0054) só quando ela existe, em paralelo. Nomes tipo SKU
  // (marca+especificação, ex.: "EUROROMA 4/6 CORES 600G 610MT") são ruído pra busca
  // textual do ML — a query limpa resolve sem descartar o que já funciona hoje (a
  // busca bruta continua rodando e entra primeiro no merge, preservando os lotes 42-49).
  const buscaLimpa = input.tipoProdutoBusca?.trim();
  const [brutos, limpos] = await Promise.all([
    deps.preditor(input.nome).catch(() => [] as CategoriaCandidata[]),
    buscaLimpa ? deps.preditor(buscaLimpa).catch(() => [] as CategoriaCandidata[]) : Promise.resolve([] as CategoriaCandidata[]),
  ]);
  const candidatos = mesclarCandidatos(brutos, limpos);
  if (candidatos.length === 0) {
    return { categoriaId: null, categoriaNome: null, tipo: 'outro', origem: 'manual' };
  }

  const topo = candidatos[0];

  // Pista forte de vertical: corrige top-1 incompatível quando há candidato
  // compatível; se a pista existe mas nenhum candidato bate, não auto-atribui
  // categoria errada — devolve manual p/ o operador escolher na Revisão.
  const pista = avaliarPistaForte(input, candidatos);
  if (pista?.tipo === 'escolhido' && pista.candidato.categoriaId !== topo.categoriaId) {
    return { categoriaId: pista.candidato.categoriaId, categoriaNome: pista.candidato.categoriaNome, tipo: tipoParaCategoria(pista.candidato.categoriaId), origem: 'ia' };
  }
  if (pista?.tipo === 'sem-candidato') {
    return { categoriaId: null, categoriaNome: null, tipo: 'outro', origem: 'manual' };
  }

  // 3. Candidatos genéricos ("Outros" etc.) nunca vencem um específico (ADR-0054, lote #50)
  // — separados ANTES de qualquer decisão. Zero candidato específico → aplica o genérico
  // (topo) como fallback visível em vez de travar a família (ADR-0058): o operador vê o
  // selo de aviso na Revisão e busca/troca quando quiser — nunca fica escondido.
  const especificos = candidatos.filter((c) => !ehCategoriaGenerica(c.categoriaNome));
  if (especificos.length === 0) {
    return { categoriaId: topo.categoriaId, categoriaNome: topo.categoriaNome, tipo: tipoParaCategoria(topo.categoriaId), origem: 'generico' };
  }
  const topoEspecifico = especificos[0];

  // 4. Desempate LLM — roda sempre que houver ≥1 candidato específico (não só em
  // ambiguidade). Abstenção deliberada (null) → manual, nunca aceita o falso-amigo
  // que sobrou. Falha técnica (undefined) → cai no topo específico (resiliente).
  if (deps.llm) {
    const resultado = await deps.llm(input, especificos).catch(() => undefined as string | null | undefined);
    if (resultado === null) {
      return { categoriaId: null, categoriaNome: null, tipo: 'outro', origem: 'manual' };
    }
    if (typeof resultado === 'string') {
      const escolhido = especificos.find((c) => c.categoriaId === resultado);
      if (escolhido && escolhido.categoriaId !== topoEspecifico.categoriaId) {
        return { categoriaId: escolhido.categoriaId, categoriaNome: escolhido.categoriaNome, tipo: tipoParaCategoria(escolhido.categoriaId), origem: 'ia' };
      }
    }
    // resultado undefined (falha técnica) ou string fora do closed-set: cai no fallback abaixo.
  }

  return { categoriaId: topoEspecifico.categoriaId, categoriaNome: topoEspecifico.categoriaNome, tipo: tipoParaCategoria(topoEspecifico.categoriaId), origem: 'preditor' };
}
