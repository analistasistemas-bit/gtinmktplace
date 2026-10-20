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

// Incidente 20/10 (água micelar 00000003): a IA ignorou a REGRA CRÍTICA do prompt e escreveu
// "• Metragem: 120ml". Guard determinístico: só o rótulo muda (valor intacto), só em bullet.
// Fronteira Unicode (não \b: "500 grãos" casaria "g") e "/" recusa composta ("80 g/m²").
const BULLET_METRAGEM = String.raw`^([ \t]*[•\-–][ \t]*)Metragem([ \t]*:[ \t]*)(?=\d+(?:[.,]\d+)?[ \t]*`;
const FIM_UNIDADE = String.raw`(?![\p{L}\p{N}_/]))`;
const METRAGEM_VOLUME = new RegExp(`${BULLET_METRAGEM}(?:litros|litro|ml|lt|l)${FIM_UNIDADE}`, 'gimu');
const METRAGEM_MASSA = new RegExp(
  `${BULLET_METRAGEM}(?:gramas|grama|kgs|kg|grs|gr|g)${FIM_UNIDADE}`,
  'gimu',
);

export function corrigirRotuloQuantidade(descricao: string): string {
  return descricao
    .replace(METRAGEM_VOLUME, '$1Volume$2')
    .replace(METRAGEM_MASSA, '$1Peso$2');
}
