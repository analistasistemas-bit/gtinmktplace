/**
 * Rótulo determinístico do bullet de quantidade nas ESPECIFICAÇÕES, derivado da
 * coluna UNIDADE da planilha (como o produto é vendido). Só decide quando a unidade
 * define a dimensão física: peso → "Peso", volume → "Volume", comprimento → "Metragem".
 * Unidades de embalagem (PC/RL/UN/CN…) são ambíguas (a metragem real da fita está no
 * nome, não na unidade) → retorna null e a IA rotula pelo dado da descrição.
 */
const PESO = new Set(['KG', 'KGS', 'G', 'GR', 'GRS', 'GRAMA', 'GRAMAS']);
const VOLUME = new Set(['L', 'LT', 'ML', 'LITRO', 'LITROS']);
const COMPRIMENTO = new Set(['M', 'MT', 'MTS', 'METRO', 'METROS']);

export function rotuloQuantidade(unidade: string | null): string | null {
  const u = (unidade ?? '').trim().toUpperCase();
  if (PESO.has(u)) return 'Peso';
  if (VOLUME.has(u)) return 'Volume';
  if (COMPRIMENTO.has(u)) return 'Metragem';
  return null;
}
