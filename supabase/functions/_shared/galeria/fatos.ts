// Ficha Verdade da galeria (spec R1, ADR-0201 §12). Puro: roda igual na edge e no vitest.
// CONFIRMADO só da planilha ou da confirmação do operador por campo; o que a IA escreveu é SUGERIDO.
import { createHash } from 'node:crypto';

export type EstadoFato = 'CONFIRMADO' | 'SUGERIDO' | 'DIVERGENTE' | 'NAO_CONFERIDO' | 'VARIA_POR_TAMANHO';
export type OrigemFato = 'planilha' | 'confirmado_operador' | 'atributo_ml' | 'titulo_ml' | 'descricao_ml' | 'etiqueta';

/** Leitura da etiqueta para um campo (R1.3). `legivel: false` = ilegível ou ausente. */
export interface LeituraCampo { legivel: boolean; valor?: string | null; recorte?: string }

export interface Fato {
  campo: string;
  valor: string;
  estado: EstadoFato;
  origem: OrigemFato;
  evidencia: Record<string, unknown>;
  etiqueta?: LeituraCampo;
}

/** Linha de `galeria_fatos` (decisão do operador por campo, na família vigente). */
export interface FatoGravado {
  campo: string;
  valor: string | null;
  origem: 'planilha' | 'confirmado_operador';
  evidencia: Record<string, unknown> | null;
  descartado: boolean;
}

export interface EntradaFicha {
  /** Colunas da planilha na família (nome, descrição do fornecedor, marca, origem…). */
  planilha: Record<string, string | null | undefined>;
  /** Medidas da planilha por SKU atendido (dados por SKU). */
  medidasPorSku: Record<string, Record<string, string>>;
  atributosML: ReadonlyArray<{ id?: string; name?: string; value_name?: string | null }>;
  textosIA: { titulo_ml?: string | null; descricao_ml?: string | null };
  confirmados: ReadonlyArray<FatoGravado>;
}

const temTexto = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

export function montarFicha({ planilha, medidasPorSku, atributosML, textosIA, confirmados }: EntradaFicha): Fato[] {
  const fatos: Fato[] = [];
  for (const [campo, valor] of Object.entries(planilha)) {
    if (temTexto(valor)) fatos.push({ campo, valor: valor.trim(), estado: 'CONFIRMADO', origem: 'planilha', evidencia: { coluna: campo, trecho: valor.trim() } });
  }

  // R1.5: medida só vira fato se valer para TODOS os SKUs atendidos; senão não vira texto.
  const skus = Object.keys(medidasPorSku);
  const campos = [...new Set(skus.flatMap((s) => Object.keys(medidasPorSku[s])))];
  for (const campo of campos) {
    const porSku = Object.fromEntries(skus.map((s) => [s, (medidasPorSku[s][campo] ?? '').trim()]));
    const valores = [...new Set(Object.values(porSku))];
    if (valores.length === 1 && valores[0] !== '') {
      fatos.push({ campo, valor: valores[0], estado: 'CONFIRMADO', origem: 'planilha', evidencia: { coluna: campo, trecho: valores[0], porSku } });
    } else if (valores.some((v) => v !== '')) {
      fatos.push({ campo, valor: valores.filter((v) => v !== '').join(' / '), estado: 'VARIA_POR_TAMANHO', origem: 'planilha', evidencia: { coluna: campo, porSku } });
    }
  }

  for (const a of atributosML) {
    if (!temTexto(a.id) || !temTexto(a.value_name)) continue;
    fatos.push({ campo: `atributo:${a.id}`, valor: a.value_name.trim(), estado: 'SUGERIDO', origem: 'atributo_ml', evidencia: { atributo: a.id, nome: a.name ?? a.id } });
  }
  for (const campo of ['titulo_ml', 'descricao_ml'] as const) {
    const v = textosIA[campo];
    if (temTexto(v)) fatos.push({ campo, valor: v.trim(), estado: 'SUGERIDO', origem: campo, evidencia: { campo } });
  }

  // Decisões do operador (galeria_fatos) vencem a sugestão.
  for (const c of confirmados) {
    const i = fatos.findIndex((x) => x.campo === c.campo);
    if (c.descartado) {
      if (i >= 0 && fatos[i].estado === 'SUGERIDO') fatos.splice(i, 1);
      continue;
    }
    const decisao = c.evidencia ?? {};
    if (i >= 0 && fatos[i].estado === 'VARIA_POR_TAMANHO') continue;
    if (c.origem === 'planilha') {
      if (i >= 0) fatos[i] = { ...fatos[i], evidencia: { ...fatos[i].evidencia, ...decisao } };
      continue;
    }
    if (!temTexto(c.valor)) continue;
    const confirmado: Fato = { campo: c.campo, valor: c.valor.trim(), estado: 'CONFIRMADO', origem: 'confirmado_operador', evidencia: { ...(i >= 0 ? fatos[i].evidencia : {}), ...decisao } };
    if (i >= 0) fatos[i] = confirmado; else fatos.push(confirmado);
  }
  return fatos;
}

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
// Texto exato normalizado: sem acento, minúsculo, espaço colapsado; dígitos, %, vírgula e ponto intocados.
const textoNorm = (s: string) => norm(s).normalize('NFC').replace(/\s+/g, ' ').trim();
// Número pt-BR: "1.500" = mil e quinhentos (milhar), "1,5" = um e meio; "1.5" (sem grupo de 3) = um e meio.
const NUM = '\\d+(?:[.,]\\d+)*';
function numero(n: string): string {
  const t = /^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(n) ? n.replace(/\./g, '').replace(',', '.') : n.replace(',', '.');
  const v = Number(t);
  return Number.isFinite(v) ? String(v) : n;
}

