// Layouts fixos das missões 2–7 no arquivo final 1200×1540 (R6.4/R6.5, estilo A). A Task 12 desenha o texto dentro
// destas caixas; as áreas que o prompt reserva à cena vêm de `_shared/galeria/layout-area.ts` (fonte única).
// Área segura: x 72–1128 (6%), y 184,8–1355,2 (12–88%). Fonte ≥60 px (5%); títulos 84 px (7%).
import type { SpecRoteiro } from '../../../supabase/functions/_shared/galeria/roteiro';

export interface Caixa { x: number; y: number; w: number; h: number; fontePx: number; linhasMax: number }

/** Só as quantidades importam aqui; o texto é da Task 12. */
export interface TextosMissao {
  headline?: string; subheadline?: string; beneficios?: unknown[]; specs?: Pick<SpecRoteiro, 'rotulo' | 'valor'>[];
  etapas?: unknown[]; legendas?: unknown[];
}

const TITULO = 84;
const CORPO = 60;
const X = 72;
const LARGURA = 1056;
const TOPO = 185;
const FIM = 1355;
const MAX = { beneficios: 3, specs: 4, etapas: 4 };

// Entrelinha: 1,2 no título (til e cedilha não cruzam a linha de cima), 1,25 no corpo.
const altura = (fontePx: number, linhas: number) => Math.round(fontePx * (fontePx >= TITULO ? 1.2 : 1.25)) * linhas;

/**
 * Largura estimada do texto: 0,6 em por caractere (Inter 600–800 mede ~0,52–0,58 em em média; fator majorado ~10%
 * para nunca subestimar). Serve aos testes e à Task 12 para prever quebra e estouro.
 */
export const FATOR_LARGURA = 0.6;
export function linhasNecessarias(texto: string, fontePx: number, w: number): number {
  const porLinha = Math.max(1, Math.floor(w / (fontePx * FATOR_LARGURA)));
  let linhas = 1; let usado = 0;
  for (const p of texto.trim().split(/\s+/)) {
    const n = p.length;
    if (usado === 0) usado = n;
    else if (usado + 1 + n <= porLinha) usado += 1 + n;
    else { linhas++; usado = n; }
    while (usado > porLinha) { linhas++; usado -= porLinha; }
  }
  return linhas;
}
const caixa = (x: number, y: number, w: number, fontePx: number, linhasMax: number): Caixa =>
  ({ x, y, w, h: altura(fontePx, linhasMax), fontePx, linhasMax });

/** Headline (≤2 linhas) e, se houver, subheadline logo abaixo. */
function cabecalho(w: number, sub: boolean): Caixa[] {
  const h = caixa(X, TOPO, w, TITULO, 2);
  return sub ? [h, caixa(X, h.y + h.h + 20, w, CORPO, 2)] : [h];
}

// Coluna à esquerda: número/ícone em x 72–144, texto de x 170 a 760.
const COLUNA_X = 170;
const COLUNA_W = 590;

function coluna(n: number, passo: number, w: number, linhas: number): Caixa[] {
  const h = caixa(X, TOPO, LARGURA, TITULO, 2); // título na largura segura, faixa de topo reservada ao gerador
  const itens: Caixa[] = [];
  let y = h.y + h.h + 30;
  for (let i = 0; i < n; i++) {
    const c = caixa(COLUNA_X, y, w, CORPO, linhas);
    itens.push(c);
    y += c.h + passo;
  }
  return [h, ...itens];
}

export function layoutMissao(missao: number, t: TextosMissao): Caixa[] {
  switch (missao) {
    case 2:
      return cabecalho(LARGURA, !!t.subheadline);
    case 3: {
      // Chip logo abaixo do texto, na faixa de topo reservada (2 linhas: legenda de 5 palavras passa de 1056 px).
      const cab = cabecalho(LARGURA, !!t.subheadline);
      const ult = cab[cab.length - 1];
      return [...cab, ...(t.legendas?.length ? [caixa(X, ult.y + ult.h + 20, LARGURA, CORPO, 2)] : [])];
    }
    case 4:
      return coluna(Math.min(MAX.beneficios, t.beneficios?.length ?? 0), 40, COLUNA_W, 3);
    case 5: {
      // Ficha ancorada embaixo: título (2 linhas) + n linhas (rótulo e valor, 1 linha cada; valor longo é da Task 12).
      const n = Math.min(MAX.specs, t.specs?.length ?? 0);
      const linha = altura(CORPO, 1);
      const tit = altura(TITULO, 2);
      const topo = FIM - (tit + 24 + n * linha + Math.max(0, n - 1) * 20);
      const rows = Array.from({ length: n }, (_, i) => {
        const y = topo + tit + 24 + i * (linha + 20);
        return [caixa(X, y, 400, CORPO, 1), caixa(500, y, 628, CORPO, 1)];
      }).flat();
      return [caixa(X, topo, LARGURA, TITULO, 2), ...rows];
    }
    case 6: // etapa em até 2 linhas (decisão do Diego, 10/11): largura toda, 7 palavras a 60 px
      return coluna(Math.min(MAX.etapas, t.etapas?.length ?? 0), 30, LARGURA + X - COLUNA_X, 2);
    case 7: {
      // Duas lupas de 408 px (recortes da referência) em y 700–1108; legenda de até 3 linhas embaixo de cada uma.
      const legs = Math.min(2, t.legendas?.length ?? 0);
      return [
        caixa(X, TOPO, LARGURA, TITULO, 2),
        ...Array.from({ length: legs }, (_, i) => caixa(i ? 648 : X, 1130, 480, CORPO, 3)),
      ];
    }
    default:
      return [];
  }
}

/**
 * Dois recortes quadrados da referência (px da referência) para lupas/detalhes: terço da menor dimensão,
 * centrados na horizontal, a 15% e 85% da folga vertical (afastados ≥ um lado: nunca se sobrepõem). Sem gerador (R3.3).
 */
export function recortesDetalhe(refW: number, refH: number): Array<{ x: number; y: number; w: number; h: number }> {
  const lado = Math.max(1, Math.floor(Math.min(refW, refH) / 3));
  return [0.15, 0.85].map((fy) => ({
    x: Math.floor((refW - lado) / 2), y: Math.floor((refH - lado) * fy), w: lado, h: lado,
  }));
}
