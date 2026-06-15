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

const PISTAS_FORTES: Array<{
  termos: RegExp;
  candidato: RegExp;
  fallback?: { categoriaId: string; categoriaNome: string };
}> = [
  {
    termos: /\b(furadeira|furadeiras|parafusadeira|parafusadeiras|martelete|marteletes)\b/,
    candidato: /\b(furadeira|furadeiras|parafusadeira|parafusadeiras|martelete|marteletes|drill|drills)\b/,
    fallback: { categoriaId: 'MLB189007', categoriaNome: 'De Mão' },
  },
];

function normalizarTexto(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ' ');
}

function escolherPorPistaForte(input: InputCategoria, candidatos: CategoriaCandidata[]): CategoriaCandidata | null {
  const texto = normalizarTexto(`${input.nome} ${input.descricao ?? ''}`);
  for (const pista of PISTAS_FORTES) {
    if (!pista.termos.test(texto)) continue;
    const escolhido = candidatos.find((c) =>
      pista.candidato.test(normalizarTexto(`${c.domainId} ${c.domainName} ${c.categoriaNome}`))
    );
    if (escolhido) return escolhido;
    if (pista.fallback) {
      return { domainId: 'FALLBACK_STRONG_CLUE', domainName: pista.fallback.categoriaNome, ...pista.fallback };
    }
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

  const porPista = escolherPorPistaForte(input, candidatos);
  if (porPista && porPista.categoriaId !== topo.categoriaId) {
    return { categoriaId: porPista.categoriaId, categoriaNome: porPista.categoriaNome, tipo: 'outro', origem: 'ia' };
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
