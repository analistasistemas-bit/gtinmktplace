// Contraste WCAG (R6.4/R6.5): cor do produto só como acento onde o par com a placa branca atinge 4,5:1.
export const TEXTO_ESCURO = '#1b1f24';

const canal = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
function luminancia(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

/** Razão de contraste (1–21) entre duas cores `#rrggbb`. */
export function razaoContraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Acento sobre a placa branca; abaixo de 4,5:1 cai para o texto escuro. */
export const corDeAcento = (hex: string): string => (razaoContraste(hex, '#ffffff') >= 4.5 ? hex : TEXTO_ESCURO);
