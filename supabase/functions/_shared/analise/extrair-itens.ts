import type { ItemAnalise } from './tipos.ts';
import { normalizarOrigem } from '../parser.ts';

const COLUNAS = ['NOME', 'UNIDADE', 'GTIN', 'PRECO', 'CUSTO'] as const;

/** Aceita número JS ou string com decimal pt-BR ("39,90") ou en-US ("39.90"); null se não-numérico. */
function parseNumero(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  let s = v.trim();
  if (s === '') return null;
  const temVirgula = s.includes(',');
  const temPonto = s.includes('.');
  if (temVirgula && temPonto) {
    // o separador que aparece por último é o decimal; o outro é separador de milhar.
    s = s.lastIndexOf(',') > s.lastIndexOf('.')
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '');
  } else if (temVirgula) {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function gtinLimpo(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

/**
 * Extrai itens a analisar de linhas de planilha (enxuta ou completa do lote).
 * Linha-a-linha, sem agrupar por pai. Se houver coluna PAI, pula agrupadores (PAI = 0).
 * Linhas sem GTIN/PRECO/CUSTO válidos são descartadas e contadas em `ignorados`.
 */
export function extrairItensAnalise(
  rows: Array<Record<string, unknown>>,
): { itens: ItemAnalise[]; ignorados: number } {
  if (rows.length > 0) {
    const cols = new Set(Object.keys(rows[0]));
    const faltando = COLUNAS.filter((c) => !cols.has(c));
    if (faltando.length > 0) {
      throw new Error(`Planilha sem a(s) coluna(s) obrigatória(s): ${faltando.join(', ')}`);
    }
  }

  const itens: ItemAnalise[] = [];
  let ignorados = 0;

  for (const r of rows) {
    if ('PAI' in r && String(r.PAI ?? '').trim() === '0') continue; // agrupador
    const gtin = gtinLimpo(r.GTIN);
    const minimo = parseNumero(r.PRECO);
    const custo = parseNumero(r.CUSTO);
    if (!gtin || minimo == null || custo == null) {
      ignorados++;
      continue;
    }
    const altura_cm = parseNumero(r.ALTURA_CM ?? r.ALTURA);
    const largura_cm = parseNumero(r.LARGURA_CM ?? r.LARGURA);
    const comprimento_cm = parseNumero(r.COMPRIMENTO_CM ?? r.COMPRIMENTO);
    const peso_gramas = parseNumero(r.PESO_GRAMAS ?? r.PESO);
    const temDimensoes = altura_cm != null || largura_cm != null || comprimento_cm != null || peso_gramas != null;

    itens.push({
      gtin,
      nome: String(r.NOME ?? '').trim(),
      unidade: r.UNIDADE != null ? String(r.UNIDADE).trim() : null,
      minimo,
      custo,
      origem: normalizarOrigem(r.ORIGEM != null ? String(r.ORIGEM) : undefined),
      ...(temDimensoes ? { dimensoes: { altura_cm, largura_cm, comprimento_cm, peso_gramas } } : {}),
    });
  }

  return { itens, ignorados };
}
