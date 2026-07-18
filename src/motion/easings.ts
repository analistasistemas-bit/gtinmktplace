/**
 * Curvas de easing nomeadas por função (contrato §6.4).
 * Regras: `success` nunca em tabelas, formulários densos, erros, exclusões ou ações
 * destrutivas; `linear` só para progresso contínuo real; nunca bounce/elastic.
 */

export const easing = {
  enter: [0.16, 1, 0.3, 1], // entradas
  exit: [0.4, 0, 1, 1], // saídas: mais rápidas e discretas que entradas
  reversible: [0.45, 0, 0.55, 1], // accordion, toggle, seleção, bidirecional
  success: [0.34, 1.3, 0.64, 1], // confirmação com leve overshoot
} as const;

export const easingCss = Object.fromEntries(
  Object.entries(easing).map(([k, v]) => [k, `cubic-bezier(${v.join(', ')})`])
) as Record<keyof typeof easing, string>;
