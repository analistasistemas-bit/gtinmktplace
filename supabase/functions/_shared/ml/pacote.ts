// Dimensões/peso da embalagem para o frete do ML (ADR-0018). A planilha trazia
// placeholder fixo (0,1cm/100g); com a planilha real, repassamos ao ML via os
// atributos SELLER_PACKAGE_* (writable; dimensões em cm, peso em g).

export interface DimensoesPacote {
  altura_cm: number | null;
  largura_cm: number | null;
  comprimento_cm: number | null;
  peso_gramas: number | null;
}

export interface AtributoPacote {
  id: string;
  value_name: string;
}

// Plausível = descarta o placeholder 0,1cm e protege contra a planilha antiga.
export function dimensoesValidas(d: DimensoesPacote): boolean {
  const medidas = [d.altura_cm, d.largura_cm, d.comprimento_cm];
  return (
    medidas.every((x): x is number => x != null && x >= 1) &&
    d.peso_gramas != null &&
    d.peso_gramas >= 1
  );
}

// Remove zeros decimais supérfluos: 18.00 → "18"; 7.5 → "7.5".
function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

// Atributos SELLER_PACKAGE_* quando válido; [] quando não (ML estima o frete — não bloqueia).
export function montarAtributosPacote(d: DimensoesPacote): AtributoPacote[] {
  if (!dimensoesValidas(d)) return [];
  return [
    { id: 'SELLER_PACKAGE_HEIGHT', value_name: `${fmt(d.altura_cm!)} cm` },
    { id: 'SELLER_PACKAGE_WIDTH', value_name: `${fmt(d.largura_cm!)} cm` },
    { id: 'SELLER_PACKAGE_LENGTH', value_name: `${fmt(d.comprimento_cm!)} cm` },
    { id: 'SELLER_PACKAGE_WEIGHT', value_name: `${fmt(d.peso_gramas!)} g` },
  ];
}
