import { detectarTipoAviamento, type TipoAviamento } from './detectar.ts';
import { categoriaParaTipo, rotuloParaTipo } from './atributos.ts';
import type { CategoriaCandidata } from '../ml/domain-discovery.ts';

// Resolução de categoria em camadas (ADR-0026 / E3). Primeira que vencer manda:
// override → preditor (domain_discovery) → desempate LLM (ambíguo) → manual.
export type OrigemCategoria = 'regex' | 'preditor' | 'ia' | 'manual';

export interface InputCategoria {
  nome: string;
  descricao?: string;
}

export interface ResultadoCategoria {
  categoriaId: string | null;   // null → 'outro' (operador escolhe na Revisão)
  categoriaNome: string | null; // rótulo humano p/ a Revisão
  tipo: TipoAviamento;
  origem: OrigemCategoria;
}

export interface DepsResolver {
  preditor: (nome: string) => Promise<CategoriaCandidata[]>;
  llm?: (input: InputCategoria, candidatos: CategoriaCandidata[]) => Promise<string | null>;
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

  // 2. Preditor nativo do ML.
  const candidatos = await deps.preditor(input.nome).catch(() => [] as CategoriaCandidata[]);
  if (candidatos.length === 0) {
    return { categoriaId: null, categoriaNome: null, tipo: 'outro', origem: 'manual' };
  }

  const topo = candidatos[0];

  // Pista forte de vertical: corrige top-1 incompatível quando há candidato
  // compatível; se a pista existe mas nenhum candidato bate, não auto-atribui
  // categoria errada — devolve manual p/ o operador escolher na Revisão.
  const pista = avaliarPistaForte(input, candidatos);
  if (pista?.tipo === 'escolhido' && pista.candidato.categoriaId !== topo.categoriaId) {
    return { categoriaId: pista.candidato.categoriaId, categoriaNome: pista.candidato.categoriaNome, tipo: 'outro', origem: 'ia' };
  }
  if (pista?.tipo === 'sem-candidato') {
    return { categoriaId: null, categoriaNome: null, tipo: 'outro', origem: 'manual' };
  }

  // 2b. Desempate LLM — só em ambiguidade real (≥2 domains distintos) e com closed-set.
  const domains = new Set(candidatos.map((c) => c.domainId));
  if (deps.llm && domains.size >= 2) {
    const escolhidoId = await deps.llm(input, candidatos).catch(() => null);
    const escolhido = candidatos.find((c) => c.categoriaId === escolhidoId);
    if (escolhido && escolhido.categoriaId !== topo.categoriaId) {
      return { categoriaId: escolhido.categoriaId, categoriaNome: escolhido.categoriaNome, tipo: 'outro', origem: 'ia' };
    }
  }

  return { categoriaId: topo.categoriaId, categoriaNome: topo.categoriaNome, tipo: 'outro', origem: 'preditor' };
}
