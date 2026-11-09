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
const numero = (n: string) => String(Number(n.replace(',', '.')));

/** Composição "90% Poliéster 10% Elastano" ou "Poliéster 90%, Elastano 10%" → material → %. Sem % → null. */
function composicao(s: string): Map<string, string> | null {
  // Itens: percentual ou material (palavras seguidas; "e", vírgula, barra e percentual separam).
  const itens: Array<{ pct?: string; mat?: string }> = [...norm(s).matchAll(/(\d+(?:[.,]\d+)?)\s*%|(\p{L}+(?:\s+(?!e\s|e$)\p{L}+)*)/gu)]
    .map((m) => (m[1] !== undefined ? { pct: numero(m[1]) } : { mat: m[2] }))
    .filter((i) => i.mat !== 'e');
  if (!itens.some((i) => i.pct !== undefined)) return null;
  const pctAntes = itens[0].pct !== undefined;
  const mapa = new Map<string, string>();
  for (let i = 0; i < itens.length; i++) {
    const pct = itens[i].pct;
    if (pct === undefined) continue;
    const mat = itens[pctAntes ? i + 1 : i - 1]?.mat;
    if (mat === undefined) return null;
    mapa.set(mat, pct);
  }
  return mapa;
}

/**
 * Mesmo valor com formatação diferente. Números e unidades contam ("20 mm" ≢ "35 mm"); composição compara
 * o percentual de cada material ("90% Poliéster 10% Elastano" ≢ "10% Poliéster 90% Elastano"); só
 * "100% X" ≡ "X". Sem percentual: mesma sequência de números e palavras ("20mm" ≡ "20 mm").
 */
export function mesmoValor(a: string, b: string): boolean {
  const ca = composicao(a);
  const cb = composicao(b);
  const igualMapa = (x: Map<string, string>, y: Map<string, string>) =>
    x.size === y.size && [...x].every(([k, v]) => y.get(k) === v);
  const sequencia = (s: string) => (norm(s).match(/\d+(?:[.,]\d+)?|\p{L}+/gu) ?? []).map((t) => (/\d/.test(t) ? numero(t) : t)).join(' ');
  if (ca && cb) return igualMapa(ca, cb);
  const [comp, puro] = ca ? [ca, b] : cb ? [cb, a] : [null, null];
  if (comp && puro !== null) return comp.size === 1 && [...comp.values()][0] === '100' && comp.has(sequencia(puro));
  return sequencia(a) === sequencia(b);
}

export function aplicarEtiqueta(fatos: Fato[], leitura: Record<string, LeituraCampo>): Fato[] {
  const saida = fatos.map((fato): Fato => {
    const l = leitura[fato.campo];
    if (!l || fato.estado === 'VARIA_POR_TAMANHO') return fato;
    if (!l.legivel || !temTexto(l.valor)) {
      return { ...fato, etiqueta: l, estado: fato.estado === 'CONFIRMADO' ? 'NAO_CONFERIDO' : fato.estado };
    }
    if (mesmoValor(l.valor, fato.valor)) return { ...fato, etiqueta: l };
    // "Manter cadastro" (R1.3) destrava só a mesma leitura que o operador viu.
    const mantida = fato.evidencia.manter_cadastro === true && temTexto(fato.evidencia.etiqueta_lida)
      && mesmoValor(fato.evidencia.etiqueta_lida, l.valor);
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
