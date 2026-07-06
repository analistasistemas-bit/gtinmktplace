// E6 (ADR-0061): visibilidade de UI multi-canal — hoje toda org tem só 1 conexão (ML), então
// ambas ficam sempre ocultas (zero mudança visual). Passam a aparecer quando o E5 (Shopee)
// trouxer uma 2ª conexão/canal real.

/** Grupo "Publicar em:" na Revisão só aparece com mais de 1 conexão de canal na org. */
export function deveMostrarSeletorCanais(nConexoes: number): boolean {
  return nConexoes > 1;
}

/** Chip do canal na linha de Publicados só aparece quando a org tem anúncios em mais de 1 canal. */
export function deveMostrarChipCanal(nCanais: number): boolean {
  return nCanais > 1;
}
