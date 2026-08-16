// Pulse (ADR-0119): resolve a entrada manual de "Adicionar produto" (link de catálogo ou GTIN).
// Pura — sem I/O. Item avulso de terceiro (`/MLB-123...`, sem `/p/`) é impossível de coletar
// (403, ver Fatos empíricos do plano) e cai em 'invalida'.
export interface EntradaResolvida {
  tipo: 'cpid' | 'gtin' | 'invalida';
  valor: string | null;
}

export function resolverEntrada(entrada: string): EntradaResolvida {
  const t = entrada.trim();
  const cpid = t.match(/\/p\/(MLB\d+)/);
  if (cpid) return { tipo: 'cpid', valor: cpid[1] };
  if (/^\d{8,14}$/.test(t)) return { tipo: 'gtin', valor: t };
  return { tipo: 'invalida', valor: null };
}
