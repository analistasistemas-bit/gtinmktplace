// ADR-0200, Adendo 1: cor da peça amostrada em código (determinística), não pedida ao modelo. Puro: os pixels vêm
// de `pixels.ts` (decodificação), para este arquivo rodar no vitest sem dependência `npm:`.

export interface Pixels { largura: number; altura: number; rgba: ArrayLike<number>; canais: number }

const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, '0');
export const paraHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
export function deHex(h: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

function px(p: Pixels, x: number, y: number): [number, number, number] {
  const i = (y * p.largura + x) * p.canais;
  return p.canais >= 3 ? [p.rgba[i], p.rgba[i + 1], p.rgba[i + 2]] : [p.rgba[i], p.rgba[i], p.rgba[i]];
}

/** Cor do fundo: mediana por canal de amostras nos 4 cantos da imagem inteira. */
function corDoFundo(p: Pixels): [number, number, number] {
  const lado = Math.max(1, Math.floor(Math.min(p.largura, p.altura) * 0.03));
  const amostras: Array<[number, number, number]> = [];
  for (const [cx, cy] of [[0, 0], [p.largura - lado, 0], [0, p.altura - lado], [p.largura - lado, p.altura - lado]]) {
    for (let y = cy; y < cy + lado; y++) for (let x = cx; x < cx + lado; x++) amostras.push(px(p, x, y));
  }
  const med = (c: 0 | 1 | 2) => amostras.map((a) => a[c]).sort((a, b) => a - b)[amostras.length >> 1];
  return [med(0), med(1), med(2)];
}

/**
 * Hex médio dos pixels da peça na região [x0, x1) × [y0, y1) (frações de 0 a 1). Fundo = cor dos cantos; pixel a
 * menos de `limiar` (distância RGB) do fundo fica fora. Menos de 2% da região como peça → null (sem leitura).
 * ponytail: média simples em sRGB e fundo pelos cantos. Peça clara em fundo claro, ou foto em modelo (pele, cenário),
 * contamina a média; trocar por segmentação se a medição mostrar falso alarme.
 */
export function corDaPeca(p: Pixels, r = { x0: 0.2, x1: 0.8, y0: 0.1, y1: 0.9 }, limiar = 40): string | null {
  const fundo = corDoFundo(p);
  const xa = Math.floor(p.largura * r.x0), xb = Math.ceil(p.largura * r.x1);
  const ya = Math.floor(p.altura * r.y0), yb = Math.ceil(p.altura * r.y1);
  const total = Math.max(1, (xb - xa) * (yb - ya));
  const passo = Math.max(1, Math.floor(Math.sqrt(total / 40_000)));   // até ~40 mil amostras
  let n = 0, vistos = 0, sr = 0, sg = 0, sb = 0;
  for (let y = ya; y < yb; y += passo) {
    for (let x = xa; x < xb; x += passo) {
      vistos++;
      const [cr, cg, cb] = px(p, x, y);
      if (Math.hypot(cr - fundo[0], cg - fundo[1], cb - fundo[2]) < limiar) continue;
      n++; sr += cr; sg += cg; sb += cb;
    }
  }
  return n < vistos * 0.02 ? null : paraHex(sr / n, sg / n, sb / n);
}

/** Hex da peça i (0-based) de N lado a lado: coluna i da imagem, sem as bordas da coluna. */
export function corDaPecaNaColuna(p: Pixels, i: number, n: number): string | null {
  const w = 1 / n;
  return corDaPeca(p, { x0: i * w + w * 0.15, x1: (i + 1) * w - w * 0.15, y0: 0.05, y1: 0.95 });
}

function lab([r, g, b]: [number, number, number]): [number, number, number] {
  const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

/** ΔE (CIE76) e ΔL (gerada − original; negativo = mais escura) entre dois hex. Hex inválido → null. */
export function diferencaCor(original: string, gerada: string): { deltaE: number; deltaL: number } | null {
  const a = deHex(original), b = deHex(gerada);
  if (!a || !b) return null;
  const [la, aa, ba] = lab(a), [lb, ab, bb] = lab(b);
  return { deltaE: Math.hypot(la - lb, aa - ab, ba - bb), deltaL: lb - la };
}
