// Acesso de agentes (ADR-0210, fatia 1): identificador livre → MLBs da organização. Puro: a organização chega
// fechada nas deps (edge `agentes`); nada aqui recebe ou escolhe organização. Alvo de outra loja = inexistente.

import type { Busca, Candidato } from './busca.ts';

export type Vinculo = { mlb: string; mlbu: string | null; familia_ml: string | null; sku: string; codigo_pai: string };
export interface DepsAlvo {
  vinculos(filtro: { mlb?: string; mlbu?: string; familia_ml?: string; sku?: string }): Promise<Vinculo[]>;
  buscarPorTitulo(trecho: string): Promise<Busca>;
}
export type Alvo =
  | { tipo: 'anuncios'; mlbs: string[]; familia_ml: string | null }
  | { tipo: 'candidatos'; candidatos: Candidato[]; lista_cortada: boolean }
  | { tipo: 'nao_encontrado' };

const MAX_IDENTIFICADOR = 200;
const MIN_TITULO = 3;

export function classificarIdentificador(s: string): 'mlb' | 'mlbu' | 'familia_ml' | 'sku_ou_titulo' {
  if (/^MLB\d+$/i.test(s)) return 'mlb';
  if (/^MLBU\d+$/i.test(s)) return 'mlbu';
  if (/^#?\d{12,}$/.test(s)) return 'familia_ml';
  return 'sku_ou_titulo';
}

/** Texto nunca resolve sozinho: devolve candidatos (no máximo 10) para o usuário escolher. */
export async function resolverAlvo(identificador: string, d: DepsAlvo): Promise<Alvo> {
  const NADA: Alvo = { tipo: 'nao_encontrado' };
  if (typeof identificador !== 'string' || identificador.length > 2 * MAX_IDENTIFICADOR) return NADA;
  // deno-lint-ignore no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(identificador)) return NADA;
  const s = identificador.trim();
  if (s.length < 1 || s.length > MAX_IDENTIFICADOR) return NADA;
  const anuncios = (vs: Vinculo[], familia_ml: string | null): Alvo =>
    vs.length ? { tipo: 'anuncios', mlbs: [...new Set(vs.map((v) => v.mlb))], familia_ml } : NADA;
  const tipo = classificarIdentificador(s);
  if (tipo === 'mlb') return anuncios(await d.vinculos({ mlb: s.toUpperCase() }), null);
  if (tipo === 'mlbu') return anuncios(await d.vinculos({ mlbu: s.toUpperCase() }), null);
  if (tipo === 'familia_ml') {
    const familia = s.replace(/^#/, '');
    const vs = await d.vinculos({ familia_ml: familia });
    // EAN usado como SKU também tem 12+ dígitos: sem família, tenta o SKU exato (nunca título).
    return vs.length ? anuncios(vs, familia) : anuncios(await d.vinculos({ sku: familia }), null);
  }
  const porSku = await d.vinculos({ sku: s });
  if (porSku.length) return anuncios(porSku, null);
  if (s.length < MIN_TITULO) return NADA;
  // Projeção explícita: campo extra da dep nunca chega ao agente.
  const { candidatos: achados, lista_cortada } = await d.buscarPorTitulo(s);
  const candidatos = achados.map(({ codigo_pai, titulo, mlbs, variacoes }): Candidato => ({
    codigo_pai, titulo, mlbs,
    ...(variacoes ? { variacoes: variacoes.map(({ sku, cor, tamanho, mlb }) => ({ sku, cor, tamanho, mlb })) } : {}),
  }));
  // Leitura que parou no teto sem achar não prova que não existe.
  return candidatos.length || lista_cortada ? { tipo: 'candidatos', candidatos, lista_cortada } : NADA;
}
