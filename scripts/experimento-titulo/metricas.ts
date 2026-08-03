/**
 * Métricas automáticas do experimento A/B de título (ADR-0099). Funções puras, sem I/O.
 *
 * Vivem em scripts/ e não em supabase/functions/ porque só o experimento as usa — o código
 * de produção não depende delas.
 */
import { marcaDoFornecedor } from '../../supabase/functions/_shared/ai/titulo-marcas.ts';

const norm = (s: string) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/**
 * Lista fechada dos adjetivos vazios efetivamente observados nos 143 títulos de produção.
 *
 * Medida deliberadamente ESTRITA. A medida frouxa ("cauda sem nenhum dígito") dá 51%, mas conta
 * "| BRANCO" como defeito — cor é dado legítimo. Comparar contra esta lista dá 35%, que é o
 * número defensável e o alvo do ADR-0099.
 */
const ADJETIVOS = [
  'ELEGANTE', 'VERSATIL', 'RESISTENTE', 'SUPER RESISTENTE', 'ALTA RESISTENCIA',
  'ALTA DURABILIDADE', 'QUALIDADE PREMIUM', 'ALTA QUALIDADE', 'QUALIDADE SUPERIOR',
  'TOQUE MACIO', 'MACIO', 'CONFORTO E CONTROLE', 'SECAGEM LIMPA', 'ADESAO FIRME',
  'ALTA ADERENCIA', 'USO PROFISSIONAL', 'ALTA PERFORMANCE', 'EXCELENTE QUALIDADE',
  'PALETA VIBRANTE', 'ROLO ECONOMICO', 'FIXACAO FIRME', 'PREMIUM', 'IDEAL PARA CRIANCAS',
  'ECOLOGICA', 'PVC DE ALTA QUALIDADE',
];

export function terminaEmAdjetivoVazio(titulo: string): boolean {
  const fim = norm(titulo.split('|').pop() ?? '').trim();
  return ADJETIVOS.some((a) => fim === a || fim.endsWith(` ${a}`));
}

/** Reprova qualquer unidade não-canônica: MT, MTS, METROS, UND, UNDS, GR. */
export function unidadeCanonica(titulo: string): boolean {
  return !/\d\s*(MT|MTS|METROS|UND|UNDS|GR)\b/i.test(titulo);
}

/**
 * A marca do mapa está no título E ancorada na fonte?
 *
 * Devolve `null` quando o fornecedor não está no mapa — essas famílias saem do denominador,
 * porque não há marca conhecida contra a qual medir. O baseline de 36% foi apurado assim, sobre
 * as 138 famílias com fornecedor mapeado.
 *
 * NÃO tente inferir a marca varrendo as palavras capitalizadas do título: o substantivo do
 * produto ("Fita", "Linha") está sempre na fonte, a medida daria ~100% e o critério de aceite
 * viraria infalsificável.
 */
export function marcaAncorada(titulo: string, fonte: string, fornecedor: string | null): boolean | null {
  const marca = marcaDoFornecedor(fornecedor);
  if (!marca) return null;
  const alvo = norm(marca);
  return norm(titulo).includes(alvo) && norm(fonte).includes(alvo);
}

/** Grupos de título idêntico entre codigo_pai DISTINTOS — o mesmo produto reingerido não conta. */
export function colisoes(itens: Array<{ codigoPai: string; titulo: string }>): number {
  const porTitulo = new Map<string, Set<string>>();
  for (const i of itens) {
    const chave = norm(i.titulo).trim();
    if (!porTitulo.has(chave)) porTitulo.set(chave, new Set());
    porTitulo.get(chave)!.add(i.codigoPai);
  }
  return [...porTitulo.values()].filter((pais) => pais.size > 1).length;
}
