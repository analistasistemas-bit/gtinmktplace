// Acesso de agentes (ADR-0210, fatia 1): identificador livre → MLBs da organização. Puro: a organização chega
// fechada nas deps (edge `agentes`); nada aqui recebe ou escolhe organização. Alvo de outra loja = inexistente.

export type Vinculo = { mlb: string; mlbu: string | null; familia_ml: string | null; sku: string; codigo_pai: string };
export type Candidato = { codigo_pai: string; titulo: string; mlbs: string[] };
export interface DepsAlvo {
  vinculos(filtro: { mlb?: string; mlbu?: string; familia_ml?: string; sku?: string }): Promise<Vinculo[]>;
  buscarPorTitulo(trecho: string): Promise<Candidato[]>;
}
export type Alvo =
  | { tipo: 'anuncios'; mlbs: string[]; familia_ml: string | null }
  | { tipo: 'candidatos'; candidatos: Candidato[] }
  | { tipo: 'nao_encontrado' };

const MAX_IDENTIFICADOR = 200;
const MIN_TITULO = 3;
const MAX_CANDIDATOS = 10;

export function classificarIdentificador(s: string): 'mlb' | 'mlbu' | 'familia_ml' | 'sku_ou_titulo' {
  if (/^MLB\d+$/.test(s)) return 'mlb';
  if (/^MLBU\d+$/.test(s)) return 'mlbu';
  if (/^#?\d{12,}$/.test(s)) return 'familia_ml';
  return 'sku_ou_titulo';
}

/** Título nunca resolve sozinho: devolve candidatos (no máximo 10) para o agente escolher. */
export async function resolverAlvo(identificador: string, d: DepsAlvo): Promise<Alvo> {
  const NADA: Alvo = { tipo: 'nao_encontrado' };
  if (typeof identificador !== 'string') return NADA;
  const s = identificador.trim();
  if (s.length < 1 || s.length > MAX_IDENTIFICADOR) return NADA;
  const anuncios = (vs: Vinculo[], familia_ml: string | null): Alvo =>
    vs.length ? { tipo: 'anuncios', mlbs: [...new Set(vs.map((v) => v.mlb))], familia_ml } : NADA;
  const tipo = classificarIdentificador(s);
  if (tipo === 'mlb') return anuncios(await d.vinculos({ mlb: s }), null);
  if (tipo === 'mlbu') return anuncios(await d.vinculos({ mlbu: s }), null);
  if (tipo === 'familia_ml') {
    const familia = s.replace(/^#/, '');
    return anuncios(await d.vinculos({ familia_ml: familia }), familia);
  }
  const porSku = await d.vinculos({ sku: s });
  if (porSku.length) return anuncios(porSku, null);
  if (s.length < MIN_TITULO) return NADA;
  const candidatos = (await d.buscarPorTitulo(s)).slice(0, MAX_CANDIDATOS);
  return candidatos.length ? { tipo: 'candidatos', candidatos } : NADA;
}
