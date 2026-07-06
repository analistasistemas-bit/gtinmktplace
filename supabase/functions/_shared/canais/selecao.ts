// E6 (ADR-0061): separa os canais pedidos em "inclui ML" (fluxo atual) e "extras"
// (fan-out genérico). Puro — testável sem rede. Default ['mercado_livre'] → compat.
export function separarCanais(canais: unknown): { canaisSel: string[]; incluiML: boolean; extras: string[] } {
  const canaisSel = Array.isArray(canais) && canais.length ? canais.filter((c): c is string => typeof c === 'string') : ['mercado_livre'];
  return {
    canaisSel,
    incluiML: canaisSel.includes('mercado_livre'),
    extras: canaisSel.filter((c) => c !== 'mercado_livre'),
  };
}