/**
 * Composição → material → %. `null` = não é composição reconhecida. Conservadora: todo termo precisa
 * casar em par percentual/material (percentual antes ou depois: "90% A, B 10%"); palavra sem par,
 * número solto ou material repetido → null (nunca "igual" por omissão).
 */
function composicao(s: string): Map<string, string> | null {
  // Material = palavras seguidas; vírgula, barra, "e" e percentual separam.
  const re = new RegExp(`(${NUM})\\s*%|(${NUM})|(\\p{L}+(?:\\s+(?!e\\s|e$)\\p{L}+)*)`, 'gu');
  const itens = [...norm(s).matchAll(re)]
    .map((m) => ({ pct: m[1] !== undefined ? numero(m[1]) : undefined, solto: m[2] !== undefined, mat: m[3] }))
    .filter((i) => i.mat !== 'e');
  if (!itens.some((i) => i.pct !== undefined) || itens.some((i) => i.solto)) return null;
  const mapa = new Map<string, string>();
  let pctPendente: string | null = null;
  let matPendente: string | null = null;
  const parear = (mat: string, pct: string) => {
    if (mapa.has(mat)) return false;
    mapa.set(mat, pct);
    return true;
  };
  for (const i of itens) {
    if (i.pct !== undefined) {
      if (pctPendente !== null) return null;
      if (matPendente !== null) { if (!parear(matPendente, i.pct)) return null; matPendente = null; }
      else pctPendente = i.pct;
    } else if (i.mat !== undefined) {
      if (matPendente !== null) return null;
      if (pctPendente !== null) { if (!parear(i.mat, pctPendente)) return null; pctPendente = null; }
      else matPendente = i.mat;
    }
  }
  return pctPendente === null && matPendente === null ? mapa : null;
}

/**
 * Mesmo valor com formatação diferente. Números e unidades contam ("20 mm" ≢ "35 mm", "1.500 m" ≢ "1,5 m");
 * composição compara o percentual de cada material, com todos os termos casados; só "100% X" ≡ "X".
 * Com % e composição não reconhecida em qualquer lado: nunca igual.
 */
export function mesmoValor(a: string, b: string): boolean {
  if (textoNorm(a) === textoNorm(b)) return true; // reflexivo: mesmo texto nunca diverge
  const sequencia = (s: string) =>
    (norm(s).match(new RegExp(`${NUM}|\\p{L}+`, 'gu')) ?? []).map((t) => (/\d/.test(t) ? numero(t) : t)).join(' ');
  const temPct = (s: string) => s.includes('%');
  if (!temPct(a) && !temPct(b)) return sequencia(a) === sequencia(b);
  // Com % em qualquer lado não há fallback por sequência: composição não reconhecida nunca é igual.
  // Material de várias palavras só casa se for idêntico (chave exata do mapa).
  const ca = composicao(a);
  const cb = composicao(b);
  if (temPct(a) && temPct(b)) return !!ca && !!cb && ca.size === cb.size && [...ca].every(([k, v]) => cb.get(k) === v);
  // "100% X" ≡ "X": o lado sem % é o material inteiro.
  const [comp, puro] = temPct(a) ? [ca, b] : [cb, a];
  return !!comp && comp.size === 1 && [...comp.values()][0] === '100' && comp.has(sequencia(puro));
}

export function aplicarEtiqueta(fatos: Fato[], leitura: Record<string, LeituraCampo>): Fato[] {
  const saida = fatos.map((fato): Fato => {
    const l = leitura[fato.campo];
    if (!l || fato.estado === 'VARIA_POR_TAMANHO') return fato;
    if (!l.legivel || !temTexto(l.valor)) {
      return { ...fato, etiqueta: l, estado: fato.estado === 'CONFIRMADO' ? 'NAO_CONFERIDO' : fato.estado };
    }
    if (mesmoValor(l.valor, fato.valor)) return { ...fato, etiqueta: l };
    // "Manter cadastro" (R1.3) destrava só a mesma leitura que o operador viu (texto exato, não semântico).
    const mantida = fato.evidencia.manter_cadastro === true && temTexto(fato.evidencia.etiqueta_lida)
      && textoNorm(fato.evidencia.etiqueta_lida) === textoNorm(l.valor);
    return { ...fato, etiqueta: l, estado: mantida ? fato.estado : 'DIVERGENTE' };
  });
  // Fato que só existe na etiqueta não vira texto: entra como sugestão para o operador incluir.
  for (const [campo, l] of Object.entries(leitura)) {
    if (l.legivel && temTexto(l.valor) && !saida.some((f) => f.campo === campo)) {
      saida.push({ campo, valor: l.valor.trim(), estado: 'SUGERIDO', origem: 'etiqueta', evidencia: { recorte: l.recorte ?? null }, etiqueta: l });
    }
  }
  return saida;
}

/** Vigência: o que pode virar texto (CONFIRMADO e NAO_CONFERIDO) + sha das referências por `cor:vista`. */
export function hashFatos(fatos: Fato[], refs: Record<string, string>): string {
  const canonico = JSON.stringify([
    fatos.filter((f) => f.estado === 'CONFIRMADO' || f.estado === 'NAO_CONFERIDO')
      .map((f) => [f.campo, f.valor, f.estado])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
    Object.entries(refs).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  ]);
  return createHash('sha256').update(canonico).digest('hex');
}
