/**
 * Métricas automáticas do experimento A/B/C de copy (ADR-0098). Funções puras, sem I/O.
 *
 * Vivem em scripts/ e não em supabase/functions/ porque só o experimento as usa — o código
 * de produção não depende delas. O detector de fórmulas de R3, esse sim, mora em
 * copywriter-prompt.ts, porque a fase 2 do ADR o promove a validador de runtime.
 */

const UNIDADES = 'mm|cm|metros|metro|kg|gramas|ml|litros|litro|unidades|pecas|folhas|tex|graus|m|g|l|v|w';

function normalizar(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Pares número+unidade normalizados. "10.000 metros", "10000 metros" e "10000metros"
 * colapsam na mesma chave — sem isso a métrica acusaria falso positivo contra a própria
 * fonte, que escreve "10.000 METROS" com separador de milhar.
 *
 * A ordem de UNIDADES importa: alternativas longas primeiro, senão 'm' casaria antes de
 * 'metros' e "10 metros" viraria "10m" enquanto a fonte produziria "10metros".
 */
export function extrairMedidas(texto: string): string[] {
  const alvo = normalizar(texto ?? '');
  const re = new RegExp(`(\\d[\\d.,]*)\\s*(${UNIDADES})\\b`, 'g');
  const achados = new Set<string>();
  for (const [, num, uni] of alvo.matchAll(re)) {
    // separador de milhar cai; vírgula decimal vira ponto; zeros decimais à direita somem
    const limpo = num
      .replace(/\.(?=\d{3}(\D|$))/g, '')
      .replace(',', '.')
      .replace(/\.0+$/, '');
    achados.add(`${limpo}${uni}`);
  }
  return [...achados];
}

/** Medidas presentes na saída e ausentes da fonte — candidatas a invenção (R1b). */
export function medidasNaoAncoradas(saida: string, fonte: string): string[] {
  const daFonte = new Set(extrairMedidas(fonte));
  return extrairMedidas(saida).filter((m) => !daFonte.has(m));
}

const PADROES_COMPARACAO = [
  /\d+\s*%/g,
  /\b\d+\s*vezes\b/g,
  /\bmais (?:que|do que)\b/g,
  /\bmenos (?:que|do que)\b/g,
  /\bsuperior a\b/g,
  /\binferior a\b/g,
];

function comparacoesBrutas(texto: string): string[] {
  const alvo = normalizar(texto ?? '');
  return PADROES_COMPARACAO.flatMap((p) => [...alvo.matchAll(p)].map((m) => m[0].replace(/\s+/g, '')));
}

/**
 * Comparações quantitativas da saída que NÃO existem na fonte — candidatas a invenção (R1b).
 *
 * Comparar contra a fonte é obrigatório, não refinamento: a primeira versão desta métrica
 * contava qualquer `\d+%` e classificava "100% poliéster" (composição, vinda da fonte) como
 * comparação inventada. Pior, acusava MAIS o prompt novo, porque R5 manda repetir "linha 100%
 * poliéster" entre os termos de busca — a métrica lia como regressão exatamente o
 * comportamento que o prompt foi desenhado para produzir. Percentual de composição é fato,
 * não comparação.
 */
export function comparacoesNaoAncoradas(saida: string, fonte: string): string[] {
  const naFonte = new Set(comparacoesBrutas(fonte));
  return comparacoesBrutas(saida).filter((c) => !naFonte.has(c));
}

function bullets(descricao: string): string[] {
  return descricao
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[✔•\-▪]/.test(l))
    .map((l) => normalizar(l.replace(/^[✔•\-▪]\s*/, '')));
}

/**
 * Fração dos bullets do conjunto que aparecem em mais de um anúncio. Alto = os anúncios se
 * parecem, que é exatamente o sintoma medido no catálogo atual ("Alta resistência" em 75%
 * das descrições).
 */
export function taxaBulletsRepetidos(descricoes: string[]): number {
  const contagem = new Map<string, number>();
  for (const d of descricoes) {
    for (const b of new Set(bullets(d))) contagem.set(b, (contagem.get(b) ?? 0) + 1);
  }
  const total = [...contagem.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  const repetidos = [...contagem.values()].filter((n) => n > 1).reduce((a, b) => a + b, 0);
  return repetidos / total;
}
